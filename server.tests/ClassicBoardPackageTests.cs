using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Corro;
using CorroServer.Tests.Integration;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// A classic board expressed as a .corro package (test fixture, not shipped). These
/// tests prove the engine — driven entirely by the package's data — reproduces classic:
/// the adapter maps it faithfully, and the rulebook computes the same rents through the package's
/// rent rules. This is the regression net guarding the data-driven migration.
/// </summary>
public class ClassicBoardPackageTests
{
	private static GameDefinition Load()
		=> new CorroPackageLoader().LoadAsync(CorroTestPaths.FixtureDir("corro-classic"))
			.GetAwaiter().GetResult();

	[Fact]
	public void Adapter_maps_the_classic_board_faithfully()
	{
		var def = Load();
		var squares = GameDefinitionAdapter.ToSquares(def, "es");

		Assert.Equal(40, squares.Count);

		// Corners -> behaviours.
		Assert.Equal("start", squares[0].Behavior);
		Assert.Equal("justVisiting", squares[10].Behavior);
		Assert.Equal("freeParking", squares[20].Behavior);
		Assert.Equal("sendToHolding", squares[30].Behavior);

		// A brown street: ownable, colour from its group, canonical rent table, Spanish name.
		var brown1 = squares[1];
		Assert.Equal("ownable", brown1.Behavior);
		Assert.Equal("brown", brown1.Color);
		Assert.Equal("game.color_brown", brown1.GroupNameKey); // i18n key for the group name (resolved client-side)
		Assert.Equal(new List<int> { 2, 10, 30, 90, 160, 250 }, brown1.Rent);
		Assert.Equal("Calle 1", brown1.Name);

		// Corners belong to no group, so they carry no group name key.
		Assert.Null(squares[0].GroupNameKey);

		// A station and a utility both collapse to "ownable".
		Assert.Equal("ownable", squares[5].Behavior);
		Assert.Equal("ownable", squares[12].Behavior);

		// A card square keeps its deck; a tax square carries its amount in Amount (not Price).
		Assert.Equal("drawCard", squares[2].Behavior);
		Assert.Equal("community", squares[2].Deck);
		Assert.Equal("tax", squares[4].Behavior);
		Assert.Equal(200, squares[4].Amount);
		Assert.Null(squares[4].Price);

		// Settings come from the package rules.
		var settings = GameDefinitionAdapter.ToSettings(def);
		Assert.Equal(1500, settings.StartingMoney);
		Assert.Equal(200, settings.GoBonus);
		Assert.Equal(50, settings.HoldingReleaseCost);
	}

	[Fact]
	public void Streets_are_es_only_while_generic_squares_are_bilingual()
	{
		var def = Load();
		var es = GameDefinitionAdapter.ToSquares(def, "es");
		var en = GameDefinitionAdapter.ToSquares(def, "en");

		// A street has only Spanish, so both languages fall back to it (partial translation).
		Assert.Equal("Calle 1", es[1].Name);
		Assert.Equal("Calle 1", en[1].Name);
		Assert.False(en[1].Names!.ContainsKey("en"));

		// The tax square is translated in both, so each language differs.
		Assert.Equal("Impuesto 4", es[4].Name);
		Assert.Equal("Tax 4", en[4].Name);
	}

	[Fact]
	public void The_classic_deck_loads_as_generic_effects_and_resolves_through_the_interpreter()
	{
		var def = Load();

		// two full 16-card decks, unique ids, every card on a real deck.
		Assert.Equal(32, def.Cards.Count);
		Assert.Equal(16, def.Cards.Count(c => c.Deck == "chance"));
		Assert.Equal(16, def.Cards.Count(c => c.Deck == "community"));
		Assert.Equal(def.Cards.Count, def.Cards.Select(c => c.Id).Distinct().Count());

		CardOutcome Resolve(string id, int from)
			=> CardEffectInterpreter.Resolve(def.Cards.Single(c => c.Id == id).Effect, def.Board, from);

		// Movement, with the classic nearest-railway/utility rent rules carried through.
		Assert.Equal(0, Resolve("chance_advance_go", 7).Position);
		var railway = Resolve("chance_nearest_railway", 7);
		Assert.Equal(15, railway.Position);            // next transit forward (5/15/25/35)
		Assert.Equal(2, railway.RentMultiplier);       // pay double
		var utility = Resolve("chance_nearest_utility", 7);
		Assert.Equal(12, utility.Position);            // next utility forward (12/28)
		Assert.True(utility.UtilityTimesDice);         // 10× dice
		Assert.Equal(CardOutcomeKind.MoveTo, Resolve("chance_go_back_3", 7).Kind);

		// Money, per-player, per-building, holding.
		Assert.Equal(200, Resolve("community_bank_error", 0).Amount);
		Assert.Equal(-15, Resolve("chance_poor_tax", 0).Amount);
		Assert.Equal(CardOutcomeKind.CollectFromEach, Resolve("community_birthday", 0).Kind);
		Assert.Equal(CardOutcomeKind.PayEach, Resolve("chance_chairman", 0).Kind);
		var repairs = Resolve("chance_general_repairs", 0);
		Assert.Equal(CardOutcomeKind.PayPerBuilding, repairs.Kind);
		Assert.Equal(25, repairs.PerSmallBuilding);
		Assert.Equal(100, repairs.PerBigBuilding);
		Assert.Equal(CardOutcomeKind.SendToHolding, Resolve("community_send_to_holding", 0).Kind);
		Assert.Equal(CardOutcomeKind.GrantReleasePass, Resolve("chance_release_pass", 0).Kind);
	}

	[Fact]
	public async Task Station_rent_scales_with_how_many_you_own_through_the_engine()
	{
		var def = Load();
		var squares = GameDefinitionAdapter.ToSquares(def, "es");
		squares[5].OwnerId = "b";  // b owns one station (id 5)
		var a = TestFixtures.NewPlayer("a", money: 2000, position: 3);
		var b = TestFixtures.NewPlayer("b", money: 1500);
		var harness = new GameHarness(new[] { a, b }, squares, rentRules: def.Manifest.Rules);

		await harness.RollAsync("a", 1, 1); // 3 -> 5 (the station)

		Assert.Equal(1525, harness.Player("b").Money); // one station => 25 rent (25/50/100/200 table)
	}

	[Fact]
	public async Task An_unimproved_full_group_doubles_base_rent_through_the_engine()
	{
		var def = Load();
		var squares = GameDefinitionAdapter.ToSquares(def, "es");
		squares[1].OwnerId = "b";  // b owns the whole brown group (1 and 3)
		squares[3].OwnerId = "b";
		var a = TestFixtures.NewPlayer("a", money: 2000, position: 38);
		var b = TestFixtures.NewPlayer("b", money: 1500);
		var harness = new GameHarness(new[] { a, b }, squares, rentRules: def.Manifest.Rules);

		await harness.RollAsync("a", 1, 2); // 38 -> 1 (the unmortgaged brown)

		Assert.Equal(1504, harness.Player("b").Money); // base rent 2 doubled to 4 for the classic
	}
}
