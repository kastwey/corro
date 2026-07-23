using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Commands;
using CorroServer.Services.Corro.Families;
using CorroServer.Services.Rules;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// The draft flow on top of the pure rulebook: the secrecy of the commit (identity
/// ToPlayer, the table only hears WHO picked), the silent re-pick, the cascade the LAST
/// pick fires (reveal → pass → round scoring → redeal → dessert race → game over), and
/// the refusals. The server owns the voice: every line asserted here is the game's audio.
/// </summary>
public class DraftTurnFlowTests
{
	private static List<DraftCardDef> Deck() => new()
	{
		new() { Id = "bite1", Type = "points", Value = 1, Count = 10, NameKey = "c.bite1" },
		new() { Id = "bite3", Type = "points", Value = 3, Count = 10, NameKey = "c.bite3" },
		new() { Id = "sauce", Type = "multiplier", Factor = 3, Count = 4, NameKey = "c.sauce" },
		new() { Id = "caramel-custard", Type = "dessert", Count = 8, NameKey = "c.flan" },
		new() { Id = "stick", Type = "extra", Count = 4, NameKey = "c.stick" },
	};

	private static DraftCardInstance Inst(string cardId, int n = 0)
		=> new() { InstanceId = $"{cardId}#{n}", CardId = cardId };

	/// <summary>A running draft game with hand-built hands (no dealing).</summary>
	private static (GameState State, GameContext Context) Game(
		DraftRulesConfig? rules = null, params (string Id, string[] Cards)[] hands)
	{
		var draft = new DraftState();
		foreach (var (id, cards) in hands)
		{
			var seat = new DraftSeatState { PlayerId = id };
			for (var i = 0; i < cards.Length; i++)
			{
				seat.Hand.Add(Inst(cards[i], i));
			}

			draft.Seats.Add(seat);
		}
		DraftRulebook.SyncCounts(draft);

		var state = TestFixtures.NewState(hands.Select(h => TestFixtures.NewPlayer(h.Id)).ToList());
		state.GameType = "draft";
		state.CurrentTurn = null; // simultaneous family: nobody holds the turn
		state.Draft = draft;
		state.DraftDeck = Deck();
		state.DraftRules = rules ?? new DraftRulesConfig();

		var baseContext = TestFixtures.NewContext(state);
		var context = new GameContext
		{
			GameState = state,
			Helper = baseContext.Helper,
			Settings = baseContext.Settings,
			FamilyRuntime = new DraftRuntime(DraftRulebook.Catalog(Deck()), Deck(), state.DraftRules!),
			Announce = baseContext.Announce,
			Announcer = baseContext.Announcer,
			Presenter = baseContext.Presenter,
		};
		return (state, context);
	}

	private static Task<ServerResponse> Pick(GameContext context, GameState state, string playerId,
		string instanceId, string? secondInstanceId = null)
		=> DraftTurnFlow.PickAsync(
			new DraftPickCommand { PlayerId = playerId, InstanceId = instanceId, SecondInstanceId = secondInstanceId },
			state.Players.First(p => p.Id == playerId), context);

	private static string[] Keys(GameContext ctx)
		=> TestFixtures.Announcer(ctx).Sent.Select(d => d.Key).ToArray();

	// ── The commit ────────────────────────────────────────────────────────────

	[Fact]
	public async Task A_pick_speaks_its_identity_to_the_picker_alone()
	{
		var (state, context) = Game(hands: new[] { ("a", new[] { "bite1", "caramel-custard" }), ("b", new[] { "bite3", "caramel-custard" }) });

		var response = await Pick(context, state, "a", "bite1#0");

		var action = Assert.IsType<DraftActionResponse>(response);
		Assert.Equal("pick", action.Action);
		Assert.False(action.Revealed);

		var announcer = TestFixtures.Announcer(context);
		Assert.True(announcer.Has(AnnouncementAudience.Player, "a", "game.draft_picked_self"));
		Assert.True(announcer.Has(AnnouncementAudience.AllExcept, "a", "game.draft_picked"));
		// The own-pick line carries actorId so the client voices it ASSERTIVELY, ahead of the
		// screen reader's reading of the newly-focused card (the picked one just left the hand).
		var mine = announcer.Sent.Single(d => d.Key == "game.draft_picked_self");
		Assert.Equal("a", mine.Vars["actorId"]);
		Assert.Equal("card-pick", mine.Vars["visualKind"]);
		Assert.Equal("bite1", mine.Vars["visualCardId"]);
		// The public line never carries the card: WHO picked is public, WHAT is not.
		var table = announcer.Sent.Single(d => d.Key == "game.draft_picked");
		Assert.False(table.Vars.ContainsKey("card"));
		Assert.False(table.Vars.ContainsKey("visualCardId"));
	}

	[Fact]
	public async Task A_repick_is_private_and_replaces_the_choice()
	{
		var (state, context) = Game(hands: new[] { ("a", new[] { "bite1", "caramel-custard" }), ("b", new[] { "bite3", "caramel-custard" }) });
		await Pick(context, state, "a", "bite1#0");

		var response = await Pick(context, state, "a", "caramel-custard#1");

		Assert.Equal("repick", Assert.IsType<DraftActionResponse>(response).Action);
		var announcer = TestFixtures.Announcer(context);
		Assert.True(announcer.Has(AnnouncementAudience.Player, "a", "game.draft_repicked_self"));
		// The table heard ONE "has picked" — the re-pick changed nothing for them.
		Assert.Single(announcer.Sent, d => d.Key == "game.draft_picked");
		Assert.Equal("caramel-custard#1", state.Draft!.Seats[0].CommittedInstanceId);
	}

	[Fact]
	public async Task Picks_are_refused_when_the_card_is_not_in_the_hand()
	{
		var (state, context) = Game(hands: new[] { ("a", new[] { "bite1" }), ("b", new[] { "bite3" }) });

		var response = await Pick(context, state, "a", "ghost#9");

		Assert.Equal("DRAFT_ILLEGAL_PICK", Assert.IsType<ErrorResponse>(response).Code);
	}

	// ── The cascade from the last pick ────────────────────────────────────────

	[Fact]
	public async Task The_last_pick_reveals_everything_and_passes_the_hands()
	{
		var (state, context) = Game(hands: new[]
		{
			("a", new[] { "bite1", "caramel-custard" }),
			("b", new[] { "bite3", "caramel-custard" }),
		});

		await Pick(context, state, "a", "bite1#0");
		var response = await Pick(context, state, "b", "bite3#0");

		var action = Assert.IsType<DraftActionResponse>(response);
		Assert.True(action.Revealed);
		Assert.False(action.RoundEnded);

		var announcer = TestFixtures.Announcer(context);
		var keys = Keys(context);
		Assert.Contains("game.draft_all_picked", keys);
		Assert.Equal(2, keys.Count(k => k == "game.draft_revealed"));
		Assert.Contains("game.draft_hands_passed", keys);
		// The plain reveal names each card publicly — but goes to the OTHERS only: the picker
		// already heard "you take X", so echoing "you serve X" would be redundant chatter.
		var revealed = announcer.Sent.First(d => d.Key == "game.draft_revealed");
		Assert.Equal("c.bite1", revealed.Vars["card"]);
		Assert.Equal("a", revealed.Vars["actorId"]);
		Assert.Equal("card-reveal-table", revealed.Vars["visualKind"]);
		Assert.Equal("bite1", revealed.Vars["visualCardId"]);
		Assert.Equal("hands-pass", announcer.Sent.Single(d => d.Key == "game.draft_hands_passed").Vars["visualKind"]);
		Assert.True(announcer.Has(AnnouncementAudience.AllExcept, "a", "game.draft_revealed"));
		Assert.False(announcer.Has(AnnouncementAudience.Player, "a", "game.draft_revealed"),
			"the picker does NOT hear their own plain reveal");
	}

	[Fact]
	public async Task A_points_card_landing_on_a_waiting_multiplier_is_voiced_boosted()
	{
		var (state, context) = Game(hands: new[]
		{
			("a", new[] { "bite3", "caramel-custard" }),
			("b", new[] { "bite1", "caramel-custard" }),
		});
		state.Draft!.Seats[0].Table.Add(new DraftTableSlot { Card = Inst("sauce", 9) });

		await Pick(context, state, "a", "bite3#0");
		await Pick(context, state, "b", "bite1#0");

		var boosted = TestFixtures.Announcer(context).Sent.Single(d => d.Key == "game.draft_revealed_boosted");
		Assert.Equal("c.bite3", boosted.Vars["card"]);
		Assert.Equal("c.sauce", boosted.Vars["multiplier"]);
		Assert.Equal(3, boosted.Vars["factor"]);
	}

	[Fact]
	public async Task A_double_pick_names_both_cards_privately_and_voices_the_spent_extra()
	{
		var (state, context) = Game(hands: new[]
		{
			("a", new[] { "sauce", "bite3", "caramel-custard" }),
			("b", new[] { "bite1", "caramel-custard", "caramel-custard" }),
		});
		state.Draft!.Seats[0].Table.Add(new DraftTableSlot { Card = Inst("stick", 9) });

		await Pick(context, state, "a", "sauce#0", "bite3#1");
		var announcer = TestFixtures.Announcer(context);
		var mine = announcer.Sent.Single(d => d.Key == "game.draft_picked_two_self");
		Assert.Equal("c.sauce", mine.Vars["card"]);
		Assert.Equal("c.bite3", mine.Vars["card2"]);

		await Pick(context, state, "b", "bite1#0");

		var keys = Keys(context);
		// Both of a's cards revealed (the second boosted by the first), the spent extra
		// voiced, and the hands still pass in step.
		Assert.Contains("game.draft_revealed_boosted", keys);
		Assert.Contains("game.draft_extra_returned", keys);
		Assert.Contains("game.draft_hands_passed", keys);
		var returned = announcer.Sent.Single(d => d.Key == "game.draft_extra_returned");
		Assert.Equal("c.stick", returned.Vars["extra"]);
	}

	[Fact]
	public async Task A_second_card_without_an_extra_is_refused()
	{
		var (state, context) = Game(hands: new[]
		{
			("a", new[] { "sauce", "bite3" }),
			("b", new[] { "bite1", "caramel-custard" }),
		});

		var response = await Pick(context, state, "a", "sauce#0", "bite3#1");

		Assert.Equal("DRAFT_ILLEGAL_PICK", Assert.IsType<ErrorResponse>(response).Code);
	}

	[Fact]
	public async Task Emptied_hands_score_the_round_and_redeal_the_next()
	{
		var (state, context) = Game(
			rules: new DraftRulesConfig { Rounds = 2, HandSizeBase = 3 }, // 2 players → hands of 1
			hands: new[] { ("a", new[] { "bite3" }), ("b", new[] { "bite1" }) });
		// Stock the pile for round two's redeal (2 seats × 1 card).
		state.Draft!.DrawPile.Add(Inst("caramel-custard", 6));
		state.Draft!.DrawPile.Add(Inst("caramel-custard", 7));

		await Pick(context, state, "a", "bite3#0");
		var response = await Pick(context, state, "b", "bite1#0");

		var action = Assert.IsType<DraftActionResponse>(response);
		Assert.True(action.RoundEnded);
		Assert.False(action.GameEnded);

		var keys = Keys(context);
		Assert.Equal(2, keys.Count(k => k == "game.draft_round_scored"));
		Assert.Contains("game.draft_round_started", keys);
		Assert.Equal(2, state.Draft!.Round);
		Assert.All(state.Draft!.Seats, s => Assert.Single(s.Hand)); // round two dealt
		Assert.Equal(3, state.Draft!.Seats[0].Score);
		Assert.Equal(1, state.Draft!.Seats[1].Score);
	}

	[Fact]
	public async Task The_final_round_settles_desserts_and_ends_the_game()
	{
		var (state, context) = Game(
			rules: new DraftRulesConfig { Rounds = 1, HandSizeBase = 3 },
			hands: new[] { ("a", new[] { "caramel-custard" }), ("b", new[] { "bite3" }) });

		await Pick(context, state, "a", "caramel-custard#0");
		var response = await Pick(context, state, "b", "bite3#0");

		var action = Assert.IsType<DraftActionResponse>(response);
		Assert.True(action.GameEnded);
		Assert.True(state.IsGameOver);

		var keys = Keys(context);
		Assert.Contains("game.draft_dessert_bonus", keys);      // a's dessert pays…
		Assert.DoesNotContain("game.draft_dessert_penalty", keys); // …and 2-player spares b
		Assert.Contains("game.draft_final_score", keys);
		Assert.Contains("game.game_over", keys);

		// b: 3 points; a: 0 + 6 dessert bonus → a wins.
		Assert.Equal("a", state.WinnerId);
		Assert.Equal(1, state.Players.First(p => p.Id == "a").FinishPlace);
		Assert.Equal(2, state.Players.First(p => p.Id == "b").FinishPlace);
	}

	[Fact]
	public async Task Leaving_a_draft_game_speaks_RETIREMENT_and_folds_the_seat()
	{
		var (state, context) = Game(hands: new[]
		{
			("a", new[] { "bite1", "caramel-custard" }),
			("b", new[] { "bite3", "caramel-custard" }),
			("c", new[] { "caramel-custard", "caramel-custard" }),
		});
		await Pick(context, state, "a", "bite1#0");
		await Pick(context, state, "b", "bite3#0");

		// c abandons through the SHARED leave flow (the "Leave game" button).
		var outcome = await new CorroServer.Services.Rules.CorroRulebook()
			.DeclareBankruptcyAsync(state.Players.First(p => p.Id == "c"), context);

		Assert.False(outcome.GameOver);
		var announcer = TestFixtures.Announcer(context);
		// The family's wording: a retirement, never a bankruptcy that doesn't exist.
		Assert.True(announcer.Has(AnnouncementAudience.Player, "c", "game.player_retired_self"));
		Assert.True(announcer.Has(AnnouncementAudience.AllExcept, "c", "game.player_retired"));
		Assert.DoesNotContain(announcer.Sent, x => x.Key.StartsWith("game.player_bankrupt"));

		// The fold removed the last holdout: the trick revealed by itself — no stall.
		Assert.True(state.Draft!.Seats.Single(s => s.PlayerId == "c").Retired);
		Assert.Contains("game.draft_all_picked", Keys(context));
		Assert.Contains("game.draft_hands_passed", Keys(context));
		Assert.Equal(2, state.Draft!.Trick);
	}

	[Fact]
	public async Task Picks_are_refused_once_the_game_is_over()
	{
		var (state, context) = Game(hands: new[] { ("a", new[] { "bite1" }), ("b", new[] { "bite3" }) });
		state.IsGameOver = true;

		var response = await Pick(context, state, "a", "bite1#0");

		Assert.Equal("GAME_OVER", Assert.IsType<ErrorResponse>(response).Code);
	}
}
