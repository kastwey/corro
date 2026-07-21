using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Corro.Families;
using CorroServer.Services.Rules;

namespace CorroServer.Tests;

/// <summary>
/// The draft family's registry contract: deck validation (types, scoring attributes, the
/// deal arithmetic across every table size), game construction (no turn holder — the
/// family is simultaneous), the hidden-information projection (hands, pending picks and
/// the pile stripped; tables/desserts/scores public) and the restore path.
/// </summary>
public class DraftFamilyTests
{
	private static readonly DraftFamily Family = new();

	private static List<DraftCardDef> GoodDeck(int flanCount = 30) => new()
	{
		new() { Id = "bite", Type = "points", Value = 2, Count = 30, NameKey = "c.bite" },
		new() { Id = "sauce", Type = "multiplier", Factor = 3, Count = 10, NameKey = "c.sauce" },
		new() { Id = "pair", Type = "set", SetSize = 2, SetPoints = 5, Count = 20, NameKey = "c.pair" },
		new() { Id = "olive", Type = "scale", Scale = new() { 1, 3, 6 }, Count = 20, NameKey = "c.olive" },
		new() { Id = "icon", Type = "majority", Icons = 2, Count = 20, NameKey = "c.icon" },
		new() { Id = "caramel-custard", Type = "dessert", Count = flanCount, NameKey = "c.flan" },
	};

	private static GameDefinition Definition(
		List<DraftCardDef>? deck = null,
		DraftRulesConfig? rules = null,
		int min = 2, int max = 4,
		List<HouseRuleDef>? houseRules = null)
		=> new()
		{
			Manifest = new Manifest
			{
				GameType = "draft",
				Players = new PlayersDef { Min = min, Max = max },
				DraftRules = rules,
				HouseRules = houseRules ?? new(),
			},
			DraftDeck = deck ?? GoodDeck(),
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

	[Theory]
	[InlineData("mystery", 0, 0, "unknown type")]
	public void An_unknown_card_type_is_rejected(string type, int value, int factor, string fragment)
	{
		var deck = GoodDeck();
		deck.Add(new DraftCardDef { Id = "odd", Type = type, Value = value, Factor = factor, Count = 1, NameKey = "c.odd" });

		var ex = Assert.Throws<InvalidOperationException>(() => Family.ValidateDefinition(Definition(deck)));
		Assert.Contains(fragment, ex.Message);
	}

	[Fact]
	public void Scoring_attributes_are_checked_per_type()
	{
		void Rejects(DraftCardDef card, string fragment)
		{
			var deck = GoodDeck();
			deck.Add(card);
			var ex = Assert.Throws<InvalidOperationException>(() => Family.ValidateDefinition(Definition(deck)));
			Assert.Contains(fragment, ex.Message);
		}

		Rejects(new() { Id = "x", Type = "points", Value = 0, Count = 1, NameKey = "c.x" }, "positive value");
		Rejects(new() { Id = "x", Type = "multiplier", Factor = 1, Count = 1, NameKey = "c.x" }, "factor of at least 2");
		Rejects(new() { Id = "x", Type = "set", SetSize = 1, SetPoints = 5, Count = 1, NameKey = "c.x" }, "setSize");
		Rejects(new() { Id = "x", Type = "scale", Count = 1, NameKey = "c.x" }, "scale ladder");
		Rejects(new() { Id = "x", Type = "majority", Icons = 0, Count = 1, NameKey = "c.x" }, "icon");
		Rejects(new() { Id = "x", Type = "dessert", Count = 1, NameKey = "" }, "no name");
	}

	[Fact]
	public void The_deal_arithmetic_is_proved_for_every_table_size()
	{
		// 5 players × hands of 7 × 3 rounds = 105 > the 100 cards this dessert-less deck
		// holds (smaller tables all fit — the check must sweep EVERY size in the range).
		var thin = GoodDeck().Where(c => c.Id != "caramel-custard").ToList();
		var ex = Assert.Throws<InvalidOperationException>(() => Family.ValidateDefinition(Definition(thin, max: 5)));
		Assert.Contains("too small", ex.Message);
	}

	[Fact]
	public void A_hand_curve_that_bottoms_out_is_rejected()
	{
		var rules = new DraftRulesConfig { HandSizeBase = 5 }; // 4 players → hands of 1
		var ex = Assert.Throws<InvalidOperationException>(() => Family.ValidateDefinition(Definition(rules: rules)));
		Assert.Contains("handSizeBase", ex.Message);
	}

	[Fact]
	public void House_rules_are_rejected_until_the_family_declares_some()
	{
		var def = Definition(houseRules: new() { new HouseRuleDef { Id = "x" } });
		var ex = Assert.Throws<InvalidOperationException>(() => Family.ValidateDefinition(def));
		Assert.Contains("house rules", ex.Message);
	}

	[Fact]
	public void Duplicate_card_ids_are_rejected()
	{
		var deck = GoodDeck();
		deck.Add(new DraftCardDef { Id = "bite", Type = "points", Value = 1, Count = 1, NameKey = "c.dup" });
		var ex = Assert.Throws<InvalidOperationException>(() => Family.ValidateDefinition(Definition(deck)));
		Assert.Contains("unique id", ex.Message);
	}

	// ── Game construction ─────────────────────────────────────────────────────

	[Fact]
	public void CreateGame_deals_round_one_and_holds_NO_turn()
	{
		var game = Family.CreateGame(Start("a", "b"));

		// Simultaneous family: nobody ever holds the turn.
		Assert.Null(game.State.CurrentTurn);
		Assert.Equal("draft", game.State.GameType);
		Assert.NotNull(game.State.Draft);
		Assert.All(game.State.Draft!.Seats, s => Assert.Equal(10, s.Hand.Count)); // 12 - 2
		Assert.NotNull(game.State.DraftDeck);
		Assert.NotNull(game.State.DraftRules);
		Assert.IsType<DraftRuntime>(game.Runtime);
	}

	[Fact]
	public async Task CreateGame_opens_the_first_round_out_loud()
	{
		var game = Family.CreateGame(Start("a", "b"));

		var announced = new List<(string Key, Dictionary<string, object>? Vars)>();
		await game.PostStartAsync!((key, vars) =>
		{
			announced.Add((key, vars));
			return Task.CompletedTask;
		});

		var line = Assert.Single(announced);
		Assert.Equal("game.draft_round_started", line.Key);
		Assert.Equal(10, line.Vars!["count"]);
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
		var draft = game.State.Draft!;
		DraftRulebook.Commit(draft, "a", draft.Seats[0].Hand[0].InstanceId, null, DraftRulebook.Catalog(GoodDeck()));
		return game.State;
	}

	[Fact]
	public void ProjectFor_keeps_my_hand_and_pick_but_strips_the_rivals_and_the_pile()
	{
		var state = Running();
		var view = Family.ProjectFor(state, "b");
		var draft = view.Draft!;

		var rival = draft.Seats.Single(s => s.PlayerId == "a");
		Assert.Empty(rival.Hand);
		Assert.Null(rival.CommittedInstanceId); // WHAT they picked stays secret…
		Assert.True(rival.HasPicked);           // …but THAT they picked is public
		Assert.Equal(10, rival.HandCount);

		var mine = draft.Seats.Single(s => s.PlayerId == "b");
		Assert.Equal(10, mine.Hand.Count);

		Assert.Empty(draft.DrawPile);
		Assert.True(draft.DrawCount > 0);
	}

	[Fact]
	public void The_public_view_sees_no_hand_at_all()
	{
		var view = Family.ProjectFor(Running(), null);
		Assert.All(view.Draft!.Seats, s => Assert.Empty(s.Hand));
		Assert.All(view.Draft!.Seats, s => Assert.Null(s.CommittedInstanceId));
	}

	[Fact]
	public void Projection_never_mutates_the_authoritative_state()
	{
		var state = Running();
		Family.ProjectFor(state, null);
		Assert.All(state.Draft!.Seats, s => Assert.NotEmpty(s.Hand));
		Assert.NotEmpty(state.Draft!.DrawPile);
	}

	// ── Restore ───────────────────────────────────────────────────────────────

	[Fact]
	public void The_snapshot_carries_the_rules_and_rebuilds_the_runtime()
	{
		var state = Running();
		Assert.True(Family.SnapshotCarriesRules);

		var runtime = Assert.IsType<DraftRuntime>(Family.RuntimeFromState(state));
		Assert.Equal(state.DraftRules, runtime.Rules);
		Assert.Equal(state.DraftDeck!.Count, runtime.Deck.Count);
	}
}
