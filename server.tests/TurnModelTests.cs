using CorroServer.Models;
using CorroServer.Services.Commands;
using CorroServer.Services.Rules;

namespace CorroServer.Tests;

/// <summary>
/// Tests for the explicit end-turn model: the turn NEVER auto-advances. After rolling,
/// the player keeps control (buy, manage, trade) and must end the turn explicitly. The
/// server enforces the turn-phase rules (must roll first, owe no doubles re-roll, resolve
/// debt) and treats a pending purchase left at end-turn as "do not buy".
/// </summary>
public class TurnModelTests
{
	private static List<Square> SmallBoard() => new()
	{
		new Square { Id = 0, Name = "Go", Type = "go" },
		new Square { Id = 1, Name = "Baltic", Type = "property", Price = 100 },
		new Square { Id = 2, Name = "Square 2", Type = "property" },
		new Square { Id = 3, Name = "Square 3", Type = "property" },
	};

	private static PendingPurchase Pending() => new()
	{
		PlayerId = "a",
		SquareIndex = 1,
		SquareName = "Baltic",
		Price = 100
	};

	private static DebtState DebtFor(string playerId) => new()
	{
		Id = "d1",
		DebtorId = playerId,
		DebtorName = playerId,
		CreditorId = "Bank",
		CreditorName = "Bank",
		Amount = 50,
		Reason = DebtReason.Rent
	};

	// ── EndTurn guards ───────────────────────────────────────────────────────

	[Fact]
	public async Task EndTurn_BeforeRolling_IsRejected()
	{
		var a = TestFixtures.NewPlayer("a");
		var b = TestFixtures.NewPlayer("b");
		var state = TestFixtures.NewState(new[] { a, b }, squares: SmallBoard());
		state.HasRolledThisTurn = false;
		var context = TestFixtures.NewContext(state);

		var response = await new EndTurnHandler(new CorroRulebook())
			.HandleAsync(new EndTurnCommand { PlayerId = "a" }, context);

		var error = Assert.IsType<ErrorResponse>(response);
		Assert.Equal("NOT_ROLLED_YET", error.Code);
		Assert.Equal("a", state.CurrentTurn); // turn did not advance
	}

	[Fact]
	public async Task EndTurn_WhenOwedAnotherRoll_IsRejected()
	{
		var a = TestFixtures.NewPlayer("a");
		var b = TestFixtures.NewPlayer("b");
		var state = TestFixtures.NewState(new[] { a, b }, squares: SmallBoard());
		state.HasRolledThisTurn = true;
		state.MustRollAgain = true; // rolled doubles
		var context = TestFixtures.NewContext(state);

		var response = await new EndTurnHandler(new CorroRulebook())
			.HandleAsync(new EndTurnCommand { PlayerId = "a" }, context);

		var error = Assert.IsType<ErrorResponse>(response);
		Assert.Equal("MUST_ROLL_AGAIN", error.Code);
		Assert.Equal("a", state.CurrentTurn);
	}

	[Fact]
	public async Task EndTurn_WithUnresolvedDebt_IsRejected()
	{
		var a = TestFixtures.NewPlayer("a");
		var b = TestFixtures.NewPlayer("b");
		var state = TestFixtures.NewState(new[] { a, b }, squares: SmallBoard());
		state.HasRolledThisTurn = true;
		state.PendingDebts.Add(DebtFor("a"));
		var context = TestFixtures.NewContext(state);

		var response = await new EndTurnHandler(new CorroRulebook())
			.HandleAsync(new EndTurnCommand { PlayerId = "a" }, context);

		var error = Assert.IsType<ErrorResponse>(response);
		Assert.Equal("RESOLVE_DEBT_FIRST", error.Code);
		Assert.Equal("a", state.CurrentTurn);
	}

	[Fact]
	public async Task EndTurn_ByAnotherPlayer_IsRejected_AndTurnDoesNotAdvance()
	{
		// Regression: EndTurn used to validate only "has the current player rolled?"
		// and NOT "is it your turn?". So while it was A's turn (A had rolled), player B
		// could send EndTurn and pass the turn — effectively ending a turn without B
		// ever rolling. Only the current player may end the turn.
		var a = TestFixtures.NewPlayer("a");
		var b = TestFixtures.NewPlayer("b");
		var state = TestFixtures.NewState(new[] { a, b }, squares: SmallBoard());
		state.CurrentTurn = "a";
		state.HasRolledThisTurn = true; // A has rolled; B has not (and it isn't B's turn)
		var context = TestFixtures.NewContext(state);

		var response = await new EndTurnHandler(new CorroRulebook())
			.HandleAsync(new EndTurnCommand { PlayerId = "b" }, context);

		var error = Assert.IsType<ErrorResponse>(response);
		Assert.Equal("NOT_YOUR_TURN", error.Code);
		Assert.Equal("a", state.CurrentTurn); // turn stayed with A
	}

	[Fact]
	public async Task EndTurn_ByAnotherPlayer_BeforeAnyoneRolled_IsRejectedAsNotYourTurn()
	{
		// The turn-ownership guard takes precedence over the roll guard: a non-current
		// player gets NOT_YOUR_TURN regardless of the roll phase.
		var a = TestFixtures.NewPlayer("a");
		var b = TestFixtures.NewPlayer("b");
		var state = TestFixtures.NewState(new[] { a, b }, squares: SmallBoard());
		state.CurrentTurn = "a";
		state.HasRolledThisTurn = false;
		var context = TestFixtures.NewContext(state);

		var response = await new EndTurnHandler(new CorroRulebook())
			.HandleAsync(new EndTurnCommand { PlayerId = "b" }, context);

		var error = Assert.IsType<ErrorResponse>(response);
		Assert.Equal("NOT_YOUR_TURN", error.Code);
		Assert.Equal("a", state.CurrentTurn);
	}

	[Fact]
	public async Task EndTurn_AfterRolling_AdvancesTurn_AnnouncesNextPlayer()
	{
		var a = TestFixtures.NewPlayer("a");
		var b = TestFixtures.NewPlayer("b");
		var state = TestFixtures.NewState(new[] { a, b }, squares: SmallBoard());
		state.CurrentTurn = "a";
		state.HasRolledThisTurn = true;
		var context = TestFixtures.NewContext(state);

		var response = await new EndTurnHandler(new CorroRulebook())
			.HandleAsync(new EndTurnCommand { PlayerId = "a" }, context);

		Assert.IsType<TurnAnnouncementResponse>(response);
		Assert.Equal("b", state.CurrentTurn);
		var announcer = TestFixtures.Announcer(context);
		Assert.True(announcer.Has(AnnouncementAudience.Player, "b", "game.turn_of_self"));
		Assert.True(announcer.Has(AnnouncementAudience.AllExcept, "b", "game.turn_of"));
	}

	// ── EndTurn resolves a still-pending purchase as "do not buy" ─────────────

	[Fact]
	public async Task EndTurn_WithPendingPurchase_AuctionOff_ClearsPending_AndAdvances()
	{
		var a = TestFixtures.NewPlayer("a", position: 1);
		var b = TestFixtures.NewPlayer("b");
		var state = TestFixtures.NewState(new[] { a, b }, squares: SmallBoard());
		state.CurrentTurn = "a";
		state.HasRolledThisTurn = true;
		state.PendingPurchase = Pending();
		var context = TestFixtures.NewContext(state, new GameSettings { AuctionOnDecline = false });

		var response = await new EndTurnHandler(new CorroRulebook())
			.HandleAsync(new EndTurnCommand { PlayerId = "a" }, context);

		Assert.IsType<TurnAnnouncementResponse>(response);
		Assert.Null(state.PendingPurchase);   // the offer was declined
		Assert.Null(state.ActiveAuction);
		Assert.Equal("b", state.CurrentTurn);  // turn handed over
	}

	[Fact]
	public async Task EndTurn_WithPendingPurchase_AuctionOn_StartsAuction_DoesNotAdvance()
	{
		var a = TestFixtures.NewPlayer("a", position: 1);
		var b = TestFixtures.NewPlayer("b");
		var state = TestFixtures.NewState(new[] { a, b }, squares: SmallBoard());
		state.CurrentTurn = "a";
		state.HasRolledThisTurn = true;
		state.PendingPurchase = Pending();
		var context = TestFixtures.NewContext(state, new GameSettings { AuctionOnDecline = true });

		var response = await new EndTurnHandler(new CorroRulebook())
			.HandleAsync(new EndTurnCommand { PlayerId = "a" }, context);

		var declined = Assert.IsType<PropertyDeclinedResponse>(response);
		Assert.True(declined.AuctionStarted);
		Assert.NotNull(state.ActiveAuction);
		Assert.Null(state.PendingPurchase);
		// The auction owns turn flow; it will pass the turn when it resolves.
		Assert.Equal("a", state.CurrentTurn);
	}

	// ── Roll guard ───────────────────────────────────────────────────────────

	[Fact]
	public async Task RollDice_AfterRolling_WithoutDoubles_IsRejected()
	{
		var a = TestFixtures.NewPlayer("a");
		var b = TestFixtures.NewPlayer("b");
		var state = TestFixtures.NewState(new[] { a, b }, squares: TestFixtures.StandardBoard());
		state.HasRolledThisTurn = true;
		state.MustRollAgain = false;
		var context = TestFixtures.NewContext(state);

		var response = await new RollDiceHandler(new CorroRulebook())
			.HandleAsync(new RollDiceCommand { PlayerId = "a" }, context);

		var error = Assert.IsType<ErrorResponse>(response);
		Assert.Equal("ALREADY_ROLLED", error.Code);
	}

	[Fact]
	public async Task RollDice_FirstRoll_SetsHasRolledThisTurn()
	{
		var a = TestFixtures.NewPlayer("a");
		var b = TestFixtures.NewPlayer("b");
		var state = TestFixtures.NewState(new[] { a, b }, squares: TestFixtures.StandardBoard());
		state.HasRolledThisTurn = false;
		var context = TestFixtures.NewContext(state);

		var response = await new RollDiceHandler(new CorroRulebook())
			.HandleAsync(new RollDiceCommand { PlayerId = "a" }, context);

		Assert.IsNotType<ErrorResponse>(response);
		Assert.True(state.HasRolledThisTurn);
	}

	[Fact]
	public async Task RollDice_AgainWithPendingPurchase_AuctionOn_DeclinesAndStartsAuction_WithoutRolling()
	{
		var a = TestFixtures.NewPlayer("a", position: 1);
		var b = TestFixtures.NewPlayer("b");
		var state = TestFixtures.NewState(new[] { a, b }, squares: SmallBoard());
		state.CurrentTurn = "a";
		state.HasRolledThisTurn = true;
		state.MustRollAgain = true; // doubles: may roll again
		state.PendingPurchase = Pending();
		var context = TestFixtures.NewContext(state, new GameSettings { AuctionOnDecline = true });

		var response = await new RollDiceHandler(new CorroRulebook())
			.HandleAsync(new RollDiceCommand { PlayerId = "a" }, context);

		// Rolling again with a purchase pending declines it first (option A). The auction
		// must resolve before the player rolls, so no dice were rolled here.
		var declined = Assert.IsType<PropertyDeclinedResponse>(response);
		Assert.True(declined.AuctionStarted);
		Assert.NotNull(state.ActiveAuction);
		Assert.Null(state.PendingPurchase);
		Assert.Equal(1, a.Position); // player did not move
		Assert.True(state.MustRollAgain); // still owes the roll after the auction
	}
}
