using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Commands;
using CorroServer.Services.Corro.Families;
using CorroServer.Services.Rules;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// The shedding flow on top of the pure rulebook: the play's voice (wilds naming the
/// colour in force), penalties suffered before the turn resolves (identities the
/// victim's alone), the direction-aware pass, the draw pause and its keep, round
/// scoring with the winner leading the redeal, the match end — and the deliberate
/// ABSENCE of a one-card-left shout (counts are on-demand: S / Shift+S).
/// </summary>
public class SheddingTurnFlowTests
{
	private static List<SheddingCardDef> Deck() => new()
	{
		new() { Id = "red-5", Type = "number", Color = "red", Value = 5, Count = 4, NameKey = "c.red5" },
		new() { Id = "red-7", Type = "number", Color = "red", Value = 7, Count = 4, NameKey = "c.red7" },
		new() { Id = "blue-5", Type = "number", Color = "blue", Value = 5, Count = 4, NameKey = "c.blue5" },
		new() { Id = "blue-7", Type = "number", Color = "blue", Value = 7, Count = 4, NameKey = "c.blue7" },
		new() { Id = "skip-red", Type = "skip", Color = "red", Count = 2, NameKey = "c.skipred" },
		new() { Id = "d2-red", Type = "drawTwo", Color = "red", Count = 2, NameKey = "c.d2red" },
		new() { Id = "wild", Type = "wild", Count = 2, NameKey = "c.wild" },
	};

	private static SheddingCardInstance Inst(string cardId, int n = 0)
		=> new() { InstanceId = $"{cardId}#{n}", CardId = cardId };

	/// <summary>A running shedding game with hand-built hands, red-5 on top, red in force.</summary>
	private static (GameState State, GameContext Context) Game(
		SheddingRulesConfig? rules = null, params (string Id, string[] Cards)[] hands)
	{
		var shedding = new SheddingState();
		foreach (var (id, cards) in hands)
		{
			var seat = new SheddingSeatState { PlayerId = id };
			for (var i = 0; i < cards.Length; i++)
			{
				seat.Hand.Add(Inst(cards[i], i));
			}

			shedding.Seats.Add(seat);
		}
		shedding.DiscardPile.Add(Inst("red-5", 9));
		shedding.CurrentColor = "red";
		SheddingRulebook.SyncCounts(shedding);

		var state = TestFixtures.NewState(hands.Select(h => TestFixtures.NewPlayer(h.Id)).ToList());
		state.GameType = "shedding";
		state.Shedding = shedding;
		state.SheddingDeck = Deck();
		state.SheddingRules = rules ?? new SheddingRulesConfig();

		var baseContext = TestFixtures.NewContext(state);
		var context = new GameContext
		{
			GameState = state,
			Helper = baseContext.Helper,
			Settings = baseContext.Settings,
			FamilyRuntime = new SheddingRuntime(SheddingRulebook.Catalog(Deck()), Deck(), state.SheddingRules!),
			Announce = baseContext.Announce,
			Announcer = baseContext.Announcer,
			Presenter = baseContext.Presenter,
		};
		return (state, context);
	}

	private static Task<ServerResponse> Play(GameContext ctx, GameState st, string playerId,
		string instanceId, string? color = null)
		=> SheddingTurnFlow.PlayAsync(
			new SheddingPlayCommand { PlayerId = playerId, InstanceId = instanceId, ChosenColor = color },
			st.Players.First(p => p.Id == playerId), ctx, new ScriptedRandomSource());

	private static string[] Keys(GameContext ctx)
		=> TestFixtures.Announcer(ctx).Sent.Select(d => d.Key).ToArray();

	// ── Plays and effects ─────────────────────────────────────────────────────

	[Fact]
	public async Task A_plain_play_speaks_the_card_and_passes_the_turn_in_order()
	{
		var (state, context) = Game(hands: new[]
		{
			("a", new[] { "red-7", "blue-5" }),
			("b", new[] { "blue-7", "blue-5" }),
			("c", new[] { "red-5", "blue-7" }),
		});

		var response = await Play(context, state, "a", "red-7#0");

		Assert.True(Assert.IsType<SheddingActionResponse>(response).TurnEnded);
		Assert.Equal("b", state.CurrentTurn);
		var played = TestFixtures.Announcer(context).Sent.First(d => d.Key == "game.shedding_played");
		Assert.Equal("c.red7", played.Vars["card"]);
		Assert.Equal("card-play-discard", played.Vars["visualKind"]);
		Assert.Equal("red-7", played.Vars["visualCardId"]);
		// No one-card-left shout — the count is on-demand (S / Shift+S), by design.
		Assert.DoesNotContain(Keys(context), k => k.Contains("one_left"));
	}

	[Fact]
	public async Task A_wild_names_the_colour_in_force_for_every_ear()
	{
		var (state, context) = Game(hands: new[]
		{
			("a", new[] { "wild", "blue-5" }),
			("b", new[] { "blue-7", "blue-5" }),
		});

		await Play(context, state, "a", "wild#0", "blue");

		var chosen = TestFixtures.Announcer(context).Sent.Single(d => d.Key == "game.shedding_color_chosen");
		Assert.Equal("colors.blue", chosen.Vars["color"]); // the client resolves the package word
		Assert.Equal("blue", state.Shedding!.CurrentColor);
	}

	[Fact]
	public async Task A_penalty_is_suffered_before_the_turn_resolves_identities_private()
	{
		var (state, context) = Game(hands: new[]
		{
			("a", new[] { "d2-red", "blue-5" }),
			("b", new[] { "blue-7" }),
			("c", new[] { "red-5" }),
		});
		state.Shedding!.DrawPile.Add(Inst("blue-5", 8));
		state.Shedding!.DrawPile.Add(Inst("blue-7", 8));
		SheddingRulebook.SyncCounts(state.Shedding!);

		await Play(context, state, "a", "d2-red#0");

		var announcer = TestFixtures.Announcer(context);
		// The table hears WHO drew HOW MANY and the lost turn; the names are b's alone.
		Assert.Contains("game.shedding_drew_penalty", Keys(context));
		var penalty = announcer.Sent.Single(d => d.Key == "game.shedding_drew_penalty");
		Assert.Equal("card-draw", penalty.Vars["visualKind"]);
		Assert.Equal("b", penalty.Vars["visualTargetPlayerId"]);
		Assert.False(penalty.Vars.ContainsKey("visualCardId"));
		Assert.Contains("game.shedding_skipped", Keys(context));
		Assert.True(announcer.Has(AnnouncementAudience.Player, "b", "game.shedding_penalty_cards_2"));
		Assert.Equal(3, SheddingRulebook.SeatOf(state.Shedding!, "b").Hand.Count);
		Assert.Equal("c", state.CurrentTurn); // b lost the turn
	}

	// ── Stacking draw cards (house rule) ───────────────────────────────────────

	[Fact]
	public async Task Stacking_hands_the_growing_penalty_on_until_someone_draws_it()
	{
		var stack = new SheddingRulesConfig { Stacking = "sameType" };
		var (state, context) = Game(stack, hands: new[]
		{
			("a", new[] { "d2-red", "blue-5" }),
			("b", new[] { "d2-red", "blue-7" }),
			("c", new[] { "red-7" }),
		});
		for (var i = 0; i < 6; i++)
		{
			state.Shedding!.DrawPile.Add(Inst("blue-5", 20 + i));
		}

		SheddingRulebook.SyncCounts(state.Shedding!);

		// a opens the pile: NOBODY draws yet, the turn simply passes to b.
		await Play(context, state, "a", "d2-red#0");
		Assert.Contains("game.shedding_stack", Keys(context));
		Assert.DoesNotContain("game.shedding_drew_penalty", Keys(context));
		Assert.Equal(2, state.Shedding!.PendingPenalty!.Amount);
		Assert.Equal("b", state.CurrentTurn);

		// b stacks another +2: the total climbs to 4 and it lands on c.
		await Play(context, state, "b", "d2-red#0");
		Assert.Equal(4, state.Shedding!.PendingPenalty!.Amount);
		Assert.Equal("c", state.CurrentTurn);

		// c can't stack: drawing takes ALL four and clears the pile, the turn passes on.
		await SheddingTurnFlow.DrawAsync(state.Players[2], context, new ScriptedRandomSource());
		Assert.Null(state.Shedding!.PendingPenalty);
		Assert.Equal(4, SheddingRulebook.SeatOf(state.Shedding!, "c").Hand.Count - 1); // started with 1
		Assert.Contains("game.shedding_drew_penalty", Keys(context));
		Assert.Equal("a", state.CurrentTurn);
	}

	// ── Doubles (house rule) ───────────────────────────────────────────────────

	[Fact]
	public async Task Doubles_announces_the_count_and_sheds_every_copy()
	{
		var doubles = new SheddingRulesConfig { AllowDoubles = true };
		var (state, context) = Game(doubles, hands: new[]
		{
			("a", new[] { "red-7", "red-7", "blue-5" }),
			("b", new[] { "blue-7" }),
		});

		var response = await SheddingTurnFlow.PlayAsync(
			new SheddingPlayCommand
			{
				PlayerId = "a",
				InstanceId = "red-7#0",
				ExtraInstanceIds = new List<string> { "red-7#1" },
			},
			state.Players[0], context, new ScriptedRandomSource());

		Assert.True(Assert.IsType<SheddingActionResponse>(response).TurnEnded);
		Assert.Contains("game.shedding_played_doubles", Keys(context));
		Assert.Single(SheddingRulebook.SeatOf(state.Shedding!, "a").Hand); // both red-7 shed
		Assert.Equal("b", state.CurrentTurn);
	}

	// ── Drawing and the pause ─────────────────────────────────────────────────

	[Fact]
	public async Task Drawing_an_unplayable_card_whispers_it_and_passes_the_turn()
	{
		var (state, context) = Game(hands: new[]
		{
			("a", new[] { "red-7" }),
			("b", new[] { "blue-7" }),
		});
		state.Shedding!.DrawPile.Add(Inst("blue-7", 8)); // neither red nor a 5
		SheddingRulebook.SyncCounts(state.Shedding!);

		var response = await SheddingTurnFlow.DrawAsync(
			state.Players[0], context, new ScriptedRandomSource());

		Assert.True(Assert.IsType<SheddingActionResponse>(response).TurnEnded);
		var announcer = TestFixtures.Announcer(context);
		Assert.True(announcer.Has(AnnouncementAudience.AllExcept, "a", "game.shedding_drew"));
		Assert.True(announcer.Has(AnnouncementAudience.Player, "a", "game.shedding_drew_unplayable"));
		Assert.Equal("a", announcer.Sent.Single(d => d.Key == "game.shedding_drew_unplayable").Vars["actorId"]);
		Assert.Equal("b", state.CurrentTurn);
	}

	[Fact]
	public async Task Drawing_a_playable_card_pauses_on_the_play_or_keep_choice()
	{
		var (state, context) = Game(hands: new[]
		{
			("a", new[] { "blue-7" }),
			("b", new[] { "blue-7" }),
		});
		state.Shedding!.DrawPile.Add(Inst("red-7", 8)); // red is in force: playable
		SheddingRulebook.SyncCounts(state.Shedding!);

		var draw = await SheddingTurnFlow.DrawAsync(state.Players[0], context, new ScriptedRandomSource());

		Assert.False(Assert.IsType<SheddingActionResponse>(draw).TurnEnded);
		Assert.Equal("a", state.CurrentTurn); // the game waits on a
		Assert.NotNull(state.Shedding!.PendingDrawnPlay);
		var announcer = TestFixtures.Announcer(context);
		Assert.True(announcer.Has(AnnouncementAudience.Player, "a", "game.shedding_drew_playable"));
		var drawnLine = announcer.Sent.Single(d => d.Key == "game.shedding_drew_playable");
		Assert.Equal("a", drawnLine.Vars["actorId"]);
		Assert.Equal("red-7", drawnLine.Vars["visualCardId"]);

		// A second draw mid-pause is refused; the KEEP resolves it and passes the turn.
		var again = await SheddingTurnFlow.DrawAsync(state.Players[0], context, new ScriptedRandomSource());
		Assert.IsType<ErrorResponse>(again);

		var keep = await SheddingTurnFlow.KeepAsync(state.Players[0], context);
		Assert.True(Assert.IsType<SheddingActionResponse>(keep).TurnEnded);
		Assert.Null(state.Shedding!.PendingDrawnPlay);
		Assert.Contains("game.shedding_kept", Keys(context));
		Assert.Equal("b", state.CurrentTurn);
		Assert.Equal(2, SheddingRulebook.SeatOf(state.Shedding!, "a").Hand.Count);
	}

	// ── Rounds and the match ──────────────────────────────────────────────────

	[Fact]
	public async Task An_emptied_hand_scores_the_round_and_the_winner_leads_the_redeal()
	{
		var (state, context) = Game(hands: new[]
		{
			("a", new[] { "red-7" }),
			("b", new[] { "wild", "blue-7" }), // 50 + 7 points surrendered
        });

		var response = await Play(context, state, "a", "red-7#0");

		var action = Assert.IsType<SheddingActionResponse>(response);
		Assert.True(action.RoundEnded);
		Assert.False(action.GameEnded); // 57 < the 500 target

		var won = TestFixtures.Announcer(context).Sent.Single(d => d.Key == "game.shedding_round_won");
		Assert.Equal(57, won.Vars["points"]);
		Assert.Contains("game.shedding_round_started", Keys(context));
		Assert.Equal(2, state.Shedding!.Round);
		Assert.Equal("a", state.CurrentTurn); // the winner leads round two
		Assert.Equal(7, SheddingRulebook.SeatOf(state.Shedding!, "a").Hand.Count); // fresh deal
	}

	[Fact]
	public async Task Crossing_the_target_ends_the_match()
	{
		var (state, context) = Game(
			rules: new SheddingRulesConfig { TargetScore = 50 },
			hands: new[]
			{
				("a", new[] { "red-7" }),
				("b", new[] { "wild" }), // 50 points: crosses the target
            });

		var response = await Play(context, state, "a", "red-7#0");

		Assert.True(Assert.IsType<SheddingActionResponse>(response).GameEnded);
		Assert.True(state.IsGameOver);
		Assert.Equal("a", state.WinnerId);
		Assert.Contains("game.game_over", Keys(context));
		Assert.Equal(1, state.Players.First(p => p.Id == "a").FinishPlace);
	}

	[Fact]
	public async Task A_single_round_game_ends_on_the_first_emptied_hand()
	{
		var (state, context) = Game(
			rules: new SheddingRulesConfig { TargetScore = 0 },
			hands: new[] { ("a", new[] { "red-7" }), ("b", new[] { "blue-7" }) });

		var response = await Play(context, state, "a", "red-7#0");

		Assert.True(Assert.IsType<SheddingActionResponse>(response).GameEnded);
	}

	// ── Leaving ───────────────────────────────────────────────────────────────

	[Fact]
	public async Task A_leaver_mid_reverse_hands_the_turn_to_the_RIGHT_neighbour()
	{
		var (state, context) = Game(hands: new[]
		{
			("a", new[] { "red-7" }),
			("b", new[] { "blue-7" }),
			("c", new[] { "red-5" }),
		});
		state.Shedding!.Direction = -1; // a reverse is in force
		state.CurrentTurn = "b";

		// b abandons through the SHARED leave flow.
		var outcome = await new CorroServer.Services.Rules.CorroRulebook()
			.DeclareBankruptcyAsync(state.Players.First(p => p.Id == "b"), context);

		Assert.False(outcome.GameOver);
		Assert.True(state.Shedding!.Seats[1].Retired);
		// Direction-aware: -1 from b is a — NOT c, which the generic +1 pass would pick.
		Assert.Equal("a", state.CurrentTurn);
		var announcer = TestFixtures.Announcer(context);
		Assert.True(announcer.Has(AnnouncementAudience.AllExcept, "b", "game.player_retired"));
	}

	// ── Last-card declaration (house rule) ─────────────────────────────────────

	[Fact]
	public async Task Playing_down_to_one_exposes_a_human_until_the_next_action_closes_the_window()
	{
		var rules = new SheddingRulesConfig { LastCardCall = true };
		var (state, context) = Game(rules, hands: new[]
		{
			("a", new[] { "red-7", "blue-5" }),
			("b", new[] { "red-5", "blue-7", "blue-5" }), // three cards: b won't drop to one
        });

		await Play(context, state, "a", "red-7#0"); // a → one card, undeclared
		Assert.Equal("a", state.Shedding!.PendingLastCardCall);

		await Play(context, state, "b", "red-5#0"); // the next action closes the window: a is safe
		Assert.Null(state.Shedding!.PendingLastCardCall);
	}

	[Fact]
	public async Task DeclareLastCard_clears_the_hook_and_speaks_it()
	{
		var rules = new SheddingRulesConfig { LastCardCall = true };
		var (state, context) = Game(rules, hands: new[]
		{
			("a", new[] { "red-7", "blue-5" }),
			("b", new[] { "red-5" }),
		});

		await Play(context, state, "a", "red-7#0");
		var declare = await SheddingTurnFlow.DeclareLastCardAsync(state.Players[0], context);

		Assert.False(Assert.IsType<SheddingActionResponse>(declare).TurnEnded); // off-turn, no pass
		Assert.Null(state.Shedding!.PendingLastCardCall);
		Assert.Contains("game.shedding_last_card_called", Keys(context));
	}

	[Fact]
	public async Task CatchLastCard_makes_the_exposed_player_draw_and_speaks_both_sides()
	{
		var rules = new SheddingRulesConfig { LastCardCall = true, LastCardPenalty = 2 };
		var (state, context) = Game(rules, hands: new[]
		{
			("a", new[] { "red-7", "blue-5" }),
			("b", new[] { "red-5" }),
		});
		for (var i = 0; i < 4; i++)
		{
			state.Shedding!.DrawPile.Add(Inst("blue-5", 20 + i));
		}

		SheddingRulebook.SyncCounts(state.Shedding!);

		await Play(context, state, "a", "red-7#0"); // a → one card, undeclared
		await SheddingTurnFlow.CatchLastCardAsync(state.Players[1], context, new ScriptedRandomSource());

		Assert.Null(state.Shedding!.PendingLastCardCall);
		Assert.Equal(3, SheddingRulebook.SeatOf(state.Shedding!, "a").Hand.Count); // 1 + the 2 penalty
		var announcer = TestFixtures.Announcer(context);
		Assert.True(announcer.Has(AnnouncementAudience.Player, "b", "game.shedding_last_card_caught_self"));
		Assert.True(announcer.Has(AnnouncementAudience.Player, "a", "game.shedding_last_card_caught_victim"));
	}

	[Fact]
	public async Task A_bot_playing_down_to_one_declares_automatically_and_is_never_exposed()
	{
		var rules = new SheddingRulesConfig { LastCardCall = true };
		var (state, context) = Game(rules, hands: new[]
		{
			("bot", new[] { "red-7", "blue-5" }),
			("b", new[] { "red-5" }),
		});
		state.Players[0] = state.Players[0] with { IsBot = true };

		await Play(context, state, "bot", "red-7#0");

		Assert.Null(state.Shedding!.PendingLastCardCall);                    // correct play: never on the hook
		Assert.Contains("game.shedding_last_card_called", Keys(context)); // It declared aloud.
	}
}
