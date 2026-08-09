using CorroServer.Services.Corro;
using CorroServer.Services.Corro.Validation;
using CorroServer.Services.Rules;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// Pins the SHIPPED "Galactic Workshop" assembly deck (the dangling-key net in
/// KeyIntegrityTests also covers it, like every board under server/Packages): the 93-card
/// composition — the classic 68 plus the 25-card expansion — the structural + content
/// validations, and the rules configuration.
/// </summary>
public class GalacticWorkshopPackageTests
{
	private static readonly Task<CorroServer.Models.Corro.GameDefinition> Loaded =
		new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir("galactic-workshop"));

	[Fact]
	public async Task The_deck_has_the_93_card_composition()
	{
		var def = await Loaded;
		var deck = def.AssemblyDeck!;

		// 68 classic cards + 25 expansion ones: the armoured module, 9 resistant breakdowns,
		// 7 experimental fixes and 8 treatments.
		Assert.Equal(93, deck.Sum(c => c.Count));
		Assert.Equal(22, deck.Where(c => c.Type == "piece").Sum(c => c.Count));
		Assert.Equal(26, deck.Where(c => c.Type == "attack").Sum(c => c.Count));
		Assert.Equal(27, deck.Where(c => c.Type == "remedy").Sum(c => c.Count));
		// The classic tail the E2E deal reads from must stay last, in this order.
		Assert.Equal(new[] { "coolant", "overload", "reactor" }, deck.TakeLast(3).Select(c => c.Id));
		Assert.Equal(18, deck.Where(c => c.Type == "special").Sum(c => c.Count));

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
	public async Task The_expansion_ships_resistant_breakdowns_experimental_fixes_and_one_armoured_module()
	{
		var def = await Loaded;
		var deck = def.AssemblyDeck!;

		// Nine resistant breakdowns: two per system plus one that ruins anything.
		Assert.Equal(9, deck.Where(c => c.Resistant).Sum(c => c.Count));
		Assert.All(deck.Where(c => c.Resistant), c => Assert.Equal("attack", c.Type));
		Assert.Equal(1, deck.Single(c => c.Resistant && c.Color == AssemblyRulebook.Wild).Count);

		// Seven experimental fixes: one per system plus three universal ones. Without them
		// the resistant breakdowns would have no answer at all.
		Assert.Equal(7, deck.Where(c => c.Potent).Sum(c => c.Count));
		Assert.All(deck.Where(c => c.Potent), c => Assert.Equal("remedy", c.Type));
		Assert.Equal(3, deck.Single(c => c.Potent && c.Color == AssemblyRulebook.Wild).Count);

		// One armoured module, in a system colour of its own that nothing else answers.
		var armoured = deck.Single(c => c.Inert);
		Assert.Equal("piece", armoured.Type);
		Assert.Equal(1, armoured.Count);
		Assert.DoesNotContain(deck, c => c.Type is "attack" or "remedy" && c.Color == armoured.Color);

		// The expansion's treatments.
		Assert.Equal(4, deck.Single(c => c.SpecialKind == "exile").Count);
		Assert.Equal(2, deck.Single(c => c.SpecialKind == "doubleAct").Count);
		Assert.Equal(2, deck.Single(c => c.SpecialKind == "handSwap").Count);
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
		// Both expansion house rules are offered to the host, and both start OFF so a table
		// that just presses start plays the printed game.
		Assert.Equal(
			new[] { "assemblyAttritionCures", "assemblyDuelGoal" },
			def.Manifest.HouseRules.Select(r => r.Id).OrderBy(id => id, StringComparer.Ordinal));
		Assert.All(def.Manifest.HouseRules, r => Assert.True(r.EditableByHost));
		Assert.All(def.Manifest.HouseRules, r => Assert.False(r.Default!.Value.GetBoolean()));
		Assert.False(rules.DuelGoal);
		Assert.False(rules.AttritionCures);
	}
}
