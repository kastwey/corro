using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Commands;
using CorroServer.Services.Corro.Families;
using CorroServer.Services.Rules;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// The journey turn flow on top of the pure rulebook: draw-then-act discipline, the secrecy
/// of the drawn card (identity ToPlayer only), the coup fourré pause (commands gated, silent
/// decline, turn theft on accept), and the hand end → scoring → redeal → match end chain.
/// </summary>
public class JourneyTurnFlowTests
{
	private static List<JourneyCardDef> Deck() => new()
	{
		new() { Id = "distance-25", Type = "distance", Value = 25, Count = 10, NameKey = "cards.distance_25" },
		new() { Id = "stop", Type = "attack", Kind = "stop", HazardClass = "stopper", Count = 3, NameKey = "cards.stop" },
		new() { Id = "go", Type = "remedy", Kind = "stop", Count = 6, NameKey = "cards.go" },
		new() { Id = "gas", Type = "remedy", Kind = "stop", Count = 2, NameKey = "cards.gas", PlayedKey = "cards.gas_played" },
		new() { Id = "limit", Type = "attack", Kind = "speedLimit", HazardClass = "limiter", Count = 2, NameKey = "cards.limit", PlayedKey = "cards.limit_played" },
		new() { Id = "priority", Type = "immunity", ShieldsKinds = new() { "stop" }, NameKey = "cards.priority" },
	};

	private static JourneyCardInstance Inst(string cardId, int n = 0)
		=> new() { InstanceId = $"{cardId}#{n}", CardId = cardId };

	/// <summary>A running two-player journey game with hand-built hands (no dealing).</summary>
	private static (GameState State, GameContext Context) Game(
		JourneyRulesConfig? rules = null, params (string Id, string[] Cards)[] hands)
	{
		var journey = new JourneyState();
		foreach (var (id, cards) in hands)
		{
			var seat = new JourneySeatState
			{
				PlayerId = id,
				Members = new() { new JourneyMemberState { PlayerId = id } },
			};
			seat.Hazards.Add("stop");
			for (var i = 0; i < cards.Length; i++)
			{
				seat.Members[0].Hand.Add(Inst(cards[i], i));
			}

			journey.Seats.Add(seat);
		}
		JourneyRulebook.SyncCounts(journey);

		var state = TestFixtures.NewState(hands.Select(h => TestFixtures.NewPlayer(h.Id)).ToList());
		state.GameType = "journey";
		state.Journey = journey;
		state.JourneyDeck = Deck();

		var context = NewJourneyContext(state, rules ?? new JourneyRulesConfig());
		return (state, context);
	}

	private static GameContext NewJourneyContext(GameState state, JourneyRulesConfig rules)
	{
		var baseContext = TestFixtures.NewContext(state);
		return new GameContext
		{
			GameState = state,
			Helper = baseContext.Helper,
			Settings = baseContext.Settings,
			FamilyRuntime = new JourneyRuntime(JourneyRulebook.Catalog(Deck()), Deck(), rules),
			Announce = baseContext.Announce,
			Announcer = baseContext.Announcer,
			Presenter = baseContext.Presenter,
		};
	}

	/// <summary>The base announcement keys, in order (the personalization convention splits
	/// every actorId line into a _self twin — asserting on the base sequence keeps the tests
	/// focused on WHAT was said, not on the split).</summary>
	private static string[] Keys(GameContext ctx)
		=> TestFixtures.Announcer(ctx).Sent
			.Where(a => !a.Key.EndsWith("_self"))
			.Select(d => d.Key).ToArray();

	// ── Teams: the seat is the victim, the team word is the name ──────────────

	[Fact]
	public async Task An_attack_on_a_team_names_the_TEAM_and_reaches_both_members()
	{
		// Teams [A,C] (seat 0 → "red") vs [B,D] (seat 1): B attacks the red team via C.
		var journey = new JourneyState();
		journey.Seats.Add(new JourneySeatState
		{
			PlayerId = "A",
			Members = new() { new() { PlayerId = "A" }, new() { PlayerId = "C" } },
		});
		journey.Seats.Add(new JourneySeatState
		{
			PlayerId = "B",
			Members = new() { new() { PlayerId = "B" }, new() { PlayerId = "D" } },
		});
		journey.Seats[1].Members[0].Hand.Add(Inst("limit"));
		journey.Seats[1].Members[1].Hand.Add(Inst("distance-25")); // keeps the hand from ending
		journey.HasDrawn = true;
		JourneyRulebook.SyncCounts(journey);

		var state = TestFixtures.NewState(new List<Player>
		{
			TestFixtures.NewPlayer("A"), TestFixtures.NewPlayer("B"),
			TestFixtures.NewPlayer("C"), TestFixtures.NewPlayer("D"),
		});
		state.GameType = "journey";
		state.Journey = journey;
		state.JourneyDeck = Deck();
		state.CurrentTurn = "B";
		var context = NewJourneyContext(state, new JourneyRulesConfig());

		var response = await JourneyTurnFlow.PlayAsync(
			new JourneyPlayCommand { PlayerId = "B", InstanceId = "limit#0", TargetId = "C" },
			state.Players.First(p => p.Id == "B"), context, new ScriptedRandomSource());

		Assert.IsType<JourneyActionResponse>(response);
		Assert.Contains("speedLimit", journey.Seats[0].Hazards); // the SEAT took the hit

		var announcer = TestFixtures.Announcer(context);
		// The themed victim line reaches BOTH members of the attacked seat, in the PLURAL
		// variant («¡Pepe os lanza…!» — the client falls back _victim_team → _victim → base)…
		Assert.True(announcer.Has(AnnouncementAudience.Player, "A", "cards.limit_played_victim_team"));
		Assert.True(announcer.Has(AnnouncementAudience.Player, "C", "cards.limit_played_victim_team"));
		// …the attacker's partner hears the table line…
		Assert.True(announcer.Has(AnnouncementAudience.Player, "D", "cards.limit_played"));
		// …and the target is named by the TEAM word (the __team convention: each client
		// localizes "red" into its own language).
		var line = announcer.Sent.First(a => a.Key == "cards.limit_played");
		Assert.Equal("__team:red", line.Vars["target"]);
	}

	// ── Draw ──────────────────────────────────────────────────────────────────

	[Fact]
	public async Task Draw_tells_everyone_THAT_and_only_you_WHAT()
	{
		var (state, ctx) = Game(hands: new[] { ("A", new[] { "go" }), ("B", new[] { "go" }) });
		state.Journey!.DrawPile.Add(Inst("distance-25", 9));
		JourneyRulebook.SyncCounts(state.Journey);

		var response = await new JourneyDrawHandler().HandleAsync(
			new JourneyDrawCommand { PlayerId = "A" }, ctx);

		Assert.IsType<JourneyActionResponse>(response);
		var dispatches = TestFixtures.Announcer(ctx).Sent;
		// The public line excludes the actor and never carries the card; the identity
		// (the card's own NameKey line) goes to the actor alone.
		var publicLine = dispatches.Single(d => d.Key == "game.journey_drew");
		Assert.Equal(AnnouncementAudience.AllExcept, publicLine.Audience);
		Assert.False(publicLine.Vars.ContainsKey("card"));
		var mine = dispatches.Single(d => d.Key == "game.journey_drew_self");
		Assert.Equal("A", mine.Vars["actorId"]); // own draw is voiced before the hand repaint
		var identity = dispatches.Single(d => d.Key == "cards.distance_25");
		Assert.Equal(AnnouncementAudience.Player, identity.Audience);
		Assert.Equal("A", identity.PlayerId);

		// Second draw in the same turn is refused.
		var again = await new JourneyDrawHandler().HandleAsync(new JourneyDrawCommand { PlayerId = "A" }, ctx);
		Assert.Equal("ALREADY_DREW", Assert.IsType<ErrorResponse>(again).Code);
	}

	[Fact]
	public async Task Playing_before_drawing_is_refused_while_the_pile_has_cards()
	{
		var (state, ctx) = Game(hands: new[] { ("A", new[] { "go" }), ("B", System.Array.Empty<string>()) });
		state.Journey!.DrawPile.Add(Inst("distance-25", 9));
		JourneyRulebook.SyncCounts(state.Journey);

		var response = await new JourneyPlayHandler(new CorroRulebook()).HandleAsync(
			new JourneyPlayCommand { PlayerId = "A", InstanceId = "go#0" }, ctx);

		Assert.Equal("DRAW_FIRST", Assert.IsType<ErrorResponse>(response).Code);
	}

	[Fact]
	public async Task Rolling_dice_is_refused_in_a_card_game()
	{
		// Regression: ProcessRoll returning null meant "use the shared property flow" — the
		// server rolled two real dice in a journey game (with the dice announcement and all).
		var (_, ctx) = Game(hands: new[] { ("A", new[] { "go" }), ("B", new[] { "go" }) });

		var response = await new RollDiceHandler(new CorroRulebook()).HandleAsync(
			new RollDiceCommand { PlayerId = "A" }, ctx);

		var error = Assert.IsType<ErrorResponse>(response);
		Assert.Equal("NO_DICE_IN_FAMILY", error.Code);
		Assert.Empty(TestFixtures.Announcer(ctx).Sent); // no dice line, no movement narration
	}

	// ── Play + turn ───────────────────────────────────────────────────────────

	[Fact]
	public async Task A_played_card_is_announced_with_its_identity_and_the_turn_passes()
	{
		var (state, ctx) = Game(hands: new[] { ("A", new[] { "go" }), ("B", new[] { "go" }) });
		state.Journey!.HasDrawn = true; // empty pile → no draw needed anyway

		var response = await new JourneyPlayHandler(new CorroRulebook()).HandleAsync(
			new JourneyPlayCommand { PlayerId = "A", InstanceId = "go#0" }, ctx);

		var action = Assert.IsType<JourneyActionResponse>(response);
		Assert.True(action.TurnEnded);
		// Curing your LAST stopper is the moment that matters: "¡En marcha!" follows the card.
		Assert.Equal(new[] { "game.journey_played_remedy", "cards.go", "game.journey_now_rolling", "game.turn_of" }, Keys(ctx));
		Assert.Equal("B", state.CurrentTurn);
		Assert.False(state.Journey.HasDrawn); // reset for the next player's turn
		Assert.Empty(state.Journey.Seats[0].Hazards); // the green light cured the initial stop
	}

	[Fact]
	public async Task A_themed_playedKey_replaces_the_generic_pair_and_names_the_piece()
	{
		var (state, ctx) = Game(hands: new[] { ("A", new[] { "gas" }), ("B", new[] { "go" }) });
		state.Journey!.HasDrawn = true;

		await new JourneyPlayHandler(new CorroRulebook()).HandleAsync(
			new JourneyPlayCommand { PlayerId = "A", InstanceId = "gas#0" }, ctx);

		// ONE themed line instead of "plays a remedy:" + the card name — plus the rolling
		// celebration (it cured the last stopper) and the turn handover.
		Assert.Equal(new[] { "cards.gas_played", "game.journey_now_rolling", "game.turn_of" }, Keys(ctx));
		var themed = TestFixtures.Announcer(ctx).Sent.First(a => a.Key == "cards.gas_played");
		// The client resolves tokenId into the piece's localized name ({{token}}).
		Assert.Equal("disc", themed.Vars["tokenId"]);
		Assert.Equal("A", themed.Vars["player"]);
	}

	[Fact]
	public async Task A_themed_attack_speaks_to_three_audiences()
	{
		var (state, ctx) = Game(hands: new[]
		{
			("A", new[] { "limit" }), ("B", System.Array.Empty<string>()), ("C", System.Array.Empty<string>()),
		});
		state.Journey!.HasDrawn = true;

		await new JourneyPlayHandler(new CorroRulebook()).HandleAsync(
			new JourneyPlayCommand { PlayerId = "A", InstanceId = "limit#0", TargetId = "B" }, ctx);

		// One line each: the attacker's, the VICTIM's (their own flavored variant) and the
		// table's — never the whole-table base to someone with a dedicated line.
		var sent = TestFixtures.Announcer(ctx).Sent.Where(a => a.Key.StartsWith("cards.limit_played")).ToList();
		Assert.Contains(sent, a => a.Key == "cards.limit_played_self" && a.Audience == AnnouncementAudience.Player && a.PlayerId == "A");
		Assert.Contains(sent, a => a.Key == "cards.limit_played_victim" && a.Audience == AnnouncementAudience.Player && a.PlayerId == "B");
		Assert.Contains(sent, a => a.Key == "cards.limit_played" && a.Audience == AnnouncementAudience.Player && a.PlayerId == "C");
		Assert.Equal(3, sent.Count);
		Assert.All(sent, a => Assert.Equal("B", a.Vars["target"])); // the target's NAME travels
	}

	[Fact]
	public async Task An_illegal_play_returns_the_reason_key()
	{
		var (state, ctx) = Game(hands: new[] { ("A", new[] { "distance-25" }), ("B", new[] { "go" }) });
		state.Journey!.HasDrawn = true; // still stopped: distance is illegal

		var response = await new JourneyPlayHandler(new CorroRulebook()).HandleAsync(
			new JourneyPlayCommand { PlayerId = "A", InstanceId = "distance-25#0" }, ctx);

		var error = Assert.IsType<ErrorResponse>(response);
		Assert.Equal("JOURNEY_ILLEGAL_PLAY", error.Code);
		Assert.Equal("game.journey_stopped", error.Message);
	}

	// ── Coup fourré ───────────────────────────────────────────────────────────

	private static (GameState, GameContext) AttackIntoShield()
	{
		var (state, ctx) = Game(hands: new[]
		{
			("A", new[] { "stop" }),
			("B", new[] { "priority", "go" }),
		});
		state.Journey!.HasDrawn = true;
		state.Journey.Seats[1].Hazards.Clear(); // B is rolling (attackable)
		return (state, ctx);
	}

	[Fact]
	public async Task The_coup_window_pauses_the_game_and_gates_other_commands()
	{
		var (state, ctx) = AttackIntoShield();

		var response = await new JourneyPlayHandler(new CorroRulebook()).HandleAsync(
			new JourneyPlayCommand { PlayerId = "A", InstanceId = "stop#0", TargetId = "B" }, ctx);

		var action = Assert.IsType<JourneyActionResponse>(response);
		Assert.False(action.TurnEnded);
		Assert.Equal("A", state.CurrentTurn); // paused, no turn advance
		Assert.NotNull(state.Journey!.PendingCoup);
		// The offer reaches ONLY the victim.
		var offer = TestFixtures.Announcer(ctx).Sent.Single(d => d.Key == "game.journey_coup_offer");
		Assert.Equal(AnnouncementAudience.Player, offer.Audience);
		Assert.Equal("B", offer.PlayerId);

		// Every journey action is gated until the victim answers.
		var gated = await new JourneyDrawHandler().HandleAsync(new JourneyDrawCommand { PlayerId = "A" }, ctx);
		Assert.Equal("RESOLVE_COUP_FIRST", Assert.IsType<ErrorResponse>(gated).Code);
	}

	[Fact]
	public async Task Accepting_the_coup_cancels_the_attack_and_steals_the_turn()
	{
		var (state, ctx) = AttackIntoShield();
		await new JourneyPlayHandler(new CorroRulebook()).HandleAsync(
			new JourneyPlayCommand { PlayerId = "A", InstanceId = "stop#0", TargetId = "B" }, ctx);

		var response = await new JourneyCoupHandler().HandleAsync(
			new JourneyCoupCommand { PlayerId = "B", Accept = true }, ctx);

		Assert.IsType<JourneyActionResponse>(response);
		Assert.Null(state.Journey!.PendingCoup);
		Assert.Empty(state.Journey.Seats[1].Hazards);
		Assert.Equal(new[] { "priority" }, state.Journey.Seats[1].Immunities);
		Assert.Equal("B", state.CurrentTurn); // the classic reward: the turn is theirs
		Assert.Contains("game.journey_coup", Keys(ctx));
	}

	[Fact]
	public async Task Declining_the_coup_is_SILENT_and_the_turn_moves_on()
	{
		var (state, ctx) = AttackIntoShield();
		await new JourneyPlayHandler(new CorroRulebook()).HandleAsync(
			new JourneyPlayCommand { PlayerId = "A", InstanceId = "stop#0", TargetId = "B" }, ctx);

		await new JourneyCoupHandler().HandleAsync(
			new JourneyCoupCommand { PlayerId = "B", Accept = false }, ctx);

		Assert.Null(state.Journey!.PendingCoup);
		Assert.Contains("stop", state.Journey.Seats[1].Hazards); // the hazard sticks
																 // Declining reveals nothing: no coup line, just the ordinary turn handover.
		Assert.DoesNotContain("game.journey_coup", Keys(ctx));
		Assert.Equal("B", state.CurrentTurn);

		// Only the victim may have answered; a rival poking the window gets refused.
		var poke = await new JourneyCoupHandler().HandleAsync(
			new JourneyCoupCommand { PlayerId = "A", Accept = true }, ctx);
		Assert.Equal("JOURNEY_NO_COUP", Assert.IsType<ErrorResponse>(poke).Code);
	}

	// ── Hand end → scoring → redeal / match end ───────────────────────────────

	[Fact]
	public async Task Completing_the_goal_scores_the_hand_and_redeals_the_next_one()
	{
		var (state, ctx) = Game(
			rules: new JourneyRulesConfig { GoalKm = 25, TargetScore = 5000 },
			hands: new[] { ("A", new[] { "distance-25" }), ("B", new[] { "go" }) });
		var journey = state.Journey!;
		journey.HasDrawn = true;
		journey.Seats[0].Hazards.Clear(); // rolling: the 25 completes the 25 km goal

		var response = await new JourneyPlayHandler(new CorroRulebook()).HandleAsync(
			new JourneyPlayCommand { PlayerId = "A", InstanceId = "distance-25#0" }, ctx);

		var action = Assert.IsType<JourneyActionResponse>(response);
		Assert.True(action.HandEnded);
		var keys = Keys(ctx);
		Assert.Contains("game.journey_hand_won", keys);
		Assert.Equal(2, keys.Count(k => k == "game.journey_hand_score"));
		Assert.Contains("game.journey_new_hand", keys);
		Assert.False(state.IsGameOver);
		// A fresh hand of the same match: new deal, scores carried, round advanced.
		Assert.Equal(2, state.Journey!.Round);
		Assert.NotSame(journey, state.Journey);
		Assert.True(state.Journey.Seats[0].Score > 0);
		Assert.All(state.Journey.Seats, s => Assert.Equal(6, s.Members[0].Hand.Count));
	}

	[Fact]
	public async Task Crossing_the_target_score_closes_the_match_with_placings()
	{
		var (state, ctx) = Game(
			rules: new JourneyRulesConfig { GoalKm = 25, TargetScore = 100 },
			hands: new[] { ("A", new[] { "distance-25" }), ("B", new[] { "go" }) });
		var journey = state.Journey!;
		journey.HasDrawn = true;
		journey.Seats[0].Hazards.Clear();

		await new JourneyPlayHandler(new CorroRulebook()).HandleAsync(
			new JourneyPlayCommand { PlayerId = "A", InstanceId = "distance-25#0" }, ctx);

		Assert.True(state.IsGameOver);
		Assert.Equal("A", state.WinnerId);
		Assert.Equal(1, state.Players.First(p => p.Id == "A").FinishPlace);
		Assert.Equal(2, state.Players.First(p => p.Id == "B").FinishPlace);
		Assert.Contains("game.game_over", Keys(ctx));
	}

	[Fact]
	public async Task A_single_hand_game_ends_the_match_with_the_hand()
	{
		var (state, ctx) = Game(
			rules: new JourneyRulesConfig { GoalKm = 25, TargetScore = 0 },
			hands: new[] { ("A", new[] { "distance-25" }), ("B", new[] { "go" }) });
		state.Journey!.HasDrawn = true;
		state.Journey.Seats[0].Hazards.Clear();

		await new JourneyPlayHandler(new CorroRulebook()).HandleAsync(
			new JourneyPlayCommand { PlayerId = "A", InstanceId = "distance-25#0" }, ctx);

		Assert.True(state.IsGameOver);
		Assert.Equal("A", state.WinnerId);
	}

	[Fact]
	public async Task A_cardless_player_is_skipped_aloud_instead_of_deadlocking_the_table()
	{
		// Pile dry, B already played out their hand: B can neither draw, play nor discard —
		// their turn used to freeze the game (the hand only ends when EVERY hand is empty).
		var (state, ctx) = Game(hands: new[]
		{
			("A", new[] { "go", "go" }), ("B", System.Array.Empty<string>()), ("C", new[] { "go" }),
		});
		state.Journey!.HasDrawn = true;

		await new JourneyDiscardHandler(new CorroRulebook()).HandleAsync(
			new JourneyDiscardCommand { PlayerId = "A", InstanceId = "go#0" }, ctx);

		// B is skipped: the table hears it, B hears the first-person line, C gets the turn.
		var announcer = TestFixtures.Announcer(ctx);
		Assert.True(announcer.Has(AnnouncementAudience.AllExcept, "B", "game.journey_no_cards_skip"));
		Assert.True(announcer.Has(AnnouncementAudience.Player, "B", "game.journey_no_cards_skip_self"));
		Assert.Equal("C", state.CurrentTurn);
	}

	[Fact]
	public async Task Discarding_the_last_card_of_an_exhausted_hand_ends_it_too()
	{
		var (state, ctx) = Game(
			rules: new JourneyRulesConfig { TargetScore = 0 },
			hands: new[] { ("A", new[] { "go" }), ("B", System.Array.Empty<string>()) });
		// Empty pile: no draw required; discarding A's only card empties the table.

		var response = await new JourneyDiscardHandler(new CorroRulebook()).HandleAsync(
			new JourneyDiscardCommand { PlayerId = "A", InstanceId = "go#0" }, ctx);

		var action = Assert.IsType<JourneyActionResponse>(response);
		Assert.True(action.HandEnded);
		Assert.Contains("game.journey_hand_exhausted", Keys(ctx));
		Assert.True(state.IsGameOver); // single-hand game: exhausted hand closes the match
	}
}
