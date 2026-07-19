using CorroServer.Models.Corro;
using CorroServer.Services.Corro;
using CorroServer.Services.Corro.Validation;
using CorroServer.Services.Rules;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// Pins the SHIPPED "Gran Tapeo" draft deck (the dangling-key net in KeyIntegrityTests
/// also covers it): the 105-card composition, the validations, the rules configuration —
/// and the E2E dealing contract: the identity shuffle deals the deck's TAIL round-robin,
/// so the two-player opening hands are KNOWN (the file deliberately ends with
/// [salsa-brava×6, tortilla×10, gamba×4] = exactly the 20 cards two players are dealt).
/// </summary>
public class GranTapeoPackageTests
{
	private static readonly Task<GameDefinition> Loaded =
		new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir("gran-tapeo"));

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
		Assert.Equal(5, deck.Single(c => c.Id == "croqueta").SetPoints);
		Assert.Equal(10, deck.Single(c => c.Id == "montadito").SetPoints);
		Assert.Equal(new List<int> { 1, 3, 6, 10, 15 }, deck.Single(c => c.Id == "aceitunas").Scale);
		Assert.Equal(3, deck.Single(c => c.Id == "salsa-brava").Factor);
		Assert.Equal("extra", deck.Single(c => c.Id == "pinzas").Type);
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
		// ends with [salsa-brava×6, tortilla×10, gamba×4], so both openers hold 2 prawn
		// skewers, 5 omelette bites and 3 brava sauces — reordering that tail breaks
		// e2e/tests/draft.spec.ts.
		var def = await Loaded;
		var state = DraftRulebook.CreateInitialState(
			new[] { "ana", "berto" }, def.DraftDeck!, def.Manifest.DraftRules!, new ScriptedRandomSource());

		Assert.Equal(
			new[]
			{
				"gamba#3", "gamba#1",
				"tortilla#9", "tortilla#7", "tortilla#5", "tortilla#3", "tortilla#1",
				"salsa-brava#5", "salsa-brava#3", "salsa-brava#1",
			},
			state.Seats[0].Hand.Select(c => c.InstanceId));
		Assert.Equal(
			new[]
			{
				"gamba#2", "gamba#0",
				"tortilla#8", "tortilla#6", "tortilla#4", "tortilla#2", "tortilla#0",
				"salsa-brava#4", "salsa-brava#2", "salsa-brava#0",
			},
			state.Seats[1].Hand.Select(c => c.InstanceId));
		Assert.Equal(89, state.DrawCount);
	}

	[Fact]
	public async Task Round_two_deals_the_tongs_the_E2E_double_pick_rides_on()
	{
		// The 4 tongs sit right BEFORE the round-one tail, so the round-TWO deal opens
		// with them: both players receive two — the draft.spec double-pick section
		// depends on this (2× pinzas + banderillas + montaditos hands).
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
				"pinzas#3", "pinzas#1",
				"banderilla#4", "banderilla#2", "banderilla#0",
				"montadito#12", "montadito#10", "montadito#8", "montadito#6", "montadito#4",
			},
			state.Seats[0].Hand.Select(c => c.InstanceId));
		Assert.Equal(
			new[]
			{
				"pinzas#2", "pinzas#0",
				"banderilla#3", "banderilla#1",
				"montadito#13", "montadito#11", "montadito#9", "montadito#7", "montadito#5", "montadito#3",
			},
			state.Seats[1].Hand.Select(c => c.InstanceId));
		Assert.Equal(69, state.DrawCount);
	}
}
