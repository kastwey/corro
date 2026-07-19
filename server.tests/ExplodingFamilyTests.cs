using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Corro.Families;
using CorroServer.Services.Rules;

namespace CorroServer.Tests;

/// <summary>
/// The exploding family's registry contract: deck validation (known types, and enough of each
/// role — a defuse per hand, players−1 bombs, ordinary cards for the hands), game construction
/// (a defuse in every hand, no bomb in a hand, the danger planted in the pile), the
/// hidden-information projection (hands + the whole draw-pile order) and the restore path.
/// </summary>
public class ExplodingFamilyTests
{
	private static readonly ExplodingFamily Family = new();

	private static List<ExplodingCardDef> GoodDeck() => new()
	{
		new() { Id = "bomb", Type = "bomb", Count = 4, NameKey = "c.bomb" },
		new() { Id = "defuse", Type = "defuse", Count = 6, NameKey = "c.defuse" },
		new() { Id = "skip", Type = "skip", Count = 6, NameKey = "c.skip" },
		new() { Id = "attack", Type = "attack", Count = 4, NameKey = "c.attack" },
		new() { Id = "see", Type = "seeFuture", Count = 4, NameKey = "c.see" },
		new() { Id = "shuffle", Type = "shuffle", Count = 2, NameKey = "c.shuffle" },
		new() { Id = "favor", Type = "favor", Count = 4, NameKey = "c.favor" },
		new() { Id = "nope", Type = "nope", Count = 4, NameKey = "c.nope" },
		new() { Id = "catA", Type = "cat", Count = 6, NameKey = "c.catA" },
		new() { Id = "catB", Type = "cat", Count = 6, NameKey = "c.catB" },
	};

	private static GameDefinition Definition(
		List<ExplodingCardDef>? deck = null,
		ExplodingRulesConfig? rules = null,
		int min = 2, int max = 3)
		=> new()
		{
			Manifest = new Manifest
			{
				GameType = "exploding",
				Players = new PlayersDef { Min = min, Max = max },
				ExplodingRules = rules,
			},
			ExplodingDeck = deck ?? GoodDeck(),
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
	public void Unknown_types_and_missing_names_are_rejected()
	{
		void Rejects(ExplodingCardDef card, string fragment)
		{
			var deck = GoodDeck();
			deck.Add(card);
			var ex = Assert.Throws<InvalidOperationException>(() => Family.ValidateDefinition(Definition(deck)));
			Assert.Contains(fragment, ex.Message);
		}

		Rejects(new() { Id = "x", Type = "mystery", Count = 1, NameKey = "c.x" }, "unknown type");
		Rejects(new() { Id = "x", Type = "skip", Count = 1, NameKey = "" }, "no name");
		Rejects(new() { Id = "x", Type = "skip", Count = 0, NameKey = "c.x" }, "positive count");
	}

	[Fact]
	public void The_deck_needs_enough_bombs_defuses_and_ordinary_cards_for_the_table()
	{
		// Only one bomb: cannot seat 3 players (needs 2).
		var fewBombs = GoodDeck();
		fewBombs[0] = fewBombs[0] with { Count = 1 };
		Assert.Contains("bombs",
			Assert.Throws<InvalidOperationException>(() => Family.ValidateDefinition(Definition(fewBombs))).Message);

		// Two defuses: cannot give 3 players one each.
		var fewDefuses = GoodDeck();
		fewDefuses[1] = fewDefuses[1] with { Count = 2 };
		Assert.Contains("defuses",
			Assert.Throws<InvalidOperationException>(() => Family.ValidateDefinition(Definition(fewDefuses))).Message);

		// Too few ordinary cards for 3 hands of 7 (needs 21).
		var thin = GoodDeck();
		for (var i = 2; i < thin.Count; i++)
		{
			thin[i] = thin[i] with { Count = 1 };
		}

		Assert.Contains("non-bomb, non-defuse",
			Assert.Throws<InvalidOperationException>(() => Family.ValidateDefinition(Definition(thin))).Message);
	}

	[Fact]
	public void Host_house_rules_are_rejected_until_the_family_supports_them()
	{
		var withRule = Definition();
		withRule.Manifest.HouseRules.Add(new HouseRuleDef { Id = "somethingExploding", Type = "toggle" });
		Assert.Contains("no host house rules",
			Assert.Throws<InvalidOperationException>(() => Family.ValidateDefinition(withRule)).Message);
	}

	// ── Game construction ─────────────────────────────────────────────────────

	[Fact]
	public async Task CreateGame_deals_a_defuse_to_every_hand_and_plants_the_bombs()
	{
		var game = Family.CreateGame(Start("a", "b"));
		var catalog = ExplodingRulebook.Catalog(game.State.ExplodingDeck!);

		Assert.Equal("exploding", game.State.GameType);
		Assert.Equal("a", game.State.CurrentTurn);
		var exploding = game.State.Exploding!;
		Assert.All(exploding.Seats, s => Assert.Equal(8, s.Hand.Count)); // 1 defuse + HandSize (7)
		Assert.All(exploding.Seats, s =>
			Assert.Single(s.Hand, i => catalog[i.CardId].Type == "defuse"));
		Assert.All(exploding.Seats, s =>
			Assert.DoesNotContain(s.Hand, i => catalog[i.CardId].Type == "bomb"));
		Assert.Equal(1, exploding.DrawPile.Count(i => catalog[i.CardId].Type == "bomb")); // 2 players → 1 bomb

		var announced = new List<(string Key, Dictionary<string, object>? Vars)>();
		await game.PostStartAsync!((key, vars) => { announced.Add((key, vars)); return Task.CompletedTask; });
		var line = Assert.Single(announced);
		Assert.Equal("game.exploding_game_started", line.Key);
		Assert.Equal(1, line.Vars!["bombs"]);
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
		var exploding = game.State.Exploding!;
		exploding.DiscardPile.Add(new ExplodingCardInstance { InstanceId = "spent#0", CardId = "skip" });
		exploding.PendingAction = new PendingExplodingAction { ActorId = "a", CardId = "skip" };
		ExplodingRulebook.SyncCounts(exploding);
		return game.State;
	}

	[Fact]
	public void ProjectFor_keeps_my_hand_and_strips_every_rival_hand_and_the_whole_pile()
	{
		var state = Running();

		var mine = Family.ProjectFor(state, "a").Exploding!;
		Assert.NotEmpty(mine.Seats[0].Hand);
		Assert.Empty(mine.DrawPile);          // the order is the game's central secret
		Assert.True(mine.DrawCount > 0);
		Assert.Single(mine.DiscardPile);      // the discards are face-up and public
		Assert.NotNull(mine.PendingAction);   // the pending action is on the table

		var rivals = Family.ProjectFor(state, "b").Exploding!;
		Assert.Empty(rivals.Seats[0].Hand);   // a's hand is hidden from b
		Assert.Equal(8, rivals.Seats[0].HandCount);
		Assert.Empty(rivals.DrawPile);

		var @public = Family.ProjectFor(state, null).Exploding!;
		Assert.All(@public.Seats, s => Assert.Empty(s.Hand));
	}

	[Fact]
	public void Projection_never_mutates_the_authoritative_state()
	{
		var state = Running();
		Family.ProjectFor(state, null);
		Assert.All(state.Exploding!.Seats, s => Assert.NotEmpty(s.Hand));
		Assert.NotEmpty(state.Exploding!.DrawPile);
		Assert.NotNull(state.Exploding!.PendingAction);
	}

	// ── Restore ───────────────────────────────────────────────────────────────

	[Fact]
	public void The_snapshot_carries_the_rules_and_rebuilds_the_runtime()
	{
		var state = Running();
		Assert.True(Family.SnapshotCarriesRules);

		var runtime = Assert.IsType<ExplodingRuntime>(Family.RuntimeFromState(state));
		Assert.Equal(state.ExplodingRules, runtime.Rules);
		Assert.Equal(state.ExplodingDeck!.Count, runtime.Deck.Count);
	}
}
