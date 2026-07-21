using CorroServer.Models.Corro;
using CorroServer.Services.Corro;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// The rent strategies are the most board-specific rule, so they are pure and parametric (no
/// hardcoded Corro numbers). These tests pin each strategy and the dispatch-by-square-type using
/// the real Galactic Empire rules config.
/// </summary>
public class RentCalculatorTests
{
	private static readonly int[] PropertyRent = { 2, 10, 30, 90, 160, 250 };
	private static readonly int[] TransitRent = { 25, 50, 100, 200 };

	// ── buildingTable ─────────────────────────────────────────────────────────
	[Fact]
	public void BuildingTable_base_rent_doubles_for_an_unimproved_full_group()
	{
		Assert.Equal(2, RentCalculator.BuildingTable(PropertyRent, smallBuildings: 0, bigBuildings: 0, ownsFullGroup: false));
		Assert.Equal(4, RentCalculator.BuildingTable(PropertyRent, smallBuildings: 0, bigBuildings: 0, ownsFullGroup: true));
	}

	[Fact]
	public void BuildingTable_indexes_by_houses_then_hotel_and_only_base_doubles()
	{
		Assert.Equal(10, RentCalculator.BuildingTable(PropertyRent, smallBuildings: 1, bigBuildings: 0, ownsFullGroup: false));
		Assert.Equal(160, RentCalculator.BuildingTable(PropertyRent, smallBuildings: 4, bigBuildings: 0, ownsFullGroup: false));
		Assert.Equal(250, RentCalculator.BuildingTable(PropertyRent, smallBuildings: 0, bigBuildings: 1, ownsFullGroup: true));
		// With buildings the classic bonus does not apply (only the base rent doubles).
		Assert.Equal(10, RentCalculator.BuildingTable(PropertyRent, smallBuildings: 1, bigBuildings: 0, ownsFullGroup: true));
	}

	// ── ownedCountScale (transit) ─────────────────────────────────────────────
	[Fact]
	public void OwnedCountScale_grows_with_how_many_of_the_group_you_own()
	{
		Assert.Equal(0, RentCalculator.OwnedCountScale(TransitRent, ownedCount: 0));
		Assert.Equal(25, RentCalculator.OwnedCountScale(TransitRent, ownedCount: 1));
		Assert.Equal(50, RentCalculator.OwnedCountScale(TransitRent, ownedCount: 2));
		Assert.Equal(200, RentCalculator.OwnedCountScale(TransitRent, ownedCount: 4));
	}

	// ── diceMultiplier (utility) ──────────────────────────────────────────────
	[Fact]
	public void DiceMultiplier_uses_the_all_factor_only_when_you_own_the_whole_group()
	{
		var mult = new UtilityMultiplier { Single = 4, All = 10 };
		Assert.Equal(28, RentCalculator.DiceMultiplier(dice: 7, ownedCount: 1, totalInGroup: 2, mult));
		Assert.Equal(70, RentCalculator.DiceMultiplier(dice: 7, ownedCount: 2, totalInGroup: 2, mult));
	}

	// ── dispatch by square type, using the shipped Galactic rules ─────────────
	[Fact]
	public async Task Compute_dispatches_by_square_type_from_the_package_rules()
	{
		 var def = await new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir("galactic-empire"));
		var rules = def.Manifest.Rules;

		var property = def.Board.Single(s => s.Id == 1);   // type "property"
		Assert.Equal(2, RentCalculator.Compute(rules, property, new RentContext()));
		Assert.Equal(4, RentCalculator.Compute(rules, property, new RentContext { OwnsFullGroup = true }));

		var transit = def.Board.Single(s => s.Id == 5);    // type "transit"
		Assert.Equal(50, RentCalculator.Compute(rules, transit, new RentContext { OwnedCount = 2 }));

		var utility = def.Board.Single(s => s.Id == 12);   // type "utility"
		Assert.Equal(28, RentCalculator.Compute(rules, utility, new RentContext { Dice = 7, OwnedCount = 1, TotalInGroup = 2 }));
		Assert.Equal(70, RentCalculator.Compute(rules, utility, new RentContext { Dice = 7, OwnedCount = 2, TotalInGroup = 2 }));
	}
}
