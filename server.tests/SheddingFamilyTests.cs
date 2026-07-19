using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Corro.Families;
using CorroServer.Services.Rules;

namespace CorroServer.Tests;

/// <summary>
/// The shedding family's registry contract: deck validation (coloured cards named and
/// coloured, wilds colourless, two colours minimum, a number opener, the deal
/// arithmetic), game construction, the hidden-information projection (hands, the pile,
/// the buried discards and the drawer's pause) and the restore path.
/// </summary>
public class SheddingFamilyTests
{
	private static readonly SheddingFamily Family = new();

	private static List<SheddingCardDef> GoodDeck() => new()
	{
		new() { Id = "red-1", Type = "number", Color = "red", Value = 1, Count = 8, NameKey = "c.red1" },
		new() { Id = "blue-1", Type = "number", Color = "blue", Value = 1, Count = 8, NameKey = "c.blue1" },
		new() { Id = "skip-red", Type = "skip", Color = "red", Count = 4, NameKey = "c.skipred" },
		new() { Id = "wild", Type = "wild", Count = 4, NameKey = "c.wild" },
	};

	private static GameDefinition Definition(
		List<SheddingCardDef>? deck = null,
		SheddingRulesConfig? rules = null,
		int min = 2, int max = 3)
		=> new()
		{
			Manifest = new Manifest
			{
				GameType = "shedding",
				Players = new PlayersDef { Min = min, Max = max },
				SheddingRules = rules,
			},
			SheddingDeck = deck ?? GoodDeck(),
		};

	private static FamilyStartContext Start(params string[] players)
		=> new()
		{
			Players = players.Select(id => TestFixtures.NewPlayer(id)).ToList(),
			Definition = Definition(),
			Random = new ScriptedRandomSource(),
		};

	// ── Validation ────────────────────────────────────────────────────────────

	[Fact]
	public void A_well_formed_deck_validates()
		=> Family.ValidateDefinition(Definition()); // no throw

	[Fact]
	public void Colour_discipline_is_enforced()
	{
		void Rejects(SheddingCardDef card, string fragment)
		{
			var deck = GoodDeck();
			deck.Add(card);
			var ex = Assert.Throws<InvalidOperationException>(() => Family.ValidateDefinition(Definition(deck)));
			Assert.Contains(fragment, ex.Message);
		}

		Rejects(new() { Id = "x", Type = "wild", Color = "red", Count = 1, NameKey = "c.x" }, "no colour");
		Rejects(new() { Id = "x", Type = "skip", Count = 1, NameKey = "c.x" }, "needs a colour");
		Rejects(new() { Id = "x", Type = "number", Color = "red", Value = -1, Count = 1, NameKey = "c.x" }, "non-negative value");
		Rejects(new() { Id = "x", Type = "mystery", Color = "red", Count = 1, NameKey = "c.x" }, "unknown type");
		Rejects(new() { Id = "x", Type = "skip", Color = "red", Points = -1, Count = 1, NameKey = "c.x" }, "non-negative points");
	}

	[Fact]
	public void The_deck_needs_two_colours_a_number_opener_and_enough_cards()
	{
		var oneColor = GoodDeck().Where(c => c.Color != "blue").ToList();
		Assert.Contains("two colours",
			Assert.Throws<InvalidOperationException>(() => Family.ValidateDefinition(Definition(oneColor))).Message);

		var noNumbers = GoodDeck().Where(c => c.Type != "number").ToList();
		noNumbers.Add(new SheddingCardDef { Id = "blue-x", Type = "skip", Color = "blue", Count = 8, NameKey = "c.bx" });
		Assert.Contains("number card",
			Assert.Throws<InvalidOperationException>(() => Family.ValidateDefinition(Definition(noNumbers))).Message);

		// 3 players × 7 + the opener = 22 > the 20 cards this thin deck holds.
		var thin = GoodDeck();
		thin[0] = thin[0] with { Count = 4 };
		Assert.Contains("too small",
			Assert.Throws<InvalidOperationException>(() => Family.ValidateDefinition(Definition(thin))).Message);
	}

	// ── House rules (lobby choices → effective SheddingRulesConfig) ────────────

	[Fact]
	public void CreateGame_applies_the_hosts_house_rule_values_and_persists_them_on_the_state()
	{
		var game = Family.CreateGame(new FamilyStartContext
		{
			Players = new List<Player> { TestFixtures.NewPlayer("a"), TestFixtures.NewPlayer("b") },
			Definition = Definition(),
			Random = new ScriptedRandomSource(),
			RuleValues = new Dictionary<string, System.Text.Json.JsonElement>
			{
				["sheddingAllowDoubles"] = System.Text.Json.JsonSerializer.SerializeToElement(true),
				["sheddingStacking"] = System.Text.Json.JsonSerializer.SerializeToElement("cross"),
				["startingMoney"] = System.Text.Json.JsonSerializer.SerializeToElement(9999), // property code: ignored
			},
		});

		var effective = game.State.SheddingRules!;
		Assert.True(effective.AllowDoubles);
		Assert.Equal("cross", effective.Stacking);
		Assert.Equal(7, effective.HandSize); // untouched fields keep the package defaults
		Assert.Equal(effective, ((SheddingRuntime)game.Runtime!).Rules);
	}

	[Fact]
	public void House_rules_must_be_known_shedding_codes_and_stacking_must_be_valid()
	{
		var unknown = Definition();
		unknown.Manifest.HouseRules.Add(new HouseRuleDef { Id = "startingMoney", Type = "number" });
		Assert.Contains("startingMoney",
			Assert.Throws<InvalidOperationException>(() => Family.ValidateDefinition(unknown)).Message);

		var badStacking = Definition(rules: new SheddingRulesConfig { Stacking = "wobble" });
		Assert.Contains("stacking",
			Assert.Throws<InvalidOperationException>(() => Family.ValidateDefinition(badStacking)).Message);

		// A known code with a coherent default validates.
		var ok = Definition();
		ok.Manifest.HouseRules.Add(new HouseRuleDef { Id = "sheddingAllowDoubles", Type = "toggle" });
		Family.ValidateDefinition(ok); // no throw
	}

	// ── Game construction ─────────────────────────────────────────────────────

	[Fact]
	public async Task CreateGame_deals_flips_a_number_and_the_first_player_leads()
	{
		var game = Family.CreateGame(Start("a", "b"));

		Assert.Equal("shedding", game.State.GameType);
		Assert.Equal("a", game.State.CurrentTurn);
		var shedding = game.State.Shedding!;
		Assert.All(shedding.Seats, s => Assert.Equal(7, s.Hand.Count));
		Assert.Single(shedding.DiscardPile);
		Assert.NotEqual(string.Empty, shedding.CurrentColor);

		var announced = new List<(string Key, Dictionary<string, object>? Vars)>();
		await game.PostStartAsync!((key, vars) => { announced.Add((key, vars)); return Task.CompletedTask; });
		var line = Assert.Single(announced);
		Assert.Equal("game.shedding_round_started", line.Key);
		Assert.Equal(7, line.Vars!["count"]);
	}

	[Fact]
	public async Task Rolling_dice_is_refused_not_defaulted()
	{
		var player = TestFixtures.NewPlayer("a");
		var context = TestFixtures.NewContext(TestFixtures.NewState(new[] { player }));
		var response = Family.ProcessRoll(() => 1, player, context);

		Assert.NotNull(response);
		Assert.Equal("NO_DICE_IN_FAMILY", Assert.IsType<ErrorResponse>(await response!).Code);
	}

	// ── Hidden information ────────────────────────────────────────────────────

	private static GameState Running()
	{
		var game = Family.CreateGame(Start("a", "b"));
		var shedding = game.State.Shedding!;
		shedding.DiscardPile.Insert(0, new SheddingCardInstance { InstanceId = "buried#0", CardId = "red-1" });
		shedding.PendingDrawnPlay = new PendingDrawnPlay
		{
			PlayerId = "a",
			InstanceId = shedding.Seats[0].Hand[0].InstanceId,
		};
		SheddingRulebook.SyncCounts(shedding);
		return game.State;
	}

	[Fact]
	public void ProjectFor_keeps_my_hand_and_my_pause_and_strips_everything_buried()
	{
		var state = Running();
		var mine = Family.ProjectFor(state, "a").Shedding!;
		Assert.NotEmpty(mine.Seats[0].Hand);
		Assert.NotNull(mine.PendingDrawnPlay);
		Assert.Single(mine.DiscardPile); // the top card only — the buried order is secret
		Assert.Equal(2, mine.DiscardCount);
		Assert.Empty(mine.DrawPile);
		Assert.True(mine.DrawCount > 0);

		var rivals = Family.ProjectFor(state, "b").Shedding!;
		Assert.Empty(rivals.Seats[0].Hand);
		Assert.Equal(7, rivals.Seats[0].HandCount);
		Assert.Null(rivals.PendingDrawnPlay); // the drawn card is the drawer's alone

		var @public = Family.ProjectFor(state, null).Shedding!;
		Assert.All(@public.Seats, s => Assert.Empty(s.Hand));
	}

	[Fact]
	public void Projection_never_mutates_the_authoritative_state()
	{
		var state = Running();
		Family.ProjectFor(state, null);
		Assert.All(state.Shedding!.Seats, s => Assert.NotEmpty(s.Hand));
		Assert.NotEmpty(state.Shedding!.DrawPile);
		Assert.Equal(2, state.Shedding!.DiscardPile.Count);
		Assert.NotNull(state.Shedding!.PendingDrawnPlay);
	}

	// ── Restore ───────────────────────────────────────────────────────────────

	[Fact]
	public void The_snapshot_carries_the_rules_and_rebuilds_the_runtime()
	{
		var state = Running();
		Assert.True(Family.SnapshotCarriesRules);

		var runtime = Assert.IsType<SheddingRuntime>(Family.RuntimeFromState(state));
		Assert.Equal(state.SheddingRules, runtime.Rules);
		Assert.Equal(state.SheddingDeck!.Count, runtime.Deck.Count);
	}
}
