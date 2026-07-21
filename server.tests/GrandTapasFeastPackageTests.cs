using CorroServer.Models.Corro;
using CorroServer.Services.Corro;
using CorroServer.Services.Corro.Validation;
using CorroServer.Services.Rules;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// Pins the SHIPPED "The Grand Tapas Feast" draft deck (the dangling-key net in KeyIntegrityTests
/// also covers it): the 105-card composition, the validations, the rules configuration —
/// and the E2E dealing contract: the identity shuffle deals the deck's TAIL round-robin,
/// so the two-player opening hands are KNOWN (the file deliberately ends with
/// [spicy-sauce×6, potato-omelette×10, prawn-skewer×4] = exactly the 20 cards two players are dealt).
/// </summary>
public class GrandTapasFeastPackageTests
{
	private static readonly Task<GameDefinition> Loaded =
		new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir("grand-tapas-feast"));

	[Fact]
	public async Task The_deck_has_the_109_card_composition()
	{
		var def = await Loaded;
		var deck = def.DraftDeck!;

		Assert.Equal(109, deck.Sum(c => c.Count));
		Assert.Equal(19, deck.Where(c => c.Type == "points").Sum(c => c.Count));
		Assert.Equal(6, deck.Where(c => c.Type == "multiplier").Sum(c => c.Count));
		Assert.Equal(28, deck.Where(c => c.Type == "set").Sum(c => c.Count));
		Assert.Equal(14, deck.Where(c => c.Type == "scale").Sum(c => c.Count));
		Assert.Equal(26, deck.Where(c => c.Type == "majority").Sum(c => c.Count));
		Assert.Equal(12, deck.Where(c => c.Type == "dessert").Sum(c => c.Count));
		Assert.Equal(4, deck.Where(c => c.Type == "extra").Sum(c => c.Count));

		// The classic proportions: pairs at 5, trios at 10, the 1/3/6/10/15 ladder,
		// trays carrying 1/2/3 servings, the ×3 sauce and the double-pick tongs.
		Assert.Equal(5, deck.Single(c => c.Id == "croquette").SetPoints);
		Assert.Equal(10, deck.Single(c => c.Id == "small-sandwich").SetPoints);
		Assert.Equal(new List<int> { 1, 3, 6, 10, 15 }, deck.Single(c => c.Id == "olives").Scale);
		Assert.Equal(3, deck.Single(c => c.Id == "spicy-sauce").Factor);
		Assert.Equal("extra", deck.Single(c => c.Id == "serving-tongs").Type);
		Assert.Equal(new[] { 1, 2, 3 },
			deck.Where(c => c.Type == "majority").Select(c => c.Icons).OrderBy(i => i));
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
		var rules = def.Manifest.DraftRules!;

		Assert.Equal(3, rules.Rounds);
		Assert.Equal(12, rules.HandSizeBase); // 2:10 … 5:7
		Assert.Equal(6, rules.MajorityFirst);
		Assert.Equal(3, rules.MajoritySecond);
		Assert.Equal(6, rules.DessertBonus);
		Assert.Equal(6, rules.DessertPenalty);

		Assert.Equal(5, def.Manifest.Tokens.Count);
		Assert.All(def.Manifest.Tokens, t => Assert.False(string.IsNullOrEmpty(t.Svg)));
		Assert.Equal(2, def.Manifest.Players.Min);
		Assert.Equal(5, def.Manifest.Players.Max);
		Assert.Empty(def.Manifest.HouseRules); // the family declares no host-customizable rules yet
	}

	[Fact]
	public async Task The_identity_shuffle_two_player_deal_is_the_known_E2E_contract()
	{
		// assembly.spec's lesson, written down for this family too: the E2E environment
		// shuffles as the identity and the deal pops the deck's TAIL round-robin. The file
		// ends with [spicy-sauce×6, potato-omelette×10, prawn-skewer×4], so both openers hold 2 prawn
		// skewers, 5 omelette bites and 3 brava sauces — reordering that tail breaks
		// e2e/tests/draft.spec.ts.
		var def = await Loaded;
		var state = DraftRulebook.CreateInitialState(
			new[] { "ana", "berto" }, def.DraftDeck!, def.Manifest.DraftRules!, new ScriptedRandomSource());

		Assert.Equal(
			new[]
			{
				"prawn-skewer#3", "prawn-skewer#1",
				"potato-omelette#9", "potato-omelette#7", "potato-omelette#5", "potato-omelette#3", "potato-omelette#1",
				"spicy-sauce#5", "spicy-sauce#3", "spicy-sauce#1",
			},
			state.Seats[0].Hand.Select(c => c.InstanceId));
		Assert.Equal(
			new[]
			{
				"prawn-skewer#2", "prawn-skewer#0",
				"potato-omelette#8", "potato-omelette#6", "potato-omelette#4", "potato-omelette#2", "potato-omelette#0",
				"spicy-sauce#4", "spicy-sauce#2", "spicy-sauce#0",
			},
			state.Seats[1].Hand.Select(c => c.InstanceId));
		Assert.Equal(89, state.DrawCount);
	}

	[Fact]
	public async Task Round_two_deals_the_tongs_the_E2E_double_pick_rides_on()
	{
		// The 4 tongs sit right BEFORE the round-one tail, so the round-TWO deal opens
		// with them: both players receive two — the draft.spec double-pick section
		// depends on this (2× serving-tongs + olive-skewers + small-sandwich hands).
		var def = await Loaded;
		var state = DraftRulebook.CreateInitialState(
			new[] { "ana", "berto" }, def.DraftDeck!, def.Manifest.DraftRules!, new ScriptedRandomSource());
		foreach (var seat in state.Seats)
		{
			seat.Hand.Clear();
		}

		DraftRulebook.DealRound(state, def.Manifest.DraftRules!);

		Assert.Equal(
			new[]
			{
				"serving-tongs#3", "serving-tongs#1",
				"olive-skewer#4", "olive-skewer#2", "olive-skewer#0",
				"small-sandwich#12", "small-sandwich#10", "small-sandwich#8", "small-sandwich#6", "small-sandwich#4",
			},
			state.Seats[0].Hand.Select(c => c.InstanceId));
		Assert.Equal(
			new[]
			{
				"serving-tongs#2", "serving-tongs#0",
				"olive-skewer#3", "olive-skewer#1",
				"small-sandwich#13", "small-sandwich#11", "small-sandwich#9", "small-sandwich#7", "small-sandwich#5", "small-sandwich#3",
			},
			state.Seats[1].Hand.Select(c => c.InstanceId));
		Assert.Equal(69, state.DrawCount);
	}
}
