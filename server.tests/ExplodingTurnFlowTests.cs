using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Commands;
using CorroServer.Services.Corro.Families;
using CorroServer.Services.Rules;

namespace CorroServer.Tests;

/// <summary>
/// The exploding flow on top of the pure rulebook: an action opens the Nope window (the actor
/// is named, the card is spent at once), the window resolves by parity (effect if even, fizzle
/// if odd), a Nope restarts it, the draw ends the turn — a bomb defused-and-tucked, or an
/// unlucky bomb that eliminates and hands the win to the last player standing.
/// </summary>
public class ExplodingTurnFlowTests
{
	private static List<ExplodingCardDef> Deck() => new()
	{
		new() { Id = "bomb", Type = "bomb", Count = 3, NameKey = "c.bomb" },
		new() { Id = "defuse", Type = "defuse", Count = 4, NameKey = "c.defuse" },
		new() { Id = "skip", Type = "skip", Count = 4, NameKey = "c.skip" },
		new() { Id = "attack", Type = "attack", Count = 4, NameKey = "c.attack" },
		new() { Id = "shuffle", Type = "shuffle", Count = 2, NameKey = "c.shuffle" },
		new() { Id = "see", Type = "seeFuture", Count = 4, NameKey = "c.see" },
		new() { Id = "nope", Type = "nope", Count = 4, NameKey = "c.nope" },
		new() { Id = "favor", Type = "favor", Count = 2, NameKey = "c.favor" },
		new() { Id = "taco", Type = "cat", Count = 6, NameKey = "c.taco" },
	};

	private static ExplodingCardInstance Inst(string cardId, int n = 0)
		=> new() { InstanceId = $"{cardId}#{n}", CardId = cardId };

	/// <summary>A running exploding game with hand-built hands and an empty pile (each test
	/// stacks the draws it needs). Player "a" leads.</summary>
	private static (GameState State, GameContext Context) Game(params (string Id, string[] Cards)[] hands)
	{
		var exploding = new ExplodingState();
		foreach (var (id, cards) in hands)
		{
			var seat = new ExplodingSeatState { PlayerId = id };
			for (var i = 0; i < cards.Length; i++)
			{
				seat.Hand.Add(Inst(cards[i], i));
			}

			exploding.Seats.Add(seat);
		}
		ExplodingRulebook.SyncCounts(exploding);

		var state = TestFixtures.NewState(hands.Select(h => TestFixtures.NewPlayer(h.Id)).ToList());
		state.GameType = "exploding";
		state.CurrentTurn = hands[0].Id;
		state.Exploding = exploding;
		state.ExplodingDeck = Deck();
		state.ExplodingRules = new ExplodingRulesConfig();

		var baseContext = TestFixtures.NewContext(state);
		var context = new GameContext
		{
			GameState = state,
			Helper = baseContext.Helper,
			Settings = baseContext.Settings,
			FamilyRuntime = new ExplodingRuntime(
				ExplodingRulebook.Catalog(Deck()), Deck(), state.ExplodingRules!),
			Announce = baseContext.Announce,
			Announcer = baseContext.Announcer,
			Presenter = baseContext.Presenter,
		};
		return (state, context);
	}

	private static Player P(GameState st, string id) => st.Players.First(p => p.Id == id);

	private static Task<ServerResponse> Play(GameContext ctx, GameState st, string id, string instanceId)
		=> ExplodingTurnFlow.PlayAsync(new ExplodingPlayCommand { PlayerId = id, InstanceId = instanceId }, P(st, id), ctx);

	private static Task<ServerResponse> Nope(GameContext ctx, GameState st, string id, string instanceId)
		=> ExplodingTurnFlow.NopeAsync(new ExplodingNopeCommand { PlayerId = id, InstanceId = instanceId }, P(st, id), ctx);

	private static Task<ServerResponse> Resolve(GameContext ctx)
		=> ExplodingTurnFlow.ResolveWindowAsync(ctx, new ScriptedRandomSource());

	private static Task<ServerResponse> ResolveWith(GameContext ctx, IRandomSource random)
		=> ExplodingTurnFlow.ResolveWindowAsync(ctx, random);

	private static Task<ServerResponse> PlayTargeted(
		GameContext ctx, GameState st, string id, string instanceId, string targetId, string? second = null)
		=> ExplodingTurnFlow.PlayAsync(new ExplodingPlayCommand
		{
			PlayerId = id,
			InstanceId = instanceId,
			TargetId = targetId,
			SecondInstanceId = second,
		}, P(st, id), ctx);

	private static Task<ServerResponse> Give(GameContext ctx, GameState st, string id, string instanceId)
		=> ExplodingTurnFlow.GiveAsync(new ExplodingGiveCommand { PlayerId = id, InstanceId = instanceId }, P(st, id), ctx);

	private static Task<ServerResponse> Draw(GameContext ctx, GameState st, string id)
		=> ExplodingTurnFlow.DrawAsync(P(st, id), ctx, new ScriptedRandomSource());

	private static string[] Keys(GameContext ctx)
		=> TestFixtures.Announcer(ctx).Sent.Select(d => d.Key).ToArray();

	// ── Playing an action opens the window ────────────────────────────────────

	[Fact]
	public async Task Playing_an_action_names_the_actor_spends_the_card_and_opens_the_window()
	{
		var (state, context) = Game(("a", new[] { "skip", "taco" }), ("b", new[] { "taco" }));

		var response = await Play(context, state, "a", "skip#0");

		Assert.True(Assert.IsType<ExplodingActionResponse>(response).WindowOpen);
		Assert.NotNull(state.Exploding!.PendingAction);
		Assert.Equal("a", state.Exploding!.PendingAction!.ActorId);
		Assert.Equal("a", state.CurrentTurn); // the turn does not pass while the window is open
		Assert.DoesNotContain(state.Exploding!.Seats[0].Hand, c => c.InstanceId == "skip#0"); // spent
		Assert.Contains("skip#0", state.Exploding!.DiscardPile.Select(c => c.InstanceId));
		var played = TestFixtures.Announcer(context).Sent.Single(d => d.Key == "game.exploding_played");
		Assert.Equal("c.skip", played.Vars["card"]);
	}

	// ── Resolution by Nope parity ──────────────────────────────────────────────

	[Fact]
	public async Task An_unnoped_skip_resolves_and_passes_the_turn()
	{
		var (state, context) = Game(("a", new[] { "skip" }), ("b", new[] { "taco" }));
		await Play(context, state, "a", "skip#0");

		var response = await Resolve(context);

		Assert.True(Assert.IsType<ExplodingActionResponse>(response).TurnEnded);
		Assert.Null(state.Exploding!.PendingAction);
		Assert.Equal("b", state.CurrentTurn);
		Assert.Contains("game.exploding_skipped", Keys(context));
	}

	[Fact]
	public async Task A_single_nope_cancels_the_action_and_the_turn_stays_put()
	{
		var (state, context) = Game(("a", new[] { "skip" }), ("b", new[] { "nope" }));
		await Play(context, state, "a", "skip#0");

		await Nope(context, state, "b", "nope#0");
		Assert.Equal(1, state.Exploding!.PendingAction!.NopeCount); // window still open, parity flipped

		var response = await Resolve(context);

		Assert.False(Assert.IsType<ExplodingActionResponse>(response).TurnEnded);
		Assert.Equal("a", state.CurrentTurn); // the skip never happened
		Assert.Contains("game.exploding_action_cancelled", Keys(context));
		Assert.DoesNotContain("game.exploding_skipped", Keys(context));
	}

	[Fact]
	public async Task A_counter_nope_restores_the_action()
	{
		var (state, context) = Game(("a", new[] { "skip", "nope" }), ("b", new[] { "nope" }));
		await Play(context, state, "a", "skip#0");
		await Nope(context, state, "b", "nope#0"); // 1 → cancelled
		await Nope(context, state, "a", "nope#1"); // 2 → restored

		await Resolve(context);

		Assert.Equal("b", state.CurrentTurn); // the skip stands after the counter-nope
		Assert.Contains("game.exploding_skipped", Keys(context));
	}

	[Fact]
	public async Task An_attack_ends_the_turn_and_the_next_player_owes_the_stack()
	{
		var (state, context) = Game(("a", new[] { "attack" }), ("b", new[] { "taco" }));
		await Play(context, state, "a", "attack#0");

		await Resolve(context);

		Assert.Equal("b", state.CurrentTurn);
		Assert.Equal(2, state.Exploding!.DrawsOwed); // the classic "take two turns"
		var attacked = TestFixtures.Announcer(context).Sent.Single(d => d.Key == "game.exploding_attacked");
		Assert.Equal("attack", attacked.Vars["visualKind"]);
		Assert.Equal("a", attacked.Vars["visualSourcePlayerId"]);
		Assert.Equal("b", attacked.Vars["visualTargetPlayerId"]);
		Assert.Equal(2, attacked.Vars["visualCount"]);
	}

	[Fact]
	public async Task See_the_future_whispers_the_top_cards_to_the_peeker_alone()
	{
		var (state, context) = Game(("a", new[] { "see" }), ("b", new[] { "taco" }));
		state.Exploding!.DrawPile.AddRange(new[] { Inst("bomb"), Inst("taco", 1), Inst("skip", 1) }); // next: skip
		ExplodingRulebook.SyncCounts(state.Exploding!);
		await Play(context, state, "a", "see#0");

		await Resolve(context);

		var announcer = TestFixtures.Announcer(context);
		var future = announcer.Sent.Single(d =>
			d.Audience == AnnouncementAudience.Player && d.PlayerId == "a"
			&& d.Key == "game.exploding_future_3");
		Assert.Equal("cards-peek", future.Vars["visualKind"]);
		Assert.Equal("skip", future.Vars["visualCard1Id"]);
		Assert.Equal("taco", future.Vars["visualCard2Id"]);
		Assert.Equal("bomb", future.Vars["visualCard3Id"]);
		Assert.Contains("game.exploding_saw_future", Keys(context));
		Assert.Equal("a", state.CurrentTurn); // peeking does not end the turn
	}

	// ── Drawing ────────────────────────────────────────────────────────────────

	[Fact]
	public async Task Drawing_an_ordinary_card_takes_it_privately_and_passes_the_turn()
	{
		var (state, context) = Game(("a", new[] { "skip" }), ("b", new[] { "taco" }));
		state.Exploding!.DrawPile.Add(Inst("taco", 5)); // next draw
		ExplodingRulebook.SyncCounts(state.Exploding!);

		var response = await Draw(context, state, "a");

		Assert.True(Assert.IsType<ExplodingActionResponse>(response).TurnEnded);
		Assert.Contains("taco#5", state.Exploding!.Seats[0].Hand.Select(c => c.InstanceId));
		Assert.Equal("b", state.CurrentTurn);
		var announcer = TestFixtures.Announcer(context);
		var mine = announcer.Sent.Single(d => d.Key == "game.exploding_drew_self");
		Assert.Equal(AnnouncementAudience.Player, mine.Audience); // identity private
		// Marks this as the drawer's own batch: the client writes the announcement before
		// applying the state that adds the new row to the hand.
		Assert.Equal("a", mine.Vars["actorId"]);
		Assert.Equal("card-draw", mine.Vars["visualKind"]);
		Assert.Equal("a", mine.Vars["visualTargetPlayerId"]);
		Assert.Equal("taco", mine.Vars["visualCardId"]);
	}

	[Fact]
	public async Task Drawing_a_bomb_with_a_defuse_holds_it_for_reinsertion_then_tucks_it()
	{
		var (state, context) = Game(("a", new[] { "defuse" }), ("b", new[] { "taco" }));
		state.Exploding!.DrawPile.AddRange(new[] { Inst("taco", 5), Inst("bomb") }); // bomb on top
		ExplodingRulebook.SyncCounts(state.Exploding!);

		var drew = await Draw(context, state, "a");
		Assert.True(Assert.IsType<ExplodingActionResponse>(drew).AwaitingReinsert);
		Assert.NotNull(state.Exploding!.PendingBomb);
		Assert.DoesNotContain(state.Exploding!.Seats[0].Hand, c => c.CardId == "defuse"); // the defuse is spent
		Assert.Contains("game.exploding_drew_bomb_defused", Keys(context));

		var tucked = await ExplodingTurnFlow.DefuseReinsertAsync(
			new ExplodingDefuseCommand { PlayerId = "a", Depth = 0 }, P(state, "a"), context);

		Assert.True(Assert.IsType<ExplodingActionResponse>(tucked).TurnEnded);
		Assert.Null(state.Exploding!.PendingBomb);
		Assert.Equal("bomb", state.Exploding!.DrawPile[^1].CardId); // depth 0 = back on top
		Assert.Equal("b", state.CurrentTurn);
		var tuckedLine = TestFixtures.Announcer(context).Sent.Single(d =>
			d.Audience == AnnouncementAudience.Player && d.PlayerId == "a"
			&& d.Key == "game.exploding_tucked_self");
		Assert.Equal("card-tuck", tuckedLine.Vars["visualKind"]);
		Assert.Equal("bomb", tuckedLine.Vars["visualCardId"]);
	}

	[Fact]
	public async Task Drawing_a_bomb_without_a_defuse_eliminates_and_the_last_one_wins()
	{
		var (state, context) = Game(("a", new[] { "taco" }), ("b", new[] { "taco" }));
		state.Exploding!.DrawPile.Add(Inst("bomb")); // a draws it, holds no defuse
		ExplodingRulebook.SyncCounts(state.Exploding!);

		var response = await Draw(context, state, "a");

		var typed = Assert.IsType<ExplodingActionResponse>(response);
		Assert.True(typed.Exploded);
		Assert.True(typed.GameEnded);
		Assert.Equal(PlayerStatus.Eliminated, P(state, "a").Status);
		Assert.Equal(2, P(state, "a").FinishPlace); // out first of two → 2nd place
		Assert.True(state.Exploding!.Seats.First(s => s.PlayerId == "a").Retired);
		Assert.True(state.IsGameOver);
		Assert.Equal("b", state.WinnerId);
		Assert.Contains("game.exploding_exploded", Keys(context));
		Assert.Contains("game.game_over", Keys(context));
	}

	// ── Favor and cat pairs ──────────────────────────────────────────────────────

	[Fact]
	public async Task Favor_waits_for_the_target_to_give_a_card_which_then_moves()
	{
		var (state, context) = Game(("a", new[] { "favor" }), ("b", new[] { "taco", "skip" }));
		await PlayTargeted(context, state, "a", "favor#0", "b");
		await Resolve(context);

		Assert.NotNull(state.Exploding!.PendingFavor);
		Assert.Equal("a", state.Exploding!.PendingFavor!.RequesterId);
		Assert.Equal("b", state.Exploding!.PendingFavor!.TargetId);
		Assert.True(TestFixtures.Announcer(context).Has(
			AnnouncementAudience.Player, "b", "game.exploding_favor_asked_victim"));
		Assert.True(TestFixtures.Announcer(context).Has(
			AnnouncementAudience.Player, "a", "game.exploding_favor_asked_self"));

		// The requester can't act while the favor is pending: b must give first.
		Assert.Equal("EXPLODING_ILLEGAL",
			Assert.IsType<ErrorResponse>(await Draw(context, state, "a")).Code);

		await Give(context, state, "b", "skip#1");
		Assert.Null(state.Exploding!.PendingFavor);
		Assert.Contains("skip#1",
			state.Exploding!.Seats.First(s => s.PlayerId == "a").Hand.Select(c => c.InstanceId));
		Assert.DoesNotContain("skip#1",
			state.Exploding!.Seats.First(s => s.PlayerId == "b").Hand.Select(c => c.InstanceId));
		var announcer = TestFixtures.Announcer(context);
		Assert.True(announcer.Has(
			AnnouncementAudience.Player, "a", "game.exploding_favor_got_self"));
		Assert.Equal("b", announcer.Sent.Single(d => d.Key == "game.exploding_favor_gave_self").Vars["actorId"]);
		var got = announcer.Sent.Single(d => d.Key == "game.exploding_favor_got_self");
		Assert.Equal("card-transfer", got.Vars["visualKind"]);
		Assert.Equal("b", got.Vars["visualSourcePlayerId"]);
		Assert.Equal("a", got.Vars["visualTargetPlayerId"]);
		Assert.Equal("skip", got.Vars["visualCardId"]);
	}

	[Fact]
	public async Task A_cat_pair_steals_a_random_card_from_the_target()
	{
		var (state, context) = Game(("a", new[] { "taco", "taco" }), ("b", new[] { "skip" }));

		await PlayTargeted(context, state, "a", "taco#0", "b", "taco#1");
		Assert.Equal("b", state.Exploding!.PendingAction!.TargetId);
		// The distinct play key still maps to the universal rising Nope-window warning. The
		// steal cue belongs to the successful result after that window closes.
		var played = TestFixtures.Announcer(context).Sent
			.Single(d => d.Key == "game.exploding_played_cat_pair");
		Assert.Equal("c.taco", played.Vars["card"]);
		Assert.Equal("b", played.Vars["target"]);
		Assert.DoesNotContain("game.exploding_played", Keys(context));
		Assert.DoesNotContain(state.Exploding.Seats.First(s => s.PlayerId == "a").Hand,
			c => c.CardId == "taco");
		Assert.Equal(2, state.Exploding.DiscardPile.Count(c => c.CardId == "taco"));
		// Steal index 0 of b's one-card hand.
		await ResolveWith(context, new ScriptedRandomSource().Enqueue(0));

		Assert.Contains("skip#0",
			state.Exploding!.Seats.First(s => s.PlayerId == "a").Hand.Select(c => c.InstanceId));
		Assert.Empty(state.Exploding!.Seats.First(s => s.PlayerId == "b").Hand);
		var announcer = TestFixtures.Announcer(context);
		Assert.True(announcer.Has(AnnouncementAudience.Player, "a", "game.exploding_stole_self"));
		Assert.True(announcer.Has(AnnouncementAudience.Player, "b", "game.exploding_stole_victim"));
		Assert.Equal("a", announcer.Sent.Single(d => d.Key == "game.exploding_stole_self").Vars["actorId"]);
	}

	[Fact]
	public async Task A_nope_cancels_a_cat_pair_before_it_can_steal()
	{
		var (state, context) = Game(
			("a", new[] { "taco", "taco" }),
			("b", new[] { "nope", "skip" }));

		await PlayTargeted(context, state, "a", "taco#0", "b", "taco#1");
		await Nope(context, state, "b", "nope#0");
		await Resolve(context); // no scripted random value: a cancelled pair must never steal

		Assert.Null(state.Exploding!.PendingAction);
		Assert.Empty(state.Exploding.Seats.First(s => s.PlayerId == "a").Hand);
		Assert.Contains("skip#1",
			state.Exploding.Seats.First(s => s.PlayerId == "b").Hand.Select(c => c.InstanceId));
		Assert.Contains("game.exploding_action_cancelled", Keys(context));
		Assert.DoesNotContain(Keys(context), key => key.StartsWith("game.exploding_stole"));
	}

	[Fact]
	public async Task A_lone_cat_or_a_bad_target_is_refused()
	{
		var (state, context) = Game(("a", new[] { "taco", "favor" }), ("b", new[] { "skip" }));

		// A single cat with no matching pair partner.
		Assert.Equal("EXPLODING_ILLEGAL",
			Assert.IsType<ErrorResponse>(await Play(context, state, "a", "taco#0")).Code);
		// A favor at yourself.
		Assert.Equal("EXPLODING_ILLEGAL",
			Assert.IsType<ErrorResponse>(await PlayTargeted(context, state, "a", "favor#1", "a")).Code);
		Assert.Null(state.Exploding!.PendingAction); // neither opened a window
	}
}
