using CorroServer.Models;
using CorroServer.Services;
using CorroServer.Services.Rules;

namespace CorroServer.Tests;

/// <summary>
/// The server is the single source of the spoken voice for debt resolution and
/// bankruptcy. These tests pin the actor-personalized announcements
/// (game.debt_resolved / game.debts_remaining / game.player_bankrupt /
/// game.game_over) so a refactor can't silently move the voice back to the client.
/// </summary>
public class DebtRulebookTests
{
	private static DebtState Debt(
		string id, string debtorId, int amount = 50,
		string creditorId = "Bank", string? creditorName = null, DateTime? createdAt = null,
		DebtReason reason = DebtReason.Rent) => new()
		{
			Id = id,
			DebtorId = debtorId,
			DebtorName = debtorId,
			CreditorId = creditorId,
			CreditorName = creditorName ?? creditorId,
			Amount = amount,
			Reason = reason,
			CreatedAt = createdAt ?? DateTime.UtcNow
		};

	[Fact]
	public async Task ResolveDebt_AnnouncesResolvedToActorAndOthers()
	{
		var a = TestFixtures.NewPlayer("a", money: 200);
		var b = TestFixtures.NewPlayer("b");
		var state = TestFixtures.NewState(new[] { a, b });
		state.PendingDebts.Add(Debt("d1", "a"));
		var context = TestFixtures.NewContext(state);
		var announcer = TestFixtures.Announcer(context);

		var outcome = await new CorroRulebook().ResolveDebtAsync(a, "d1", context);

		Assert.True(outcome.Success);
		Assert.Equal(0, outcome.RemainingDebts);
		Assert.True(announcer.Has(AnnouncementAudience.Player, "a", "game.debt_resolved_self"));
		Assert.True(announcer.Has(AnnouncementAudience.AllExcept, "a", "game.debt_resolved"));
		// No remaining debts -> debts_remaining is NOT announced.
		Assert.False(announcer.Has(AnnouncementAudience.Player, "a", "game.debts_remaining_self"));
	}

	[Fact]
	public async Task ResolveDebt_WithRemaining_AnnouncesDebtsRemaining()
	{
		var a = TestFixtures.NewPlayer("a", money: 300);
		var state = TestFixtures.NewState(new[] { a, TestFixtures.NewPlayer("b") });
		state.PendingDebts.Add(Debt("d1", "a"));
		state.PendingDebts.Add(Debt("d2", "a"));
		var context = TestFixtures.NewContext(state);
		var announcer = TestFixtures.Announcer(context);

		var outcome = await new CorroRulebook().ResolveDebtAsync(a, "d1", context);

		Assert.True(outcome.Success);
		Assert.Equal(1, outcome.RemainingDebts);
		Assert.True(announcer.Has(AnnouncementAudience.Player, "a", "game.debts_remaining_self"));
		Assert.True(announcer.Has(AnnouncementAudience.AllExcept, "a", "game.debts_remaining"));
	}

	[Fact]
	public async Task DeclareBankruptcy_AnnouncesBankruptToActorAndOthers()
	{
		var a = TestFixtures.NewPlayer("a", money: 0);
		var b = TestFixtures.NewPlayer("b", money: 1500);
		var c = TestFixtures.NewPlayer("c", money: 1500);
		var state = TestFixtures.NewState(new[] { a, b, c });
		var context = TestFixtures.NewContext(state);
		var announcer = TestFixtures.Announcer(context);

		var outcome = await new CorroRulebook().DeclareBankruptcyAsync(a, context);

		Assert.False(outcome.GameOver);
		Assert.True(announcer.Has(AnnouncementAudience.Player, "a", "game.player_bankrupt_self"));
		Assert.True(announcer.Has(AnnouncementAudience.AllExcept, "a", "game.player_bankrupt"));
		// Two players remain -> the game is not over.
		Assert.DoesNotContain(announcer.Sent, x => x.Key.StartsWith("game.game_over"));
	}

	private static List<Square> BoardWithMortgagedAt(int idx, string ownerId)
	{
		var board = new List<Square>();
		for (var i = 0; i < 6; i++)
		{
			board.Add(new Square { Id = i, Name = $"S{i}", Type = "property" });
		}

		board[idx] = new Square { Id = idx, Name = $"S{idx}", Type = "property", Price = 100, Mortgaged = true, OwnerId = ownerId };
		return board;
	}

	[Fact]
	public async Task DeclareBankruptcy_CreditorInheritingMortgaged_PaysTenPercentInterestToBank()
	{
		var a = TestFixtures.NewPlayer("a", money: 0);
		var b = TestFixtures.NewPlayer("b", money: 1000);
		var c = TestFixtures.NewPlayer("c", money: 1500);
		var state = TestFixtures.NewState(new[] { a, b, c }, squares: BoardWithMortgagedAt(1, "a"));
		a.Properties.Add(1);
		state.PendingDebts.Add(Debt("d1", "a", amount: 50, creditorId: "b", creditorName: "b"));
		var context = TestFixtures.NewContext(state);
		var announcer = TestFixtures.Announcer(context);
		var bankBefore = state.Bank.Money;

		await new CorroRulebook().DeclareBankruptcyAsync(a, context);

		var bb = state.Players.First(p => p.Id == "b");
		Assert.Equal("b", state.Squares[1].OwnerId);    // inherited
		Assert.True(state.Squares[1].Mortgaged);          // still mortgaged
		Assert.Equal(1000 - 5, bb.Money);                 // price 100 -> mortgage 50 -> 10% = 5
		Assert.Equal(bankBefore + 5, state.Bank.Money);   // paid to the bank
		Assert.Empty(state.PendingDebts);                 // b could afford it -> no new debt
		Assert.True(announcer.Has(AnnouncementAudience.AllExcept, "b", "game.mortgage_inherited_fee"));
	}

	[Fact]
	public async Task DeclareBankruptcy_CreditorCannotAffordInterest_RecordsABankDebt()
	{
		var a = TestFixtures.NewPlayer("a", money: 0);
		var b = TestFixtures.NewPlayer("b", money: 2); // can't cover the 5 interest
		var c = TestFixtures.NewPlayer("c", money: 1500);
		var state = TestFixtures.NewState(new[] { a, b, c }, squares: BoardWithMortgagedAt(1, "a"));
		a.Properties.Add(1);
		state.PendingDebts.Add(Debt("d1", "a", amount: 50, creditorId: "b", creditorName: "b"));
		var context = TestFixtures.NewContext(state);
		var announcer = TestFixtures.Announcer(context);

		await new CorroRulebook().DeclareBankruptcyAsync(a, context);

		var bb = state.Players.First(p => p.Id == "b");
		Assert.Equal("b", state.Squares[1].OwnerId);
		// The interest becomes a bank debt b must settle — they are not pushed into a negative balance.
		Assert.Equal(2, bb.Money);
		Assert.Contains(state.PendingDebts, d => d.DebtorId == "b" && d.Amount == 5);
		// The debt is announced (panel + voice) so nobody is left wondering where the money went.
		Assert.True(announcer.Has(AnnouncementAudience.Player, "b", "game.debt_created_self"));
	}

	[Fact]
	public async Task DeclareBankruptcy_ToCreditor_TransfersHeldReleasePasses()
	{
		var a = TestFixtures.NewPlayer("a", money: 0);
		a.ReleasePasses = 1;
		var b = TestFixtures.NewPlayer("b", money: 1500);
		var c = TestFixtures.NewPlayer("c", money: 1500);
		var state = TestFixtures.NewState(new[] { a, b, c });
		state.PendingDebts.Add(Debt("d1", "a", amount: 50, creditorId: "b", creditorName: "b"));
		var context = TestFixtures.NewContext(state);

		await new CorroRulebook().DeclareBankruptcyAsync(a, context);

		Assert.Equal(0, a.ReleasePasses);
		Assert.Equal(1, state.Players.First(p => p.Id == "b").ReleasePasses); // passed to the creditor
	}

	[Fact]
	public async Task DeclareBankruptcy_ToBank_ReturnsHeldReleasePassesToTheDeck()
	{
		var a = TestFixtures.NewPlayer("a", money: 0);
		a.ReleasePasses = 1;
		var b = TestFixtures.NewPlayer("b", money: 1500);
		var c = TestFixtures.NewPlayer("c", money: 1500);
		var state = TestFixtures.NewState(new[] { a, b, c });
		// The card a was holding lives in a package deck's held pile (the only deck kind now).
		state.PackageDecks["chance"] = new CardDeck
		{
			Cards = new List<string>(),
			HeldCards = new List<string> { "chance_release_pass" },
			IsInitialized = true,
		};
		var context = TestFixtures.NewContext(state); // no player debt -> estate goes to the bank

		await new CorroRulebook().DeclareBankruptcyAsync(a, context);

		Assert.Equal(0, a.ReleasePasses);
		Assert.Empty(state.PackageDecks["chance"].HeldCards);
		Assert.Contains("chance_release_pass", state.PackageDecks["chance"].Cards); // back in circulation
	}

	[Fact]
	public async Task DeclareBankruptcy_LastPlayerStanding_AnnouncesGameOverToWinner()
	{
		var a = TestFixtures.NewPlayer("a", money: 0);
		var b = TestFixtures.NewPlayer("b", money: 1500);
		var state = TestFixtures.NewState(new[] { a, b });
		var context = TestFixtures.NewContext(state);
		var announcer = TestFixtures.Announcer(context);

		var outcome = await new CorroRulebook().DeclareBankruptcyAsync(a, context);

		Assert.True(outcome.GameOver);
		Assert.Equal("b", outcome.WinnerId);
		Assert.True(announcer.Has(AnnouncementAudience.Player, "a", "game.player_bankrupt_self"));
		// The winner hears the first-person game over; everyone else the third-person base.
		Assert.True(announcer.Has(AnnouncementAudience.Player, "b", "game.game_over_self"));
		Assert.True(announcer.Has(AnnouncementAudience.AllExcept, "b", "game.game_over"));
	}

	[Fact]
	public async Task DeclareBankruptcy_StampsFinishPlace_InEliminationOrder()
	{
		// Four players fall in order a, b, c (d survives). The first out of four finishes 4th and
		// the last out finishes 2nd (runner-up), so the end screen can rank eliminated players by
		// how long they survived rather than alphabetically (their net worth is 0 either way).
		var a = TestFixtures.NewPlayer("a", money: 0);
		var b = TestFixtures.NewPlayer("b", money: 0);
		var c = TestFixtures.NewPlayer("c", money: 0);
		var d = TestFixtures.NewPlayer("d", money: 1500);
		var state = TestFixtures.NewState(new[] { a, b, c, d });
		var context = TestFixtures.NewContext(state);
		var rulebook = new CorroRulebook();

		await rulebook.DeclareBankruptcyAsync(a, context);
		await rulebook.DeclareBankruptcyAsync(b, context);
		await rulebook.DeclareBankruptcyAsync(c, context);

		Assert.Equal(4, a.FinishPlace);
		Assert.Equal(3, b.FinishPlace);
		Assert.Equal(2, c.FinishPlace);
		Assert.Equal(0, d.FinishPlace); // the winner is never stamped
	}

	// ── ResolveDebt validation / branches ─────────────────────────────────────

	[Fact]
	public async Task ResolveDebt_WithNoDebts_IsRejected()
	{
		var a = TestFixtures.NewPlayer("a", money: 200);
		var state = TestFixtures.NewState(new[] { a });
		var context = TestFixtures.NewContext(state);

		var outcome = await new CorroRulebook().ResolveDebtAsync(a, null, context);

		Assert.False(outcome.Success);
		Assert.Equal("NO_DEBTS", outcome.ErrorCode);
	}

	[Fact]
	public async Task ResolveDebt_UnknownDebtId_IsRejected()
	{
		var a = TestFixtures.NewPlayer("a", money: 200);
		var state = TestFixtures.NewState(new[] { a });
		state.PendingDebts.Add(Debt("d1", "a"));
		var context = TestFixtures.NewContext(state);

		var outcome = await new CorroRulebook().ResolveDebtAsync(a, "nope", context);

		Assert.False(outcome.Success);
		Assert.Equal("DEBT_NOT_FOUND", outcome.ErrorCode);
	}

	[Fact]
	public async Task ResolveDebt_WhenCannotAfford_IsRejected()
	{
		var a = TestFixtures.NewPlayer("a", money: 10);
		var state = TestFixtures.NewState(new[] { a });
		state.PendingDebts.Add(Debt("d1", "a", amount: 50));
		var context = TestFixtures.NewContext(state);

		var outcome = await new CorroRulebook().ResolveDebtAsync(a, "d1", context);

		Assert.False(outcome.Success);
		Assert.Equal("INSUFFICIENT_FUNDS", outcome.ErrorCode);
		Assert.Equal(10, a.Money); // untouched
	}

	[Fact]
	public async Task ResolveDebt_WithNoId_PaysOldestDebtFirst()
	{
		var a = TestFixtures.NewPlayer("a", money: 200);
		var state = TestFixtures.NewState(new[] { a });
		var oldest = Debt("old", "a", amount: 50, createdAt: DateTime.UtcNow.AddMinutes(-5));
		var newer = Debt("new", "a", amount: 70, createdAt: DateTime.UtcNow);
		state.PendingDebts.Add(newer);
		state.PendingDebts.Add(oldest);
		var context = TestFixtures.NewContext(state);

		var outcome = await new CorroRulebook().ResolveDebtAsync(a, null, context);

		Assert.True(outcome.Success);
		Assert.Equal("old", outcome.DebtId);
		Assert.Equal(1, outcome.RemainingDebts);
		Assert.Equal(150, a.Money); // 200 - 50
	}

	[Fact]
	public async Task ResolveDebt_OwedToAnotherPlayer_CreditsThatPlayer()
	{
		var a = TestFixtures.NewPlayer("a", money: 200);
		var b = TestFixtures.NewPlayer("b", money: 500);
		var state = TestFixtures.NewState(new[] { a, b }, bankMoney: 10000);
		var debt = Debt("d1", "a", amount: 80, creditorId: "b");
		state.PendingDebts.Add(debt);
		var context = TestFixtures.NewContext(state);
		var before = TestFixtures.TotalMoney(state);

		var outcome = await new CorroRulebook().ResolveDebtAsync(a, "d1", context);

		Assert.True(outcome.Success);
		Assert.Equal(120, a.Money);   // 200 - 80
		Assert.Equal(580, b.Money);   // 500 + 80
		Assert.Equal(before, TestFixtures.TotalMoney(state));
	}

	// ── Bank fine debts settled later still feed the Free Parking pot ─────────────

	[Fact]
	public async Task ResolveDebt_BankFineDebt_FeedsFreeParkingPot_WhenJackpotOn()
	{
		// Regression: a tax/card/holding fine the player couldn't afford up front becomes a
		// Bank debt. When that debt is SETTLED later it must still feed the Free Parking
		// pot (jackpot on) — exactly as if it had been paid immediately. Previously the
		// money silently went to the bank instead.
		var a = TestFixtures.NewPlayer("a", money: 650);
		var state = TestFixtures.NewState(new[] { a, TestFixtures.NewPlayer("b") });
		state.PendingDebts.Add(Debt("d1", "a", amount: 650, reason: DebtReason.Card));
		var context = TestFixtures.NewContext(state, new GameSettings { FreeParkingJackpot = true });

		var outcome = await new CorroRulebook().ResolveDebtAsync(a, "d1", context);

		Assert.True(outcome.Success);
		Assert.Equal(650, context.Helper.GetFreeParkingPot());
		Assert.Equal(0, a.Money);
	}

	[Fact]
	public async Task ResolveDebt_BankFineDebt_DoesNotFeedPot_WhenJackpotOff()
	{
		var a = TestFixtures.NewPlayer("a", money: 650);
		var state = TestFixtures.NewState(new[] { a, TestFixtures.NewPlayer("b") });
		state.PendingDebts.Add(Debt("d1", "a", amount: 650, reason: DebtReason.Card));
		var context = TestFixtures.NewContext(state, new GameSettings { FreeParkingJackpot = false });

		await new CorroRulebook().ResolveDebtAsync(a, "d1", context);

		Assert.Equal(0, context.Helper.GetFreeParkingPot()); // rule off -> bank, never the pot
	}

	[Fact]
	public async Task ResolveDebt_NonFineBankDebt_DoesNotFeedPot()
	{
		// Only tax/card/holding fines feed the pot; a Bank debt for some other reason must not.
		var a = TestFixtures.NewPlayer("a", money: 200);
		var state = TestFixtures.NewState(new[] { a, TestFixtures.NewPlayer("b") });
		state.PendingDebts.Add(Debt("d1", "a", amount: 50, reason: DebtReason.Other));
		var context = TestFixtures.NewContext(state, new GameSettings { FreeParkingJackpot = true });

		await new CorroRulebook().ResolveDebtAsync(a, "d1", context);

		Assert.Equal(0, context.Helper.GetFreeParkingPot());
	}

	[Fact]
	public async Task Sweep_BankFineDebt_FeedsFreeParkingPot_WhenJackpotOn()
	{
		// Same fix on the auto-resolution sweep path: a Bank fine debt cleared from cash
		// gained later must reach the pot, not the bank.
		var a = TestFixtures.NewPlayer("a", money: 0);
		var state = TestFixtures.NewState(new[] { a, TestFixtures.NewPlayer("b") }, bankMoney: 10000);
		state.PendingDebts.Add(Debt("d1", "a", amount: 200, reason: DebtReason.Tax));
		var context = TestFixtures.NewContext(state, new GameSettings { FreeParkingJackpot = true });
		var rulebook = new CorroRulebook();

		context.Helper.AddPlayerMoney("a", 200); // now affordable
		await rulebook.SweepResolvableDebtsAsync(context);

		Assert.Empty(state.PendingDebts);
		Assert.Equal(200, context.Helper.GetFreeParkingPot());
	}

	// ── Auto-resolution sweep (debt panel removed; recover from any cash gain) ────

	/// <summary>A brown property (price 100, mortgage value 50) owned by the given player.</summary>
	private static Square Brown(int id, string ownerId) => new()
	{
		Id = id,
		Name = $"Brown {id}",
		Type = "property",
		Color = "brown",
		Price = 100,
		BuildingCost = 50,
		Rent = new List<int> { 2, 10, 30, 90, 160, 250 },
		OwnerId = ownerId
	};

	[Fact]
	public async Task MortgagingToRaiseCash_SweepResolvesDebt_AnnouncesResolvedAndCanRoll()
	{
		var a = TestFixtures.NewPlayer("a", money: 10);
		a.Properties.Add(0);
		var state = TestFixtures.NewState(new[] { a, TestFixtures.NewPlayer("b") },
			bankMoney: 10000, squares: new List<Square> { Brown(0, "a") });
		state.PendingDebts.Add(Debt("d1", "a", amount: 50)); // owes the Bank 50, only has 10
		var context = TestFixtures.NewContext(state);
		var announcer = TestFixtures.Announcer(context);
		var rulebook = new CorroRulebook();

		// Mortgaging adds 50 -> 60. The post-command sweep then clears the 50 debt.
		var outcome = await rulebook.MortgagePropertyAsync(a, 0, context);
		await rulebook.SweepResolvableDebtsAsync(context);

		Assert.True(outcome.Success);
		Assert.Empty(state.PendingDebts);
		Assert.Equal(10, a.Money); // 10 + 50 mortgage - 50 debt
		Assert.True(announcer.Has(AnnouncementAudience.Player, "a", "game.debt_resolved_self"));
		Assert.True(announcer.Has(AnnouncementAudience.AllExcept, "a", "game.debt_resolved"));
		// All debts cleared -> the player is told they can roll again.
		Assert.True(announcer.Has(AnnouncementAudience.Player, "a", "game.debt_cleared_self"));
		Assert.True(announcer.Has(AnnouncementAudience.AllExcept, "a", "game.debt_cleared"));
		Assert.False(announcer.Has(AnnouncementAudience.Player, "a", "game.debts_remaining_self"));
	}

	[Fact]
	public async Task MortgagingWithDebtLeftover_SweepAnnouncesDebtsRemaining_NotCanRoll()
	{
		var a = TestFixtures.NewPlayer("a", money: 10);
		a.Properties.Add(0);
		a.Properties.Add(1); // a second property keeps them solvent after a partial payment
		var state = TestFixtures.NewState(new[] { a, TestFixtures.NewPlayer("b") },
			bankMoney: 10000, squares: new List<Square> { Brown(0, "a"), Brown(1, "a") });
		// Two 50 debts; mortgaging one property raises 50 -> can clear only the oldest one.
		// The still-mortgageable second property keeps assets >= the remaining debt, so the
		// sweep reports debts remaining instead of forcing bankruptcy.
		state.PendingDebts.Add(Debt("d1", "a", amount: 50, createdAt: DateTime.UtcNow.AddMinutes(-1)));
		state.PendingDebts.Add(Debt("d2", "a", amount: 50, createdAt: DateTime.UtcNow));
		var context = TestFixtures.NewContext(state);
		var announcer = TestFixtures.Announcer(context);
		var rulebook = new CorroRulebook();

		var outcome = await rulebook.MortgagePropertyAsync(a, 0, context);
		await rulebook.SweepResolvableDebtsAsync(context);

		Assert.True(outcome.Success);
		Assert.False(a.IsBankrupt);
		Assert.Single(state.PendingDebts);
		Assert.True(announcer.Has(AnnouncementAudience.Player, "a", "game.debt_resolved_self"));
		Assert.True(announcer.Has(AnnouncementAudience.Player, "a", "game.debts_remaining_self"));
		Assert.False(announcer.Has(AnnouncementAudience.Player, "a", "game.debt_cleared_self"));
	}

	[Fact]
	public async Task Sweep_ResolvesDebtFromCashGainedOutOfTurn()
	{
		// Núria owes the Bank 50 (e.g. a "collect from each player" card she couldn't
		// afford). It is NOT her turn. Later she receives rent and the sweep clears it.
		var nuria = TestFixtures.NewPlayer("nuria", money: 0);
		var eric = TestFixtures.NewPlayer("eric", money: 500);
		var state = TestFixtures.NewState(new[] { eric, nuria }, bankMoney: 10000);
		state.CurrentTurn = "eric"; // not Núria's turn
		state.PendingDebts.Add(Debt("d1", "nuria", amount: 50));
		var context = TestFixtures.NewContext(state);
		var announcer = TestFixtures.Announcer(context);
		var rulebook = new CorroRulebook();

		// Eric pays Núria 60 rent -> she now has enough; this marks her as a money gainer.
		context.Helper.TryPay("eric", "nuria", 60, DebtReason.Rent, "rent");
		await rulebook.SweepResolvableDebtsAsync(context);

		Assert.Empty(state.PendingDebts);
		Assert.Equal(10, nuria.Money); // 60 received - 50 debt
		Assert.True(announcer.Has(AnnouncementAudience.Player, "nuria", "game.debt_cleared_self"));
		Assert.True(announcer.Has(AnnouncementAudience.AllExcept, "nuria", "game.debt_cleared"));
	}

	[Fact]
	public async Task Sweep_ChainsResolution_WhenADebtorPaysAnotherDebtor()
	{
		// a owes b 50; b owes the Bank 50. Both are broke. a gains 50 -> pays b -> b can
		// now pay the Bank, all within one sweep (the creditor is re-checked).
		var a = TestFixtures.NewPlayer("a", money: 0);
		var b = TestFixtures.NewPlayer("b", money: 0);
		var state = TestFixtures.NewState(new[] { a, b }, bankMoney: 10000);
		state.PendingDebts.Add(Debt("d-a", "a", amount: 50, creditorId: "b", creditorName: "b"));
		state.PendingDebts.Add(Debt("d-b", "b", amount: 50)); // to Bank
		var context = TestFixtures.NewContext(state);
		var rulebook = new CorroRulebook();

		context.Helper.AddPlayerMoney("a", 50); // a receives cash
		await rulebook.SweepResolvableDebtsAsync(context);

		Assert.Empty(state.PendingDebts);
		Assert.Equal(0, a.Money); // 50 in - 50 to b
		Assert.Equal(0, b.Money); // 50 from a - 50 to Bank
	}

	[Fact]
	public async Task Sweep_DoesNotForceSaleOrAnnounce_WhenStillSolventButShortOnCash()
	{
		// The debtor owns a property and, by mortgaging it, COULD still cover the debt
		// (assets >= debt) — they are just short on liquid cash right now. The sweep must
		// neither auto-mortgage nor force bankruptcy: the debt stays so the player can
		// resolve it manually, and nothing is announced.
		var a = TestFixtures.NewPlayer("a", money: 10);
		a.Properties.Add(0);
		var state = TestFixtures.NewState(new[] { a, TestFixtures.NewPlayer("b") },
			bankMoney: 10000, squares: new List<Square> { Brown(0, "a") });
		state.PendingDebts.Add(Debt("d1", "a", amount: 80)); // assets = 40 cash + 50 mortgage = 90 >= 80
		var context = TestFixtures.NewContext(state);
		var announcer = TestFixtures.Announcer(context);
		var rulebook = new CorroRulebook();

		context.Helper.AddPlayerMoney("a", 30); // 40 total cash, still short of 80
		await rulebook.SweepResolvableDebtsAsync(context);

		Assert.Single(state.PendingDebts);
		Assert.Equal(40, a.Money);
		Assert.False(a.IsBankrupt);                 // still solvent -> not forced out
		Assert.False(state.Squares[0].Mortgaged);   // property untouched
		Assert.False(announcer.Has(AnnouncementAudience.Player, "a", "game.debt_resolved_self"));
	}

	[Fact]
	public async Task Sweep_ForcesBankruptcy_WhenAssetsCannotCoverDebt()
	{
		// Eric owes the Bank 200 but can raise at most 90 (40 cash + a 100-price property's
		// 50 mortgage value). He is genuinely insolvent, so the sweep forces bankruptcy
		// rather than leaving him stuck unable to ever clear the debt (bug: no escape).
		var eric = TestFixtures.NewPlayer("eric", money: 40);
		eric.Properties.Add(0);
		var nuria = TestFixtures.NewPlayer("nuria", money: 1500);
		var state = TestFixtures.NewState(new[] { eric, nuria },
			bankMoney: 10000, squares: new List<Square> { Brown(0, "eric") });
		state.CurrentTurn = "eric";
		state.PendingDebts.Add(Debt("d1", "eric", amount: 200));
		var context = TestFixtures.NewContext(state);
		var rulebook = new CorroRulebook();

		await rulebook.SweepResolvableDebtsAsync(context);

		Assert.True(eric.IsBankrupt);
		Assert.Empty(state.PendingDebts);
		Assert.Empty(eric.Properties);
		Assert.Equal(0, eric.Money);
		// Last solvent player standing -> game over, Núria wins.
		Assert.True(state.IsGameOver);
		Assert.Equal("nuria", state.WinnerId);
	}

	[Fact]
	public async Task DeclareBankruptcy_ToPlayerCreditor_TransfersCashAndProperties()
	{
		// Eric owes Núria 500 but is insolvent. Bankrupting to her hands over his cash and
		// his (mortgaged-stays-mortgaged) property; the game continues only if others remain.
		var eric = TestFixtures.NewPlayer("eric", money: 120);
		eric.Properties.Add(0);
		var nuria = TestFixtures.NewPlayer("nuria", money: 1000);
		var bob = TestFixtures.NewPlayer("bob", money: 1000);
		var prop = Brown(0, "eric");
		prop.Mortgaged = true; // already mortgaged -> stays mortgaged on transfer
		var state = TestFixtures.NewState(new[] { eric, nuria, bob },
			bankMoney: 10000, squares: new List<Square> { prop });
		state.Ownership.Add(new SquareOwnership { Index = 0, OwnerId = "eric" });
		state.CurrentTurn = "eric";
		state.PendingDebts.Add(Debt("d1", "eric", amount: 500, creditorId: "nuria", creditorName: "nuria"));
		var context = TestFixtures.NewContext(state);
		var rulebook = new CorroRulebook();

		var outcome = await rulebook.DeclareBankruptcyAsync(eric, context);

		Assert.True(outcome.Success);
		Assert.Equal("nuria", outcome.BeneficiaryId);
		Assert.Equal(120, outcome.CashTransferred);
		Assert.Contains(0, outcome.PropertiesTransferred);
		Assert.False(outcome.GameOver); // bob still in the game

		Assert.True(eric.IsBankrupt);
		// 1000 + 120 cash inherited, minus the 10% interest (5) for inheriting the mortgaged lot.
		Assert.Equal(1115, nuria.Money);
		Assert.Contains(0, nuria.Properties);       // property transferred
		Assert.Equal("nuria", state.Squares[0].OwnerId);
		Assert.True(state.Squares[0].Mortgaged);    // mortgaged stays mortgaged
		Assert.Equal("nuria", state.Ownership.Single(o => o.Index == 0).OwnerId);
		Assert.Empty(eric.Properties);
		Assert.Empty(state.PendingDebts);
	}

	[Fact]
	public async Task DeclareBankruptcy_WithSeveralCreditors_HandsEstateToTheTriggeringOne_NotTheLargestOrOldest()
	{
		// Playtest #7: Aelin fell on Juanjo's rent first (an older, LARGER debt), then couldn't pay
		// Eric's rent and went under. The estate must go to ERIC — the creditor she couldn't pay when
		// she declared bankruptcy — not to Juanjo; Juanjo's now-unbacked older debt is extinguished.
		// (The old rule handed it to the largest/oldest creditor, so it wrongly went to Juanjo.)
		var aelin = TestFixtures.NewPlayer("aelin", money: 0);
		aelin.Properties.Add(0);
		var juanjo = TestFixtures.NewPlayer("juanjo", money: 1000);
		var eric = TestFixtures.NewPlayer("eric", money: 1000);
		var state = TestFixtures.NewState(new[] { aelin, juanjo, eric },
			bankMoney: 10000, squares: new List<Square> { Brown(0, "aelin") });
		state.Ownership.Add(new SquareOwnership { Index = 0, OwnerId = "aelin" });
		state.CurrentTurn = "aelin";
		// Older + larger debt to Juanjo; the newer, smaller debt to Eric is what triggered the fall.
		state.PendingDebts.Add(Debt("d-juanjo", "aelin", amount: 300, creditorId: "juanjo", creditorName: "juanjo", createdAt: DateTime.UtcNow.AddMinutes(-2)));
		state.PendingDebts.Add(Debt("d-eric", "aelin", amount: 50, creditorId: "eric", creditorName: "eric", createdAt: DateTime.UtcNow));
		var context = TestFixtures.NewContext(state);

		var outcome = await new CorroRulebook().DeclareBankruptcyAsync(aelin, context);

		Assert.True(outcome.Success);
		Assert.Equal("eric", outcome.BeneficiaryId);   // the creditor she couldn't pay inherits
		Assert.Contains(0, eric.Properties);           // the street goes to Eric...
		Assert.Equal("eric", state.Squares[0].OwnerId);
		Assert.DoesNotContain(0, juanjo.Properties);   // ...not to Juanjo (the older/larger creditor)
		Assert.Empty(state.PendingDebts);              // Juanjo's now-unbacked older debt is wiped
	}

	[Fact]
	public async Task DeclareBankruptcy_AdvancesTurn_WhenBankruptPlayerWasCurrent()
	{
		// The bankrupt player held the turn; play must pass to a non-bankrupt rival rather
		// than staying stuck on a player who can no longer act.
		var a = TestFixtures.NewPlayer("a", money: 0);
		var b = TestFixtures.NewPlayer("b", money: 1500);
		var c = TestFixtures.NewPlayer("c", money: 1500);
		var state = TestFixtures.NewState(new[] { a, b, c });
		state.CurrentTurn = "a";
		var context = TestFixtures.NewContext(state);
		var announcer = TestFixtures.Announcer(context);

		await new CorroRulebook().DeclareBankruptcyAsync(a, context);

		Assert.Equal("b", state.CurrentTurn); // advanced past the bankrupt player
		Assert.Contains(announcer.Sent, x => x.Key == "game.turn_of");
	}

	[Fact]
	public void GetLiquidatableAssets_SumsCashMortgageAndBuildings()
	{
		var a = TestFixtures.NewPlayer("a", money: 100);
		a.Properties.Add(0);
		var square = Brown(0, "a");
		square.SmallBuildings = 2; // 2 smallBuildings * (BuildingCost 50 / 2) = 50
		var state = TestFixtures.NewState(new[] { a },
			bankMoney: 10000, squares: new List<Square> { square });
		var context = TestFixtures.NewContext(state);

		// 100 cash + 50 building resale; built property cannot also be mortgaged.
		var assets = new CorroRulebook().GetLiquidatableAssets(a, context);

		Assert.Equal(150, assets);
	}

	[Fact]
	public void Helper_FlagsMoneyGainers_OnlyForIndebtedPlayers()
	{
		// a and b owe money; c is debt-free. A cash gain can only ever clear an existing
		// debt, so only indebted players are recorded — c is never flagged, and a spend
		// (negative add) never flags anyone.
		var a = TestFixtures.NewPlayer("a", money: 100);
		var b = TestFixtures.NewPlayer("b", money: 100);
		var c = TestFixtures.NewPlayer("c", money: 100);
		var state = TestFixtures.NewState(new[] { a, b, c }, bankMoney: 10000);
		state.PendingDebts.Add(Debt("d-a", "a", amount: 50));
		state.PendingDebts.Add(Debt("d-b", "b", amount: 50));
		var context = TestFixtures.NewContext(state);

		context.Helper.AddPlayerMoney("a", 50);   // gain, a is indebted -> flagged
		context.Helper.AddPlayerMoney("b", -20);  // spend, not a gain
		context.Helper.AddPlayerMoney("c", 30);   // gain, but c is debt-free -> not flagged
		context.Helper.TryPay("a", "b", 10, DebtReason.Rent, "rent"); // b credited & indebted -> flagged

		var gainers = context.Helper.DrainMoneyGainers();
		Assert.Contains("a", gainers);
		Assert.Contains("b", gainers);
		Assert.DoesNotContain("c", gainers);
		// Draining clears the set.
		Assert.Empty(context.Helper.DrainMoneyGainers());
	}
}
