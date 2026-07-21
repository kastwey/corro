using System.Text.Json;
using CorroServer.Models.Corro;
using CorroServer.Services.Corro;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// The adapter turns a loaded .corro package into the engine's runtime board + settings + rent
/// rules. These pin the mapping against the shipped "Galactic Empire" package, so a package can
/// drive the game without the rulebook knowing any of its content.
/// </summary>
public class GameDefinitionAdapterTests
{
	private static GameDefinition Galactic()
		  => new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir("galactic-empire"))
			.GetAwaiter().GetResult();

	[Fact]
	public void ToSquares_maps_types_to_generic_behaviours_and_data()
	{
		var squares = GameDefinitionAdapter.ToSquares(Galactic(), "en");

		Assert.Equal(40, squares.Count);

		// Corners -> generic behaviours.
		Assert.Equal("start", squares[0].Behavior);
		Assert.Equal("justVisiting", squares[10].Behavior);
		Assert.Equal("freeParking", squares[20].Behavior);
		Assert.Equal("sendToHolding", squares[30].Behavior);

		// Tax: behaviour + the package's `amount` mapped onto Amount (what ProcessTax reads), NOT
		// Price — a tax square is not for sale, so its Price stays null.
		Assert.Equal("tax", squares[4].Behavior);
		Assert.Equal(200, squares[4].Amount);
		Assert.Null(squares[4].Price);

		// Card square: drawCard behaviour, keeps its deck id for the draw.
		var deckSquare = squares.First(s => s.Type == "deck");
		Assert.Equal("drawCard", deckSquare.Behavior);
		Assert.False(string.IsNullOrEmpty(deckSquare.Deck));

		// Ownable squares: property + transit + utility all collapse to one behaviour.
		Assert.Equal("ownable", squares.First(s => s.Type == "property").Behavior);
		Assert.Equal("ownable", squares.First(s => s.Type == "transit").Behavior);
		Assert.Equal("ownable", squares.First(s => s.Type == "utility").Behavior);

		// A property carries its rent table, a colour (from its group) and localized names.
		var property = squares.First(s => s.Type == "property");
		Assert.NotNull(property.Rent);
		Assert.False(string.IsNullOrEmpty(property.Color));
		Assert.NotNull(property.Names);
		Assert.False(string.IsNullOrEmpty(property.Name));
	}

	[Fact]
	public void ToSquares_names_an_unnamed_card_square_from_its_deck()
	{
		// Bug #8: a card ("deck") square carries no name of its own, so before it read blank —
		// e.g. as a bus destination. It now falls back to its deck's display name.
		var squares = GameDefinitionAdapter.ToSquares(Galactic(), "es");
		var fortuneSquare = squares.First(s => s.Type == "deck" && s.Deck == "fortune");

		Assert.Equal("Anomalía Cuántica", fortuneSquare.Name);
		Assert.Equal("Quantum Anomaly", fortuneSquare.Names!["en"]);
	}

	[Fact]
	public void ToSquares_resolves_the_canonical_name_for_the_requested_language()
	{
		var def = Galactic();
		var src = def.Board.First(s => s.Type == "property" && s.NameKey != null);

		var en = GameDefinitionAdapter.ToSquares(def, "en").First(s => s.Id == src.Id);
		var es = GameDefinitionAdapter.ToSquares(def, "es").First(s => s.Id == src.Id);

		// The name is resolved from the package's own i18n by the square's key.
		Assert.Equal(def.I18n["en"][src.NameKey!], en.Name);
		Assert.Equal(def.I18n["es"][src.NameKey!], es.Name);
		// Both translations are carried so the client can re-resolve per player.
		Assert.True(en.Names!.ContainsKey("en") && en.Names.ContainsKey("es"));
	}

	[Fact]
	public void ToSquares_names_an_unnamed_corner_from_the_boards_terminology()
	{
		// The galactic corners carry no nameKey; their name comes from the manifest terminology so
		// landing announcements say "Agujero Negro" rather than a generic "Holding".
		var squares = GameDefinitionAdapter.ToSquares(Galactic(), "es");

		Assert.Equal("Agujero Negro", squares[10].Name);     // holding corner
		Assert.Equal("Astillero Orbital", squares[20].Name); // free parking corner
		Assert.Equal("Rayo Tractor", squares[30].Name);      // go-to-holding corner
															 // Per-locale names are carried so the client can re-resolve per player.
		Assert.Equal("Black Hole", squares[10].Names!["en"]);
	}

	[Fact]
	public void ToSettings_applies_declared_house_rule_defaults_over_the_base_rules()
	{
		var def = new GameDefinition
		{
			Manifest = new Manifest
			{
				Rules = new RulesConfig { StartingMoney = 1500, PassStartBonus = 200 },
				HouseRules = new List<HouseRuleDef>
				{
					new() { Id = "startingMoney", Type = "number", Default = JsonSerializer.SerializeToElement(2500) },
					new() { Id = "finesToCenterPot", Type = "toggle", Default = JsonSerializer.SerializeToElement(true) },
				},
			},
		};

		var s = GameDefinitionAdapter.ToSettings(def);

		Assert.Equal(2500, s.StartingMoney);  // a declared smallBuilding rule default overrides the base value
		Assert.True(s.FreeParkingJackpot);    // the generic code maps to the engine's field
		Assert.Equal(200, s.GoBonus);         // a rule the board doesn't declare keeps the base value
	}

	[Fact]
	public void ToSettings_maps_the_package_rules_onto_game_settings()
	{
		var def = Galactic();
		var settings = GameDefinitionAdapter.ToSettings(def);

		Assert.Equal(def.Manifest.Rules.StartingMoney, settings.StartingMoney);
		Assert.Equal(def.Manifest.Rules.PassStartBonus, settings.GoBonus);
		Assert.Equal(def.Manifest.Rules.Holding.ReleaseCost, settings.HoldingReleaseCost);
		Assert.Equal(def.Manifest.Rules.Holding.MaxTurns, settings.MaxHoldingTurns);
		Assert.Equal(5, settings.BuildingLevels); // the galactic board: 5 colonies make a metropolis
	}
}
