using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Corro.Families;
using CorroServer.Services.Rules;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// The per-family LEAVE folds (OnPlayerRetiredAsync, run by the shared leave flow BEFORE
/// the turn passes): assembly returns the leaver's hand and rack to the face-down
/// discards and stops targeting them; journey discards the member's hand, keeps the team
/// alive while anyone remains, silently declines a coup waiting on the leaver and
/// releases the draw flag; race sends the leaver's pieces home and clears the choices
/// and bonus chains that would otherwise freeze the game on them. (The draft fold lives
/// with its flow in DraftTurnFlowTests.)
/// </summary>
public class FamilyRetirementTests
{
	// ── Assembly ──────────────────────────────────────────────────────────────

	private static AssemblyCardInstance AInst(string cardId, int n = 0)
		=> new() { InstanceId = $"{cardId}#{n}", CardId = cardId };

	private static readonly List<AssemblyCardDef> AssemblyDeck = new()
	{
		new() { Id = "p-red", Type = "piece", Color = "red", Count = 5, NameKey = "c.p-red" },
		new() { Id = "a-red", Type = "attack", Color = "red", Count = 4, NameKey = "c.a-red" },
		new() { Id = "r-red", Type = "remedy", Color = "red", Count = 4, NameKey = "c.r-red" },
		new() { Id = "s-fullswap", Type = "special", SpecialKind = "fullSwap", Count = 1, NameKey = "c.s-fullswap" },
	};

	[Fact]
	public void Assembly_retire_returns_hand_and_rack_to_the_facedown_discards()
	{
		var leaver = new AssemblySeatState
		{
			PlayerId = "c",
			Hand = { AInst("r-red", 1) },
			Slots =
			{
				new AssemblySlot
				{
					Color = "red", Piece = AInst("p-red"),
					Afflictions = { AInst("a-red") }, Shields = { AInst("r-red") },
				},
			},
		};
		var state = new AssemblyState { Seats = { new AssemblySeatState { PlayerId = "a" }, leaver } };

		AssemblyRulebook.Retire(state, "c");

		Assert.True(leaver.Retired);
		Assert.Empty(leaver.Hand);
		Assert.Empty(leaver.Slots);
		// Hand + piece + affliction + shield: everything recirculates via the reshuffle.
		Assert.Equal(4, state.DiscardPile.Count);
		Assert.Equal(4, state.DiscardCount);
	}

	[Fact]
	public void Assembly_fullSwap_refuses_a_retired_target()
	{
		var catalog = AssemblyRulebook.Catalog(AssemblyDeck);
		var me = new AssemblySeatState { PlayerId = "a", Hand = { AInst("s-fullswap") } };
		var ghost = new AssemblySeatState { PlayerId = "c", Retired = true };
		var state = new AssemblyState { Seats = { me, ghost } };

		var check = AssemblyRulebook.CanPlay(
			catalog["s-fullswap"], me, ghost, null, null, state, catalog);

		Assert.False(check.Ok);
		Assert.Equal("game.assembly_needs_target", check.ReasonKey);
	}

	[Fact]
	public async Task Assembly_hook_folds_the_seat_through_the_family_registry()
	{
		var state = TestFixtures.NewState(new[] { TestFixtures.NewPlayer("a"), TestFixtures.NewPlayer("c") });
		state.GameType = "assembly";
		state.Assembly = new AssemblyState
		{
			Seats =
			{
				new AssemblySeatState { PlayerId = "a" },
				new AssemblySeatState { PlayerId = "c", Hand = { AInst("p-red") } },
			},
		};
		var context = TestFixtures.NewContext(state);

		await GameFamilies.For("assembly").OnPlayerRetiredAsync(
			state.Players.First(p => p.Id == "c"), context);

		Assert.True(state.Assembly.Seats[1].Retired);
		Assert.Single(state.Assembly.DiscardPile);
	}

	// ── Journey ───────────────────────────────────────────────────────────────

	private static JourneyCardInstance JInst(string cardId, int n = 0)
		=> new() { InstanceId = $"{cardId}#{n}", CardId = cardId };

	private static GameState JourneyGame(params JourneySeatState[] seats)
	{
		var players = seats.SelectMany(s => s.Members)
			.Select(m => TestFixtures.NewPlayer(m.PlayerId)).ToList();
		var state = TestFixtures.NewState(players);
		state.GameType = "journey";
		state.Journey = new JourneyState { Seats = seats.ToList() };
		return state;
	}

	[Fact]
	public async Task Journey_a_TEAM_keeps_playing_until_its_last_member_leaves()
	{
		var team = new JourneySeatState
		{
			PlayerId = "A",
			Members =
			{
				new JourneyMemberState { PlayerId = "A", Hand = { JInst("d25", 1) } },
				new JourneyMemberState { PlayerId = "C", Hand = { JInst("d25", 2) } },
			},
		};
		var state = JourneyGame(team, new JourneySeatState
		{
			PlayerId = "B",
			Members = { new JourneyMemberState { PlayerId = "B" } },
		});
		var context = TestFixtures.NewContext(state);
		var family = GameFamilies.For("journey");

		// A leaves: their hand goes face-up to the discards, but C still drives the seat.
		state.Players.First(p => p.Id == "A").IsBankrupt = true;
		await family.OnPlayerRetiredAsync(state.Players.First(p => p.Id == "A"), context);
		Assert.False(team.Retired);
		Assert.Empty(team.Members[0].Hand);
		Assert.Single(state.Journey!.DiscardPile);

		// C leaves too: nobody drives — the seat retires and stops being a target.
		state.Players.First(p => p.Id == "C").IsBankrupt = true;
		await family.OnPlayerRetiredAsync(state.Players.First(p => p.Id == "C"), context);
		Assert.True(team.Retired);
	}

	[Fact]
	public void Journey_an_attack_refuses_a_retired_seat()
	{
		var catalog = JourneyRulebook.Catalog(new List<JourneyCardDef>
		{
			new() { Id = "stop", Type = "attack", Kind = "stop", HazardClass = "stopper", NameKey = "c.stop" },
		});
		var me = new JourneySeatState { PlayerId = "A", Members = { new() { PlayerId = "A" } } };
		var ghost = new JourneySeatState { PlayerId = "B", Retired = true, Members = { new() { PlayerId = "B" } } };

		var check = JourneyRulebook.CanPlay(
			catalog["stop"], me, ghost, new JourneyRulesConfig(), catalog);

		Assert.False(check.Ok);
		Assert.Equal("game.journey_needs_target", check.ReasonKey);
	}

	[Fact]
	public async Task Journey_a_leaver_releases_the_draw_flag_and_their_coup_window()
	{
		var seat = new JourneySeatState
		{
			PlayerId = "A",
			Members = { new JourneyMemberState { PlayerId = "A", Hand = { JInst("priority") } } },
		};
		var state = JourneyGame(seat, new JourneySeatState
		{
			PlayerId = "B",
			Members = { new JourneyMemberState { PlayerId = "B" } },
		});
		state.CurrentTurn = "A"; // the leaver holds the turn and has already drawn
		state.Journey!.HasDrawn = true;
		state.Journey!.PendingCoup = new PendingJourneyCoup
		{
			VictimId = "A",
			AttackerId = "B",
			HazardKind = "stop",
			ImmunityInstanceId = "priority#0",
		};
		var context = TestFixtures.NewContext(state);

		state.Players.First(p => p.Id == "A").IsBankrupt = true;
		await GameFamilies.For("journey").OnPlayerRetiredAsync(
			state.Players.First(p => p.Id == "A"), context);

		// The silent decline: the held hazard stays where it fell, play unblocks.
		Assert.Null(state.Journey!.PendingCoup);
		// The draw belonged to the leaver: the next player starts their turn cleanly.
		Assert.False(state.Journey!.HasDrawn);
	}

	// ── Race ──────────────────────────────────────────────────────────────────

	[Fact]
	public async Task Race_a_leaver_goes_home_and_their_pending_choice_and_bonuses_clear()
	{
		var state = TestFixtures.NewState(new[] { TestFixtures.NewPlayer("a"), TestFixtures.NewPlayer("c") });
		state.GameType = "race";
		state.Race = new RaceState
		{
			Seats =
			{
				new RaceSeatState { PlayerId = "a", SeatId = "rojo" },
				new RaceSeatState
				{
					PlayerId = "c", SeatId = "azul",
					Pieces =
					{
						new RacePiece { Location = RacePieceLocation.Circuit, Square = 12 },
						new RacePiece { Location = RacePieceLocation.Circuit, Square = 12 }, // a barrier
                        new RacePiece { Location = RacePieceLocation.Corridor, Square = 3 },
					},
				},
			},
			PendingMove = new PendingRaceMove { PlayerId = "c", Steps = 5, Kind = "roll", Rolled = 5 },
			ConsecutiveSixes = 2,
			LastMovedPieceIndex = 1,
		};
		state.Race.PendingBonuses.Add(20);
		state.Race.PendingBonusKinds.Add("captureBonus");
		state.CurrentTurn = "c";
		var context = TestFixtures.NewContext(state);

		await GameFamilies.For("race").OnPlayerRetiredAsync(
			state.Players.First(p => p.Id == "c"), context);

		// The ghost barrier is gone: every piece sits at home, off the circuit.
		Assert.All(state.Race.Seats[1].Pieces, p => Assert.Equal(RacePieceLocation.Home, p.Location));
		Assert.Null(state.Race.PendingMove); // nobody will ever answer that choice
		Assert.Empty(state.Race.PendingBonuses);
		Assert.Equal(0, state.Race.ConsecutiveSixes);
		Assert.Null(state.Race.LastMovedPieceIndex);
	}

	// ── Exploding ───────────────────────────────────────────────────────────────

	[Fact]
	public async Task Exploding_a_leaver_discards_their_hand_and_passes_the_turn()
	{
		var state = TestFixtures.NewState(new[]
		{
			TestFixtures.NewPlayer("a"), TestFixtures.NewPlayer("b"), TestFixtures.NewPlayer("c"),
		});
		state.GameType = "exploding";
		state.Exploding = new ExplodingState
		{
			Seats =
			{
				new ExplodingSeatState { PlayerId = "a", Hand = { new() { InstanceId = "skip#0", CardId = "skip" } } },
				new ExplodingSeatState { PlayerId = "b" },
				new ExplodingSeatState { PlayerId = "c" },
			},
			DrawsOwed = 2, // a was under an Attack — leaving must reset the fresh turn
			PendingAction = new PendingExplodingAction { ActorId = "a", CardId = "skip" },
		};
		state.CurrentTurn = "a";
		var context = TestFixtures.NewContext(state);

		await GameFamilies.For("exploding").OnPlayerRetiredAsync(
			state.Players.First(p => p.Id == "a"), context);

		var seatA = state.Exploding.Seats.First(s => s.PlayerId == "a");
		Assert.True(seatA.Retired);
		Assert.Empty(seatA.Hand);
		Assert.Single(state.Exploding.DiscardPile); // the hand left play
		Assert.Null(state.Exploding.PendingAction); // the action they owned is dropped
		Assert.Equal("b", state.CurrentTurn); // the turn passed on, direction-less
		Assert.Equal(1, state.Exploding.DrawsOwed); // the fresh turn owes a single draw
	}

	// ── Trivia ────────────────────────────────────────────────────────────────

	[Fact]
	public async Task Trivia_a_leaver_is_folded_and_their_pending_move_and_question_are_dropped()
	{
		var state = TestFixtures.NewState(new[] { TestFixtures.NewPlayer("a"), TestFixtures.NewPlayer("b") });
		state.GameType = "trivia";
		state.Trivia = new TriviaState
		{
			Players = { new() { PlayerId = "a" }, new() { PlayerId = "b" } },
			PendingMove = new TriviaPendingMove { PlayerId = "a", Rolled = 3, Options = { "R0" } },
			PendingQuestion = new TriviaPendingQuestion { PlayerId = "a", JudgeId = "b", QuestionId = "q0", Prompt = "?" },
		};
		state.CurrentTurn = "a";
		var context = TestFixtures.NewContext(state);

		await GameFamilies.For("trivia").OnPlayerRetiredAsync(state.Players.First(p => p.Id == "a"), context);

		Assert.True(state.Trivia.Players.First(p => p.PlayerId == "a").Retired);
		Assert.Null(state.Trivia.PendingMove);     // their move choice is void
		Assert.Null(state.Trivia.PendingQuestion); // the question they were answering is dropped
	}

	[Fact]
	public async Task Trivia_a_leaving_judge_hands_the_verdict_to_another_player()
	{
		var state = TestFixtures.NewState(new[]
		{
			TestFixtures.NewPlayer("a"), TestFixtures.NewPlayer("b"), TestFixtures.NewPlayer("c"),
		});
		state.GameType = "trivia";
		state.Trivia = new TriviaState
		{
			Players = { new() { PlayerId = "a" }, new() { PlayerId = "b" }, new() { PlayerId = "c" } },
			PendingQuestion = new TriviaPendingQuestion
			{
				PlayerId = "a",
				JudgeId = "b",
				QuestionId = "q0",
				Prompt = "?",
				Submitted = "guess",
			},
		};
		state.CurrentTurn = "a";
		var context = TestFixtures.NewContext(state);

		// The JUDGE leaves mid-question: the answerer must still be ruled on, so the fold
		// reassigns the verdict to another eligible player rather than stalling.
		await GameFamilies.For("trivia").OnPlayerRetiredAsync(state.Players.First(p => p.Id == "b"), context);

		Assert.NotNull(state.Trivia.PendingQuestion);
		Assert.Equal("c", state.Trivia.PendingQuestion!.JudgeId);
	}
}
