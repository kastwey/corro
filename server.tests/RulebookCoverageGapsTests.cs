using CorroServer.Models;
using CorroServer.Services.Commands;
using CorroServer.Services.Rules;
using CorroServer.Tests.Integration;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// Pins behaviour that was uncovered before the data-driven engine migration: rent scaling for
/// stations, the decline/trade validation branches, and building liquidation on bankruptcy. These
/// guard against regressions when the rulebook starts reading rules from the GameDefinition.
/// </summary>
public class RulebookCoverageGapsTests
{
	// ── Railroad rent scales with how many the owner holds (3 -> 100, 4 -> 200) ──
	[Theory]
	[InlineData(1, 25)]
	[InlineData(2, 50)]
	[InlineData(3, 100)]
	[InlineData(4, 200)]
	public async Task RailroadRent_scales_with_railroads_owned(int owned, int expectedRent)
	{
		var owner = TestFixtures.NewPlayer("owner", money: 1500);
		var tenant = TestFixtures.NewPlayer("tenant", money: 1500, position: 0);
		var squares = new List<Square>();
		for (var i = 0; i < owned; i++)
		{
			squares.Add(new Square { Id = i, Name = $"Station {i}", Type = "railroad", Price = 200, OwnerId = "owner" });
		}

		var context = TestFixtures.NewContext(TestFixtures.NewState(new[] { owner, tenant }, squares: squares));

		await new CorroRulebook().ProcessLandingEffectsAsync(tenant, 0, context);

		Assert.Equal(1500 - expectedRent, tenant.Money);
		Assert.Equal(1500 + expectedRent, owner.Money);
	}

	// ── DeclinePropertyAsync validation branches ─────────────────────────────────
	[Fact]
	public async Task Decline_without_a_pending_purchase_is_rejected()
	{
		var p = TestFixtures.NewPlayer("p");
		var context = TestFixtures.NewContext(TestFixtures.NewState(new[] { p },
			squares: new List<Square> { new() { Id = 0, Name = "Go", Type = "corner" } }));

		var outcome = await new CorroRulebook().DeclinePropertyAsync(p, 0, context);

		Assert.False(outcome.Success);
		Assert.Equal("NO_PENDING_PURCHASE", outcome.ErrorCode);
	}

	[Fact]
	public async Task Decline_for_a_square_other_than_the_pending_one_is_rejected()
	{
		var p = TestFixtures.NewPlayer("p");
		var state = TestFixtures.NewState(new[] { p },
			squares: new List<Square> { new() { Id = 1, Name = "Prop", Type = "property", Price = 100 } });
		state.PendingPurchase = new PendingPurchase { PlayerId = "p", SquareIndex = 1, SquareName = "Prop", Price = 100 };
		var context = TestFixtures.NewContext(state);

		var outcome = await new CorroRulebook().DeclinePropertyAsync(p, 3, context);

		Assert.False(outcome.Success);
		Assert.Equal("SQUARE_MISMATCH", outcome.ErrorCode);
	}

	// ── ProposeTradeAsync validation branches ────────────────────────────────────
	[Fact]
	public async Task Trade_with_a_duplicated_property_is_rejected()
	{
		var a = TestFixtures.NewPlayer("a");
		var b = TestFixtures.NewPlayer("b");
		var context = TestFixtures.NewContext(TestFixtures.NewState(new[] { a, b },
			squares: new List<Square> { new() { Id = 1, Name = "P", Type = "property", Color = "brown", Price = 60, OwnerId = "a" } }));

		var trade = new TradeState
		{
			Id = "t1",
			InitiatorId = "a",
			InitiatorName = "A",
			TargetId = "b",
			TargetName = "B",
			Initiator = new TradeOffer { Properties = new List<int> { 1, 1 } }, // same property twice
			Target = new TradeOffer { Money = 10 },
		};

		var outcome = await new CorroRulebook().ProposeTradeAsync(trade, context);

		Assert.False(outcome.Success);
		Assert.Equal("INVALID_TRADE", outcome.ErrorCode);
	}

	[Fact]
	public async Task Trade_of_a_property_whose_colour_group_has_buildings_is_rejected()
	{
		var a = TestFixtures.NewPlayer("a");
		var b = TestFixtures.NewPlayer("b");
		// GetSquare/SquareAt index by board position, so squares sit at position == id.
		var context = TestFixtures.NewContext(TestFixtures.NewState(new[] { a, b }, squares: new List<Square>
		{
			new() { Id = 0, Name = "Go", Type = "corner" },
			new() { Id = 1, Name = "Brown 1", Type = "property", Color = "brown", Price = 60, OwnerId = "a" },
			new() { Id = 2, Name = "Cell", Type = "corner" },
			new() { Id = 3, Name = "Brown 2", Type = "property", Color = "brown", Price = 60, OwnerId = "a", SmallBuildings = 1 },
		}));

		var trade = new TradeState
		{
			Id = "t1",
			InitiatorId = "a",
			InitiatorName = "A",
			TargetId = "b",
			TargetName = "B",
			Initiator = new TradeOffer { Properties = new List<int> { 1 } }, // brown group has a smallBuilding on Brown 2 (pos 3)
			Target = new TradeOffer { Money = 10 },
		};

		var outcome = await new CorroRulebook().ProposeTradeAsync(trade, context);

		Assert.False(outcome.Success);
		Assert.Equal("GROUP_HAS_BUILDINGS", outcome.ErrorCode);
	}

	// ── Bankruptcy liquidates the player's buildings ─────────────────────────────
	[Fact]
	public async Task Bankruptcy_liquidates_the_players_buildings_before_transfer()
	{
		var debtor = TestFixtures.NewPlayer("debtor", money: 0);
		var survivor = TestFixtures.NewPlayer("survivor", money: 1500);
		// GetSquare indexes by board position, so the property sits at position 1.
		var go = new Square { Id = 0, Name = "Go", Type = "corner" };
		var prop = new Square { Id = 1, Name = "Brown 1", Type = "property", Color = "brown", Price = 60, BuildingCost = 50, OwnerId = "debtor", SmallBuildings = 2 };
		debtor.Properties.Add(1);
		var context = TestFixtures.NewContext(TestFixtures.NewState(new[] { debtor, survivor }, squares: new List<Square> { go, prop }));

		await new CorroRulebook().DeclareBankruptcyAsync(debtor, context);

		Assert.Equal(0, prop.SmallBuildings);
		Assert.Equal(0, prop.BigBuildings);
	}

	// ── Decline an out-of-range pending square ──────────────────────────────────
	[Fact]
	public async Task Decline_when_the_pending_square_is_out_of_range_is_INVALID_SQUARE()
	{
		var p = TestFixtures.NewPlayer("p");
		var state = TestFixtures.NewState(new[] { p }, squares: new List<Square> { new() { Id = 0, Name = "Go", Type = "corner" } });
		state.PendingPurchase = new PendingPurchase { PlayerId = "p", SquareIndex = 99, SquareName = "Nowhere", Price = 100 };
		var context = TestFixtures.NewContext(state);

		var outcome = await new CorroRulebook().DeclinePropertyAsync(p, 99, context);

		Assert.False(outcome.Success);
		Assert.Equal("INVALID_SQUARE", outcome.ErrorCode);
	}

	// ── Trade with a duplicated property on the requested side ───────────────────
	[Fact]
	public async Task Trade_with_a_duplicated_property_on_the_requested_side_is_rejected()
	{
		var a = TestFixtures.NewPlayer("a");
		var b = TestFixtures.NewPlayer("b");
		var context = TestFixtures.NewContext(TestFixtures.NewState(new[] { a, b }, squares: TestFixtures.StandardBoard()));

		var trade = new TradeState
		{
			Id = "t1",
			InitiatorId = "a",
			InitiatorName = "A",
			TargetId = "b",
			TargetName = "B",
			Initiator = new TradeOffer { Money = 10 },
			Target = new TradeOffer { Properties = new List<int> { 3, 3 } }, // same requested property twice
		};

		var outcome = await new CorroRulebook().ProposeTradeAsync(trade, context);

		Assert.False(outcome.Success);
		Assert.Equal("INVALID_TRADE", outcome.ErrorCode);
	}

	// ── SmallBuilding-cost colour fallback (when a square carries no explicit BuildingCost) ──
	[Theory]
	[InlineData("brown", 25)]
	[InlineData("lightblue", 25)]
	[InlineData("pink", 50)]
	[InlineData("orange", 50)]
	[InlineData("red", 75)]
	[InlineData("yellow", 75)]
	[InlineData("green", 100)]
	[InlineData("darkblue", 100)]
	[InlineData("rainbow", 50)] // unknown colour -> default 100 per smallBuilding -> 50 for one smallBuilding
	public void BuildingSaleValue_falls_back_to_the_colour_house_cost_table(string colour, int expected)
	{
		// One smallBuilding, no explicit BuildingCost -> sale value = house_cost(colour) / 2.
		var square = new Square { Id = 1, Name = "P", Type = "property", Color = colour, SmallBuildings = 1 };
		Assert.Equal(expected, new CorroRulebook().GetBuildingSaleValue(square));
	}

	// ── Ending an auction when none is active ────────────────────────────────────
	[Fact]
	public async Task EndAuction_with_no_active_auction_reports_nothing_sold()
	{
		var context = TestFixtures.NewContext(TestFixtures.NewState(new[] { TestFixtures.NewPlayer("a") }));

		var outcome = await new AuctionRulebook().EndAuctionAsync(context);

		Assert.False(outcome.PropertySold);
	}

	// ── Landing on an unknown square type is a harmless no-op ─────────────────────
	[Fact]
	public async Task Landing_on_an_unknown_square_type_does_nothing()
	{
		var p = TestFixtures.NewPlayer("p", money: 1500, position: 0);
		var context = TestFixtures.NewContext(TestFixtures.NewState(new[] { p },
			squares: new List<Square> { new() { Id = 0, Name = "Mystery", Type = "wormhole" } }));

		await new CorroRulebook().ProcessLandingEffectsAsync(p, 0, context);

		Assert.Equal(1500, p.Money); // unknown type -> no effect
	}

	// ── EndTurn ownership guard ──────────────────────────────────────────────────
	[Fact]
	public async Task EndTurn_by_a_player_who_is_not_on_turn_fails()
	{
		var a = TestFixtures.NewPlayer("a");
		var b = TestFixtures.NewPlayer("b");
		var state = TestFixtures.NewState(new[] { a, b }, squares: TestFixtures.StandardBoard());
		state.CurrentTurn = "a";
		var context = TestFixtures.NewContext(state);

		var outcome = await new CorroRulebook().EndTurnAsync(b, context);

		Assert.False(outcome.Success);
	}

	// ── Trade: building checks on the traded square / on a colourless railroad ───
	[Fact]
	public async Task Trade_of_a_property_that_itself_has_a_building_is_rejected()
	{
		var a = TestFixtures.NewPlayer("a");
		var b = TestFixtures.NewPlayer("b");
		var context = TestFixtures.NewContext(TestFixtures.NewState(new[] { a, b }, squares: new List<Square>
		{
			new() { Id = 0, Name = "Go", Type = "corner" },
			new() { Id = 1, Name = "Brown 1", Type = "property", Color = "brown", Price = 60, OwnerId = "a", SmallBuildings = 1 },
		}));
		var trade = new TradeState
		{
			Id = "t1",
			InitiatorId = "a",
			InitiatorName = "A",
			TargetId = "b",
			TargetName = "B",
			Initiator = new TradeOffer { Properties = new List<int> { 1 } },
			Target = new TradeOffer { Money = 10 },
		};

		var outcome = await new CorroRulebook().ProposeTradeAsync(trade, context);

		Assert.Equal("GROUP_HAS_BUILDINGS", outcome.ErrorCode);
	}

	[Fact]
	public async Task A_colourless_railroad_can_be_traded()
	{
		var a = TestFixtures.NewPlayer("a", money: 1500);
		var b = TestFixtures.NewPlayer("b", money: 1500);
		var squares = Enumerable.Range(0, 6).Select(i => new Square { Id = i, Name = $"S{i}", Type = "corner" }).ToList();
		squares[5] = new Square { Id = 5, Name = "Station", Type = "railroad", Price = 200, OwnerId = "a" };
		var context = TestFixtures.NewContext(TestFixtures.NewState(new[] { a, b }, squares: squares));
		var trade = new TradeState
		{
			Id = "t1",
			InitiatorId = "a",
			InitiatorName = "A",
			TargetId = "b",
			TargetName = "B",
			Initiator = new TradeOffer { Properties = new List<int> { 5 } }, // railroad has no colour group
			Target = new TradeOffer { Money = 50 },
		};

		var outcome = await new CorroRulebook().ProposeTradeAsync(trade, context);

		Assert.True(outcome.Success);
	}

	// ── Auctions: everyone passes, and ending while the player owes a doubles roll ─
	[Fact]
	public async Task An_auction_in_which_everyone_passes_ends()
	{
		var a = TestFixtures.NewPlayer("a", money: 1500);
		var b = TestFixtures.NewPlayer("b", money: 1500);
		var board = TestFixtures.StandardBoard();
		board[1] = new Square { Id = 1, Name = "P", Type = "property", Price = 100 };
		var state = TestFixtures.NewState(new[] { a, b }, squares: board);
		state.CurrentTurn = "a";
		var context = TestFixtures.NewContext(state);
		var auction = new AuctionRulebook();

		await auction.StartAuctionAsync(1, "a", context);
		await auction.PassAuctionAsync("a", 1, context);
		var last = await auction.PassAuctionAsync("b", 1, context);

		Assert.True(last.AuctionEnded);
		Assert.Null(state.Squares[1].OwnerId); // no bids -> unsold
	}

	[Fact]
	public async Task A_square_can_declare_a_landing_behaviour_that_overrides_its_type()
	{
		var a = TestFixtures.NewPlayer("a", money: 1500, position: 4);
		var board = TestFixtures.StandardBoard();
		// A "property"-typed square that nonetheless behaves as Go To Holding — the engine dispatches
		// on the declared behaviour, not the type.
		board[10] = new Square { Id = 10, Name = "Trap", Type = "property", Behavior = "sendToHolding" };
		var harness = new GameHarness(new[] { a }, board);

		await harness.RollAsync("a", 2, 4); // 4 -> 10

		Assert.True(harness.Player("a").IsHeld);
	}

	[Fact]
	public async Task An_auction_ignores_bankrupt_players_when_deciding_it_has_ended()
	{
		var a = TestFixtures.NewPlayer("a", money: 1500);
		var b = TestFixtures.NewPlayer("b", money: 1500);
		var c = TestFixtures.NewPlayer("c", money: 0);
		c.IsBankrupt = true; // already out of the game: must not keep the auction alive
		var board = TestFixtures.StandardBoard();
		board[1] = new Square { Id = 1, Name = "P", Type = "property", Price = 100 };
		var state = TestFixtures.NewState(new[] { a, b, c }, squares: board);
		state.CurrentTurn = "a";
		var context = TestFixtures.NewContext(state);
		var auction = new AuctionRulebook();

		await auction.StartAuctionAsync(1, "a", context);
		await auction.PlaceBidAsync("a", 1, 10, context);
		var pass = await auction.PassAuctionAsync("b", 1, context); // only a (live) bidder remains

		Assert.True(pass.AuctionEnded);
		Assert.Null(state.ActiveAuction);
		Assert.Equal("a", state.Squares[1].OwnerId);                    // a wins
		Assert.Equal(1490, state.Players.First(p => p.Id == "a").Money); // and pays the 10 bid
	}

	[Fact]
	public async Task Ending_an_auction_announces_doubles_roll_again_when_the_player_still_owes_a_roll()
	{
		var a = TestFixtures.NewPlayer("a", money: 1500);
		var b = TestFixtures.NewPlayer("b", money: 1500);
		var board = TestFixtures.StandardBoard();
		board[1] = new Square { Id = 1, Name = "P", Type = "property", Price = 100 };
		var state = TestFixtures.NewState(new[] { a, b }, squares: board);
		state.CurrentTurn = "a";
		var context = TestFixtures.NewContext(state);
		var auction = new AuctionRulebook();
		await auction.StartAuctionAsync(1, "a", context);
		state.MustRollAgain = true; // the initiator rolled doubles before declining

		await auction.EndAuctionAsync(context);

		Assert.Contains(TestFixtures.Announcer(context).Sent, s => s.Key == "game.doubles_roll_again");
	}

	// ── Trade rejection messages (error codes whose message arms were uncovered) ──
	private static async Task<string?> ProposeAsync(TradeState trade, GameContext context)
		=> (await new CorroRulebook().ProposeTradeAsync(trade, context)).ErrorCode;

	[Fact]
	public async Task Trade_rejections_map_to_their_codes()
	{
		var a = TestFixtures.NewPlayer("a", money: 100);
		var b = TestFixtures.NewPlayer("b", money: 100);
		var context = TestFixtures.NewContext(TestFixtures.NewState(new[] { a, b }, squares: TestFixtures.StandardBoard()));

		TradeState Trade(string target, TradeOffer give) => new()
		{
			Id = "t",
			InitiatorId = "a",
			InitiatorName = "A",
			TargetId = target,
			TargetName = target.ToUpper(),
			Initiator = give,
			Target = new TradeOffer { Money = 1 },
		};

		Assert.Equal("SELF_TRADE", await ProposeAsync(Trade("a", new TradeOffer { Money = 10 }), context));
		Assert.Equal("PLAYER_NOT_FOUND", await ProposeAsync(Trade("ghost", new TradeOffer { Money = 10 }), context));
		Assert.Equal("INSUFFICIENT_FUNDS", await ProposeAsync(Trade("b", new TradeOffer { Money = 9999 }), context));
		Assert.Equal("INSUFFICIENT_RELEASE_PASSES", await ProposeAsync(Trade("b", new TradeOffer { ReleasePasses = 5 }), context));

		// A pending trade blocks a second proposal.
		context.GameState.ActiveTrade = new TradeState
		{
			Id = "x",
			InitiatorId = "a",
			InitiatorName = "A",
			TargetId = "b",
			TargetName = "B",
			Initiator = new TradeOffer { Money = 1 },
			Target = new TradeOffer { Money = 1 },
			IsActive = true,
		};
		Assert.Equal("TRADE_IN_PROGRESS", await ProposeAsync(Trade("b", new TradeOffer { Money = 10 }), context));
	}

}
