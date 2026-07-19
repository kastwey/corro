using CorroServer.Models;
using CorroServer.Services.Commands;

namespace CorroServer.Services.Rules;

/// <summary>
/// The consistent API every card uses to mutate the game state.
/// Stateless: all state comes from the per-call <see cref="GameContext"/>.
/// </summary>
public interface ICardActions
{
	Task<CardEffect> MoveToSquareAsync(Player player, int targetPosition, bool collectGoIfPassed, GameContext context);
	CardEffect CollectFromBank(Player player, int amount, GameContext context);
	CardEffect PayToBank(Player player, int amount, GameContext context);
	Task<CardEffect> PayAllPlayersAsync(Player player, int amountPerPlayer, GameContext context);
	Task<CardEffect> CollectFromAllPlayersAsync(Player player, int amountPerPlayer, GameContext context);
	Task<CardEffect> PayRepairsAsync(Player player, int perSmallBuilding, int perBigBuilding, GameContext context);
	CardEffect ReceiveReleasePass(Player player, GameContext context);
	Task<CardEffect> SendToHoldingByCardAsync(Player player, GameContext context);
}

/// <summary>
/// Default implementation of <see cref="ICardActions"/>. Stateless singleton.
/// These are the effect primitives previously embedded in the card switch.
/// </summary>
public class CardActions : ICardActions
{
	public async Task<CardEffect> MoveToSquareAsync(
		Player player,
		int targetPosition,
		bool collectGoIfPassed,
		GameContext context)
	{
		// Close the "landed on the card square" segment first (dice + landing + card text +
		// the state standing on the deck square), THEN start the card's move. Without it
		// the client saw one lump: the token
		// animated straight to the card's destination while the whole turn was narrated at
		// once (live-play bug: "card sent me to GO and it all played as a single sequence").
		await context.Presenter.CheckpointTurnSegmentAsync();

		var oldPosition = player.Position;
		var passedGo = collectGoIfPassed && BoardCoordinates.DidPassThroughGo(oldPosition, targetPosition);

		context.Helper.SetPlayerPosition(player.Id, targetPosition);

		var square = context.GameState.Squares.FirstOrDefault(s => s.Id == targetPosition);

		// Announce the card's teleport as a MOVE-phase line for this segment. It arms
		// the client's announcement gate so the new state applies paced to the token hop and the
		// action bar's deferred refresh waits for the hop to settle. Without a move-phase line the
		// segment applied un-paced, the refresh fired mid-hop and never re-fired, so End Turn stayed
		// hidden and the turn was stranded.
		await context.Announcer.Announce("game.card_move", new Dictionary<string, object>
		{
			["player"] = player.Name,
			["square"] = square?.Name ?? $"{targetPosition}",
			["actorId"] = player.Id
		}, AnnouncementPhase.Move);

		// GO bonus + announcement come from the shared rule. Card teleports use the
		// standard pass bonus (no double-landing smallBuilding rule).
		if (collectGoIfPassed)
		{
			await GoBonusRules.AwardForMoveAsync(player, oldPosition, targetPosition, doubleOnLanding: false, context);
		}

		// Resolve the destination square (announce landing, charge rent, draw a nested
		// card, etc.) exactly like normal movement. Wired through the context to avoid
		// a construction-time dependency cycle between cards and the rulebook.
		if (context.ProcessLanding != null)
		{
			await context.ProcessLanding(player, targetPosition, context);
		}

		return new CardEffect
		{
			Type = "move",
			Description = $"Moved to {square?.Name ?? $"position {targetPosition}"}",
			MovedTo = targetPosition,
			PassedGo = passedGo
		};
	}

	public CardEffect CollectFromBank(Player player, int amount, GameContext context)
	{
		context.Helper.AddPlayerMoney(player.Id, amount);
		var bankMoney = context.Helper.GetBankMoney();
		context.Helper.SetBankMoney(bankMoney - amount);

		context.Logger?.LogDebug("{PlayerName} collected ${Amount} from bank", player.Name, amount);

		return new CardEffect
		{
			Type = "money",
			Amount = amount,
			Description = $"Collected ${amount} from the bank"
		};
	}

	public CardEffect PayToBank(Player player, int amount, GameContext context)
	{
		var (success, debtId) = context.Helper.TryPay(
			player.Id,
			null, // Bank
			amount,
			DebtReason.Card,
			"Card payment"
		);

		if (!success)
		{
			context.Logger?.LogDebug("{PlayerName} owes ${Amount} to bank (debt created)", player.Name, amount);
		}
		else
		{
			// Card fines feed the Free Parking pot (same smallBuilding rule as taxes) so a player
			// landing on Free Parking later collects them, instead of vanishing into the bank.
			// Only when the jackpot smallBuilding rule is enabled; otherwise the money goes to the bank.
			if (context.Settings.FreeParkingJackpot)
			{
				context.Helper.AddToFreeParkingPot(amount);
			}

			context.Logger?.LogDebug("{PlayerName} paid ${Amount} into the Free Parking pot", player.Name, amount);
		}

		return new CardEffect
		{
			Type = "money",
			Amount = -amount,
			Description = success ? $"Paid ${amount} to bank" : $"Debt of ${amount} created",
			DebtCreated = !success
		};
	}

	public async Task<CardEffect> PayAllPlayersAsync(Player player, int amountPerPlayer, GameContext context)
	{
		// Bankrupt players are out of the game: they neither receive nor pay on all-player cards.
		var otherPlayers = context.GameState.Players.Where(p => p.Id != player.Id && !p.IsBankrupt).ToList();
		var totalAmount = amountPerPlayer * otherPlayers.Count;
		bool anyDebt = false;

		// Pay each player directly so the money moves from the payer to the recipients
		// and is never duplicated into the bank (money must be conserved).
		foreach (var other in otherPlayers)
		{
			var (success, _) = context.Helper.TryPay(
				player.Id,
				other.Id,
				amountPerPlayer,
				DebtReason.Card,
				"Chairman payment"
			);
			if (!success)
			{
				anyDebt = true;
				// The chairman can't cover this player: surface the new debt aloud so a blind
				// player hears it, not only sees the panel change.
				await AnnounceDebtCreatedAsync(player, amountPerPlayer, other.Name, context);
			}
		}

		await context.Announce("game.paid_all_players", new Dictionary<string, object>
		{
			{ "player", player.Name },
			{ "amount", amountPerPlayer },
			{ "actorId", player.Id }
		});

		return new CardEffect
		{
			Type = "money",
			Amount = -totalAmount,
			Description = $"Paid ${amountPerPlayer} to each player",
			DebtCreated = anyDebt
		};
	}

	public async Task<CardEffect> CollectFromAllPlayersAsync(Player player, int amountPerPlayer, GameContext context)
	{
		// Bankrupt players are out of the game: they neither receive nor pay on all-player cards.
		var otherPlayers = context.GameState.Players.Where(p => p.Id != player.Id && !p.IsBankrupt).ToList();
		var totalCollected = 0;

		foreach (var other in otherPlayers)
		{
			var (success, _) = context.Helper.TryPay(
				other.Id,
				player.Id,
				amountPerPlayer,
				DebtReason.Card,
				"Birthday collection"
			);

			if (success)
			{
				totalCollected += amountPerPlayer;
			}
			else
			{
				// A player who can't pay the birthday money now owes it. Announce the debt so a
				// screen-reader user hears it — sighted players see the panel, blind players need
				// the spoken voice too.
				await AnnounceDebtCreatedAsync(other, amountPerPlayer, player.Name, context);
			}
		}

		await context.Announce("game.collected_from_all", new Dictionary<string, object>
		{
			{ "player", player.Name },
			{ "amount", amountPerPlayer },
			{ "actorId", player.Id }
		});

		return new CardEffect
		{
			Type = "money",
			Amount = totalCollected,
			Description = $"Collected ${amountPerPlayer} from each player"
		};
	}

	/// <summary>
	/// Announce a newly created debt (debtor owes <paramref name="creditorName"/>) on an
	/// all-player card. Tagged with the debtor as actor so they hear the first-person line and
	/// everyone else the third-person — the same voice every other debt uses.
	/// </summary>
	private static Task AnnounceDebtCreatedAsync(Player debtor, int amount, string creditorName, GameContext context)
		=> context.Announce("game.debt_created", new Dictionary<string, object>
		{
			["player"] = debtor.Name,
			["amount"] = amount,
			["creditor"] = creditorName,
			["actorId"] = debtor.Id
		});

	public async Task<CardEffect> PayRepairsAsync(
		Player player,
		int perSmallBuilding,
		int perBigBuilding,
		GameContext context)
	{
		// Count smallBuildings and bigBuildings owned by player
		var playerSquares = context.GameState.Squares
			.Where(s => s.OwnerId == player.Id)
			.ToList();

		var smallBuildings = playerSquares.Sum(s => s.SmallBuildings);
		var bigBuildings = playerSquares.Sum(s => s.BigBuildings);

		var totalCost = (smallBuildings * perSmallBuilding) + (bigBuildings * perBigBuilding);

		var success = true;
		if (totalCost > 0)
		{
			(success, _) = context.Helper.TryPay(
				player.Id,
				null,
				totalCost,
				DebtReason.Card,
				"Repairs"
			);

			// Repair fines feed the Free Parking pot too (consistent with taxes and
			// the other card fines), rather than disappearing into the bank — but only
			// when the jackpot smallBuilding rule is enabled.
			if (success && context.Settings.FreeParkingJackpot)
			{
				context.Helper.AddToFreeParkingPot(totalCost);
			}
		}

		// Always announce the amount, even 0€ (no buildings), so the player hears the
		// outcome of the card instead of silence.
		await context.Announce("game.paid_repairs", new Dictionary<string, object>
		{
			{ "player", player.Name },
			{ "smallBuildings", smallBuildings },
			{ "bigBuildings", bigBuildings },
			{ "amount", totalCost },
			{ "actorId", player.Id }
		});

		return new CardEffect
		{
			Type = "money",
			Amount = -totalCost,
			Description = totalCost > 0
				? $"Paid ${totalCost} for repairs ({smallBuildings} smallBuildings, {bigBuildings} bigBuildings)"
				: "No repairs needed (no smallBuildings or bigBuildings)",
			DebtCreated = !success
		};
	}

	public CardEffect ReceiveReleasePass(Player player, GameContext context)
	{
		context.Helper.AddPlayerReleasePass(player.Id);

		context.Logger?.LogDebug("{PlayerName} received a release pass", player.Name);

		return new CardEffect
		{
			Type = "releasePass",
			CardHeld = true,
			Description = "Received release pass"
		};
	}

	public async Task<CardEffect> SendToHoldingByCardAsync(Player player, GameContext context)
	{
		var oldPosition = player.Position;
		context.Helper.SendToHolding(player.Id, GameConstants.HoldingPosition, context.Settings.MaxHoldingTurns);


		await context.Announce("game.sent_to_holding_by_card", new Dictionary<string, object>
		{
			{ "player", player.Name },
			{ "actorId", player.Id }
		});

		return new CardEffect
		{
			Type = "holding",
			Description = "Go directly to Holding. Do not pass GO. Do not collect $200."
		};
	}
}
