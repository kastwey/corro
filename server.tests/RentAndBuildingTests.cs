using CorroServer.Models;
using CorroServer.Services.Rules;

namespace CorroServer.Tests;

/// <summary>
/// Tests for the rent engine and smallBuilding/bigBuilding building, now that rent uses the canonical
/// per-square rent table ([base, 1, 2, 3, 4, bigBuilding]) with a classic double on the bare
/// base rent, mortgaged properties collect nothing, and building smallBuildings/bigBuildings is wired.
/// </summary>
public class RentAndBuildingTests
{
	// A canonical-looking colour group of two squares (like a brown group), price 60,
	// rent table [2, 10, 30, 90, 160, 250], smallBuilding cost 50.
	private static readonly int[] BrownRent = { 2, 10, 30, 90, 160, 250 };

	private static Square ColourSquare(int id, string? ownerId = null, int smallBuildings = 0, int bigBuildings = 0, bool mortgaged = false)
		=> new()
		{
			Id = id,
			Name = $"Brown {id}",
			Type = "property",
			Color = "brown",
			Price = 60,
			Rent = BrownRent.ToList(),
			BuildingCost = 50,
			OwnerId = ownerId,
			SmallBuildings = smallBuildings,
			BigBuildings = bigBuildings,
			Mortgaged = mortgaged
		};

	// ── PropertyRentFor (pure) ───────────────────────────────────────────────

	[Fact]
	public void BareBaseRent_WhenNoFullGroup()
		=> Assert.Equal(2, CorroRulebook.PropertyRentFor(BrownRent, 60, smallBuildings: 0, bigBuildings: 0, hasFullGroup: false));

	[Fact]
	public void BaseRentDoubles_WithFullGroup_AndNoBuildings()
		=> Assert.Equal(4, CorroRulebook.PropertyRentFor(BrownRent, 60, smallBuildings: 0, bigBuildings: 0, hasFullGroup: true));

	[Fact]
	public void FullGroupMultiplier_IsConfigurable()
		// Base rent 2 × a custom group multiplier of 3 = 6 (only the base, not improved, tiers).
		=> Assert.Equal(6, CorroRulebook.PropertyRentFor(BrownRent, 60, smallBuildings: 0, bigBuildings: 0, hasFullGroup: true, fullGroupMultiplier: 3));

	[Theory]
	[InlineData(1, 10)]
	[InlineData(2, 30)]
	[InlineData(3, 90)]
	[InlineData(4, 160)]
	public void HousesMapOntoRentTiers(int smallBuildings, int expected)
		=> Assert.Equal(expected, CorroRulebook.PropertyRentFor(BrownRent, 60, smallBuildings, bigBuildings: 0, hasFullGroup: true));

	[Fact]
	public void HotelChargesTopTier_EvenWithoutFullGroupFlag()
		=> Assert.Equal(250, CorroRulebook.PropertyRentFor(BrownRent, 60, smallBuildings: 0, bigBuildings: 1, hasFullGroup: false));

	[Fact]
	public void HotelTakesPrecedenceOverHouseCount()
		=> Assert.Equal(250, CorroRulebook.PropertyRentFor(BrownRent, 60, smallBuildings: 4, bigBuildings: 1, hasFullGroup: true));

	[Fact]
	public void FullGroupDoubleDoesNotApplyOnceHousesExist()
		=> Assert.Equal(10, CorroRulebook.PropertyRentFor(BrownRent, 60, smallBuildings: 1, bigBuildings: 0, hasFullGroup: true));

	[Fact]
	public void FallsBackToTenPercent_WhenNoRentTable()
		=> Assert.Equal(6, CorroRulebook.PropertyRentFor(null, price: 60, smallBuildings: 0, bigBuildings: 0, hasFullGroup: true));

	[Fact]
	public void FallsBackToTenPercent_WhenTableTooShort()
		=> Assert.Equal(6, CorroRulebook.PropertyRentFor(new[] { 2, 10 }, price: 60, smallBuildings: 0, bigBuildings: 0, hasFullGroup: false));

	// ── Rent payment flow (integration) ──────────────────────────────────────

	[Fact]
	public async Task LandingOnFullGroupProperty_PaysDoubledBaseRent()
	{
		var owner = TestFixtures.NewPlayer("owner", money: 1500);
		var tenant = TestFixtures.NewPlayer("tenant", money: 1500, position: 1);
		// Owner holds the whole brown group → classic → base rent doubles (2 → 4).
		var state = TestFixtures.NewState(new[] { owner, tenant },
			squares: new List<Square> { ColourSquare(0, "owner"), ColourSquare(1, "owner") });
		var context = TestFixtures.NewContext(state);

		await new CorroRulebook().ProcessLandingEffectsAsync(tenant, 1, context);

		Assert.Equal(1500 - 4, tenant.Money);
		Assert.Equal(1500 + 4, owner.Money);
	}

	[Fact]
	public async Task LandingOnHotelProperty_PaysTopTierRent()
	{
		var owner = TestFixtures.NewPlayer("owner", money: 1500);
		var tenant = TestFixtures.NewPlayer("tenant", money: 1500, position: 1);
		var state = TestFixtures.NewState(new[] { owner, tenant },
			squares: new List<Square> { ColourSquare(0, "owner"), ColourSquare(1, "owner", bigBuildings: 1) });
		var context = TestFixtures.NewContext(state);

		await new CorroRulebook().ProcessLandingEffectsAsync(tenant, 1, context);

		Assert.Equal(1500 - 250, tenant.Money);
		Assert.Equal(1500 + 250, owner.Money);
	}

	[Fact]
	public async Task MortgagedProperty_CollectsNoRent()
	{
		var owner = TestFixtures.NewPlayer("owner", money: 1500);
		var tenant = TestFixtures.NewPlayer("tenant", money: 1500, position: 1);
		var state = TestFixtures.NewState(new[] { owner, tenant },
			squares: new List<Square> { ColourSquare(0, "owner"), ColourSquare(1, "owner", mortgaged: true) });
		var context = TestFixtures.NewContext(state);

		await new CorroRulebook().ProcessLandingEffectsAsync(tenant, 1, context);

		Assert.Equal(1500, tenant.Money);
		Assert.Equal(1500, owner.Money);

		// Bug 8: the tenant must be told WHY no rent was charged, not just hear silence.
		var announcer = TestFixtures.Announcer(context);
		Assert.True(announcer.Has(AnnouncementAudience.Player, "tenant", "game.rent_not_due_mortgaged_self"));
		Assert.True(announcer.Has(AnnouncementAudience.AllExcept, "tenant", "game.rent_not_due_mortgaged"));
	}

	// ── Building smallBuildings/bigBuildings (integration) ─────────────────────────────────

	[Fact]
	public async Task BuildHouse_RequiresFullGroup()
	{
		var owner = TestFixtures.NewPlayer("owner", money: 1500);
		// Owns only one of the two brown squares → no classic.
		var state = TestFixtures.NewState(new[] { owner },
			squares: new List<Square> { ColourSquare(0, "owner"), ColourSquare(1, ownerId: null) });
		var context = TestFixtures.NewContext(state);

		var outcome = await new CorroRulebook().BuildAsync(owner, 0, context);

		Assert.False(outcome.Success);
		Assert.Equal("NO_FULL_GROUP", outcome.ErrorCode);
		Assert.Equal(0, state.Squares[0].SmallBuildings);
	}

	[Fact]
	public async Task BuildHouse_DeductsCost_AndAddsAHouse()
	{
		var owner = TestFixtures.NewPlayer("owner", money: 1500);
		var state = TestFixtures.NewState(new[] { owner },
			squares: new List<Square> { ColourSquare(0, "owner"), ColourSquare(1, "owner") });
		var context = TestFixtures.NewContext(state);

		var outcome = await new CorroRulebook().BuildAsync(owner, 0, context);

		Assert.True(outcome.Success);
		Assert.Equal(1, state.Squares[0].SmallBuildings);
		Assert.Equal(1500 - 50, owner.Money); // smallBuilding cost 50
	}

	[Fact]
	public async Task BuildHouse_EnforcesEvenBuilding()
	{
		var owner = TestFixtures.NewPlayer("owner", money: 1500);
		// Square 0 already has a smallBuilding; building a second on it before square 1 is uneven.
		var state = TestFixtures.NewState(new[] { owner },
			squares: new List<Square> { ColourSquare(0, "owner", smallBuildings: 1), ColourSquare(1, "owner") });
		var context = TestFixtures.NewContext(state);

		var outcome = await new CorroRulebook().BuildAsync(owner, 0, context);

		Assert.False(outcome.Success);
		Assert.Equal("UNEVEN_BUILDING", outcome.ErrorCode);
	}

	[Fact]
	public async Task BuildHouse_TurnsFourHousesIntoAHotel()
	{
		var owner = TestFixtures.NewPlayer("owner", money: 1500);
		// Both squares at 4 smallBuildings; the next build on square 0 should yield a bigBuilding.
		var state = TestFixtures.NewState(new[] { owner },
			squares: new List<Square> { ColourSquare(0, "owner", smallBuildings: 4), ColourSquare(1, "owner", smallBuildings: 4) });
		var context = TestFixtures.NewContext(state);

		var outcome = await new CorroRulebook().BuildAsync(owner, 0, context);

		Assert.True(outcome.Success);
		Assert.Equal(0, state.Squares[0].SmallBuildings);
		Assert.Equal(1, state.Squares[0].BigBuildings);
		Assert.Equal(1500 - 50, owner.Money);
	}

	[Fact]
	public async Task BuildHouse_CannotBuildOnMortgagedProperty()
	{
		var owner = TestFixtures.NewPlayer("owner", money: 1500);
		var state = TestFixtures.NewState(new[] { owner },
			squares: new List<Square> { ColourSquare(0, "owner", mortgaged: true), ColourSquare(1, "owner") });
		var context = TestFixtures.NewContext(state);

		var outcome = await new CorroRulebook().BuildAsync(owner, 0, context);

		Assert.False(outcome.Success);
		Assert.Equal("MORTGAGED", outcome.ErrorCode);
	}

	// ── "You landed on a developed property" flavour announcement ─────────────

	[Fact]
	public void BuildingsFlex_IsNull_OnBareProperty()
		=> Assert.Null(CorroRulebook.BuildingsFlexAnnouncement(ColourSquare(1, "owner")));

	[Fact]
	public void BuildingsFlex_UsesSingularKey_ForOneHouse()
		=> Assert.Equal(("game.landed_on_building", 1),
			CorroRulebook.BuildingsFlexAnnouncement(ColourSquare(1, "owner", smallBuildings: 1)));

	[Fact]
	public void BuildingsFlex_UsesPluralKey_WithCount_ForSeveralHouses()
		=> Assert.Equal(("game.landed_on_buildings", 3),
			CorroRulebook.BuildingsFlexAnnouncement(ColourSquare(1, "owner", smallBuildings: 3)));

	[Fact]
	public void BuildingsFlex_HotelTakesPrecedenceOverHouses()
		=> Assert.Equal(("game.landed_on_big_building", 1),
			CorroRulebook.BuildingsFlexAnnouncement(ColourSquare(1, "owner", smallBuildings: 4, bigBuildings: 1)));

	[Fact]
	public async Task LandingOnDevelopedProperty_AnnouncesTheBuildingsFlex_ToTheActor()
	{
		var owner = TestFixtures.NewPlayer("owner", money: 1500);
		var tenant = TestFixtures.NewPlayer("tenant", money: 1500, position: 1);
		var state = TestFixtures.NewState(new[] { owner, tenant },
			squares: new List<Square> { ColourSquare(0, "owner"), ColourSquare(1, "owner", smallBuildings: 3) });
		var context = TestFixtures.NewContext(state);

		await new CorroRulebook().ProcessLandingEffectsAsync(tenant, 1, context);

		var flex = Assert.Single(TestFixtures.Announcer(context).Sent, a => a.Key == "game.landed_on_buildings");
		Assert.Equal(3, flex.Vars["count"]);
		Assert.Equal(tenant.Id, flex.Vars["actorId"]);
		Assert.Equal(state.Squares[1].Name, flex.Vars["property"]);
	}

	[Fact]
	public async Task LandingOnBareProperty_DoesNotAnnounceAnyBuildingsFlex()
	{
		var owner = TestFixtures.NewPlayer("owner", money: 1500);
		var tenant = TestFixtures.NewPlayer("tenant", money: 1500, position: 1);
		var state = TestFixtures.NewState(new[] { owner, tenant },
			squares: new List<Square> { ColourSquare(0, "owner"), ColourSquare(1, "owner") });
		var context = TestFixtures.NewContext(state);

		await new CorroRulebook().ProcessLandingEffectsAsync(tenant, 1, context);

		Assert.DoesNotContain(TestFixtures.Announcer(context).Sent,
			a => a.Key is "game.landed_on_building" or "game.landed_on_buildings" or "game.landed_on_big_building");
	}
}
