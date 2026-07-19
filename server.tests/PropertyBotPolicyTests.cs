using CorroServer.Models;
using CorroServer.Services.Bots;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// The property bot's brain. Decisions run over a projected <see cref="GameState"/>,
/// so they are exhaustively testable here. The invariant that matters most: every branch returns a
/// LEGAL command (or null) — an "I can't afford it" path always ends in decline / pass / bankruptcy,
/// never a command the driver would see rejected and never retry (which would wedge the table).
/// </summary>
public class PropertyBotPolicyTests
{
	private static readonly PropertyBotPolicy Policy = new();

	private static Player Bot(int money = 1500, bool held = false, int releasePasses = 0, List<int>? props = null)
		=> new() { Id = "bot", Name = "Bot", Token = "disc", IsBot = true, Money = money, IsHeld = held, ReleasePasses = releasePasses, Properties = props ?? new() };

	private static Player Rival(int money = 1500)
		=> new() { Id = "rival", Name = "Rival", Token = "car", Money = money };

	/// <summary>A buildable "property" square (has a rent table + building cost).</summary>
	private static Square Prop(int id, string color, int price, string? owner = null, int houses = 0, bool mortgaged = false)
		=> new()
		{
			Id = id,
			Name = $"sq{id}",
			Type = "property",
			Color = color,
			Price = price,
			OwnerId = owner,
			SmallBuildings = houses,
			Mortgaged = mortgaged,
			Rent = new List<int> { 2, 10, 30, 90, 160, 250 },
			BuildingCost = 50,
		};

	private static GameState View(Player me, IEnumerable<Square>? squares = null, string turn = "bot",
		bool rolled = true, bool mustRollAgain = false, Action<GameState>? tweak = null)
	{
		var gs = new GameState
		{
			GameType = "property",
			CurrentTurn = turn,
			HasRolledThisTurn = rolled,
			MustRollAgain = mustRollAgain,
			Players = new List<Player> { me, Rival() },
			Squares = squares?.ToList() ?? new List<Square>(),
		};
		tweak?.Invoke(gs);
		return gs;
	}

	// ── Turn flow ──────────────────────────────────────────────────────────────────────────────

	[Fact]
	public void Not_my_turn_with_no_obligations_does_nothing()
		=> Assert.Null(Policy.Decide(View(Bot(), turn: "rival"), "bot"));

	[Fact]
	public void Game_over_does_nothing()
		=> Assert.Null(Policy.Decide(View(Bot(), tweak: g => g.IsGameOver = true), "bot"));

	[Fact]
	public void My_turn_before_rolling_rolls()
		=> Assert.IsType<RollDiceCommand>(Policy.Decide(View(Bot(), rolled: false), "bot"));

	[Fact]
	public void Owed_a_doubles_reroll_rolls_again()
		=> Assert.IsType<RollDiceCommand>(Policy.Decide(View(Bot(), rolled: true, mustRollAgain: true), "bot"));

	[Fact]
	public void Rolled_with_nothing_pending_ends_the_turn()
		=> Assert.IsType<EndTurnCommand>(Policy.Decide(View(Bot()), "bot"));

	// ── Holding ─────────────────────────────────────────────────────────────────────────────────────

	[Fact]
	public void In_holding_with_a_card_uses_it()
		=> Assert.IsType<UseReleasePassCommand>(Policy.Decide(View(Bot(held: true, releasePasses: 1), rolled: false), "bot"));

	[Fact]
	public void In_holding_without_a_card_rolls_for_doubles()
		=> Assert.IsType<RollDiceCommand>(Policy.Decide(View(Bot(held: true), rolled: false), "bot"));

	// ── Buying / declining ─────────────────────────────────────────────────────────────────────

	[Fact]
	public void Affordable_landing_is_bought()
	{
		var gs = View(Bot(money: 500), tweak: g => g.PendingPurchase = new PendingPurchase { PlayerId = "bot", SquareIndex = 3, SquareName = "sq3", Price = 200 });
		var cmd = Assert.IsType<BuyPropertyCommand>(Policy.Decide(gs, "bot"));
		Assert.Equal(3, cmd.SquareIndex);
	}

	[Fact]
	public void Unaffordable_landing_is_declined_by_ending_the_turn()
	{
		var gs = View(Bot(money: 50), tweak: g => g.PendingPurchase = new PendingPurchase { PlayerId = "bot", SquareIndex = 3, SquareName = "sq3", Price = 200 });
		Assert.IsType<EndTurnCommand>(Policy.Decide(gs, "bot"));
	}

	[Fact]
	public void Unaffordable_landing_on_a_doubles_turn_declines_by_rolling_again()
	{
		var gs = View(Bot(money: 50), mustRollAgain: true, tweak: g => g.PendingPurchase = new PendingPurchase { PlayerId = "bot", SquareIndex = 3, SquareName = "sq3", Price = 200 });
		Assert.IsType<RollDiceCommand>(Policy.Decide(gs, "bot"));
	}

	// ── Debt (deadlock-safe liquidation) ─────────────────────────────────────────────────────────

	private static void OweBank(GameState g, int amount)
		=> g.PendingDebts.Add(new DebtState { Id = "d1", DebtorId = "bot", DebtorName = "Bot", CreditorId = "Bank", CreditorName = "Bank", Amount = amount });

	[Fact]
	public void A_debt_covered_by_cash_is_paid()
	{
		var gs = View(Bot(money: 500), turn: "rival", tweak: g => OweBank(g, 200));
		Assert.IsType<ResolveDebtCommand>(Policy.Decide(gs, "bot"));
	}

	[Fact]
	public void A_debt_short_on_cash_sells_a_house_first()
	{
		var squares = new[] { Prop(1, "brown", 60, owner: "bot", houses: 3) };
		var gs = View(Bot(money: 50, props: new() { 1 }), squares, turn: "rival", tweak: g => OweBank(g, 500));
		var cmd = Assert.IsType<SellBuildingsCommand>(Policy.Decide(gs, "bot"));
		Assert.Equal(1, cmd.SquareIndex);
	}

	[Fact]
	public void A_debt_with_no_houses_mortgages_a_property()
	{
		var squares = new[] { Prop(1, "brown", 60, owner: "bot"), Prop(2, "blue", 400, owner: "bot") };
		var gs = View(Bot(money: 50, props: new() { 1, 2 }), squares, turn: "rival", tweak: g => OweBank(g, 500));
		var cmd = Assert.IsType<MortgagePropertyCommand>(Policy.Decide(gs, "bot"));
		Assert.Equal(1, cmd.SquareIndex); // cheapest first
	}

	[Fact]
	public void A_debt_with_no_assets_left_declares_bankruptcy()
	{
		var gs = View(Bot(money: 50), turn: "rival", tweak: g => OweBank(g, 500));
		Assert.IsType<DeclareBankruptcyCommand>(Policy.Decide(gs, "bot"));
	}

	// ── Auctions ─────────────────────────────────────────────────────────────────────────────────

	private static void Auction(GameState g, int square, int currentBid, string? highId = null)
		=> g.ActiveAuction = new AuctionState { SquareIndex = square, SquareName = $"sq{square}", InitiatorPlayerId = "rival", CurrentBid = currentBid, HighestBidderId = highId };

	[Fact]
	public void An_auction_below_face_value_gets_a_minimum_bid()
	{
		var squares = new[] { Prop(3, "brown", 200) };
		var gs = View(Bot(money: 1000), squares, turn: "rival", tweak: g => Auction(g, 3, 50));
		var cmd = Assert.IsType<PlaceBidCommand>(Policy.Decide(gs, "bot"));
		Assert.Equal(51, cmd.Amount);
	}

	[Fact]
	public void An_auction_at_face_value_is_passed()
	{
		var squares = new[] { Prop(3, "brown", 200) };
		var gs = View(Bot(money: 1000), squares, turn: "rival", tweak: g => Auction(g, 3, 200));
		Assert.IsType<PassAuctionCommand>(Policy.Decide(gs, "bot"));
	}

	[Fact]
	public void Leading_an_auction_waits()
	{
		var squares = new[] { Prop(3, "brown", 200) };
		var gs = View(Bot(money: 1000), squares, turn: "rival", tweak: g => Auction(g, 3, 50, highId: "bot"));
		Assert.Null(Policy.Decide(gs, "bot"));
	}

	// ── Trades (answer only) ───────────────────────────────────────────────────────────────────

	private static TradeState Trade(TradeOffer initiatorGives, TradeOffer botGives, string target = "bot")
		=> new()
		{
			Id = "t1", InitiatorId = "rival", InitiatorName = "Rival", TargetId = target, TargetName = "Bot",
			Initiator = initiatorGives, Target = botGives,
		};

	[Fact]
	public void A_favourable_affordable_trade_is_accepted()
	{
		var gs = View(Bot(money: 1000), turn: "rival",
			tweak: g => g.ActiveTrade = Trade(new TradeOffer { Money = 300 }, new TradeOffer { Money = 100 }));
		var cmd = Assert.IsType<RespondTradeCommand>(Policy.Decide(gs, "bot"));
		Assert.True(cmd.Accept);
	}

	[Fact]
	public void A_lopsided_trade_is_declined()
	{
		var gs = View(Bot(money: 1000), turn: "rival",
			tweak: g => g.ActiveTrade = Trade(new TradeOffer { Money = 50 }, new TradeOffer { Money = 400 }));
		var cmd = Assert.IsType<RespondTradeCommand>(Policy.Decide(gs, "bot"));
		Assert.False(cmd.Accept);
	}

	[Fact]
	public void A_trade_that_would_break_my_complete_group_is_declined()
	{
		// I own the whole brown group; the trade asks for one of them, even for good money.
		var squares = new[] { Prop(1, "brown", 60, owner: "bot"), Prop(2, "brown", 60, owner: "bot") };
		var gs = View(Bot(money: 1000, props: new() { 1, 2 }), squares, turn: "rival",
			tweak: g => g.ActiveTrade = Trade(new TradeOffer { Money = 1000 }, new TradeOffer { Properties = new() { 1 } }));
		var cmd = Assert.IsType<RespondTradeCommand>(Policy.Decide(gs, "bot"));
		Assert.False(cmd.Accept);
	}

	[Fact]
	public void A_trade_between_others_is_left_alone()
	{
		var gs = View(Bot(), turn: "rival",
			tweak: g => g.ActiveTrade = Trade(new TradeOffer { Money = 300 }, new TradeOffer { Money = 100 }, target: "rival"));
		Assert.Null(Policy.Decide(gs, "bot"));
	}

	// ── Building ─────────────────────────────────────────────────────────────────────────────────

	[Fact]
	public void A_completed_group_gets_a_house_on_the_least_built_square()
	{
		var squares = new[] { Prop(1, "brown", 60, owner: "bot", houses: 1), Prop(2, "brown", 60, owner: "bot", houses: 0) };
		var gs = View(Bot(money: 1000, props: new() { 1, 2 }), squares);
		var cmd = Assert.IsType<BuildCommand>(Policy.Decide(gs, "bot"));
		Assert.Equal(2, cmd.SquareIndex); // the 0-house square, keeping the group even
	}

	[Fact]
	public void An_incomplete_group_is_not_built_on()
	{
		var squares = new[] { Prop(1, "brown", 60, owner: "bot"), Prop(2, "brown", 60, owner: "rival") };
		var gs = View(Bot(money: 1000, props: new() { 1 }), squares);
		Assert.IsType<EndTurnCommand>(Policy.Decide(gs, "bot")); // No complete group means nothing to build.
	}

	[Fact]
	public void Building_stops_to_keep_the_cash_cushion()
	{
		var squares = new[] { Prop(1, "brown", 60, owner: "bot"), Prop(2, "brown", 60, owner: "bot") };
		var gs = View(Bot(money: 100, props: new() { 1, 2 }), squares); // below the cushion
		Assert.IsType<EndTurnCommand>(Policy.Decide(gs, "bot"));
	}
}
