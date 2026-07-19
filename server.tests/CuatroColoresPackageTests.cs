using CorroServer.Models.Corro;
using CorroServer.Services.Corro;
using CorroServer.Services.Corro.Validation;
using CorroServer.Services.Rules;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// Pins the SHIPPED "Cuatro Colores" shedding deck (the dangling-key net in
/// KeyIntegrityTests also covers it): the classic 108-card composition, the validations,
/// the rules configuration — and the E2E dealing contract: the identity shuffle deals
/// the deck's TAIL, so the two-player opening hands, the flip and the first draws are
/// KNOWN. Reordering that tail breaks e2e/tests/shedding.spec.ts.
/// </summary>
public class CuatroColoresPackageTests
{
	private static readonly Task<GameDefinition> Loaded =
		new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir("cuatro-colores"));

	[Fact]
	public async Task The_deck_has_the_classic_108_card_composition()
	{
		var def = await Loaded;
		var deck = def.SheddingDeck!;

		Assert.Equal(108, deck.Sum(c => c.Count));
		Assert.Equal(76, deck.Where(c => c.Type == "number").Sum(c => c.Count)); // 4×(1 zero + 2×1..9)
		Assert.Equal(8, deck.Where(c => c.Type == "skip").Sum(c => c.Count));
		Assert.Equal(8, deck.Where(c => c.Type == "reverse").Sum(c => c.Count));
		Assert.Equal(8, deck.Where(c => c.Type == "drawTwo").Sum(c => c.Count));
		Assert.Equal(4, deck.Where(c => c.Type == "wild").Sum(c => c.Count));
		Assert.Equal(4, deck.Where(c => c.Type == "wildDrawFour").Sum(c => c.Count));

		Assert.Equal(4, deck.Where(c => c.Color != null).Select(c => c.Color).Distinct().Count());
		Assert.All(deck.Where(c => c.Type is "wild" or "wildDrawFour"), c => Assert.Null(c.Color));
	}

	[Fact]
	public async Task The_package_passes_structural_and_content_validation()
	{
		var def = await Loaded; // the loader already ran the family's structural validation
		Assert.Empty(new PackageValidator().Validate(def)); // incl. every nameKey and colors.<id>
	}

	[Fact]
	public async Task The_rules_ship_as_configured_defaults()
	{
		var def = await Loaded;
		var rules = def.Manifest.SheddingRules!;

		Assert.Equal(7, rules.HandSize);
		Assert.Equal(500, rules.TargetScore);
		Assert.True(rules.DrawnCardPlayable);
		Assert.True(rules.WildDrawRequiresNoMatch);

		Assert.Equal(5, def.Manifest.Tokens.Count);
		Assert.All(def.Manifest.Tokens, t => Assert.False(string.IsNullOrEmpty(t.Svg)));
		Assert.Equal(2, def.Manifest.Players.Min);
		Assert.Equal(5, def.Manifest.Players.Max);

		// The package exposes the two shedding house rules: the doubles toggle and the
		// stacking choice (three options), each a known engine code.
		var doubles = Assert.Single(def.Manifest.HouseRules, r => r.Id == "sheddingAllowDoubles");
		Assert.Equal("toggle", doubles.Type);
		var stacking = Assert.Single(def.Manifest.HouseRules, r => r.Id == "sheddingStacking");
		Assert.Equal("choice", stacking.Type);
		Assert.Equal(new[] { "none", "sameType", "cross" }, stacking.Options!.Select(o => o.Id));
	}

	[Fact]
	public async Task The_identity_shuffle_two_player_deal_is_the_known_E2E_contract()
	{
		var def = await Loaded;
		var state = SheddingRulebook.CreateInitialState(
			new[] { "ana", "berto" }, def.SheddingDeck!, def.Manifest.SheddingRules!,
			new ScriptedRandomSource());

		// Mirrored hands (each tail pair splits one copy per player), Amarillo 0 flips.
		Assert.Equal(
			new[]
			{
				"rojo-5#1", "rojo-salta#1", "azul-5#1", "verde-7#1",
				"azul-roba2#1", "verde-2#1", "amarillo-7#1",
			},
			state.Seats[0].Hand.Select(c => c.InstanceId));
		Assert.Equal(
			new[]
			{
				"rojo-5#0", "rojo-salta#0", "azul-5#0", "verde-7#0",
				"azul-roba2#0", "verde-2#0", "amarillo-7#0",
			},
			state.Seats[1].Hand.Select(c => c.InstanceId));
		Assert.Equal("amarillo-0#0", state.DiscardPile[^1].InstanceId);
		Assert.Equal("amarillo", state.CurrentColor);
		Assert.Equal(93, state.DrawCount);
		// The first draws are the azul-2 pair, then the rojo-1 pair.
		Assert.Equal("azul-2#1", state.DrawPile[^1].InstanceId);
		Assert.Equal("azul-2#0", state.DrawPile[^2].InstanceId);
		Assert.Equal("rojo-1#1", state.DrawPile[^3].InstanceId);
	}
}
