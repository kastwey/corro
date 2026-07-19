using CorroServer.Services.Corro;
using CorroServer.Services.Corro.Validation;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// Pins the SHIPPED "La Gran Ruta" journey deck (the dangling-key net in KeyIntegrityTests
/// also covers it, like every board under server/Packages): the classic 106-card
/// composition, the structural + content validations, and the official rules configuration.
/// </summary>
public class LaGranRutaPackageTests
{
	private static readonly Task<CorroServer.Models.Corro.GameDefinition> Loaded =
		new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir("la-gran-ruta"));

	[Fact]
	public async Task The_deck_has_the_classic_106_card_composition()
	{
		var def = await Loaded;
		var deck = def.JourneyDeck!;

		Assert.Equal(106, deck.Sum(c => c.Count));
		Assert.Equal(46, deck.Where(c => c.Type == "distance").Sum(c => c.Count));
		Assert.Equal(18, deck.Where(c => c.Type == "attack").Sum(c => c.Count));
		Assert.Equal(38, deck.Where(c => c.Type == "remedy").Sum(c => c.Count));
		Assert.Equal(4, deck.Where(c => c.Type == "immunity").Sum(c => c.Count));

		// The premium 200s: twice per hand, and they void the safe-trip bonus.
		var d200 = deck.Single(c => c.Id == "d200");
		Assert.True(d200.Premium);
		Assert.Equal(2, d200.MaxPlaysPerHand);

		// Right of way is the multi-shield immunity (red light + speed limit).
		var prioridad = deck.Single(c => c.Id == "prioridad");
		Assert.Equal(new[] { "stop", "speedLimit" }, prioridad.ShieldsKinds);
	}

	[Fact]
	public async Task The_package_passes_structural_and_content_validation()
	{
		var def = await Loaded; // the loader already ran the family's structural validation
		Assert.Empty(new PackageValidator().Validate(def)); // incl. every card nameKey resolving
	}

	[Fact]
	public async Task The_official_rules_ship_as_configured_defaults()
	{
		var def = await Loaded;
		var rules = def.Manifest.JourneyRules!;

		Assert.Equal(1000, rules.GoalKm);
		Assert.Equal(5000, rules.TargetScore);
		Assert.Equal(6, rules.HandSize);
		Assert.Equal(50, rules.LimitCap);
		Assert.Equal("stop", rules.InitialHazard);
		Assert.False(rules.StackHazards);

		Assert.Equal(6, def.Manifest.Tokens.Count);
		Assert.All(def.Manifest.Tokens, t => Assert.False(string.IsNullOrEmpty(t.Svg)));
		Assert.Equal(2, def.Manifest.Players.Min);
		Assert.Equal(6, def.Manifest.Players.Max);
	}

	[Fact]
	public async Task The_lobby_house_rules_expose_the_four_journey_codes_with_official_defaults()
	{
		var def = await Loaded;
		var rules = def.Manifest.HouseRules;

		Assert.Equal(
			new[] { "journeyTargetScore", "journeyGoalKm", "journeyStackHazards", "journeyAllImmunitiesBonus" },
			rules.Select(r => r.Id));
		Assert.All(rules, r => Assert.True(HouseRuleCatalog.IsKnownJourney(r.Id)));
		Assert.All(rules, r => Assert.True(r.EditableByHost));

		// Declared defaults MATCH the manifest's journeyRules (what the lobby shows untouched
		// is what the game plays).
		Assert.Equal(5000, rules.Single(r => r.Id == "journeyTargetScore").Default!.Value.GetInt32());
		Assert.Equal(1000, rules.Single(r => r.Id == "journeyGoalKm").Default!.Value.GetInt32());
		Assert.False(rules.Single(r => r.Id == "journeyStackHazards").Default!.Value.GetBoolean());
		Assert.Equal(300, rules.Single(r => r.Id == "journeyAllImmunitiesBonus").Default!.Value.GetInt32());
		// 0 must stay a LEGAL choice for the target score: it means "a single hand".
		Assert.Equal(0, rules.Single(r => r.Id == "journeyTargetScore").Min);
	}

	[Theory]
	[InlineData("es", "## Ayuda durante la partida", "## Cómo jugar con lector de pantalla", "**Flecha arriba**")]
	[InlineData("en", "## Help during play", "## Playing with a screen reader", "**Up Arrow**")]
	public void The_guide_explains_every_help_route_and_screen_reader_play(
		string language,
		string helpHeading,
		string screenReaderHeading,
		string handNavigation)
	{
		var path = Path.Combine(CorroTestPaths.PackageDir("la-gran-ruta"), $"help.{language}.md");
		var guide = File.ReadAllText(path);

		Assert.Contains(helpHeading, guide);
		Assert.Contains(screenReaderHeading, guide);
		Assert.Contains(handNavigation, guide);
		Assert.DoesNotContain("freesound.org", guide, StringComparison.OrdinalIgnoreCase);
		Assert.DoesNotContain("CC BY", guide, StringComparison.OrdinalIgnoreCase);

		// These are the four distinct help layers the guide must make discoverable:
		// package guide, current shortcut table, active rules and focused-card help.
		foreach (var shortcut in new[] { "**F1**", "**Ctrl+F1**", "**Ctrl+Shift+F1**", "**Shift+F1**" })
		{
			Assert.Contains(shortcut, guide);
		}

		// The screen-reader primer must also cover cross-panel movement and direct chat access.
		foreach (var shortcut in new[] { "**F6**", "**Shift+F6**", "**Ctrl+Shift+R**", "**Escape**" })
		{
			Assert.Contains(shortcut, guide);
		}
	}

	[Fact]
	public void Sound_attribution_lives_in_the_package_credits_not_the_player_guide()
	{
		var credits = File.ReadAllText(Path.Combine(CorroTestPaths.PackageDir("la-gran-ruta"), "CREDITS.md"));

		Assert.Contains("sounds/low-blow.ogg", credits);
		Assert.Contains("ChrisButler99", credits);
	}
}
