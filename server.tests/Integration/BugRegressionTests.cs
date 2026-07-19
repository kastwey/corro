using CorroServer.Models;
using CorroServer.Services.Commands;
using CorroServer.Services.Rules;

namespace CorroServer.Tests.Integration;

/// <summary>
/// Regression tests for a batch of gameplay bugs captured during a real session.
/// Each test first reproduces the broken behaviour, so it would fail against the
/// pre-fix code, and now asserts the corrected outcome.
/// </summary>
public class BugRegressionTests
{
	private static List<Square> BoardWith(params (int index, Square square)[] overrides)
	{
		var board = TestFixtures.StandardBoard();
		foreach (var (index, square) in overrides)
		{
			board[index] = square;
		}

		return board;
	}

	// ── BUG 13: a tax debt must block any further roll (no phantom debts) ─────────

	[Fact]
	public async Task TaxDebt_BlocksRollingAgain_AfterDoubles()
	{
		// Player can only afford 37 of a 100 tax. Landing on it via doubles creates a
		// debt AND owes another roll — but the debt must be paid first, otherwise the
		// player rolls past it and the debt is never collected (the original bug).
		var player = TestFixtures.NewPlayer("a", money: 37, position: 0);
		var harness = new GameHarness(
			new[] { player, TestFixtures.NewPlayer("b") },
			BoardWith((4, new Square { Id = 4, Name = "Luxury Tax", Type = "tax", Amount = 100 })));

		await harness.RollAsync("a", die1: 2, die2: 2); // 0 -> 4 (doubles), tax 100 > 37

		Assert.True(harness.Context.Helper.HasPendingDebts("a"));
		Assert.True(harness.State.MustRollAgain); // doubles still owe a roll…

		// …but the pending debt must be resolved before that roll is allowed.
		var response = await new RollDiceHandler(harness.Rulebook)
			.HandleAsync(new RollDiceCommand { PlayerId = "a" }, harness.Context);

		var error = Assert.IsType<ErrorResponse>(response);
		Assert.Equal("RESOLVE_DEBT_FIRST", error.Code);
		Assert.Equal(4, harness.Player("a").Position); // did not move
		Assert.Equal(37, harness.Player("a").Money);   // did not pay / change
	}

	// ── BUG 2: landing on a colored street announces its colour group ────────────

	[Fact]
	public async Task LandingOnColoredProperty_AnnouncesTheColour()
	{
		var harness = new GameHarness(
			new[] { TestFixtures.NewPlayer("a", money: 1500, position: 0) },
			BoardWith((4, new Square { Id = 4, Name = "Orange Avenue", Type = "property", Price = 60, Color = "orange", GroupNameKey = "game.color_orange" })));

		await harness.RollAsync("a", die1: 1, die2: 3); // 0 -> 4 (orange property)

		Assert.True(harness.Announcer.Has(AnnouncementAudience.AllExcept, "a", "game.landed_on_property_colored"));
		Assert.True(harness.Announcer.Has(AnnouncementAudience.Player, "a", "game.landed_on_property_colored_self"));
		var colored = harness.Announcer.Sent.First(a => a.Key == "game.landed_on_property_colored");
		Assert.Equal("game.color_orange", colored.Vars["colorKey"]); // the group's name key, nested via $t client-side
	}

	[Fact]
	public async Task LandingOnAPackageGroup_AnnouncesItsNameKey_NotTheHexColour()
	{
		// The reported bug: a package board's group has a hex colour (no game.color_* key), so the
		// announcement must carry the group's NAME KEY (e.g. "groups.g3"), never the raw hex — which
		// used to leak as "game.color_#e15fb0".
		var harness = new GameHarness(
			new[] { TestFixtures.NewPlayer("a", money: 1500, position: 0) },
			BoardWith((4, new Square { Id = 4, Name = "Velo Carmesí", Type = "property", Price = 60, Color = "#e15fb0", GroupNameKey = "groups.g3" })));

		await harness.RollAsync("a", die1: 1, die2: 3); // 0 -> 4

		var colored = harness.Announcer.Sent.First(a => a.Key == "game.landed_on_property_colored");
		Assert.Equal("groups.g3", colored.Vars["colorKey"]);
		Assert.DoesNotContain("#", colored.Vars["colorKey"]!.ToString()!);
	}

	// ── BUG 4: completing a set announces the milestone ──────────────────────────

	[Fact]
	public async Task BuyingTheLastPropertyOfAColour_AnnouncesFullGroupCompleted()
	{
		var player = TestFixtures.NewPlayer("a", money: 1500);
		var squares = BoardWith(
			(4, new Square { Id = 4, Name = "Orange 1", Type = "property", Price = 60, Color = "orange", Key = "orange", GroupNameKey = "game.color_orange", OwnerId = "a" }),
			(5, new Square { Id = 5, Name = "Orange 2", Type = "property", Price = 60, Color = "orange", Key = "orange", GroupNameKey = "game.color_orange" }));
		var state = TestFixtures.NewState(new[] { player }, squares: squares);
		state.PendingPurchase = new PendingPurchase { PlayerId = "a", SquareIndex = 5, SquareName = "Orange 2", Price = 60 };
		var context = TestFixtures.NewContext(state);

		await new CorroRulebook().BuyPropertyAsync(player, 5, context);

		var announcer = TestFixtures.Announcer(context);
		Assert.True(announcer.Has(AnnouncementAudience.Player, "a", "game.group_completed_self"));
		Assert.True(announcer.Has(AnnouncementAudience.AllExcept, "a", "game.group_completed"));
		var completed = announcer.Sent.First(a => a.Key == "game.group_completed");
		Assert.Equal("game.color_orange", completed.Vars["colorKey"]);
	}

	[Fact]
	public async Task BuyingTheLastOfANonColourGroup_AnnouncesGroupCompleted()
	{
		// Completion is by group, not type: owning the whole "transit" group announces the same
		// group_completed as a colour set (the engine privileges no railroad/utility type).
		var player = TestFixtures.NewPlayer("a", money: 1500);
		var squares = BoardWith(
			(5, new Square { Id = 5, Name = "Station 1", Type = "transit", Price = 200, Key = "transit", GroupNameKey = "groups.transit", OwnerId = "a" }),
			(15, new Square { Id = 15, Name = "Station 2", Type = "transit", Price = 200, Key = "transit", GroupNameKey = "groups.transit", OwnerId = "a" }),
			(25, new Square { Id = 25, Name = "Station 3", Type = "transit", Price = 200, Key = "transit", GroupNameKey = "groups.transit", OwnerId = "a" }),
			(35, new Square { Id = 35, Name = "Station 4", Type = "transit", Price = 200, Key = "transit", GroupNameKey = "groups.transit" }));
		var state = TestFixtures.NewState(new[] { player }, squares: squares);
		state.PendingPurchase = new PendingPurchase { PlayerId = "a", SquareIndex = 35, SquareName = "Square 35", Price = 200 };
		var context = TestFixtures.NewContext(state);

		await new CorroRulebook().BuyPropertyAsync(player, 35, context);

		var announcer = TestFixtures.Announcer(context);
		Assert.True(announcer.Has(AnnouncementAudience.Player, "a", "game.group_completed_self"));
		Assert.True(announcer.Has(AnnouncementAudience.AllExcept, "a", "game.group_completed"));
		var completed = announcer.Sent.First(a => a.Key == "game.group_completed");
		Assert.Equal("groups.transit", completed.Vars["colorKey"]);
	}

	// ── BUG 9 + 12: an auction auto-wins when nobody else can outbid, and the ─────
	//                winner hears it in the first person.

	[Fact]
	public async Task Auction_AutoEnds_WhenNoOtherBidderCanOutbid()
	{
		var rich = TestFixtures.NewPlayer("a", money: 1500);
		var poor1 = TestFixtures.NewPlayer("b", money: 50);
		var poor2 = TestFixtures.NewPlayer("c", money: 50);
		var squares = new List<Square> { new() { Id = 0, Name = "GO", Type = "corner" }, new() { Id = 1, Name = "Square 1", Type = "property", Price = 200 } };
		var state = TestFixtures.NewState(new[] { rich, poor1, poor2 }, bankMoney: 10000, squares: squares);
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

		// "a" bids 100. Neither poor player can ever beat 100, so the auction ends now.
		var response = await new PlaceBidHandler(new AuctionRulebook())
			.HandleAsync(new PlaceBidCommand { PlayerId = "a", SquareIndex = 1, Amount = 100 }, context);

		var ended = Assert.IsType<AuctionEndedResponse>(response);
		Assert.True(ended.PropertySold);
		Assert.Equal("a", ended.WinnerId);
		Assert.Equal("a", context.Helper.GetSquare(1)!.OwnerId);
		Assert.Equal(1400, context.Helper.GetPlayerMoney("a"));

		// BUG 12: the winner hears it in the first person, everyone else in the third.
		var announcer = TestFixtures.Announcer(context);
		Assert.True(announcer.Has(AnnouncementAudience.Player, "a", "game.auction_won_self"));
		Assert.True(announcer.Has(AnnouncementAudience.AllExcept, "a", "game.auction_won"));
	}

	[Fact]
	public async Task Auction_StaysOpen_WhenAnotherBidderCanStillOutbid()
	{
		var rich = TestFixtures.NewPlayer("a", money: 1500);
		var alsoRich = TestFixtures.NewPlayer("b", money: 1500);
		var squares = new List<Square> { new() { Id = 0, Name = "GO", Type = "corner" }, new() { Id = 1, Name = "Square 1", Type = "property", Price = 200 } };
		var state = TestFixtures.NewState(new[] { rich, alsoRich }, bankMoney: 10000, squares: squares);
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

		var response = await new PlaceBidHandler(new AuctionRulebook())
			.HandleAsync(new PlaceBidCommand { PlayerId = "a", SquareIndex = 1, Amount = 100 }, context);

		// "b" can still outbid 100, so the auction must keep running.
		Assert.IsType<BidPlacedResponse>(response);
		Assert.NotNull(state.ActiveAuction);
		Assert.True(state.ActiveAuction!.IsActive);
	}

}
