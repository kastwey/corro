using CorroServer.Models;
using CorroServer.Services.Commands;
using CorroServer.Services.Rules;

namespace CorroServer.Tests;

/// <summary>
/// Unit coverage for the validation branches and the sell-building flow of
/// <see cref="CorroRulebook"/> property management
/// (mortgage / unmortgage / build / sell), complementing the happy-path coverage in
/// <see cref="RentAndBuildingTests"/> and <see cref="GameRulesSettingsTests"/>.
/// </summary>
public class PropertyManagementTests
{
	/// <summary>A brown property (smallBuilding cost 50, price 100) with explicit building state.</summary>
	private static Square Brown(int id, string? ownerId, int smallBuildings = 0, int bigBuildings = 0, bool mortgaged = false)
		=> new()
		{
			Id = id,
			Name = $"Brown {id}",
			Type = "property",
			Color = "brown",
			Price = 100,
			BuildingCost = 50,
			Rent = new List<int> { 2, 10, 30, 90, 160, 250 },
			OwnerId = ownerId,
			SmallBuildings = smallBuildings,
			BigBuildings = bigBuildings,
			Mortgaged = mortgaged
		};

	/// <summary>Both brown lots owned by "a" — a complete colour group (classic).</summary>
	private static (Player owner, GameContext context) Corro(
		int aHouses = 0, int bHouses = 0, int aHotels = 0, int bHotels = 0,
		bool aMortgaged = false, int money = 1500)
	{
		var owner = TestFixtures.NewPlayer("a", money: money);
		owner.LapsCompleted = 1;
		var squares = new List<Square>
		{
			Brown(0, "a", aHouses, aHotels, aMortgaged),
			Brown(1, "a", bHouses, bHotels)
		};
		var state = TestFixtures.NewState(new[] { owner }, bankMoney: 10000, squares: squares);
		state.CurrentTurn = "a";
		return (owner, TestFixtures.NewContext(state));
	}

	// ── Mortgage ──────────────────────────────────────────────────────────────

	[Fact]
	public async Task Mortgage_UnknownSquare_IsRejected()
	{
		var (owner, context) = Corro();

		var outcome = await new CorroRulebook().MortgagePropertyAsync(owner, 99, context);

		Assert.False(outcome.Success);
		Assert.Equal("PROPERTY_NOT_FOUND", outcome.ErrorCode);
	}

	[Fact]
	public async Task Mortgage_NotOwner_IsRejected()
	{
		var stranger = TestFixtures.NewPlayer("z", money: 1500);
		var (_, context) = Corro();
		context.GameState.Players.Add(stranger);

		var outcome = await new CorroRulebook().MortgagePropertyAsync(stranger, 0, context);

		Assert.False(outcome.Success);
		Assert.Equal("NOT_OWNER", outcome.ErrorCode);
	}

	[Fact]
	public async Task Mortgage_AlreadyMortgaged_IsRejected()
	{
		var (owner, context) = Corro(aMortgaged: true);

		var outcome = await new CorroRulebook().MortgagePropertyAsync(owner, 0, context);

		Assert.False(outcome.Success);
		Assert.Equal("ALREADY_MORTGAGED", outcome.ErrorCode);
	}

	[Fact]
	public async Task Mortgage_WithBuildings_IsRejected()
	{
		var (owner, context) = Corro(aHouses: 1, bHouses: 1);

		var outcome = await new CorroRulebook().MortgagePropertyAsync(owner, 0, context);

		Assert.False(outcome.Success);
		Assert.Equal("HAS_BUILDINGS", outcome.ErrorCode);
	}

	[Fact]
	public async Task Mortgage_WhenAnotherLotInTheGroupHasBuildings_IsRejected()
	{
		// Lot 0 has no smallBuildings, but its colour-group mate (lot 1) does. Officially every building
		// in the group must be sold back to the bank before ANY of its lots can be mortgaged.
		var (owner, context) = Corro(aHouses: 0, bHouses: 1);

		var outcome = await new CorroRulebook().MortgagePropertyAsync(owner, 0, context);

		Assert.False(outcome.Success);
		Assert.Equal("HAS_BUILDINGS", outcome.ErrorCode);
	}

	[Fact]
	public async Task Mortgage_Success_PaysHalfPrice_AndConservesMoney()
	{
		var (owner, context) = Corro(money: 1500);
		var before = TestFixtures.TotalMoney(context.GameState);

		var outcome = await new CorroRulebook().MortgagePropertyAsync(owner, 0, context);

		Assert.True(outcome.Success);
		Assert.Equal(50, outcome.AmountChanged); // 50% of 100
		Assert.Equal(1550, owner.Money);
		Assert.True(context.Helper.GetSquare(0)!.Mortgaged);
		Assert.Equal(before, TestFixtures.TotalMoney(context.GameState));
	}

	// ── Unmortgage ────────────────────────────────────────────────────────────

	[Fact]
	public async Task Unmortgage_UnknownSquare_IsRejected()
	{
		var (owner, context) = Corro();

		var outcome = await new CorroRulebook().UnmortgagePropertyAsync(owner, 99, context);

		Assert.False(outcome.Success);
		Assert.Equal("PROPERTY_NOT_FOUND", outcome.ErrorCode);
	}

	[Fact]
	public async Task Unmortgage_NotOwner_IsRejected()
	{
		var stranger = TestFixtures.NewPlayer("z", money: 1500);
		var (_, context) = Corro(aMortgaged: true);
		context.GameState.Players.Add(stranger);

		var outcome = await new CorroRulebook().UnmortgagePropertyAsync(stranger, 0, context);

		Assert.False(outcome.Success);
		Assert.Equal("NOT_OWNER", outcome.ErrorCode);
	}

	[Fact]
	public async Task Unmortgage_NotMortgaged_IsRejected()
	{
		var (owner, context) = Corro();

		var outcome = await new CorroRulebook().UnmortgagePropertyAsync(owner, 0, context);

		Assert.False(outcome.Success);
		Assert.Equal("NOT_MORTGAGED", outcome.ErrorCode);
	}

	[Fact]
	public async Task Unmortgage_InsufficientFunds_IsRejected()
	{
		var (owner, context) = Corro(aMortgaged: true, money: 10);

		var outcome = await new CorroRulebook().UnmortgagePropertyAsync(owner, 0, context);

		Assert.False(outcome.Success);
		Assert.Equal("INSUFFICIENT_FUNDS", outcome.ErrorCode);
		Assert.True(context.Helper.GetSquare(0)!.Mortgaged); // unchanged
	}

	// ── Build (validation branches not covered elsewhere) ─────────────────────

	[Fact]
	public async Task Build_OnNonProperty_IsRejected()
	{
		var owner = TestFixtures.NewPlayer("a", money: 1500);
		var squares = new List<Square> { new() { Id = 0, Name = "Station", Type = "railroad", OwnerId = "a" } };
		var state = TestFixtures.NewState(new[] { owner }, bankMoney: 10000, squares: squares);
		var context = TestFixtures.NewContext(state);

		var outcome = await new CorroRulebook().BuildAsync(owner, 0, context);

		Assert.False(outcome.Success);
		Assert.Equal("INVALID_SQUARE", outcome.ErrorCode);
	}

	[Fact]
	public async Task Build_NotOwner_IsRejected()
	{
		var stranger = TestFixtures.NewPlayer("z", money: 1500);
		var (_, context) = Corro();
		context.GameState.Players.Add(stranger);

		var outcome = await new CorroRulebook().BuildAsync(stranger, 0, context);

		Assert.False(outcome.Success);
		Assert.Equal("NOT_OWNER", outcome.ErrorCode);
	}

	[Fact]
	public async Task Build_OnMortgagedProperty_IsRejected()
	{
		var (owner, context) = Corro(aMortgaged: true);

		var outcome = await new CorroRulebook().BuildAsync(owner, 0, context);

		Assert.False(outcome.Success);
		Assert.Equal("MORTGAGED", outcome.ErrorCode);
	}

	[Fact]
	public async Task Build_WhenAnotherGroupPropertyIsMortgaged_ReportsGroupMortgaged_NotMissingFullGroup()
	{
		// Owns the whole brown group, but one lot is mortgaged. Building on the OTHER (unmortgaged)
		// lot must fail with a truthful reason — not "you don't own the group", which would be a lie.
		var (owner, context) = Corro(aMortgaged: true);

		var outcome = await new CorroRulebook().BuildAsync(owner, 1, context);

		Assert.False(outcome.Success);
		Assert.Equal("GROUP_MORTGAGED", outcome.ErrorCode);
	}

	[Fact]
	public async Task Build_WithoutFullGroup_IsRejected()
	{
		var owner = TestFixtures.NewPlayer("a", money: 1500);
		owner.LapsCompleted = 1;
		var squares = new List<Square> { Brown(0, "a"), Brown(1, ownerId: null) };
		var state = TestFixtures.NewState(new[] { owner }, bankMoney: 10000, squares: squares);
		var context = TestFixtures.NewContext(state);

		var outcome = await new CorroRulebook().BuildAsync(owner, 0, context);

		Assert.False(outcome.Success);
		Assert.Equal("NO_FULL_GROUP", outcome.ErrorCode);
	}

	[Fact]
	public async Task Build_AtMaxBuildings_IsRejected()
	{
		// Both lots already at a bigBuilding (4 smallBuildings converted) — nothing more to build.
		var (owner, context) = Corro(aHouses: 4, aHotels: 1, bHouses: 4, bHotels: 1);

		var outcome = await new CorroRulebook().BuildAsync(owner, 0, context);

		Assert.False(outcome.Success);
		Assert.Equal("MAX_BUILDINGS", outcome.ErrorCode);
	}

	// ── Configurable building levels (a board can require N small constructions, not just 4) ──

	/// <summary>A board where 5 small constructions combine into the big one (rent table base+5+1).</summary>
	private static (Player owner, GameContext context) FiveLevelGroup(
		int aSmall = 0, int bSmall = 0, int aBig = 0, int bBig = 0)
	{
		Square colony(int id, int small, int big) => new()
		{
			Id = id,
			Name = $"Colony {id}",
			Type = "property",
			Color = "g1",
			Price = 100,
			BuildingCost = 50,
			Rent = new List<int> { 2, 10, 30, 90, 160, 205, 250 }, // base + 5 small + 1 big
			OwnerId = "a",
			SmallBuildings = small,
			BigBuildings = big,
		};
		var owner = TestFixtures.NewPlayer("a", money: 5000);
		owner.LapsCompleted = 1;
		var state = TestFixtures.NewState(new[] { owner }, bankMoney: 10000,
			squares: new List<Square> { colony(0, aSmall, aBig), colony(1, bSmall, bBig) });
		state.CurrentTurn = "a";
		return (owner, TestFixtures.NewContext(state, new GameSettings { BuildingLevels = 5 }));
	}

	[Fact]
	public async Task Build_WithFiveLevels_ConvertsToTheBigConstructionOnlyAfterFiveSmall()
	{
		// Both lots hold 5 small constructions (the configured maximum before the big one).
		var (owner, context) = FiveLevelGroup(aSmall: 5, bSmall: 5);

		var outcome = await new CorroRulebook().BuildAsync(owner, 0, context);

		Assert.True(outcome.Success);
		var sq = context.Helper.GetSquare(0)!;
		Assert.Equal(0, sq.SmallBuildings); // the 5 small ones convert…
		Assert.Equal(1, sq.BigBuildings); // …into one big construction
	}

	[Fact]
	public async Task Build_WithFiveLevels_RejectsBuildingPastTheBigConstruction()
	{
		var (owner, context) = FiveLevelGroup(aSmall: 5, aBig: 1, bSmall: 5, bBig: 1);

		var outcome = await new CorroRulebook().BuildAsync(owner, 0, context);

		Assert.False(outcome.Success);
		Assert.Equal("MAX_BUILDINGS", outcome.ErrorCode);
	}

	[Fact]
	public async Task Build_WithFiveLevels_FifthSmallStaysSmall_NotConvertedEarly()
	{
		// At 4 small on both lots, building a 5th is still a small construction (would have been a
		// bigBuilding under the hardcoded 4-level rule).
		var (owner, context) = FiveLevelGroup(aSmall: 4, bSmall: 4);

		var outcome = await new CorroRulebook().BuildAsync(owner, 0, context);

		Assert.True(outcome.Success);
		var sq = context.Helper.GetSquare(0)!;
		Assert.Equal(5, sq.SmallBuildings);
		Assert.Equal(0, sq.BigBuildings);
	}

	[Fact]
	public async Task Build_InsufficientFunds_IsRejected()
	{
		var (owner, context) = Corro(money: 10); // smallBuilding costs 50

		var outcome = await new CorroRulebook().BuildAsync(owner, 0, context);

		Assert.False(outcome.Success);
		Assert.Equal("INSUFFICIENT_FUNDS", outcome.ErrorCode);
	}

	[Fact]
	public async Task Build_OutsideOwnTurn_IsAllowed()
	{
		// Official rule: buildings may be bought at any time, even during another
		// player's turn. Make it someone else's turn and assert building still works.
		var (owner, context) = Corro();
		context.GameState.CurrentTurn = "someone-else";

		var outcome = await new CorroRulebook().BuildAsync(owner, 0, context);

		Assert.True(outcome.Success);
		Assert.Equal(1, context.Helper.GetSquare(0)!.SmallBuildings);
	}

	// ── Sell buildings ────────────────────────────────────────────────────────

	[Fact]
	public async Task SellHouse_UnknownSquare_IsRejected()
	{
		var (owner, context) = Corro();

		var outcome = await new CorroRulebook().SellBuildingAsync(owner, 99, context);

		Assert.False(outcome.Success);
		Assert.Equal("PROPERTY_NOT_FOUND", outcome.ErrorCode);
	}

	[Fact]
	public async Task SellHouse_NotOwner_IsRejected()
	{
		var stranger = TestFixtures.NewPlayer("z", money: 1500);
		var (_, context) = Corro(aHouses: 1, bHouses: 1);
		context.GameState.Players.Add(stranger);

		var outcome = await new CorroRulebook().SellBuildingAsync(stranger, 0, context);

		Assert.False(outcome.Success);
		Assert.Equal("NOT_OWNER", outcome.ErrorCode);
	}

	[Fact]
	public async Task SellHouse_WithNoBuildings_IsRejected()
	{
		var (owner, context) = Corro();

		var outcome = await new CorroRulebook().SellBuildingAsync(owner, 0, context);

		Assert.False(outcome.Success);
		Assert.Equal("NO_BUILDINGS", outcome.ErrorCode);
	}

	[Fact]
	public async Task SellHouse_UnevenSelling_IsRejected()
	{
		// a has 1 smallBuilding, b has 2 — selling from the lower lot would worsen the imbalance.
		var (owner, context) = Corro(aHouses: 1, bHouses: 2);

		var outcome = await new CorroRulebook().SellBuildingAsync(owner, 0, context);

		Assert.False(outcome.Success);
		Assert.Equal("UNEVEN_SELLING", outcome.ErrorCode);
	}

	[Fact]
	public async Task SellHouse_Success_RefundsHalfCost_AndConservesMoney()
	{
		var (owner, context) = Corro(aHouses: 1, bHouses: 1, money: 1000);
		var before = TestFixtures.TotalMoney(context.GameState);

		var outcome = await new CorroRulebook().SellBuildingAsync(owner, 0, context);

		Assert.True(outcome.Success);
		Assert.Equal(25, outcome.AmountChanged); // half of the 50 smallBuilding cost
		Assert.Equal(1025, owner.Money);
		Assert.Equal(0, context.Helper.GetSquare(0)!.SmallBuildings);
		Assert.Equal(before, TestFixtures.TotalMoney(context.GameState));
	}

	[Fact]
	public async Task SellHotel_Success_RevertsToFourHouses()
	{
		// Both lots hold a bigBuilding; selling one reverts it to four smallBuildings and refunds half a smallBuilding.
		var (owner, context) = Corro(aHouses: 0, aHotels: 1, bHouses: 0, bHotels: 1, money: 1000);

		var outcome = await new CorroRulebook().SellBuildingAsync(owner, 0, context);

		Assert.True(outcome.Success);
		Assert.Equal(0, context.Helper.GetSquare(0)!.BigBuildings);
		Assert.Equal(4, context.Helper.GetSquare(0)!.SmallBuildings);
		Assert.Equal(1025, owner.Money);
	}
}
