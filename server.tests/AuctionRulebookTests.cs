using CorroServer.Models;
using CorroServer.Services.Commands;
using CorroServer.Services.Rules;

namespace CorroServer.Tests;

/// <summary>
/// Tests that ending an auction conserves money: the winner pays and the bank is credited
/// by the same amount (regression test for the auction money-leak fix).
/// </summary>
public class AuctionRulebookTests
{
	private static Square PropertySquare(int index)
		=> new() { Id = index, Name = $"Square {index}", Price = 200, Type = "property" };

	[Fact]
	public async Task EndAuction_WithWinner_TransfersMoneyToBankAndAssignsProperty()
	{
		var winner = TestFixtures.NewPlayer("a", money: 1000);
		var other = TestFixtures.NewPlayer("b", money: 1000);
		var squares = new List<Square> { PropertySquare(0), PropertySquare(1) };
		var state = TestFixtures.NewState(new[] { winner, other }, bankMoney: 10000, squares: squares);
		state.ActiveAuction = new AuctionState
		{
			SquareIndex = 1,
			SquareName = "Square 1",
			CurrentBid = 300,
			HighestBidderId = "a",
			HighestBidderName = "a",
			InitiatorPlayerId = "b",
			IsActive = true
		};
		var context = TestFixtures.NewContext(state);
		var before = TestFixtures.TotalMoney(state);

		var rulebook = new AuctionRulebook();
		var outcome = await rulebook.EndAuctionAsync(context);

		Assert.True(outcome.PropertySold);
		Assert.Equal(700, context.Helper.GetPlayerMoney("a"));
		Assert.Equal(10300, context.Helper.GetBankMoney());
		Assert.Equal("a", context.Helper.GetSquare(1)!.OwnerId);
		Assert.Equal(before, TestFixtures.TotalMoney(state));
	}

	[Fact]
	public async Task EndAuction_WithNoBids_DoesNotChangeMoneyOrOwnership()
	{
		var p = TestFixtures.NewPlayer("a", money: 1000);
		var squares = new List<Square> { PropertySquare(0), PropertySquare(1) };
		var state = TestFixtures.NewState(new[] { p }, bankMoney: 10000, squares: squares);
		state.ActiveAuction = new AuctionState
		{
			SquareIndex = 1,
			SquareName = "Square 1",
			CurrentBid = 0,
			HighestBidderId = null,
			InitiatorPlayerId = "a",
			IsActive = true
		};
		var context = TestFixtures.NewContext(state);
		var before = TestFixtures.TotalMoney(state);

		var outcome = await new AuctionRulebook().EndAuctionAsync(context);

		Assert.False(outcome.PropertySold);
		Assert.Null(context.Helper.GetSquare(1)!.OwnerId);
		Assert.Equal(before, TestFixtures.TotalMoney(state));
	}

	/// <summary>
	/// Regression test for the "winner's modal never closes" bug. When the last opponent
	/// passes, the auction ends and the PassAuction handler must return an
	/// <c>AUCTION_ENDED</c> response (which the Hub then broadcasts to the whole group so
	/// every open auction modal — including the non-acting winner's — closes).
	/// </summary>
	[Fact]
	public async Task PassHandler_WhenLastOpponentPasses_ReturnsAuctionEndedWithWinner()
	{
		var winner = TestFixtures.NewPlayer("a", money: 1000);
		var passer = TestFixtures.NewPlayer("b", money: 1000);
		var squares = new List<Square> { PropertySquare(0), PropertySquare(1) };
		var state = TestFixtures.NewState(new[] { winner, passer }, bankMoney: 10000, squares: squares);
		state.ActiveAuction = new AuctionState
		{
			SquareIndex = 1,
			SquareName = "Square 1",
			CurrentBid = 300,
			HighestBidderId = "a",
			HighestBidderName = "a",
			InitiatorPlayerId = "a",
			IsActive = true
		};
		var context = TestFixtures.NewContext(state);

		var handler = new PassAuctionHandler(new AuctionRulebook());
		var response = await handler.HandleAsync(
			new PassAuctionCommand { PlayerId = "b", SquareIndex = 1 }, context);

		Assert.Equal("AUCTION_ENDED", response.Type);
		var ended = Assert.IsType<AuctionEndedResponse>(response);
		Assert.True(ended.PropertySold);
		Assert.Equal("a", ended.WinnerId);
		Assert.Equal(300, ended.WinningBid);
	}

	/// <summary>
	/// Regression test: the current highest bidder must NOT be able to pass. Otherwise their
	/// own pass dropped the remaining-bidder count to one and the auction ended early, awarding
	/// the property to the very player who passed — before the timer ran out and before the
	/// other players had a chance to bid. The auction may only end with the highest bidder
	/// winning once every OTHER player has passed.
	/// </summary>
	[Fact]
	public async Task PassAuction_HighestBidderCannotPass_AuctionStaysActive()
	{
		var highest = TestFixtures.NewPlayer("a", money: 1000);
		var other1 = TestFixtures.NewPlayer("b", money: 1000);
		var other2 = TestFixtures.NewPlayer("c", money: 1000);
		var squares = new List<Square> { PropertySquare(0), PropertySquare(1) };
		var state = TestFixtures.NewState(new[] { highest, other1, other2 }, bankMoney: 10000, squares: squares);
		state.ActiveAuction = new AuctionState
		{
			SquareIndex = 1,
			SquareName = "Square 1",
			CurrentBid = 300,
			HighestBidderId = "a",
			HighestBidderName = "a",
			InitiatorPlayerId = "a",
			IsActive = true
		};
		var context = TestFixtures.NewContext(state);

		var outcome = await new AuctionRulebook().PassAuctionAsync("a", 1, context);

		Assert.False(outcome.Success);
		Assert.Equal("HIGHEST_BIDDER_CANNOT_PASS", outcome.ErrorCode);
		Assert.False(outcome.AuctionEnded);
		// The auction is untouched: still active, the highest bidder is not recorded as passed,
		// and the property has not been awarded.
		Assert.NotNull(state.ActiveAuction);
		Assert.True(state.ActiveAuction!.IsActive);
		Assert.DoesNotContain("a", state.ActiveAuction.PassedPlayers);
		Assert.Null(context.Helper.GetSquare(1)!.OwnerId);
	}

	/// <summary>
	/// Regression companion: the auction ends with the highest bidder winning only once EVERY
	/// other player has passed — not as soon as a single opponent drops out while others could
	/// still bid.
	/// </summary>
	[Fact]
	public async Task PassAuction_EndsForHighestBidder_OnlyAfterAllOthersPass()
	{
		var highest = TestFixtures.NewPlayer("a", money: 1000);
		var other1 = TestFixtures.NewPlayer("b", money: 1000);
		var other2 = TestFixtures.NewPlayer("c", money: 1000);
		var squares = new List<Square> { PropertySquare(0), PropertySquare(1) };
		var state = TestFixtures.NewState(new[] { highest, other1, other2 }, bankMoney: 10000, squares: squares);
		state.ActiveAuction = new AuctionState
		{
			SquareIndex = 1,
			SquareName = "Square 1",
			CurrentBid = 300,
			HighestBidderId = "a",
			HighestBidderName = "a",
			InitiatorPlayerId = "a",
			IsActive = true
		};
		var context = TestFixtures.NewContext(state);
		var rulebook = new AuctionRulebook();

		// First opponent passes: two non-highest bidders could still compete, so it must NOT end.
		var firstPass = await rulebook.PassAuctionAsync("b", 1, context);
		Assert.True(firstPass.Success);
		Assert.False(firstPass.AuctionEnded);
		Assert.NotNull(state.ActiveAuction);

		// Last opponent passes: only the highest bidder remains, so now the auction ends and "a" wins.
		var lastPass = await rulebook.PassAuctionAsync("c", 1, context);
		Assert.True(lastPass.Success);
		Assert.True(lastPass.AuctionEnded);
		Assert.True(lastPass.FinalResult!.PropertySold);
		Assert.Equal("a", lastPass.FinalResult.WinnerId);
		Assert.Equal("a", context.Helper.GetSquare(1)!.OwnerId);
	}

	// ── StartAuction ──────────────────────────────────────────────────────────

	[Fact]
	public async Task StartAuction_Success_CreatesActiveAuction()
	{
		var p = TestFixtures.NewPlayer("a", money: 1000);
		var squares = new List<Square> { PropertySquare(0), PropertySquare(1) };
		var state = TestFixtures.NewState(new[] { p }, bankMoney: 10000, squares: squares);
		var context = TestFixtures.NewContext(state);

		var outcome = await new AuctionRulebook().StartAuctionAsync(1, "a", context);

		Assert.True(outcome.Success);
		Assert.Equal(1, outcome.SquareIndex);
		Assert.Equal("a", outcome.InitiatorPlayerId);
		Assert.NotNull(state.ActiveAuction);
		Assert.True(state.ActiveAuction!.IsActive);
		Assert.Equal(1, state.ActiveAuction.SquareIndex);
	}

	[Fact]
	public async Task StartAuction_UnknownSquare_Fails()
	{
		var p = TestFixtures.NewPlayer("a", money: 1000);
		var state = TestFixtures.NewState(new[] { p }, bankMoney: 10000, squares: new List<Square> { PropertySquare(0) });
		var context = TestFixtures.NewContext(state);

		var outcome = await new AuctionRulebook().StartAuctionAsync(99, "a", context);

		Assert.False(outcome.Success);
		Assert.Null(state.ActiveAuction);
	}

	[Fact]
	public async Task StartAuction_UnknownInitiator_Fails()
	{
		var p = TestFixtures.NewPlayer("a", money: 1000);
		var squares = new List<Square> { PropertySquare(0), PropertySquare(1) };
		var state = TestFixtures.NewState(new[] { p }, bankMoney: 10000, squares: squares);
		var context = TestFixtures.NewContext(state);

		var outcome = await new AuctionRulebook().StartAuctionAsync(1, "ghost", context);

		Assert.False(outcome.Success);
		Assert.Null(state.ActiveAuction);
	}

	// ── PlaceBid ──────────────────────────────────────────────────────────────

	/// <summary>Three equally-funded players with an active auction on square 1.</summary>
	private static GameContext ThreeWayAuction(int currentBid = 0, string? highestBidderId = null)
	{
		var a = TestFixtures.NewPlayer("a", money: 1000);
		var b = TestFixtures.NewPlayer("b", money: 1000);
		var c = TestFixtures.NewPlayer("c", money: 1000);
		var squares = new List<Square> { PropertySquare(0), PropertySquare(1) };
		var state = TestFixtures.NewState(new[] { a, b, c }, bankMoney: 10000, squares: squares);
		state.ActiveAuction = new AuctionState
		{
			SquareIndex = 1,
			SquareName = "Square 1",
			CurrentBid = currentBid,
			HighestBidderId = highestBidderId,
			HighestBidderName = highestBidderId,
			InitiatorPlayerId = "a",
			IsActive = true
		};
		return TestFixtures.NewContext(state);
	}

	[Fact]
	public async Task PlaceBid_NoActiveAuction_Rejected()
	{
		var a = TestFixtures.NewPlayer("a", money: 1000);
		var state = TestFixtures.NewState(new[] { a }, bankMoney: 10000, squares: new List<Square> { PropertySquare(1) });
		var context = TestFixtures.NewContext(state);

		var outcome = await new AuctionRulebook().PlaceBidAsync("a", 1, 100, context);

		Assert.False(outcome.Success);
		Assert.Equal("NO_ACTIVE_AUCTION", outcome.ErrorCode);
	}

	[Fact]
	public async Task PlaceBid_PlayerNotFound_Rejected()
	{
		var context = ThreeWayAuction();

		var outcome = await new AuctionRulebook().PlaceBidAsync("ghost", 1, 100, context);

		Assert.False(outcome.Success);
		Assert.Equal("PLAYER_NOT_FOUND", outcome.ErrorCode);
	}

	[Fact]
	public async Task PlaceBid_SquareMismatch_Rejected()
	{
		var context = ThreeWayAuction();

		var outcome = await new AuctionRulebook().PlaceBidAsync("a", 7, 100, context);

		Assert.False(outcome.Success);
		Assert.Equal("SQUARE_MISMATCH", outcome.ErrorCode);
	}

	[Fact]
	public async Task PlaceBid_AfterPassing_Rejected()
	{
		var context = ThreeWayAuction();
		context.GameState.ActiveAuction!.PassedPlayers.Add("a");

		var outcome = await new AuctionRulebook().PlaceBidAsync("a", 1, 100, context);

		Assert.False(outcome.Success);
		Assert.Equal("ALREADY_PASSED", outcome.ErrorCode);
	}

	[Fact]
	public async Task PlaceBid_NotHigherThanCurrent_Rejected()
	{
		var context = ThreeWayAuction(currentBid: 200, highestBidderId: "b");

		var outcome = await new AuctionRulebook().PlaceBidAsync("a", 1, 200, context);

		Assert.False(outcome.Success);
		Assert.Equal("BID_TOO_LOW", outcome.ErrorCode);
	}

	[Fact]
	public async Task PlaceBid_BeyondPlayerFunds_Rejected()
	{
		var context = ThreeWayAuction();

		var outcome = await new AuctionRulebook().PlaceBidAsync("a", 1, 5000, context);

		Assert.False(outcome.Success);
		Assert.Equal("INSUFFICIENT_FUNDS", outcome.ErrorCode);
	}

	[Fact]
	public async Task PlaceBid_Valid_RecordsHighestBid_WithoutEnding()
	{
		// b and c can still outbid 100, so the auction stays open.
		var context = ThreeWayAuction();

		var outcome = await new AuctionRulebook().PlaceBidAsync("a", 1, 100, context);

		Assert.True(outcome.Success);
		Assert.False(outcome.AuctionEnded);
		Assert.Equal(100, context.GameState.ActiveAuction!.CurrentBid);
		Assert.Equal("a", context.GameState.ActiveAuction.HighestBidderId);
	}

	[Fact]
	public async Task PlaceBid_WhenNobodyElseCanOutbid_EndsAuctionImmediately()
	{
		var a = TestFixtures.NewPlayer("a", money: 1000);
		var b = TestFixtures.NewPlayer("b", money: 50); // cannot top a 100 bid
		var squares = new List<Square> { PropertySquare(0), PropertySquare(1) };
		var state = TestFixtures.NewState(new[] { a, b }, bankMoney: 10000, squares: squares);
		state.ActiveAuction = new AuctionState
		{
			SquareIndex = 1,
			SquareName = "Square 1",
			CurrentBid = 0,
			InitiatorPlayerId = "a",
			IsActive = true
		};
		var context = TestFixtures.NewContext(state);
		var before = TestFixtures.TotalMoney(state);

		var outcome = await new AuctionRulebook().PlaceBidAsync("a", 1, 100, context);

		Assert.True(outcome.Success);
		Assert.True(outcome.AuctionEnded);
		Assert.True(outcome.FinalResult!.PropertySold);
		Assert.Equal("a", outcome.FinalResult.WinnerId);
		Assert.Equal(900, context.Helper.GetPlayerMoney("a"));
		Assert.Equal("a", context.Helper.GetSquare(1)!.OwnerId);
		Assert.Null(state.ActiveAuction); // cleared on end
		Assert.Equal(before, TestFixtures.TotalMoney(state));
	}

	// ── PassAuction error branches ────────────────────────────────────────────

	[Fact]
	public async Task PassAuction_NoActiveAuction_Rejected()
	{
		var a = TestFixtures.NewPlayer("a", money: 1000);
		var state = TestFixtures.NewState(new[] { a }, bankMoney: 10000, squares: new List<Square> { PropertySquare(1) });
		var context = TestFixtures.NewContext(state);

		var outcome = await new AuctionRulebook().PassAuctionAsync("a", 1, context);

		Assert.False(outcome.Success);
		Assert.Equal("NO_ACTIVE_AUCTION", outcome.ErrorCode);
	}

	[Fact]
	public async Task PassAuction_SquareMismatch_Rejected()
	{
		var context = ThreeWayAuction(currentBid: 100, highestBidderId: "a");

		var outcome = await new AuctionRulebook().PassAuctionAsync("b", 7, context);

		Assert.False(outcome.Success);
		Assert.Equal("SQUARE_MISMATCH", outcome.ErrorCode);
	}

	[Fact]
	public async Task PassAuction_PlayerNotFound_Rejected()
	{
		var context = ThreeWayAuction(currentBid: 100, highestBidderId: "a");

		var outcome = await new AuctionRulebook().PassAuctionAsync("ghost", 1, context);

		Assert.False(outcome.Success);
		Assert.Equal("PLAYER_NOT_FOUND", outcome.ErrorCode);
	}

	[Fact]
	public async Task PassAuction_AlreadyPassed_Rejected()
	{
		var context = ThreeWayAuction(currentBid: 100, highestBidderId: "a");
		context.GameState.ActiveAuction!.PassedPlayers.Add("b");

		var outcome = await new AuctionRulebook().PassAuctionAsync("b", 1, context);

		Assert.False(outcome.Success);
		Assert.Equal("ALREADY_PASSED", outcome.ErrorCode);
	}

	// ── HasActiveAuction ──────────────────────────────────────────────────────

	[Fact]
	public void HasActiveAuction_ReflectsAuctionState()
	{
		var rulebook = new AuctionRulebook();
		var context = ThreeWayAuction();

		Assert.True(rulebook.HasActiveAuction(context));

		context.GameState.ActiveAuction!.IsActive = false;
		Assert.False(rulebook.HasActiveAuction(context));

		context.GameState.ActiveAuction = null;
		Assert.False(rulebook.HasActiveAuction(context));
	}
}
