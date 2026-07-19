using CorroServer.Models;
using CorroServer.Services.Commands;

namespace CorroServer.Services.Rules;

/// <summary>
/// CorroRulebook - DEBT & BANKRUPTCY
/// 
/// Debt mechanics in Corro:
/// - Debts are created when player can't afford a payment
/// - Player must resolve debts before continuing (sell/mortgage assets)
/// - If total assets < total debt, player must declare bankruptcy
/// - Bankruptcy transfers all assets to creditor (or bank)
/// </summary>
public partial class CorroRulebook
{
	// ============================================================
	// SECTION: DEBT RESOLUTION
	// ============================================================

	public async Task<DebtOutcome> ResolveDebtAsync(Player player, string? debtId, GameContext context)
	{
		context.Logger?.LogDebug("Rulebook: {PlayerName} resolving debt {DebtId}", player.Name, debtId ?? "(oldest)");

		var debts = context.GameState.PendingDebts
			.Where(d => d.DebtorId == player.Id)
			.OrderBy(d => d.CreatedAt)
			.ToList();

		if (!debts.Any())
		{
			return new DebtOutcome
			{
				Success = false,
				Error = "No pending debts",
				ErrorCode = "NO_DEBTS"
			};
		}

		// Find the debt to resolve
		DebtState? debtToResolve;
		if (!string.IsNullOrEmpty(debtId))
		{
			debtToResolve = debts.FirstOrDefault(d => d.Id == debtId);
			if (debtToResolve == null)
			{
				return new DebtOutcome
				{
					Success = false,
					Error = "Debt not found",
					ErrorCode = "DEBT_NOT_FOUND"
				};
			}
		}
		else
		{
			debtToResolve = debts.First();
		}

		// Check if player can afford
		if (player.Money < debtToResolve.Amount)
		{
			return new DebtOutcome
			{
				Success = false,
				Error = $"Insufficient funds. Have {player.Money}€, need {debtToResolve.Amount}€",
				ErrorCode = "INSUFFICIENT_FUNDS"
			};
		}

		// Pay the debt
		player.Money -= debtToResolve.Amount;

		if (debtToResolve.CreditorId == "Bank")
		{
			context.GameState.Bank.Money += debtToResolve.Amount;
			// A fine that fed the Free Parking pot when paid immediately (tax, card fine,
			// holding release cost) must STILL feed it when settled later via a debt — otherwise the
			// money silently vanishes into the bank instead of the pot.
			if (BankDebtFeedsFreeParkingPot(debtToResolve, context))
			{
				context.Helper.AddToFreeParkingPot(debtToResolve.Amount);
			}
		}
		else
		{
			var creditor = context.Helper.GetPlayer(debtToResolve.CreditorId);
			if (creditor != null)
			{
				creditor.Money += debtToResolve.Amount;
			}
		}

		context.GameState.PendingDebts.Remove(debtToResolve);

		context.Logger?.LogDebug("Debt resolved: {PlayerName} paid {Amount}€ to {Creditor}", player.Name, debtToResolve.Amount, debtToResolve.CreditorName);

		var remainingDebts = context.GameState.PendingDebts.Count(d => d.DebtorId == player.Id);

		// Server owns the spoken voice of debt resolution (actorId -> first person).
		await context.Announce("game.debt_resolved", new Dictionary<string, object>
		{
			{ "player", player.Name },
			{ "amount", debtToResolve.Amount },
			{ "creditor", debtToResolve.CreditorName },
			{ "actorId", player.Id }
		});

		if (remainingDebts > 0)
		{
			await context.Announce("game.debts_remaining", new Dictionary<string, object>
			{
				{ "count", remainingDebts },
				{ "actorId", player.Id }
			});
		}

		return new DebtOutcome
		{
			Success = true,
			DebtId = debtToResolve.Id,
			AmountPaid = debtToResolve.Amount,
			CreditorName = debtToResolve.CreditorName,
			RemainingDebts = remainingDebts
		};
	}

	// ============================================================
	// SECTION: BANKRUPTCY
	// ============================================================

	public async Task<BankruptcyOutcome> DeclareBankruptcyAsync(Player player, GameContext context)
	{
		context.Logger?.LogInformation("Rulebook: {PlayerName} declaring bankruptcy", player.Name);

		// --- Who inherits the estate? -------------------------------------------------
		// Official rule: a player bankrupted by a DEBT to another player hands everything to THAT
		// creditor — the one they couldn't pay when they went under — while a player bankrupted by
		// the bank (tax/cards) returns it to the bank (auction). A physical bank can't hold two
		// unpaid player-debts at once, but the deferred-debt model can, so the TRIGGER is the most
		// recent unpayable debt; any older debts are extinguished (RemoveAll below). Choosing the
		// largest/oldest creditor instead sent a bankrupt's estate to the wrong player — e.g. one
		// who fell on A's rent, then couldn't pay B, had the estate go to A rather than to B.
		var triggeringDebt = context.GameState.PendingDebts
			.Where(d => d.DebtorId == player.Id)
			.OrderByDescending(d => d.CreatedAt)
			.FirstOrDefault();

		string? beneficiaryId = null;
		var beneficiaryName = "Bank";
		if (triggeringDebt != null && triggeringDebt.CreditorId != "Bank")
		{
			var creditorPlayer = context.Helper.GetPlayer(triggeringDebt.CreditorId);
			if (creditorPlayer != null && !creditorPlayer.IsBankrupt)
			{
				beneficiaryId = creditorPlayer.Id;
				beneficiaryName = creditorPlayer.Name;
			}
		}

		// --- Liquidate buildings back to the bank, folding the proceeds into the cash pot ---
		var cash = player.Money;
		foreach (var propIndex in player.Properties)
		{
			var square = context.Helper.GetSquare(propIndex);
			if (square == null)
			{
				continue;
			}

			var buildingValue = GetBuildingSaleValue(square, context.Settings);
			if (buildingValue > 0)
			{
				cash += buildingValue;
				context.Helper.SetBankMoney(context.Helper.GetBankMoney() - buildingValue);
				square.SmallBuildings = 0;
				square.BigBuildings = 0;
			}
		}

		// --- Hand cash + properties to the beneficiary (creditor or bank) -------------
		var propertiesTransferred = new List<int>();
		var propertiesToBank = new List<int>();
		if (beneficiaryId != null)
		{
			// Credit via the bank helper so the creditor is flagged a money-gainer: if THEY
			// owe someone too, the sweep cascades and settles that debt next.
			context.Helper.AddPlayerMoney(beneficiaryId, cash);
			var creditor = context.Helper.GetPlayer(beneficiaryId)!;
			var inheritedMortgageInterest = 0;
			foreach (var propIndex in player.Properties)
			{
				var square = context.Helper.GetSquare(propIndex);
				if (square == null)
				{
					continue;
				}

				square.OwnerId = beneficiaryId; // mortgaged properties stay mortgaged
				context.GameState.Ownership.RemoveAll(o => o.Index == propIndex);
				context.GameState.Ownership.Add(new SquareOwnership { Index = propIndex, OwnerId = beneficiaryId });
				if (!creditor.Properties.Contains(propIndex))
				{
					creditor.Properties.Add(propIndex);
				}

				propertiesTransferred.Add(propIndex);

				// Official rule: inheriting a MORTGAGED property costs the new owner 10% interest on
				// the mortgage value, paid to the bank. (Unmortgaged lots transfer for free.)
				if (square is { Mortgaged: true } && square.Price is int price)
				{
					inheritedMortgageInterest += MortgageValueOf(price, context.Settings) * context.Settings.MortgageInterestRate / 100;
				}
			}

			// Charge the interest. Unlike a (voluntary) trade, this is forced — if the creditor
			// can't cover it, TryPay turns the shortfall into a bank debt they must settle (sell /
			// mortgage, or failing that, go bankrupt themselves). Either way the game records it.
			if (inheritedMortgageInterest > 0)
			{
				var (paid, _) = context.Helper.TryPay(beneficiaryId, null, inheritedMortgageInterest,
					DebtReason.Other, "Interest on inherited mortgaged properties");

				// Always explain the charge (the "why").
				await context.Announce("game.mortgage_inherited_fee", new Dictionary<string, object>
				{
					["actorId"] = beneficiaryId,
					["player"] = creditor.Name,
					["amount"] = inheritedMortgageInterest
				});

				// If they couldn't cover it, surface the new bank debt exactly like any other —
				// so the debt panel + voice pick it up and nobody panics that money vanished.
				if (!paid)
				{
					await context.Announce("game.debt_created", new Dictionary<string, object>
					{
						["player"] = creditor.Name,
						["amount"] = inheritedMortgageInterest,
						["creditor"] = "bank",
						["actorId"] = beneficiaryId
					});
				}
			}
		}
		else
		{
			context.Helper.SetBankMoney(context.Helper.GetBankMoney() + cash);
			foreach (var propIndex in player.Properties)
			{
				var square = context.Helper.GetSquare(propIndex);
				if (square == null)
				{
					continue;
				}

				square.OwnerId = null;
				square.Mortgaged = false; // returned to the bank free of mortgage
				context.GameState.Ownership.RemoveAll(o => o.Index == propIndex);
				propertiesToBank.Add(propIndex);
			}
		}

		// release passes held by the bankrupt player must not vanish: to a creditor
		// they pass along with the rest of the estate (the physical card stays held, the counter
		// moves); to the bank they return to the bottom of the deck so they can be drawn again.
		for (var i = 0; i < player.ReleasePasses; i++)
		{
			if (beneficiaryId != null)
			{
				context.Helper.AddPlayerReleasePass(beneficiaryId);
			}
			else
			{
				ReturnHeldReleasePassToDeck(context.GameState);
			}
		}
		player.ReleasePasses = 0;

		// --- The player is now out of the game ---------------------------------------
		// Finishing place = how many players were still in when they fell (themselves included):
		// the first of N to go out finishes Nth, the last one out finishes 2nd (runner-up).
		player.FinishPlace = context.GameState.Players.Count(p => !p.IsBankrupt);
		player.Properties.Clear();
		player.Money = 0;
		player.IsBankrupt = true;
		player.Status = PlayerStatus.Eliminated; // out of the game — the rotation skips them

		context.GameState.PendingDebts.RemoveAll(d => d.DebtorId == player.Id);

		context.Logger?.LogInformation(
			"{PlayerName} bankrupt -> {Beneficiary}. {Cash}€ and {Count} properties transferred.",
			player.Name, beneficiaryName, cash, propertiesTransferred.Count + propertiesToBank.Count);

		// --- Last player standing wins -----------------------------------------------
		var remainingPlayers = context.GameState.Players.Where(p => !p.IsBankrupt).ToList();
		var gameOver = remainingPlayers.Count <= 1;
		Player? winner = gameOver ? remainingPlayers.FirstOrDefault() : null;

		if (gameOver && winner != null)
		{
			context.GameState.IsGameOver = true;
			context.GameState.WinnerId = winner.Id;
			context.GameState.WinnerName = winner.Name;
			context.Logger?.LogInformation("GAME OVER! {WinnerName} wins!", winner.Name);
		}

		// Server owns the spoken voice of leaving / game over (actorId -> first person).
		// The WORDING is the family's: only the property family forfeits an estate and
		// speaks of bankruptcy; everywhere else this same flow is a plain retirement.
		var family = Services.Corro.Families.GameFamilies.For(context.GameState.GameType);
		await context.Announce(family.LeaveAnnouncementKey, new Dictionary<string, object>
		{
			{ "player", player.Name },
			{ "actorId", player.Id }
		});

		if (gameOver && winner != null)
		{
			await context.Announce("game.game_over", new Dictionary<string, object>
			{
				{ "winner", winner.Name },
				{ "actorId", winner.Id }
			});
		}
		else
		{
			// The game continues without them: the family folds their seat FIRST — while
			// CurrentTurn still tells whether the leaver held it, so turn-scoped leftovers
			// (journey's draw flag, race's pending choice/bonuses) can be cleaned — and so
			// play never stalls on a ghost (draft: a seat that never picks would block
			// every reveal).
			await family.OnPlayerRetiredAsync(player, context);

			if (context.GameState.CurrentTurn == player.Id)
			{
				// The player fell on their own turn: they can no longer act, so pass
				// play to the next (non-fallen) player rather than leaving the game stuck.
				context.Helper.NextTurn();
				var next = context.Helper.GetCurrentPlayer();
				await context.Announce("game.turn_of", new Dictionary<string, object>
				{
					["player"] = next?.Name ?? "",
					["actorId"] = next?.Id ?? ""
				});
			}
		}

		return new BankruptcyOutcome
		{
			Success = true,
			BeneficiaryId = beneficiaryId,
			BeneficiaryName = beneficiaryName,
			PropertiesTransferred = propertiesTransferred,
			PropertiesToAuction = propertiesToBank,
			CashTransferred = cash,
			RemainingPlayers = remainingPlayers.Count,
			GameOver = gameOver,
			WinnerId = winner?.Id,
			WinnerName = winner?.Name
		};
	}

	// ============================================================
	// SECTION: HELPERS
	// ============================================================

	/// <summary>
	/// After a command settles, auto-resolve any debts that became payable from cash the
	/// debtor GAINED during it. Resolving a debt credits its creditor (via the bank helper,
	/// which marks them as a gainer too), so a debtor paid by another debtor can clear in
	/// the same sweep. When no incoming cash remains, any player who still owes more than
	/// they could raise by liquidating EVERYTHING is forced into bankruptcy (official rule),
	/// which may credit a creditor and cascade — so we loop until the game settles.
	/// </summary>
	public async Task SweepResolvableDebtsAsync(GameContext context)
	{
		// Each iteration either resolves a debt, forces a bankruptcy, or stops; debts and
		// solvent-debtor count strictly decrease, so this converges. The guard is defensive.
		for (var guard = 0; guard < 256; guard++)
		{
			var gainers = context.Helper.DrainMoneyGainers();
			if (gainers.Count > 0)
			{
				foreach (var playerId in gainers)
				{
					await TryAutoResolveDebtsAsync(playerId, context);
				}
				continue; // re-check for cascaded gains before considering bankruptcy
			}

			// No more incoming cash: force bankruptcy on a genuinely insolvent debtor.
			var insolvent = FindForcedBankruptcyVictim(context);
			if (insolvent == null)
			{
				return;
			}

			await DeclareBankruptcyAsync(insolvent, context);
		}
	}

	/// <summary>
	/// The first non-bankrupt player who owes more than their total liquidatable assets and
	/// therefore must be forced into bankruptcy. A player who could still cover the debt by
	/// mortgaging / selling buildings is NOT forced — they keep the chance to do it manually.
	/// </summary>
	private Player? FindForcedBankruptcyVictim(GameContext context)
	{
		foreach (var player in context.GameState.Players)
		{
			if (player.IsBankrupt)
			{
				continue;
			}

			var debt = GetTotalDebt(player.Id, context);
			if (debt <= 0)
			{
				continue;
			}

			if (GetLiquidatableAssets(player, context) < debt)
			{
				return player;
			}
		}
		return null;
	}

	public int GetLiquidatableAssets(Player player, GameContext context)
	{
		var total = player.Money;
		foreach (var propIndex in player.Properties)
		{
			var square = context.Helper.GetSquare(propIndex);
			if (square == null)
			{
				continue;
			}

			total += GetBuildingSaleValue(square, context.Settings);
			// Only unmortgaged, building-free properties can still be mortgaged for cash.
			if (!square.Mortgaged && square.SmallBuildings == 0 && square.BigBuildings == 0 && square.Price.HasValue)
			{
				total += MortgageValueOf(square.Price.Value, context.Settings);
			}
		}
		return total;
	}

	/// <summary>
	/// A debt owed to the Bank whose fine feeds the Free Parking pot when paid up front
	/// (taxes, card fines and holding release cost) must still feed that pot when it is settled LATER,
	/// otherwise debt-settled money silently goes to the bank instead. Only when the jackpot
	/// smallBuilding rule is enabled; rent debts have a real creditor and never reach this path.
	/// </summary>
	private static bool BankDebtFeedsFreeParkingPot(DebtState debt, GameContext context)
		=> context.Settings.FreeParkingJackpot
		   && debt.Reason is DebtReason.Tax or DebtReason.Card or DebtReason.Holding;

	private async Task TryAutoResolveDebtsAsync(string playerId, GameContext context)
	{
		var player = context.Helper.GetPlayer(playerId);
		if (player == null)
		{
			return;
		}

		var debts = context.GameState.PendingDebts
			.Where(d => d.DebtorId == playerId)
			.OrderBy(d => d.CreatedAt)
			.ToList();

		if (debts.Count == 0)
		{
			return;
		}

		var resolvedAny = false;
		foreach (var debt in debts)
		{
			if (player.Money < debt.Amount)
			{
				break; // Stop at the first (oldest) debt the player still can't afford.
			}

			// Pay the debt
			player.Money -= debt.Amount;

			if (debt.CreditorId == "Bank")
			{
				context.GameState.Bank.Money += debt.Amount;
				// Mirror the immediate-payment behaviour: a tax/card/holding fine settled via
				// a debt still feeds the Free Parking pot (when the smallBuilding rule is on).
				if (BankDebtFeedsFreeParkingPot(debt, context))
				{
					context.Helper.AddToFreeParkingPot(debt.Amount);
				}
			}
			else
			{
				// Credit via the bank helper so the creditor is also flagged as a gainer:
				// a creditor who is themselves a debtor gets re-checked in the same sweep.
				context.Helper.AddPlayerMoney(debt.CreditorId, debt.Amount);
			}

			context.GameState.PendingDebts.Remove(debt);
			resolvedAny = true;
			context.Logger?.LogDebug("Auto-resolved: {PlayerName} paid {Amount}€ to {Creditor}", player.Name, debt.Amount, debt.CreditorName);

			// The server owns the spoken voice (actorId -> first person "You paid ...").
			await context.Announce("game.debt_resolved", new Dictionary<string, object>
			{
				["player"] = player.Name,
				["amount"] = debt.Amount,
				["creditor"] = debt.CreditorName,
				["actorId"] = player.Id
			});
		}

		if (!resolvedAny)
		{
			return;
		}

		var remaining = context.GameState.PendingDebts.Count(d => d.DebtorId == playerId);
		if (remaining > 0)
		{
			await context.Announce("game.debts_remaining", new Dictionary<string, object>
			{
				["count"] = remaining,
				["actorId"] = player.Id
			});
		}
		else
		{
			// All debts cleared: tell the player they may roll again. The turn-flow gates
			// in RollDiceHandler / EndTurnHandler stop blocking once PendingDebts is empty.
			await context.Announce("game.debt_cleared", new Dictionary<string, object>
			{
				["player"] = player.Name,
				["actorId"] = player.Id
			});
		}
	}

	private int GetTotalDebt(string playerId, GameContext context)
	{
		return context.GameState.PendingDebts
			.Where(d => d.DebtorId == playerId)
			.Sum(d => d.Amount);
	}
}
