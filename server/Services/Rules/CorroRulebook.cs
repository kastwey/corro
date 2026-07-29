using CorroServer.Models;
using CorroServer.Services.Commands;

namespace CorroServer.Services.Rules;

/// <summary>
/// The Corro Rulebook - THE central authority for all game rules.
///
/// This class is intentionally larger because it serves as the single
/// source of truth for game logic. Each section is clearly marked.
///
/// Sections:
/// - DICE ROLLING: Standard dice and doubles
/// - MOVEMENT: Moving around the board, passing GO
/// - HOLDING: All holding-related rules
/// - PROPERTY: Buying, renting, analyzing squares
/// - SQUARE EFFECTS: What happens when landing on different squares
/// - TURN MANAGEMENT: Doubles, passing turns
/// </summary>
public partial class CorroRulebook : ICorroRulebook
{
	private readonly IRandomSource _random;
	private static readonly BonusDieFace[] BonusDieFaces =
	[
		BonusDieFace.One,
		BonusDieFace.Two,
		BonusDieFace.Three,
		BonusDieFace.Express,
		BonusDieFace.Express,
		BonusDieFace.Bus,
	];

	public CorroRulebook(IRandomSource? randomSource = null)
	{
		_random = randomSource ?? new SystemRandomSource();
	}

	// ============================================================
	// MAIN ENTRY POINT
	// ============================================================

	public async Task<DiceRollOutcome> ProcessDiceRollAsync(Player player, GameContext context)
	{
		context.Logger?.LogDebug("Rulebook: Processing dice roll for {PlayerName}", player.Name);

		// 1. Roll the dice
		var dice = RollDice(context.Settings, player);
		LogDiceRoll(dice, context.Logger);

		// The player has now rolled this turn. The turn no longer auto-advances; the
		// player keeps control until they end the turn explicitly. This roll also
		// satisfies any pending doubles re-roll (re-set below if these dice are doubles).
		context.GameState.HasRolledThisTurn = true;
		context.GameState.MustRollAgain = false;

		// Announce the dice result first, before any landing consequences the move will stream.
		// A failed holding attempt is the one exception: it does not move, and its complete
		// roll + outcome is emitted below as ONE sentence. Two back-to-back live-region writes
		// made NVDA drop the roll and speak only "still in holding".
		var willRemainHeld = player.IsHeld && !dice.IsDoubles && player.HoldingTurnsRemaining > 1;
		if (!willRemainHeld)
		{
			await AnnounceDiceRollAsync(player, dice, context);
		}

		// 2. If in holding, apply holding rules
		if (player.IsHeld)
		{
			return await ProcessHoldingRollAsync(player, dice, context);
		}

		// White-die doubles count regardless of the bonus face. In particular, a Bus
		// must not bypass the third-consecutive-doubles speeding rule by pausing for a
		// destination choice first.
		if (dice.IsDoubles)
		{
			context.GameState.ConsecutiveDoubles++;
			if (context.GameState.ConsecutiveDoubles >= 3)
			{
				return await ProcessSpeedingToHoldingAsync(player, dice, player.Position, context);
			}
		}
		else
		{
			context.GameState.ConsecutiveDoubles = 0;
		}

		// 3. A Bus face pauses before movement until the roller chooses one die or both.
		if (dice.RequiresBusChoice)
		{
			return await SetupBusChoiceAsync(player, dice, context);
		}

		// 4. Normal movement
		return await ProcessNormalRollAsync(player, dice, context);
	}

	// ============================================================
	// SECTION: DICE ROLLING
	// ============================================================

	private record DiceResult
	{
		public int Die1 { get; init; }
		public int Die2 { get; init; }
		public bool IsDoubles { get; init; }
		public int StandardTotal => Die1 + Die2;
		public BonusDieFace? BonusDie { get; init; }
		public int BonusDieValue { get; init; }
		public int TotalMovement { get; init; }
		public bool RequiresBusChoice => BonusDie == BonusDieFace.Bus;
	}

	/// <inheritdoc />
	public int RollSingleDie() => _random.Next(1, 7);

	/// <inheritdoc />

	private DiceResult RollDice(GameSettings settings, Player player)
	{
		var die1 = _random.Next(1, 7);
		var die2 = _random.Next(1, 7);
		// The bonus die starts only after the first lap and is never thrown in holding.
		var useBonusDie = settings.UseBonusDie && player.LapsCompleted >= 1 && !player.IsHeld;
		BonusDieFace? bonusDie = null;
		var bonusValue = 0;
		if (useBonusDie)
		{
			bonusDie = BonusDieFaces[_random.Next(0, BonusDieFaces.Length)];
			bonusValue = bonusDie switch
			{
				BonusDieFace.One => 1,
				BonusDieFace.Two => 2,
				BonusDieFace.Three => 3,
				_ => 0,
			};
		}

		return new DiceResult
		{
			Die1 = die1,
			Die2 = die2,
			IsDoubles = die1 == die2,
			BonusDie = bonusDie,
			BonusDieValue = bonusValue,
			TotalMovement = die1 + die2 + bonusValue,
		};
	}

	private static void LogDiceRoll(DiceResult dice, ILogger? logger)
	{
		logger?.LogDebug("Dice: {Die1} + {Die2} = {Total}, doubles={IsDoubles}", dice.Die1, dice.Die2, dice.StandardTotal, dice.IsDoubles);
		if (dice.BonusDie is not null)
		{
			logger?.LogDebug("Bonus die: {Face} (value={Value})", dice.BonusDie, dice.BonusDieValue);
		}
	}

	/// <summary>
	/// Announces the dice result to every client. The actor's client swaps to the
	/// matching <c>_self</c> key for first-person phrasing.
	/// </summary>
	private static Task AnnounceDiceRollAsync(Player player, DiceResult dice, GameContext context)
	{
		var key = dice.BonusDie switch
		{
			BonusDieFace.One or BonusDieFace.Two or BonusDieFace.Three => dice.IsDoubles
				? "game.dice_rolled_bonus_doubles"
				: "game.dice_rolled_bonus",
			BonusDieFace.Express => dice.IsDoubles
				? "game.dice_rolled_express_doubles"
				: "game.dice_rolled_express",
			_ => dice.IsDoubles ? "game.dice_rolled_doubles" : "game.dice_rolled",
		};

		return context.Announcer.Announce(key, new Dictionary<string, object>
		{
			["player"] = player.Name,
			["die1"] = dice.Die1,
			["die2"] = dice.Die2,
			["bonus"] = dice.BonusDieValue,
			["total"] = dice.TotalMovement,
			["actorId"] = player.Id
		}, AnnouncementPhase.Move);
	}

	// ============================================================
	// SECTION: NORMAL ROLL PROCESSING
	// ============================================================

	private async Task<DiceRollOutcome> ProcessNormalRollAsync(
		Player player,
		DiceResult dice,
		GameContext context)
	{
		var oldPosition = player.Position;

		// Move the player
		await MovePlayerAsync(player, dice.TotalMovement, context);
		var newPosition = player.Position;

		context.Logger?.LogDebug("Movement: {OldPosition} -> {NewPosition}", oldPosition, newPosition);

		// Remember the throw so utility rent can multiply by it (4× / 10×).
		context.LastDiceTotal = dice.StandardTotal;

		// Resolve the square the player landed on (rent, tax, card, or a purchase offer).
		await ProcessLandingEffectsAsync(player, newPosition, context);

		// Express takes the first landing as normal, then advances to the next eligible
		// ownable square. A purchase/auction decision defers that second move.
		int? expressDestination = null;
		string? expressSquareName = null;
		if (dice.BonusDie == BonusDieFace.Express && !player.IsHeld)
		{
			if (context.GameState.PendingPurchase is not null || context.GameState.ActiveAuction is not null)
			{
				context.GameState.PendingExpressMove = new PendingExpressMove { PlayerId = player.Id };
			}
			else if (await ExecuteExpressMoveAsync(player, context) is { } destination)
			{
				expressDestination = destination.position;
				expressSquareName = destination.square.Name;
			}
		}

		// Analyze the resolved landing for the response.
		var landing = AnalyzeLanding(player.Position, player.Id, context);

		// Handle turn progression (announces roll-again on doubles; never auto-advances).
		var (nextId, nextName) = await HandleTurnProgressionAsync(player, dice.IsDoubles, context);

		context.Logger?.LogDebug("Rulebook: Dice roll completed");

		var (buySquareName, buyPrice, canBuy, canAfford) = ResolvePurchaseResponse(landing, player.Id, context);
		return new DiceRollOutcome
		{
			Die1 = dice.Die1,
			Die2 = dice.Die2,
			Total = dice.TotalMovement,
			IsDoubles = dice.IsDoubles,
			FromPosition = oldPosition,
			ToPosition = player.Position,
			NextPlayerId = nextId,
			NextPlayerName = nextName,
			SquareName = buySquareName,
			SquarePrice = buyPrice,
			CanBuySquare = canBuy,
			CanAfford = canAfford,
			BonusDie = dice.BonusDie,
			BonusDieValue = dice.BonusDieValue,
			ExpressDestination = expressDestination,
			ExpressSquareName = expressSquareName,
		};
	}

	// ============================================================
	// SECTION: MOVEMENT
	// ============================================================

	private async Task MovePlayerAsync(Player player, int spaces, GameContext context)
	{
		var fromPosition = player.Position;
		var toPosition = NormalizePosition(fromPosition + spaces);

		// Update position
		player.Position = toPosition;

		// GO bonus, lap counting and announcement live in one place (GoBonusRules),
		// shared with card teleports. Dice movement uses the double landing bonus.
		if (spaces > 0)
		{
			await GoBonusRules.AwardForMoveAsync(player, fromPosition, toPosition, doubleOnLanding: true, context);
		}
	}

	private static int NormalizePosition(int position)
	{
		return BoardCoordinates.NormalizePosition(position);
	}


	// ============================================================
	// SECTION: TURN MANAGEMENT
	// ============================================================

	private async Task<(string? nextId, string? nextName)> HandleTurnProgressionAsync(
		Player roller, bool isDoubles, GameContext context)
	{
		// The turn NEVER auto-advances. After a roll the player keeps control (buy,
		// manage properties, trade) and ends the turn explicitly via EndTurn.
		//
		// Doubles = the player owes another roll before they may end the turn. The
		// server owns the "roll again" voice and records the obligation so EndTurn can
		// refuse to pass the turn until the extra roll happens.
		//
		// EXCEPTION: if the move itself sent the player to holding (they landed on Go To Holding or
		// drew the card), the turn ends immediately — the doubles re-roll is forfeited.
		if (isDoubles && !roller.IsHeld)
		{
			context.GameState.MustRollAgain = true;
			await AnnounceDoublesRollAgainAsync(roller, context);
		}

		return (null, null);
	}

	/// <summary>
	/// "Caught speeding" — a third consecutive double. The player goes straight to holding without
	/// moving and owes no re-roll; like landing on Go To Holding, they keep control to end the turn.
	/// Announces game.holding_speeding (which the client maps to the holding-enter earcon).
	/// </summary>
	private async Task<DiceRollOutcome> ProcessSpeedingToHoldingAsync(
		Player player, DiceResult dice, int oldPosition, GameContext context)
	{
		context.GameState.ConsecutiveDoubles = 0;
		context.GameState.MustRollAgain = false;
		// SendToHoldingAsync picks the announcement phase from the board's holding-movement rule
		// (teleport => Move/immediate, walk => Resolve/paced), so this is never silent.
		await SendToHoldingAsync(player, context, "game.holding_speeding");

		return new DiceRollOutcome
		{
			Die1 = dice.Die1,
			Die2 = dice.Die2,
			Total = dice.TotalMovement,
			IsDoubles = dice.IsDoubles,
			FromPosition = oldPosition,
			ToPosition = player.Position, // holding
			NextPlayerId = null,
			NextPlayerName = null,
			StillHeld = true,
			HoldingTurnsRemaining = player.HoldingTurnsRemaining,
			BonusDie = dice.BonusDie,
			BonusDieValue = dice.BonusDieValue,
		};
	}

	// ------------------------------------------------------------
	// SECTION: ANNOUNCEMENT HELPERS
	//
	// The server is the single source of truth for the spoken voice of
	// game events. Every helper tags the acting player with "actorId" so the
	// Announce policy delivers the first-person "_self" variant to that player
	// and the third-person base key to everyone else.
	// ------------------------------------------------------------

	private static Task AnnounceDoublesRollAgainAsync(Player roller, GameContext context)
		=> context.Announce("game.doubles_roll_again", new Dictionary<string, object>
		{
			["player"] = roller.Name,
			["actorId"] = roller.Id
		});

	private static async Task AnnouncePurchaseAvailabilityAsync(Player player, LandingInfo landing, GameContext context)
	{
		if (!landing.CanBuy || landing.Square.Price == null)
		{
			return;
		}

		var price = landing.Square.Price.Value;
		await context.Announce("game.property_available", new Dictionary<string, object>
		{
			["player"] = player.Name,
			["property"] = SquareNameVar(landing.Square),
			["price"] = price,
			["actorId"] = player.Id
		});

		if (!landing.CanAfford)
		{
			await context.Announce("game.cannot_afford_property", new Dictionary<string, object>
			{
				["player"] = player.Name,
				["property"] = SquareNameVar(landing.Square),
				["price"] = price,
				["actorId"] = player.Id
			});
		}
	}

	public Task<TurnOutcome> EndTurnAsync(Player player, GameContext context)
	{
		// Validate it's the player's turn
		var currentPlayer = context.Helper.GetCurrentPlayer();
		if (currentPlayer?.Id != player.Id)
		{
			return Task.FromResult(new TurnOutcome
			{
				Success = false
			});
		}

		// Advance to next player
		context.Helper.NextTurn();
		var nextPlayer = context.Helper.GetCurrentPlayer();

		return Task.FromResult(new TurnOutcome
		{
			Success = true,
			NextPlayerId = nextPlayer?.Id,
			NextPlayerName = nextPlayer?.Name
		});
	}
}
