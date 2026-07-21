using CorroServer.Services.Corro;
using CorroServer.Services.Corro.Validation;
using CorroServer.Services.Rules;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// Pins the SHIPPED "Galactic Workshop" assembly deck (the dangling-key net in
/// KeyIntegrityTests also covers it, like every board under server/Packages): the 68-card
/// composition, the structural + content validations, and the rules configuration.
/// </summary>
public class GalacticWorkshopPackageTests
{
	private static readonly Task<CorroServer.Models.Corro.GameDefinition> Loaded =
		new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir("galactic-workshop"));

	[Fact]
	public async Task The_deck_has_the_68_card_composition()
	{
		var def = await Loaded;
		var deck = def.AssemblyDeck!;

		Assert.Equal(68, deck.Sum(c => c.Count));
		Assert.Equal(21, deck.Where(c => c.Type == "piece").Sum(c => c.Count));
		Assert.Equal(17, deck.Where(c => c.Type == "attack").Sum(c => c.Count));
		Assert.Equal(20, deck.Where(c => c.Type == "remedy").Sum(c => c.Count));
		Assert.Equal(10, deck.Where(c => c.Type == "special").Sum(c => c.Count));

		// One wild joker piece, one wild attack; the wild remedy comes in four copies.
		Assert.Equal(1, deck.Single(c => c.Id == "universal-module").Count);
		Assert.Equal(AssemblyRulebook.Wild, deck.Single(c => c.Id == "universal-module").Color);
		Assert.Equal(1, deck.Single(c => c.Id == "systems-failure").Count);
		Assert.Equal(4, deck.Single(c => c.Id == "nanobots").Count);

		// The five specials, in their classic proportions.
		Assert.Equal(3, deck.Single(c => c.SpecialKind == "swapPiece").Count);
		Assert.Equal(3, deck.Single(c => c.SpecialKind == "stealPiece").Count);
		Assert.Equal(2, deck.Single(c => c.SpecialKind == "plague").Count);
		Assert.Equal(1, deck.Single(c => c.SpecialKind == "scrapHands").Count);
		Assert.Equal(1, deck.Single(c => c.SpecialKind == "fullSwap").Count);
	}

	[Fact]
	public async Task The_package_passes_structural_and_content_validation()
	{
		var def = await Loaded; // the loader already ran the family's structural validation
		Assert.Empty(new PackageValidator().Validate(def)); // incl. every card nameKey resolving
	}

	[Fact]
	public async Task The_rules_ship_as_configured_defaults()
	{
		var def = await Loaded;
		var rules = def.Manifest.AssemblyRules!;

		Assert.Equal(3, rules.HandSize);
		Assert.Equal(4, rules.SlotsToWin);
		Assert.Equal(3, rules.MaxDiscard);

		Assert.Equal(6, def.Manifest.Tokens.Count);
		Assert.All(def.Manifest.Tokens, t => Assert.False(string.IsNullOrEmpty(t.Svg)));
		Assert.Equal(2, def.Manifest.Players.Min);
		Assert.Equal(6, def.Manifest.Players.Max);
		Assert.Empty(def.Manifest.HouseRules); // the family declares no host-customizable rules yet
	}
}
