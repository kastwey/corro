using CorroServer.Models;
using CorroServer.Services.Commands;
using CorroServer.Services.Rules;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// Tests for the player-to-player trade system: pure validation, the atomic swap on accept,
/// decline / cancel, and the announcements. Money conservation is asserted via
/// <see cref="TestFixtures.TotalMoney"/> for every accepted trade.
/// </summary>
public class TradeTests
{
	private static readonly List<int> StdRent = new() { 2, 10, 30, 90, 160, 250 };

	private static Square Prop(int id, string color) => new()
	{
		Id = id,
		Name = $"S{id}",
		Type = "property",
		Color = color,
		Price = 100,
		BuildingCost = 50,
		Rent = StdRent
	};

	/// <summary>
	/// Board: brown group at 1/2, light-blue group at 4/5, plus filler squares so the
	/// indices line up. Returns a fresh list each call.
	/// </summary>
	private static List<Square> Board()
	{
		var squares = new List<Square>();
		for (var i = 0; i < 8; i++)
		{
			squares.Add(new Square { Id = i, Name = $"S{i}", Type = "property" });
		}

		squares[1] = Prop(1, "brown");
		squares[2] = Prop(2, "brown");
		squares[4] = Prop(4, "lightblue");
		squares[5] = Prop(5, "lightblue");
		return squares;
	}

	private static void Give(GameState state, string playerId, int idx)
	{
		state.Squares[idx].OwnerId = playerId;
		state.Players.First(p => p.Id == playerId).Properties.Add(idx);
	}

	private static TradeState Trade(
		string initiatorId, string targetId,
		TradeOffer? give = null, TradeOffer? get = null)
		=> new()
		{
			Id = "T1",
			InitiatorId = initiatorId,
			InitiatorName = initiatorId,
			TargetId = targetId,
			TargetName = targetId,
			Initiator = give ?? new TradeOffer(),
			Target = get ?? new TradeOffer()
		};

	private static (GameState State, CorroRulebook Rules) Setup(int aMoney = 1500, int bMoney = 1500)
	{
		var a = TestFixtures.NewPlayer("A", aMoney);
		var b = TestFixtures.NewPlayer("B", bMoney);
		var state = TestFixtures.NewState(new[] { a, b }, squares: Board());
		return (state, new CorroRulebook());
	}

	// ============================================================
	// VALIDATION (pure)
	// ============================================================

	[Fact]
	public void Validate_BalancedPropertyTrade_IsValid()
	{
		var (state, _) = Setup();
		Give(state, "A", 1);
		Give(state, "B", 4);
		var trade = Trade("A", "B",
			new TradeOffer { Properties = new() { 1 } },
			new TradeOffer { Properties = new() { 4 } });

		var (ok, code) = CorroRulebook.ValidateTrade(state, trade);

		Assert.True(ok);
		Assert.Null(code);
	}

	[Fact]
	public void Validate_TradeWithYourself_IsRejected()
	{
		var (state, _) = Setup();
		Give(state, "A", 1);
		var trade = Trade("A", "A", new TradeOffer { Properties = new() { 1 } });

		var (ok, code) = CorroRulebook.ValidateTrade(state, trade);

		Assert.False(ok);
		Assert.Equal("SELF_TRADE", code);
	}

	[Fact]
	public void Validate_TradeWithBankruptPlayer_IsRejected()
	{
		var (state, _) = Setup();
		Give(state, "A", 1);
		state.Players.First(p => p.Id == "B").IsBankrupt = true; // B is out of the game
		var trade = Trade("A", "B", new TradeOffer { Properties = new() { 1 } });

		var (ok, code) = CorroRulebook.ValidateTrade(state, trade);

		Assert.False(ok);
		Assert.Equal("PLAYER_BANKRUPT", code);
	}

	[Fact]
	public void Validate_UnknownTarget_IsRejected()
	{
		var (state, _) = Setup();
		Give(state, "A", 1);
		var trade = Trade("A", "ghost", new TradeOffer { Properties = new() { 1 } });

		var (ok, code) = CorroRulebook.ValidateTrade(state, trade);

		Assert.False(ok);
		Assert.Equal("PLAYER_NOT_FOUND", code);
	}

	[Fact]
	public void Validate_EmptyTrade_IsRejected()
	{
		var (state, _) = Setup();
		var trade = Trade("A", "B");

		var (ok, code) = CorroRulebook.ValidateTrade(state, trade);

		Assert.False(ok);
		Assert.Equal("EMPTY_TRADE", code);
	}

	[Fact]
	public void Validate_OfferingPropertyYouDoNotOwn_IsRejected()
	{
		var (state, _) = Setup();
		Give(state, "B", 1); // B owns it, but A offers it
		var trade = Trade("A", "B", new TradeOffer { Properties = new() { 1 } });

		var (ok, code) = CorroRulebook.ValidateTrade(state, trade);

		Assert.False(ok);
		Assert.Equal("NOT_OWNER", code);
	}

	[Fact]
	public void Validate_RequestingPropertyTargetDoesNotOwn_IsRejected()
	{
		var (state, _) = Setup();
		Give(state, "A", 1);
		var trade = Trade("A", "B",
			new TradeOffer { Properties = new() { 1 } },
			new TradeOffer { Properties = new() { 4 } }); // B does not own 4

		var (ok, code) = CorroRulebook.ValidateTrade(state, trade);

		Assert.False(ok);
		Assert.Equal("NOT_OWNER", code);
	}

	[Fact]
	public void Validate_PropertyWhoseGroupHasBuildings_IsRejected()
	{
		var (state, _) = Setup();
		Give(state, "A", 1);
		Give(state, "A", 2);
		state.Squares[2].SmallBuildings = 1; // sibling in the brown group has a smallBuilding
		var trade = Trade("A", "B", new TradeOffer { Properties = new() { 1 } },
			new TradeOffer { Money = 10 });

		var (ok, code) = CorroRulebook.ValidateTrade(state, trade);

		Assert.False(ok);
		Assert.Equal("GROUP_HAS_BUILDINGS", code);
	}

	[Fact]
	public void Validate_OfferingMoreMoneyThanYouHave_IsRejected()
	{
		var (state, _) = Setup(aMoney: 100);
		var trade = Trade("A", "B", new TradeOffer { Money = 500 });

		var (ok, code) = CorroRulebook.ValidateTrade(state, trade);

		Assert.False(ok);
		Assert.Equal("INSUFFICIENT_FUNDS", code);
	}

	[Fact]
	public void Validate_OfferingMoreReleasePassesThanYouHave_IsRejected()
	{
		var (state, _) = Setup();
		var trade = Trade("A", "B", new TradeOffer { ReleasePasses = 1 });

		var (ok, code) = CorroRulebook.ValidateTrade(state, trade);

		Assert.False(ok);
		Assert.Equal("INSUFFICIENT_RELEASE_PASSES", code);
	}

	[Fact]
	public void Validate_SamePropertyOnBothSides_IsRejected()
	{
		var (state, _) = Setup();
		Give(state, "A", 1);
		var trade = Trade("A", "B",
			new TradeOffer { Properties = new() { 1 } },
			new TradeOffer { Properties = new() { 1 } });

		var (ok, code) = CorroRulebook.ValidateTrade(state, trade);

		Assert.False(ok);
		Assert.Equal("INVALID_TRADE", code);
	}

	[Fact]
	public void Validate_NegativeMoney_IsRejected()
	{
		var (state, _) = Setup();
		var trade = Trade("A", "B", new TradeOffer { Money = -10 });

		var (ok, code) = CorroRulebook.ValidateTrade(state, trade);

		Assert.False(ok);
		Assert.Equal("INVALID_TRADE", code);
	}

	// ============================================================
	// PROPOSE
	// ============================================================

	[Fact]
	public async Task Propose_ValidTrade_SetsActiveTradeAndAnnounces()
	{
		var (state, rules) = Setup();
		Give(state, "A", 1);
		var ctx = TestFixtures.NewContext(state);
		var trade = Trade("A", "B", new TradeOffer { Properties = new() { 1 } },
			new TradeOffer { Money = 50 });

		var outcome = await rules.ProposeTradeAsync(trade, ctx);

		Assert.True(outcome.Success);
		Assert.Equal("proposed", outcome.Outcome);
		Assert.Same(trade, state.ActiveTrade);
		Assert.True(state.ActiveTrade!.IsActive);
		// Announced with actorId so the initiator hears the _self variant and everyone else the base.
		var ann = TestFixtures.Announcer(ctx);
		Assert.True(ann.Has(AnnouncementAudience.AllExcept, "A", "game.trade_proposed"));
		Assert.True(ann.Has(AnnouncementAudience.Player, "A", "game.trade_proposed_self"));
		Assert.Equal("A", ann.Sent.Single(a => a.Key == "game.trade_proposed").Vars["actorId"]);
	}

	[Fact]
	public async Task Propose_WhenTradeAlreadyPending_IsRejected()
	{
		var (state, rules) = Setup();
		Give(state, "A", 1);
		var ctx = TestFixtures.NewContext(state);
		state.ActiveTrade = Trade("A", "B", new TradeOffer { Money = 1 });

		var trade = Trade("A", "B", new TradeOffer { Properties = new() { 1 } });
		var outcome = await rules.ProposeTradeAsync(trade, ctx);

		Assert.False(outcome.Success);
		Assert.Equal("TRADE_IN_PROGRESS", outcome.ErrorCode);
	}

	[Fact]
	public async Task Propose_InvalidTrade_DoesNotFreezeGame()
	{
		var (state, rules) = Setup();
		var ctx = TestFixtures.NewContext(state);
		var trade = Trade("A", "B"); // empty

		var outcome = await rules.ProposeTradeAsync(trade, ctx);

		Assert.False(outcome.Success);
		Assert.Equal("EMPTY_TRADE", outcome.ErrorCode);
		Assert.Null(state.ActiveTrade);
	}

	// ============================================================
	// ACCEPT
	// ============================================================

	[Fact]
	public async Task Accept_SwapsProperties_MoneyAndReleasePasses_AndClearsTrade()
	{
		var (state, rules) = Setup(aMoney: 1000, bMoney: 1000);
		Give(state, "A", 1);
		Give(state, "B", 4);
		state.Players.First(p => p.Id == "A").ReleasePasses = 1;
		var ctx = TestFixtures.NewContext(state);
		var before = TestFixtures.TotalMoney(state);

		var trade = Trade("A", "B",
			new TradeOffer { Properties = new() { 1 }, Money = 200, ReleasePasses = 1 },
			new TradeOffer { Properties = new() { 4 }, Money = 50 });
		await rules.ProposeTradeAsync(trade, ctx);

		var outcome = await rules.AcceptTradeAsync("B", "T1", ctx);

		Assert.True(outcome.Success);
		Assert.Equal("accepted", outcome.Outcome);
		Assert.Null(state.ActiveTrade);

		var a = state.Players.First(p => p.Id == "A");
		var b = state.Players.First(p => p.Id == "B");

		// Properties swapped (both Properties list and Square.OwnerId).
		Assert.Contains(4, a.Properties);
		Assert.DoesNotContain(1, a.Properties);
		Assert.Contains(1, b.Properties);
		Assert.DoesNotContain(4, b.Properties);
		Assert.Equal("B", state.Squares[1].OwnerId);
		Assert.Equal("A", state.Squares[4].OwnerId);

		// Net cash: A pays 200 - 50 = 150 to B.
		Assert.Equal(1000 - 150, a.Money);
		Assert.Equal(1000 + 150, b.Money);
		Assert.Equal(before, TestFixtures.TotalMoney(state));

		// Holding card moved A -> B.
		Assert.Equal(0, a.ReleasePasses);
		Assert.Equal(1, b.ReleasePasses);

		Assert.True(TestFixtures.Announcer(ctx).Has(AnnouncementAudience.AllExcept, "B", "game.trade_completed"));

		// The public "trade completed" line carries an itemized summary of what each side
		// gave (so every player, not just the two participants, learns what changed hands):
		// property names + cash for the prose, release-pass counts localised in the template.
		var completed = TestFixtures.Announcer(ctx).Sent.Single(x => x.Key == "game.trade_completed");
		Assert.Equal("S1, 200 euros", completed.Vars["offered"]);
		Assert.Equal("S4, 50 euros", completed.Vars["requested"]);
		Assert.Equal(1, completed.Vars["offeredCards"]);
		Assert.Equal(0, completed.Vars["requestedCards"]);
	}

	[Fact]
	public async Task Accept_TradeCash_ClearsTheReceiversPendingDebt()
	{
		// Regression: a player who OWES money and is PAID via a trade should clear the debt from
		// the trade cash. The trade moved money with a bare `player.Money +=`, so the receiver was
		// never flagged a money gainer and the post-command debt sweep skipped them — the debt hung.
		var (state, rules) = Setup(aMoney: 1000, bMoney: 0);
		state.PendingDebts.Add(new DebtState
		{
			Id = "d1",
			DebtorId = "B",
			DebtorName = "B",
			CreditorId = "Bank",
			CreditorName = "Bank",
			Amount = 100,
			Reason = DebtReason.Rent,
			CreatedAt = DateTime.UtcNow,
		});
		var ctx = TestFixtures.NewContext(state);

		// A pays B 150 in cash — enough to cover B's 100 debt.
		var trade = Trade("A", "B", new TradeOffer { Money = 150 }, new TradeOffer());
		await rules.ProposeTradeAsync(trade, ctx);
		await rules.AcceptTradeAsync("B", "T1", ctx);
		await rules.SweepResolvableDebtsAsync(ctx); // mirrors GameService's post-command hook

		Assert.Empty(state.PendingDebts);                                 // debt auto-cleared
		Assert.Equal(50, state.Players.First(p => p.Id == "B").Money);    // 0 + 150 trade - 100 debt
	}

	[Fact]
	public async Task Accept_PreservesMortgagedState()
	{
		var (state, rules) = Setup();
		Give(state, "A", 1);
		state.Squares[1].Mortgaged = true;
		var ctx = TestFixtures.NewContext(state);
		var trade = Trade("A", "B", new TradeOffer { Properties = new() { 1 } },
			new TradeOffer { Money = 10 });
		await rules.ProposeTradeAsync(trade, ctx);

		await rules.AcceptTradeAsync("B", "T1", ctx);

		Assert.Equal("B", state.Squares[1].OwnerId);
		Assert.True(state.Squares[1].Mortgaged);
	}

	[Fact]
	public async Task Accept_AcquiringMortgaged_ChargesTenPercentInterestToTheBank()
	{
		var (state, rules) = Setup(aMoney: 1000, bMoney: 1000);
		Give(state, "A", 1);
		state.Squares[1].Mortgaged = true; // price 100 -> mortgage value 50 -> 10% interest = 5
		var ctx = TestFixtures.NewContext(state);
		var before = TestFixtures.TotalMoney(state);
		var bankBefore = state.Bank.Money;

		var trade = Trade("A", "B", new TradeOffer { Properties = new() { 1 } }, new TradeOffer());
		await rules.ProposeTradeAsync(trade, ctx);
		var outcome = await rules.AcceptTradeAsync("B", "T1", ctx);

		Assert.True(outcome.Success);
		var b = state.Players.First(p => p.Id == "B");
		Assert.True(state.Squares[1].Mortgaged);              // still mortgaged after the swap
		Assert.Equal(1000 - 5, b.Money);                     // the new owner pays the 10% interest
		Assert.Equal(bankBefore + 5, state.Bank.Money);      // to the bank
		Assert.Equal(before, TestFixtures.TotalMoney(state)); // money conserved (bank included)
		Assert.True(TestFixtures.Announcer(ctx).Has(AnnouncementAudience.AllExcept, "B", "game.mortgage_transfer_fee"));
	}

	[Fact]
	public void Validate_TradeRejected_WhenReceiverCannotAffordTheMortgageInterest()
	{
		var (state, _) = Setup(aMoney: 1500, bMoney: 3); // B has only 3, but the interest is 5
		Give(state, "A", 1);
		state.Squares[1].Mortgaged = true;
		var trade = Trade("A", "B", new TradeOffer { Properties = new() { 1 } }, new TradeOffer());

		var (ok, code) = CorroRulebook.ValidateTrade(state, trade, new GameSettings());

		// The trade is rejected up front, so the receiver is never charged money they don't have.
		Assert.False(ok);
		Assert.Equal("INSUFFICIENT_FUNDS", code);
	}

	[Fact]
	public async Task Accept_ByWrongPlayer_IsRejectedAndTradeRemains()
	{
		var (state, rules) = Setup();
		Give(state, "A", 1);
		var ctx = TestFixtures.NewContext(state);
		var trade = Trade("A", "B", new TradeOffer { Properties = new() { 1 } },
			new TradeOffer { Money = 10 });
		await rules.ProposeTradeAsync(trade, ctx);

		var outcome = await rules.AcceptTradeAsync("A", "T1", ctx); // initiator cannot accept

		Assert.False(outcome.Success);
		Assert.Equal("NOT_TRADE_TARGET", outcome.ErrorCode);
		Assert.NotNull(state.ActiveTrade);
	}

	[Fact]
	public async Task Accept_WrongTradeId_IsRejected()
	{
		var (state, rules) = Setup();
		Give(state, "A", 1);
		var ctx = TestFixtures.NewContext(state);
		var trade = Trade("A", "B", new TradeOffer { Properties = new() { 1 } },
			new TradeOffer { Money = 10 });
		await rules.ProposeTradeAsync(trade, ctx);

		var outcome = await rules.AcceptTradeAsync("B", "WRONG", ctx);

		Assert.False(outcome.Success);
		Assert.Equal("NO_ACTIVE_TRADE", outcome.ErrorCode);
		Assert.NotNull(state.ActiveTrade);
	}

	// ============================================================
	// DECLINE / CANCEL
	// ============================================================

	[Fact]
	public async Task Decline_ClearsTradeWithoutMovingAssets()
	{
		var (state, rules) = Setup();
		Give(state, "A", 1);
		var ctx = TestFixtures.NewContext(state);
		var trade = Trade("A", "B", new TradeOffer { Properties = new() { 1 } },
			new TradeOffer { Money = 10 });
		await rules.ProposeTradeAsync(trade, ctx);

		var outcome = await rules.DeclineTradeAsync("B", "T1", ctx);

		Assert.True(outcome.Success);
		Assert.Equal("declined", outcome.Outcome);
		Assert.Null(state.ActiveTrade);
		Assert.Equal("A", state.Squares[1].OwnerId); // unchanged
		Assert.True(TestFixtures.Announcer(ctx).Has(AnnouncementAudience.AllExcept, "B", "game.trade_declined"));
	}

	[Fact]
	public async Task Cancel_ByInitiator_ClearsTrade()
	{
		var (state, rules) = Setup();
		Give(state, "A", 1);
		var ctx = TestFixtures.NewContext(state);
		var trade = Trade("A", "B", new TradeOffer { Properties = new() { 1 } },
			new TradeOffer { Money = 10 });
		await rules.ProposeTradeAsync(trade, ctx);

		var outcome = await rules.CancelTradeAsync("A", "T1", ctx);

		Assert.True(outcome.Success);
		Assert.Equal("cancelled", outcome.Outcome);
		Assert.Null(state.ActiveTrade);
		Assert.True(TestFixtures.Announcer(ctx).Has(AnnouncementAudience.AllExcept, "A", "game.trade_cancelled"));
	}

	[Fact]
	public async Task Cancel_ByNonInitiator_IsRejected()
	{
		var (state, rules) = Setup();
		Give(state, "A", 1);
		var ctx = TestFixtures.NewContext(state);
		var trade = Trade("A", "B", new TradeOffer { Properties = new() { 1 } },
			new TradeOffer { Money = 10 });
		await rules.ProposeTradeAsync(trade, ctx);

		var outcome = await rules.CancelTradeAsync("B", "T1", ctx);

		Assert.False(outcome.Success);
		Assert.Equal("NOT_TRADE_INITIATOR", outcome.ErrorCode);
		Assert.NotNull(state.ActiveTrade);
	}

	[Fact]
	public async Task Accept_WhenAssetsChangedToInvalid_DiscardsTradeWithoutSwapping()
	{
		// The dispatcher freeze normally prevents this, but accept re-validates defensively:
		// if the world changed so the trade is now illegal, it is discarded, not executed.
		var (state, rules) = Setup();
		Give(state, "A", 1);
		var ctx = TestFixtures.NewContext(state);
		var trade = Trade("A", "B", new TradeOffer { Properties = new() { 1 } },
			new TradeOffer { Money = 10 });
		await rules.ProposeTradeAsync(trade, ctx);

		// A no longer owns square 1 -> the pending trade is no longer valid.
		state.Squares[1].OwnerId = "B";
		state.Players.First(p => p.Id == "A").Properties.Remove(1);

		var outcome = await rules.AcceptTradeAsync("B", "T1", ctx);

		Assert.False(outcome.Success);
		Assert.Equal("NOT_OWNER", outcome.ErrorCode);
		Assert.Equal("declined", outcome.Outcome);
		Assert.Null(state.ActiveTrade); // discarded
	}

	[Fact]
	public async Task Decline_WhenNoActiveTrade_IsRejected()
	{
		var (state, rules) = Setup();
		var ctx = TestFixtures.NewContext(state);

		var outcome = await rules.DeclineTradeAsync("B", "T1", ctx);

		Assert.False(outcome.Success);
		Assert.Equal("NO_ACTIVE_TRADE", outcome.ErrorCode);
	}

	[Fact]
	public async Task Decline_ByWrongPlayer_IsRejectedAndTradeRemains()
	{
		var (state, rules) = Setup();
		Give(state, "A", 1);
		var ctx = TestFixtures.NewContext(state);
		var trade = Trade("A", "B", new TradeOffer { Properties = new() { 1 } },
			new TradeOffer { Money = 10 });
		await rules.ProposeTradeAsync(trade, ctx);

		var outcome = await rules.DeclineTradeAsync("A", "T1", ctx); // only the target may decline

		Assert.False(outcome.Success);
		Assert.Equal("NOT_TRADE_TARGET", outcome.ErrorCode);
		Assert.NotNull(state.ActiveTrade);
	}

	[Fact]
	public async Task Cancel_WhenNoActiveTrade_IsRejected()
	{
		var (state, rules) = Setup();
		var ctx = TestFixtures.NewContext(state);

		var outcome = await rules.CancelTradeAsync("A", "T1", ctx);

		Assert.False(outcome.Success);
		Assert.Equal("NO_ACTIVE_TRADE", outcome.ErrorCode);
	}

	[Fact]
	public async Task Accept_MovesReleasePassesFromTargetToInitiator()
	{
		var (state, rules) = Setup(aMoney: 1000, bMoney: 1000);
		state.Players.First(p => p.Id == "B").ReleasePasses = 2;
		var ctx = TestFixtures.NewContext(state);
		var trade = Trade("A", "B",
			new TradeOffer { Money = 100 },
			new TradeOffer { ReleasePasses = 2 });
		await rules.ProposeTradeAsync(trade, ctx);

		var outcome = await rules.AcceptTradeAsync("B", "T1", ctx);

		Assert.True(outcome.Success);
		Assert.Equal(2, state.Players.First(p => p.Id == "A").ReleasePasses);
		Assert.Equal(0, state.Players.First(p => p.Id == "B").ReleasePasses);
	}
}
