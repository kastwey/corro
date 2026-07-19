using CorroServer.Models;
using CorroServer.Services.Commands;
using CorroServer.Services.Rules;

namespace CorroServer.Tests;

/// <summary>
/// Tests for the reflection-free <see cref="CommandDispatcher"/>: it must route a command
/// to the registered typed handler and report unknown command types as errors.
/// </summary>
public class CommandDispatcherTests
{
	private sealed record UnregisteredCommand : GameCommand
	{
		public override string Type => "UNREGISTERED";
	}

	private static CommandDispatcher NewDispatcher()
		=> new(new CorroRulebook(), new AuctionRulebook());

	[Fact]
	public async Task Dispatch_UnknownCommand_ReturnsUnknownCommandError()
	{
		var dispatcher = NewDispatcher();
		var state = TestFixtures.NewState(new[] { TestFixtures.NewPlayer("a") });
		var context = TestFixtures.NewContext(state);

		var response = await dispatcher.DispatchAsync(new UnregisteredCommand { PlayerId = "a" }, context);

		var error = Assert.IsType<ErrorResponse>(response);
		Assert.Equal("UNKNOWN_COMMAND", error.Code);
	}

	[Fact]
	public async Task Dispatch_RegisteredCommand_RoutesToHandler()
	{
		var dispatcher = NewDispatcher();
		var state = TestFixtures.NewState(new[] { TestFixtures.NewPlayer("a") });
		var context = TestFixtures.NewContext(state);

		// GetMoney is a simple registered handler that returns a non-error response.
		var response = await dispatcher.DispatchAsync(new GetMoneyCommand { PlayerId = "a" }, context);

		Assert.NotNull(response);
		Assert.IsNotType<ErrorResponse>(response);
	}

	// ── Server-authoritative turn guard ──────────────────────────────────────

	[Fact]
	public void CheckTurn_TurnBoundCommandFromOtherPlayer_IsRejected()
		=> Assert.Equal("NOT_YOUR_TURN",
			CommandDispatcher.CheckTurn(new RollDiceCommand { PlayerId = "b" }, currentTurn: "a"));

	[Fact]
	public void CheckTurn_TurnBoundCommandFromCurrentPlayer_IsAllowed()
		=> Assert.Null(CommandDispatcher.CheckTurn(new RollDiceCommand { PlayerId = "a" }, currentTurn: "a"));

	[Fact]
	public void CheckTurn_OffTurnCommandFromAnyPlayer_IsAllowed()
		=> Assert.Null(CommandDispatcher.CheckTurn(new PlaceBidCommand { PlayerId = "b", SquareIndex = 1, Amount = 50 }, currentTurn: "a"));

	[Fact]
	public async Task Dispatch_TurnBoundCommandFromOtherPlayer_ReturnsNotYourTurn()
	{
		var dispatcher = NewDispatcher();
		// CurrentTurn defaults to the first player ("a").
		var state = TestFixtures.NewState(new[] { TestFixtures.NewPlayer("a"), TestFixtures.NewPlayer("b") });
		var context = TestFixtures.NewContext(state);

		var response = await dispatcher.DispatchAsync(new RollDiceCommand { PlayerId = "b" }, context);

		var error = Assert.IsType<ErrorResponse>(response);
		Assert.Equal("NOT_YOUR_TURN", error.Code);
	}

	[Fact]
	public async Task Dispatch_TurnBoundCommandFromCurrentPlayer_PassesTheGuard()
	{
		var dispatcher = NewDispatcher();
		var state = TestFixtures.NewState(new[] { TestFixtures.NewPlayer("a"), TestFixtures.NewPlayer("b") });
		var context = TestFixtures.NewContext(state);

		// EndTurn is turn-bound; from the current player it must NOT be rejected by the turn guard.
		var response = await dispatcher.DispatchAsync(new EndTurnCommand { PlayerId = "a" }, context);

		Assert.False(response is ErrorResponse { Code: "NOT_YOUR_TURN" });
	}

	[Fact]
	public async Task Dispatch_OffTurnCommandFromOtherPlayer_IsNotRejectedByTurnGuard()
	{
		var dispatcher = NewDispatcher();
		var state = TestFixtures.NewState(new[] { TestFixtures.NewPlayer("a"), TestFixtures.NewPlayer("b") });
		var context = TestFixtures.NewContext(state);

		// A query is not turn-bound: player "b" may run it on player "a"'s turn.
		var response = await dispatcher.DispatchAsync(new GetMoneyCommand { PlayerId = "b" }, context);

		Assert.False(response is ErrorResponse { Code: "NOT_YOUR_TURN" });
	}

	[Theory]
	// Turn-bound: only the current player may issue these.
	[InlineData("ROLL_DICE", true)]
	[InlineData("BUY_PROPERTY", true)]
	[InlineData("END_TURN", true)]
	[InlineData("PAY_HOLDING_RELEASE_COST", true)]
	[InlineData("USE_RELEASE_PASS", true)]
	// Off-turn: auctions, property management, debt and queries.
	[InlineData("PLACE_BID", false)]
	[InlineData("PASS_AUCTION", false)]
	[InlineData("MORTGAGE_PROPERTY", false)]
	[InlineData("BUILD", false)]
	[InlineData("SELL_BUILDINGS", false)]
	[InlineData("RESOLVE_DEBT", false)]
	[InlineData("GET_MONEY", false)]
	public void RequiresTurn_FlagMatchesExpectation(string type, bool requiresTurn)
	{
		GameCommand cmd = type switch
		{
			"ROLL_DICE" => new RollDiceCommand { PlayerId = "a" },
			"BUY_PROPERTY" => new BuyPropertyCommand { PlayerId = "a", SquareIndex = 1 },
			"END_TURN" => new EndTurnCommand { PlayerId = "a" },
			"PAY_HOLDING_RELEASE_COST" => new PayReleaseCostCommand { PlayerId = "a" },
			"USE_RELEASE_PASS" => new UseReleasePassCommand { PlayerId = "a" },
			"PLACE_BID" => new PlaceBidCommand { PlayerId = "a", SquareIndex = 1, Amount = 1 },
			"PASS_AUCTION" => new PassAuctionCommand { PlayerId = "a", SquareIndex = 1 },
			"MORTGAGE_PROPERTY" => new MortgagePropertyCommand { PlayerId = "a", SquareIndex = 1 },
			"BUILD" => new BuildCommand { PlayerId = "a", SquareIndex = 1 },
			"SELL_BUILDINGS" => new SellBuildingsCommand { PlayerId = "a", SquareIndex = 1 },
			"RESOLVE_DEBT" => new ResolveDebtCommand { PlayerId = "a" },
			"GET_MONEY" => new GetMoneyCommand { PlayerId = "a" },
			_ => throw new ArgumentOutOfRangeException(nameof(type), type, null)
		};

		Assert.Equal(requiresTurn, cmd.RequiresTurn);
	}

	// ── Trade freeze guard ───────────────────────────────────────────────────

	private static GameState FrozenState()
	{
		var state = TestFixtures.NewState(new[] { TestFixtures.NewPlayer("a"), TestFixtures.NewPlayer("b") });
		state.ActiveTrade = new TradeState
		{
			Id = "T1",
			InitiatorId = "a",
			InitiatorName = "a",
			TargetId = "b",
			TargetName = "b",
			Initiator = new TradeOffer { Money = 10 },
			Target = new TradeOffer()
		};
		return state;
	}

	[Fact]
	public void CheckTradeFreeze_NoActiveTrade_Allows()
		=> Assert.Null(CommandDispatcher.CheckTradeFreeze(
			new BuildCommand { PlayerId = "a", SquareIndex = 1 },
			TestFixtures.NewState(new[] { TestFixtures.NewPlayer("a") })));

	[Fact]
	public void CheckTradeFreeze_InactiveTrade_Allows()
	{
		var state = FrozenState();
		state.ActiveTrade!.IsActive = false;
		Assert.Null(CommandDispatcher.CheckTradeFreeze(
			new BuildCommand { PlayerId = "a", SquareIndex = 1 }, state));
	}

	[Fact]
	public void CheckTradeFreeze_MutatingCommand_IsRejected()
		=> Assert.Equal("TRADE_IN_PROGRESS",
			CommandDispatcher.CheckTradeFreeze(
				new BuildCommand { PlayerId = "b", SquareIndex = 1 }, FrozenState()));

	[Fact]
	public void CheckTradeFreeze_SecondPropose_IsRejected()
		=> Assert.Equal("TRADE_IN_PROGRESS",
			CommandDispatcher.CheckTradeFreeze(
				new ProposeTradeCommand { PlayerId = "a", TargetPlayerId = "b" }, FrozenState()));

	[Fact]
	public void CheckTradeFreeze_RespondTrade_IsAllowed()
		=> Assert.Null(CommandDispatcher.CheckTradeFreeze(
			new RespondTradeCommand { PlayerId = "b", TradeId = "T1", Accept = true }, FrozenState()));

	[Fact]
	public void CheckTradeFreeze_CancelTrade_IsAllowed()
		=> Assert.Null(CommandDispatcher.CheckTradeFreeze(
			new CancelTradeCommand { PlayerId = "a", TradeId = "T1" }, FrozenState()));

	[Fact]
	public void CheckTradeFreeze_ReadOnlyQuery_IsAllowed()
		=> Assert.Null(CommandDispatcher.CheckTradeFreeze(
			new GetMoneyCommand { PlayerId = "b" }, FrozenState()));

	[Fact]
	public async Task Dispatch_DuringTrade_BlocksMutatingCommand()
	{
		var dispatcher = NewDispatcher();
		var context = TestFixtures.NewContext(FrozenState());

		var response = await dispatcher.DispatchAsync(
			new MortgagePropertyCommand { PlayerId = "b", SquareIndex = 1 }, context);

		var error = Assert.IsType<ErrorResponse>(response);
		Assert.Equal("TRADE_IN_PROGRESS", error.Code);
	}

	[Fact]
	public async Task Dispatch_DuringTrade_AllowsReadOnlyQuery()
	{
		var dispatcher = NewDispatcher();
		var context = TestFixtures.NewContext(FrozenState());

		var response = await dispatcher.DispatchAsync(new GetMoneyCommand { PlayerId = "b" }, context);

		Assert.False(response is ErrorResponse { Code: "TRADE_IN_PROGRESS" });
	}

	// ── Auction freeze guard (playtest #6 + #9) ──────────────────────────────
	// While an auction runs the declining player is still the current turn holder. Without a
	// freeze they could roll again on doubles (#9) or open a trade that then freezes the whole
	// game, including the auction's own bids, so a later un-mortgage hit "TRADE_IN_PROGRESS" (#6).

	private static GameState AuctioningState()
	{
		// CurrentTurn defaults to "a" (the initiator/decliner), matching the live flow.
		var state = TestFixtures.NewState(new[] { TestFixtures.NewPlayer("a"), TestFixtures.NewPlayer("b") });
		state.ActiveAuction = new AuctionState
		{
			SquareIndex = 1,
			SquareName = "Main Square",
			InitiatorPlayerId = "a"
		};
		return state;
	}

	[Fact]
	public void CheckAuctionFreeze_NoActiveAuction_Allows()
		=> Assert.Null(CommandDispatcher.CheckAuctionFreeze(
			new RollDiceCommand { PlayerId = "a" },
			TestFixtures.NewState(new[] { TestFixtures.NewPlayer("a") })));

	[Fact]
	public void CheckAuctionFreeze_InactiveAuction_Allows()
	{
		var state = AuctioningState();
		state.ActiveAuction!.IsActive = false;
		Assert.Null(CommandDispatcher.CheckAuctionFreeze(new RollDiceCommand { PlayerId = "a" }, state));
	}

	[Fact]
	public void CheckAuctionFreeze_RollDuringAuction_IsRejected()
		=> Assert.Equal("AUCTION_IN_PROGRESS",
			CommandDispatcher.CheckAuctionFreeze(new RollDiceCommand { PlayerId = "a" }, AuctioningState()));

	[Fact]
	public void CheckAuctionFreeze_ProposeTradeDuringAuction_IsRejected()
		=> Assert.Equal("AUCTION_IN_PROGRESS",
			CommandDispatcher.CheckAuctionFreeze(
				new ProposeTradeCommand { PlayerId = "a", TargetPlayerId = "b" }, AuctioningState()));

	[Fact]
	public void CheckAuctionFreeze_UnmortgageDuringAuction_IsRejected()
		=> Assert.Equal("AUCTION_IN_PROGRESS",
			CommandDispatcher.CheckAuctionFreeze(
				new UnmortgagePropertyCommand { PlayerId = "b", SquareIndex = 1 }, AuctioningState()));

	[Fact]
	public void CheckAuctionFreeze_PlaceBid_IsAllowed()
		=> Assert.Null(CommandDispatcher.CheckAuctionFreeze(
			new PlaceBidCommand { PlayerId = "b", SquareIndex = 1, Amount = 5 }, AuctioningState()));

	[Fact]
	public void CheckAuctionFreeze_PassAuction_IsAllowed()
		=> Assert.Null(CommandDispatcher.CheckAuctionFreeze(
			new PassAuctionCommand { PlayerId = "b", SquareIndex = 1 }, AuctioningState()));

	[Fact]
	public void CheckAuctionFreeze_EndAuction_IsAllowed()
		=> Assert.Null(CommandDispatcher.CheckAuctionFreeze(
			new EndAuctionCommand { PlayerId = "a" }, AuctioningState()));

	[Fact]
	public void CheckAuctionFreeze_ReadOnlyQuery_IsAllowed()
		=> Assert.Null(CommandDispatcher.CheckAuctionFreeze(
			new GetMoneyCommand { PlayerId = "b" }, AuctioningState()));

	[Fact]
	public async Task Dispatch_DuringAuction_BlocksTheCurrentPlayerRollingAgain()
	{
		// #9: doubles keep "a" as CurrentTurn during the auction; the roll must be refused.
		var dispatcher = NewDispatcher();
		var context = TestFixtures.NewContext(AuctioningState());

		var response = await dispatcher.DispatchAsync(new RollDiceCommand { PlayerId = "a" }, context);

		var error = Assert.IsType<ErrorResponse>(response);
		Assert.Equal("AUCTION_IN_PROGRESS", error.Code);
	}

	[Fact]
	public async Task Dispatch_DuringAuction_BlocksOpeningATrade()
	{
		// #6: opening a trade mid-auction used to freeze everyone (including the bids); block it.
		var dispatcher = NewDispatcher();
		var context = TestFixtures.NewContext(AuctioningState());

		var response = await dispatcher.DispatchAsync(
			new ProposeTradeCommand { PlayerId = "a", TargetPlayerId = "b" }, context);

		var error = Assert.IsType<ErrorResponse>(response);
		Assert.Equal("AUCTION_IN_PROGRESS", error.Code);
	}

	[Fact]
	public async Task Dispatch_DuringAuction_AllowsAPass()
	{
		var dispatcher = NewDispatcher();
		var context = TestFixtures.NewContext(AuctioningState());

		var response = await dispatcher.DispatchAsync(
			new PassAuctionCommand { PlayerId = "b", SquareIndex = 1 }, context);

		Assert.False(response is ErrorResponse { Code: "AUCTION_IN_PROGRESS" });
	}
}
