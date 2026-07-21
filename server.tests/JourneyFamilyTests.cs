using System.Text.Json;
using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Corro.Families;
using CorroServer.Services.Rules;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// The journey family is the engine's first hidden-information family: these pin the
/// projection contract (your hand stays, every other hand and the draw pile collapse to
/// counts, the pending coup's card is the victim's secret) and the deck validation that
/// keeps a package coherent (every remedy/immunity answers a hazard that exists, the initial
/// hazard is curable, the deck covers the players).
/// </summary>
public class JourneyFamilyTests
{
	private static List<JourneyCardDef> Deck() => new()
	{
		new() { Id = "distance-25", Type = "distance", Value = 25, Count = 10, NameKey = "cards.distance_25" },
		new() { Id = "stop", Type = "attack", Kind = "stop", HazardClass = "stopper", Count = 3, NameKey = "cards.stop" },
		new() { Id = "go", Type = "remedy", Kind = "stop", Count = 6, NameKey = "cards.go" },
		new() { Id = "priority", Type = "immunity", ShieldsKinds = new() { "stop" }, NameKey = "cards.priority" },
	};

	private static GameDefinition Definition(List<JourneyCardDef>? deck = null, JourneyRulesConfig? rules = null)
		=> new()
		{
			Manifest = new Manifest
			{
				Id = "test-journey",
				GameType = "journey",
				JourneyRules = rules ?? new JourneyRulesConfig(),
				Players = new PlayersDef { Min = 2, Max = 2 },
			},
			JourneyDeck = deck ?? Deck(),
		};

	private static GameState StartedGame()
	{
		var family = new JourneyFamily();
		var game = family.CreateGame(new FamilyStartContext
		{
			Players = new List<Player>
			{
				TestFixtures.NewPlayer("A"), TestFixtures.NewPlayer("B"),
			},
			Definition = Definition(),
		});
		return game.State;
	}

	// ── Game start ────────────────────────────────────────────────────────────

	[Fact]
	public void CreateGame_deals_a_journey_and_publishes_the_deck_catalog()
	{
		var state = StartedGame();

		Assert.Equal("journey", state.GameType);
		Assert.NotNull(state.Journey);
		Assert.Equal(2, state.Journey!.Seats.Count);
		Assert.All(state.Journey.Seats, s => Assert.Equal(6, s.Members[0].Hand.Count));
		Assert.All(state.Journey.Seats, s => Assert.Equal(new[] { "stop" }, s.Hazards));
		Assert.Equal("A", state.CurrentTurn);
		Assert.NotNull(state.JourneyDeck); // the catalog is public wire data
										   // Every player wears an engine-palette colour: the progress-strip car, the panel
										   // identity and the spoken colour word all share it (same contract as track).
		Assert.All(state.Players, p => Assert.False(string.IsNullOrEmpty(p.Color)));
		Assert.NotEqual(state.Players[0].Color, state.Players[1].Color);
	}

	// ── Teams: interleaved turns, shared seat + colour, private partner hands ──

	/// <summary>The 20-card fixture deck covers two hands; four players need more copies.</summary>
	private static List<JourneyCardDef> BigDeck()
		=> Deck().Select(c => c.Id == "distance-25" ? c with { Count = 30 } : c).ToList();

	[Fact]
	public void CreateGame_with_teams_interleaves_the_turn_order_and_dresses_partners_alike()
	{
		var family = new JourneyFamily();
		var game = family.CreateGame(new FamilyStartContext
		{
			Players = new List<Player>
			{
				TestFixtures.NewPlayer("A"), TestFixtures.NewPlayer("B"),
				TestFixtures.NewPlayer("C"), TestFixtures.NewPlayer("D"),
			},
			Definition = Definition(BigDeck()),
			Teams = new() { new() { "A", "C" }, new() { "B", "D" } },
		});
		var state = game.State;

		// One seat per TEAM; the members listed in their turn order.
		Assert.Equal(2, state.Journey!.Seats.Count);
		Assert.Equal(new[] { "A", "C" }, state.Journey.Seats[0].Members.Select(m => m.PlayerId));
		Assert.Equal(new[] { "B", "D" }, state.Journey.Seats[1].Members.Select(m => m.PlayerId));

		// The players list IS the interleave (member 0 of each team, then member 1): NextTurn
		// walks it untouched and partners never play back to back.
		Assert.Equal(new[] { "A", "B", "C", "D" }, state.Players.Select(p => p.Id));
		Assert.Equal("A", state.CurrentTurn);

		// Partners wear the TEAM's palette colour — the same as their shared car.
		var colour = (string id) => state.Players.First(p => p.Id == id).Color;
		Assert.Equal(colour("A"), colour("C"));
		Assert.Equal(colour("B"), colour("D"));
		Assert.NotEqual(colour("A"), colour("B"));
	}

	[Fact]
	public void Projection_hides_the_PARTNERS_hand_too()
	{
		var family = new JourneyFamily();
		var game = family.CreateGame(new FamilyStartContext
		{
			Players = new List<Player>
			{
				TestFixtures.NewPlayer("A"), TestFixtures.NewPlayer("B"),
				TestFixtures.NewPlayer("C"), TestFixtures.NewPlayer("D"),
			},
			Definition = Definition(BigDeck()),
			Teams = new() { new() { "A", "C" }, new() { "B", "D" } },
		});

		var mine = family.ProjectFor(game.State, "A").Journey!;
		var mySeat = mine.Seats[0];
		Assert.NotEmpty(mySeat.Members[0].Hand);                 // my own hand stays
		Assert.Empty(mySeat.Members[1].Hand);                    // my PARTNER's is a count only
		Assert.Equal(6, mySeat.Members[1].HandCount);            // (official: private even between partners)
		Assert.All(mine.Seats[1].Members, m => Assert.Empty(m.Hand));
	}

	[Fact]
	public void CreateGame_rejects_teams_that_do_not_cover_every_player_exactly_once()
	{
		var family = new JourneyFamily();
		var players = new List<Player>
		{
			TestFixtures.NewPlayer("A"), TestFixtures.NewPlayer("B"),
			TestFixtures.NewPlayer("C"), TestFixtures.NewPlayer("D"),
		};

		Assert.Throws<InvalidOperationException>(() => family.CreateGame(new FamilyStartContext
		{
			Players = players,
			Definition = Definition(BigDeck()),
			Teams = new() { new() { "A", "C" }, new() { "B" } }, // D missing
		}));
		Assert.Throws<InvalidOperationException>(() => family.CreateGame(new FamilyStartContext
		{
			Players = players,
			Definition = Definition(BigDeck()),
			Teams = new() { new() { "A", "C" }, new() { "B", "A" } }, // A twice, D missing
		}));
	}

	// ── House rules (lobby choices → effective JourneyRulesConfig) ────────────

	[Fact]
	public void CreateGame_applies_the_hosts_house_rule_values_and_persists_them_on_the_state()
	{
		var family = new JourneyFamily();
		var game = family.CreateGame(new FamilyStartContext
		{
			Players = new List<Player> { TestFixtures.NewPlayer("A"), TestFixtures.NewPlayer("B") },
			Definition = Definition(),
			RuleValues = new Dictionary<string, JsonElement>
			{
				["journeyTargetScore"] = JsonSerializer.SerializeToElement(0),      // single hand
				["journeyGoalKm"] = JsonSerializer.SerializeToElement(700),
				["journeyStackHazards"] = JsonSerializer.SerializeToElement(true),
				["journeyAllImmunitiesBonus"] = JsonSerializer.SerializeToElement(0),
				["startingMoney"] = JsonSerializer.SerializeToElement(9999),        // property code: ignored
			},
		});

		// The EFFECTIVE rules are persisted on the state (the restore contract) and drive
		// the runtime the handlers see.
		var effective = game.State.JourneyRules!;
		Assert.Equal(0, effective.TargetScore);
		Assert.Equal(700, effective.GoalKm);
		Assert.True(effective.StackHazards);
		Assert.Equal(0, effective.AllImmunitiesBonus);
		Assert.Equal(6, effective.HandSize); // untouched fields keep the package defaults
		Assert.Equal(effective, ((JourneyRuntime)game.Runtime!).Rules);
	}

	[Fact]
	public void A_house_rule_must_be_a_known_journey_code()
	{
		var definition = new GameDefinition
		{
			Manifest = new Manifest
			{
				Id = "test-journey",
				GameType = "journey",
				JourneyRules = new JourneyRulesConfig(),
				Players = new PlayersDef { Min = 2, Max = 2 },
				// A PROPERTY code on a journey manifest is a package bug: reject it loudly.
				HouseRules = new List<HouseRuleDef> { new() { Id = "startingMoney", Type = "number" } },
			},
			JourneyDeck = Deck(),
		};

		var ex = Assert.Throws<InvalidOperationException>(() => new JourneyFamily().ValidateDefinition(definition));
		Assert.Contains("startingMoney", ex.Message);
	}

	[Fact]
	public void The_journey_snapshot_carries_its_rules_so_restore_prefers_the_state()
	{
		Assert.True(new JourneyFamily().SnapshotCarriesRules);

		// RuntimeFromState rebuilds from the persisted EFFECTIVE rules, not the manifest.
		var family = new JourneyFamily();
		var game = family.CreateGame(new FamilyStartContext
		{
			Players = new List<Player> { TestFixtures.NewPlayer("A"), TestFixtures.NewPlayer("B") },
			Definition = Definition(),
			RuleValues = new Dictionary<string, JsonElement>
			{
				["journeyGoalKm"] = JsonSerializer.SerializeToElement(700),
			},
		});

		var restored = (JourneyRuntime)family.RuntimeFromState(game.State)!;
		Assert.Equal(700, restored.Rules.GoalKm);
	}

	// ── Projection (the hidden-information contract) ──────────────────────────

	[Fact]
	public void Projection_keeps_my_hand_and_collapses_everything_secret_to_counts()
	{
		var family = new JourneyFamily();
		var state = StartedGame();
		var full = state.Journey!;

		var mine = family.ProjectFor(state, "A").Journey!;

		// My hand intact; the rival's is a count only; the pile is a count only.
		Assert.Equal(full.Seats[0].Members[0].Hand.Select(c => c.InstanceId),
			mine.Seats[0].Members[0].Hand.Select(c => c.InstanceId));
		Assert.Empty(mine.Seats[1].Members[0].Hand);
		Assert.Equal(6, mine.Seats[1].Members[0].HandCount);
		Assert.Empty(mine.DrawPile);
		Assert.Equal(full.DrawPile.Count, mine.DrawCount);
		// The ORIGINAL state is untouched (persistence keeps the full information).
		Assert.Equal(6, full.Seats[1].Members[0].Hand.Count);
		Assert.NotEmpty(full.DrawPile);
	}

	[Fact]
	public void The_public_view_sees_no_hand_at_all()
	{
		var family = new JourneyFamily();
		var state = StartedGame();

		var projected = family.ProjectFor(state, null).Journey!;

		Assert.All(projected.Seats, s => Assert.Empty(s.Members[0].Hand));
		Assert.All(projected.Seats, s => Assert.Equal(6, s.Members[0].HandCount));
		Assert.Empty(projected.DrawPile);
	}

	[Fact]
	public void The_pending_coup_card_is_only_the_victims_secret()
	{
		var family = new JourneyFamily();
		var state = StartedGame();
		state.Journey!.PendingCoup = new PendingJourneyCoup
		{
			VictimId = "B",
			AttackerId = "A",
			HazardKind = "stop",
			ImmunityInstanceId = "priority#0",
		};

		Assert.Equal("priority#0", family.ProjectFor(state, "B").Journey!.PendingCoup!.ImmunityInstanceId);
		Assert.Equal(string.Empty, family.ProjectFor(state, "A").Journey!.PendingCoup!.ImmunityInstanceId);
		Assert.Equal(string.Empty, family.ProjectFor(state, null).Journey!.PendingCoup!.ImmunityInstanceId);
	}

	[Fact]
	public void Journey_declares_hidden_information_so_the_fanout_projects_per_player()
	{
		var family = new JourneyFamily();
		Assert.True(family.HasHiddenInformation);

		var state = StartedGame();
		var sends = GameStateFanout.PlanPerPlayer(state, family,
			pid => pid == "A" ? new[] { "connA" } : System.Array.Empty<string>());

		var send = Assert.Single(sends!);
		Assert.Equal(new[] { "connA" }, send.ConnectionIds);
		Assert.Empty(send.State.Journey!.Seats[1].Members[0].Hand); // B's hand never leaves the server
	}

	// ── Deck validation ───────────────────────────────────────────────────────

	[Fact]
	public void A_coherent_deck_validates()
	{
		new JourneyFamily().ValidateDefinition(Definition()); // does not throw
	}

	[Theory]
	[InlineData("unknown type", "wizard", "stop", "stopper", "unknown type")]
	[InlineData("attack without class", "attack", "stop", null, "hazardClass")]
	public void Incoherent_cards_are_rejected(string _, string type, string kind, string? hazardClass, string reason)
	{
		var deck = Deck();
		deck.Add(new JourneyCardDef { Id = "bad", Type = type, Kind = kind, HazardClass = hazardClass, NameKey = "cards.bad" });

		var ex = Assert.Throws<InvalidOperationException>(() => new JourneyFamily().ValidateDefinition(Definition(deck)));
		Assert.Contains(reason, ex.Message);
	}

	[Fact]
	public void A_remedy_for_a_hazard_nobody_inflicts_is_rejected()
	{
		var deck = Deck();
		deck.Add(new JourneyCardDef { Id = "ghost-cure", Type = "remedy", Kind = "ghost", NameKey = "cards.ghost" });

		var ex = Assert.Throws<InvalidOperationException>(() => new JourneyFamily().ValidateDefinition(Definition(deck)));
		Assert.Contains("no attack inflicts", ex.Message);
	}

	[Fact]
	public void An_uncurable_initial_hazard_is_rejected()
	{
		var deck = Deck().Where(c => c.Id != "go" && c.Id != "priority").ToList();

		var ex = Assert.Throws<InvalidOperationException>(() => new JourneyFamily().ValidateDefinition(Definition(deck)));
		Assert.Contains("initial hazard", ex.Message);
	}

	[Fact]
	public void A_deck_too_small_for_the_players_is_rejected()
	{
		var deck = new List<JourneyCardDef>
		{
			new() { Id = "distance-25", Type = "distance", Value = 25, Count = 5, NameKey = "cards.distance_25" },
			new() { Id = "go", Type = "remedy", Kind = "stop", Count = 2, NameKey = "cards.go" },
		};

		var ex = Assert.Throws<InvalidOperationException>(() => new JourneyFamily().ValidateDefinition(Definition(deck)));
		Assert.Contains("too small", ex.Message);
	}
}
