using CorroServer.Models;
using CorroServer.Services.Commands;

namespace CorroServer.Services.Rules;

/// <summary>
/// CorroRulebook - HOLDING RULES
///
/// How holding works in Corro:
/// 1. Player is sent to holding (Go To Holding square, card, or 3 doubles)
/// 2. On their turn, player can:
///    a) Try to roll doubles (3 attempts)
///    b) Pay $50 release cost before rolling
///    c) Use release pass
/// 3. After 3 failed attempts, must pay $50 and move with the dice roll
/// 4. Rolling doubles in holding does NOT give an extra turn
/// </summary>
public partial class CorroRulebook
{
	// ============================================================
	// SECTION: HOLDING RULES
	// ============================================================

	private async Task<DiceRollOutcome> ProcessHoldingRollAsync(
		Player player,
		DiceResult dice,
		GameContext context)
	{
		context.Logger?.LogDebug("{PlayerName} is in holding. Turns remaining: {Turns}", player.Name, player.HoldingTurnsRemaining);

		// Rolled doubles = escape free!
		if (dice.IsDoubles)
		{
			return await EscapeHoldingWithDoublesAsync(player, dice, context);
		}

		// No doubles - decrement turns
		context.Helper.DecrementHoldingTurns(player.Id);
		var turnsRemaining = context.Helper.GetPlayerHoldingTurnsRemaining(player.Id);

		context.Logger?.LogDebug("No doubles. Turns remaining: {Turns}", turnsRemaining);

		// Last turn = must pay the release cost
		if (turnsRemaining == 0)
		{
			return await EscapeHoldingWithReleaseCostAsync(player, dice, context);
		}

		// Still in holding
		return await StillHeld(player, dice, turnsRemaining, context);
	}

	private async Task<DiceRollOutcome> EscapeHoldingWithDoublesAsync(
		Player player,
		DiceResult dice,
		GameContext context)
	{
		context.Logger?.LogDebug("{PlayerName} rolled doubles and escapes holding!", player.Name);

		context.Helper.ReleaseFromHolding(player.Id);

		await context.Announce("game.escaped_holding_doubles", new Dictionary<string, object>
		{
			{ "player", player.Name },
			{ "actorId", player.Id }
		});

		var oldPosition = player.Position;
		await MovePlayerAsync(player, dice.StandardTotal, context);

		// Analyze landing
		var landing = AnalyzeLanding(player.Position, player.Id, context);
		context.LastDiceTotal = dice.StandardTotal;
		await ProcessLandingEffectsAsync(player, player.Position, context);

		// NOTE: Doubles in holding does NOT give an extra turn, and the turn no longer
		// auto-advances; the player keeps control and ends the turn explicitly.
		var (nextId, nextName) = await HandleTurnProgressionAsync(player, false, context);

		var (buySquareName, buyPrice, canBuy, canAfford) = ResolvePurchaseResponse(landing, player.Id, context);
		return new DiceRollOutcome
		{
			Die1 = dice.Die1,
			Die2 = dice.Die2,
			Total = dice.StandardTotal,
			IsDoubles = true,
			FromPosition = oldPosition,
			ToPosition = player.Position,
			NextPlayerId = nextId,
			NextPlayerName = nextName,
			SquareName = buySquareName,
			SquarePrice = buyPrice,
			CanBuySquare = canBuy,
			CanAfford = canAfford,
			ReleasedFromHolding = true
		};
	}

	private async Task<DiceRollOutcome> EscapeHoldingWithReleaseCostAsync(
		Player player,
		DiceResult dice,
		GameContext context)
	{
		context.Logger?.LogDebug("{PlayerName}'s last turn in holding - must pay the release cost!", player.Name);

		var releaseCost = context.Settings.HoldingReleaseCost;
		// Try to pay the release cost
		var (success, debtId) = context.Helper.TryPay(
			player.Id,
			null, // Bank
			releaseCost,
			DebtReason.Holding,
			"Holding release cost"
		);

		// Add to Free Parking pot or create debt. Paying release cost is the CAUSE that precedes
		// the move, so it is a MOVE-phase line: it is spoken immediately alongside the dice
		// roll, BEFORE the token hop animates — otherwise the AnnouncementGate would hold it
		// until the token settles and the player would hear "moved, then paid the release cost".
		if (success)
		{
			if (context.Settings.FreeParkingJackpot)
			{
				context.Helper.AddToFreeParkingPot(releaseCost);
			}
		}
		else
		{
			await context.Announcer.Announce("game.debt_created", new Dictionary<string, object>
			{
				{ "player", player.Name },
				{ "amount", releaseCost },
				{ "creditor", "bank" },
				{ "actorId", player.Id }
			}, AnnouncementPhase.Move);
		}

		// Release and move
		context.Helper.ReleaseFromHolding(player.Id);

		await context.Announcer.Announce("game.paid_holding_release_cost", new Dictionary<string, object>
		{
			{ "player", player.Name },
			{ "amount", releaseCost },
			{ "actorId", player.Id }
		}, AnnouncementPhase.Move);

		var oldPosition = player.Position;
		await MovePlayerAsync(player, dice.StandardTotal, context);

		// Analyze landing
		var landing = AnalyzeLanding(player.Position, player.Id, context);
		context.LastDiceTotal = dice.StandardTotal;
		await ProcessLandingEffectsAsync(player, player.Position, context);

		// The turn no longer auto-advances; the player keeps control and ends it explicitly.
		var (nextId, nextName) = await HandleTurnProgressionAsync(player, false, context);

		var (buySquareName, buyPrice, canBuy, canAfford) = ResolvePurchaseResponse(landing, player.Id, context);
		return new DiceRollOutcome
		{
			Die1 = dice.Die1,
			Die2 = dice.Die2,
			Total = dice.StandardTotal,
			IsDoubles = false,
			FromPosition = oldPosition,
			ToPosition = player.Position,
			NextPlayerId = nextId,
			NextPlayerName = nextName,
			SquareName = buySquareName,
			SquarePrice = buyPrice,
			CanBuySquare = canBuy,
			CanAfford = canAfford,
			ReleasedFromHolding = true,
			PaidReleaseCost = true,
			ReleaseCostAmount = releaseCost
		};
	}

	private async Task<DiceRollOutcome> StillHeld(
		Player player,
		DiceResult dice,
		int turnsRemaining,
		GameContext context)
	{
		context.Logger?.LogDebug("{PlayerName} remains in holding. {Turns} turns left.", player.Name, turnsRemaining);

		// The player failed to escape but keeps control of the turn: they may still
		// mortgage, trade or manage properties, then end the turn explicitly. The turn
		// does NOT auto-advance.
		await context.Announce("game.holding_still_in", new Dictionary<string, object>
		{
			{ "player", player.Name },
			{ "turns", turnsRemaining },
			{ "actorId", player.Id }
		});

		return new DiceRollOutcome
		{
			Die1 = dice.Die1,
			Die2 = dice.Die2,
			Total = dice.StandardTotal,
			IsDoubles = false,
			FromPosition = player.Position,
			ToPosition = player.Position, // Didn't move
			NextPlayerId = null,
			NextPlayerName = null,
			StillHeld = true,
			HoldingTurnsRemaining = turnsRemaining
		};
	}

	// ============================================================
	// HOLDING: Voluntary escape options (before rolling)
	// ============================================================

	public async Task<HoldingOutcome> PayReleaseCostAsync(Player player, GameContext context)
	{
		context.Logger?.LogDebug("Rulebook: {PlayerName} paying holding release cost", player.Name);

		if (!player.IsHeld)
		{
			return new HoldingOutcome
			{
				Success = false,
				Error = "Player is not in holding",
				ErrorCode = "NOT_HELD"
			};
		}

		if (context.GameState.CurrentTurn != player.Id)
		{
			return new HoldingOutcome
			{
				Success = false,
				Error = "Not your turn",
				ErrorCode = "NOT_YOUR_TURN"
			};
		}

		// ReleaseCost is paid BEFORE rolling. Once the player has rolled this turn the option is
		// gone (the frontend hides it, but the server must enforce it too). A pending
		// doubles re-roll does not count as having taken the turn's action.
		if (context.GameState.HasRolledThisTurn && !context.GameState.MustRollAgain)
		{
			return new HoldingOutcome
			{
				Success = false,
				Error = "You can only pay the release cost before rolling",
				ErrorCode = "ALREADY_ROLLED"
			};
		}

		var releaseCost = context.Settings.HoldingReleaseCost;
		// Try to pay the release cost
		var (success, debtId) = context.Helper.TryPay(
			player.Id,
			null, // Bank
			releaseCost,
			DebtReason.Holding,
			"Holding release cost"
		);

		if (success)
		{
			if (context.Settings.FreeParkingJackpot)
			{
				context.Helper.AddToFreeParkingPot(releaseCost);
			}

			await context.Announce("game.paid_holding_release_cost", new Dictionary<string, object>
			{
				{ "player", player.Name },
				{ "amount", releaseCost },
				{ "actorId", player.Id }
			});
		}
		else
		{
			await context.Announce("game.debt_created", new Dictionary<string, object>
			{
				{ "player", player.Name },
				{ "amount", releaseCost },
				{ "creditor", "bank" },
				{ "actorId", player.Id }
			});
		}

		// Release from holding (even if debt was created)
		context.Helper.ReleaseFromHolding(player.Id);

		context.Logger?.LogDebug("{PlayerName} paid {Amount}€ release cost and is released", player.Name, releaseCost);

		return new HoldingOutcome
		{
			Success = true,
			Released = true,
			AmountPaid = releaseCost
		};
	}

	public async Task<HoldingOutcome> UseReleasePassAsync(Player player, GameContext context)
	{
		context.Logger?.LogDebug("Rulebook: {PlayerName} using release pass", player.Name);

		if (!player.IsHeld)
		{
			return new HoldingOutcome
			{
				Success = false,
				Error = "Player is not in holding",
				ErrorCode = "NOT_HELD"
			};
		}

		if (context.GameState.CurrentTurn != player.Id)
		{
			return new HoldingOutcome
			{
				Success = false,
				Error = "Not your turn",
				ErrorCode = "NOT_YOUR_TURN"
			};
		}

		if (player.ReleasePasses <= 0)
		{
			return new HoldingOutcome
			{
				Success = false,
				Error = "No release passes available",
				ErrorCode = "NO_RELEASE_PASSES"
			};
		}

		// Use the card, then return it to the bottom of its deck so it can be drawn again
		// (official rule). Without this the card stays stuck in HeldCards forever — vanishing
		// from the game after a single use.
		context.Helper.RemovePlayerReleasePass(player.Id);
		context.Helper.ReleaseFromHolding(player.Id);
		ReturnHeldReleasePassToDeck(context.GameState);

		// Voice the release (live-play bug: the shortcut worked but said NOTHING). Same shape
		// as paid_holding_release_cost: the actor hears the _self variant, everyone else the named one.
		await context.Announce("game.used_release_pass", new Dictionary<string, object>
		{
			{ "player", player.Name },
			{ "actorId", player.Id }
		});

		context.Logger?.LogDebug("{PlayerName} used a release pass", player.Name);

		return new HoldingOutcome
		{
			Success = true,
			Released = true,
			CardsRemaining = player.ReleasePasses
		};
	}

	/// <summary>
	/// Return one used "Get Out of Holding Free" card from a deck's held pile to the bottom of its
	/// draw pile, so it re-enters circulation. Only release-pass cards are ever held, so any held
	/// card is one; the decks' cards are interchangeable, so returning the first found keeps the
	/// card count balanced (held count always equals the players' total release passes).
	/// </summary>
	private static void ReturnHeldReleasePassToDeck(GameState state)
	{
		foreach (var deck in state.PackageDecks.Values)
		{
			if (deck.HeldCards.Count > 0)
			{
				var cardId = deck.HeldCards[0];
				deck.HeldCards.RemoveAt(0);
				deck.Cards.Add(cardId); // bottom of the draw pile
				return;
			}
		}
	}

	// ============================================================
	// HOLDING: Sending to holding
	// ============================================================

	private async Task SendToHoldingAsync(Player player, GameContext context, string announcementKey = "game.send_to_holding")
	{
		var squares = context.Helper.GetSquares();
		var holdingIndex = squares.FindIndex(s => s.Key == "holding");
		if (holdingIndex == -1)
		{
			holdingIndex = 10; // Default holding position
		}

		context.Helper.SendToHolding(player.Id, holdingIndex, context.Settings.MaxHoldingTurns);

		// Phase follows the board's holding-movement rule: teleport (default) has no token hop for the
		// client to pace to, so the line is announced at once (Move — sound + toast + live region);
		// a board that makes the token WALK to holding keeps the default Resolve so the line is paced to
		// that hop. Applies to every holding trigger (third double, the square, a card).
		var phase = context.GameState.WalkToHolding ? AnnouncementPhase.Resolve : AnnouncementPhase.Move;
		await context.Announcer.Announce(announcementKey, new Dictionary<string, object>
		{
			{ "player", player.Name },
			{ "actorId", player.Id }
		}, phase);
	}
}
