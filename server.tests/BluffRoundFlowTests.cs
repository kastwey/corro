using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services;
using CorroServer.Services.Commands;
using CorroServer.Services.Corro;
using CorroServer.Services.Corro.Families;
using CorroServer.Services.Rules;

namespace CorroServer.Tests;

public class BluffRoundFlowTests
{
	private sealed record Table(GameContext Context, GameState State, BluffState Bluff)
	{
		public BluffRoundState Round => Bluff.Round;
		public TestFixtures.FakeAnnouncer Announcer => (TestFixtures.FakeAnnouncer)Context.Announcer;
	}

	private static async Task<Table> NewTable(int players = 3, int? writeSeconds = null, int rounds = 2)
	{
		var definition = await new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir("tall-tales"));
		definition = definition with
		{
			Manifest = definition.Manifest with
			{
				BluffRules = (definition.Manifest.BluffRules ?? new BluffRulesConfig())
					with { WriteSeconds = writeSeconds ?? 45, Rounds = rounds },
			},
		};
		var seats = Enumerable.Range(0, players)
			.Select(index => TestFixtures.NewPlayer($"p{index}", token: "seat"))
			.ToList();
		var game = new BluffFamily().CreateGame(new FamilyStartContext
		{
			Players = seats,
			Definition = definition,
			Lang = "en",
			HostId = "p0",
		});
		var context = TestFixtures.NewContext(game.State, bluffRules: game.State.BluffRules);
		return new Table(context, game.State, game.State.Bluff!);
	}

	private static Task<ServerResponse> Start(Table table, string playerId)
		=> new BluffStartRoundHandler().HandleAsync(
			new BluffStartRoundCommand { PlayerId = playerId, RoundNumber = table.Round.RoundNumber },
			table.Context);

	private static Task<ServerResponse> Write(Table table, string playerId, string text)
		=> new BluffWriteHandler().HandleAsync(
			new BluffWriteCommand { PlayerId = playerId, RoundNumber = table.Round.RoundNumber, Text = text },
			table.Context);

	private static Task<ServerResponse> Finish(Table table, string playerId)
		=> new BluffFinishWritingHandler().HandleAsync(
			new BluffFinishWritingCommand { PlayerId = playerId, RoundNumber = table.Round.RoundNumber },
			table.Context);

	private static Task<ServerResponse> Vote(Table table, string playerId, int? truth, int? funny, bool final = false)
		=> new BluffVoteHandler().HandleAsync(
			new BluffVoteCommand
			{
				PlayerId = playerId,
				RoundNumber = table.Round.RoundNumber,
				Final = final,
				TruthPick = truth,
				FunnyPick = funny,
			},
			table.Context);

	private static Task<ServerResponse> Next(Table table, string playerId)
		=> new BluffNextRoundHandler().HandleAsync(
			new BluffNextRoundCommand { PlayerId = playerId, RoundNumber = table.Round.RoundNumber },
			table.Context);

	private static int Index(Table table, string playerId, string key, bool final = false)
		=> BluffRulebook.BallotOf(table.Round, playerId, final)!.Options.First(option => option.Key == key).Index;

	/// <summary>Everybody writes and finishes; the vote is open on return.</summary>
	private static async Task OpenVote(Table table, params string[] lies)
	{
		await Start(table, "p0");
		for (var index = 0; index < lies.Length; index++)
		{
			await Write(table, $"p{index}", lies[index]);
		}
		for (var index = 0; index < lies.Length; index++)
		{
			await Finish(table, $"p{index}");
		}
		Assert.Equal(BluffPhase.Voting, table.Round.Phase);
	}

	[Fact]
	public async Task Only_the_master_opens_the_round_and_the_question_is_read_with_the_clock()
	{
		var table = await NewTable();

		var refused = Assert.IsType<ErrorResponse>(await Start(table, "p1"));
		Assert.Equal("BLUFF_NOT_MASTER", refused.Code);
		Assert.Equal(BluffPhase.Preparing, table.Round.Phase);

		var started = Assert.IsType<BluffActionResponse>(await Start(table, "p0"));
		Assert.Equal("start", started.Action);
		Assert.True(started.BroadcastsState);
		Assert.Equal(BluffPhase.Writing, table.Round.Phase);
		Assert.NotNull(table.Round.StartedAt);
		var announced = Assert.Single(table.Announcer.Sent, sent => sent.Key == "game.bluff_round_started");
		Assert.Equal(table.Round.Question, announced.Vars["question"]);
		Assert.Equal("p0", announced.Vars["actorId"]);

		Assert.Equal("BLUFF_WRONG_PHASE", Assert.IsType<ErrorResponse>(await Start(table, "p0")).Code);
	}

	[Fact]
	public async Task A_saved_bluff_is_quiet_and_private_and_the_truth_is_refused_with_its_own_code()
	{
		var table = await NewTable();
		await Start(table, "p0");
		var spokenBefore = table.Announcer.Sent.Count;

		var saved = Assert.IsType<BluffActionResponse>(await Write(table, "p1", "a tall tale"));
		Assert.True(saved.Quiet);
		Assert.False(saved.BroadcastsState);
		Assert.Equal("a tall tale", table.Round.Entries[1].Text);
		Assert.Equal(spokenBefore, table.Announcer.Sent.Count);

		var truth = Assert.IsType<ErrorResponse>(await Write(table, "p1", table.Round.Truth.ToUpperInvariant()));
		Assert.Equal("BLUFF_WROTE_THE_TRUTH", truth.Code);
		Assert.Equal("a tall tale", table.Round.Entries[1].Text);

		var tooLong = Assert.IsType<ErrorResponse>(await Write(table, "p1", new string('x', 81)));
		Assert.Equal("BLUFF_LIE_TOO_LONG", tooLong.Code);
	}

	[Fact]
	public async Task A_stale_round_number_is_refused()
	{
		var table = await NewTable();
		await Start(table, "p0");

		var stale = await new BluffWriteHandler().HandleAsync(
			new BluffWriteCommand { PlayerId = "p1", RoundNumber = 7, Text = "late" },
			table.Context);

		Assert.Equal("BLUFF_STALE_ROUND", Assert.IsType<ErrorResponse>(stale).Code);
	}

	[Fact]
	public async Task Finishing_is_private_until_the_last_writer_opens_the_vote_for_everyone()
	{
		var table = await NewTable();
		await Start(table, "p0");
		await Write(table, "p0", "A");
		await Write(table, "p1", "B");
		await Write(table, "p2", "C");

		var first = Assert.IsType<BluffActionResponse>(await Finish(table, "p1"));
		Assert.Equal("finish", first.Action);
		// Three players: every finish moves the counter, so this one is broadcast.
		Assert.False(first.Quiet);
		Assert.True(table.Announcer.Has(AnnouncementAudience.Player, "p1", "game.bluff_you_finished"));
		Assert.DoesNotContain(table.Announcer.Sent, sent => sent.Audience == AnnouncementAudience.All && sent.Key.StartsWith("game.bluff_"));
		Assert.Equal("BLUFF_ALREADY_FINISHED", Assert.IsType<ErrorResponse>(await Finish(table, "p1")).Code);
		Assert.Equal("BLUFF_ALREADY_FINISHED", Assert.IsType<ErrorResponse>(await Write(table, "p1", "late")).Code);

		await Finish(table, "p2");
		var last = Assert.IsType<BluffActionResponse>(await Finish(table, "p0"));
		Assert.True(last.PhaseEnded);
		Assert.Equal(BluffPhase.Voting, table.Round.Phase);
		Assert.Equal(3, table.Round.Lies.Count);
		var closed = Assert.Single(table.Announcer.Sent, sent => sent.Key == "game.bluff_writing_closed");
		Assert.Equal(3, closed.Vars["count"]);
		Assert.True(table.Announcer.Has(AnnouncementAudience.All, null, "game.bluff_voting_started"));
	}

	[Fact]
	public async Task In_a_hall_a_finish_is_quiet_except_at_every_tenth_and_in_the_last_three()
	{
		Assert.False(BluffRoundFlow.ProgressWorthBroadcasting(remaining: 199, total: 200));
		Assert.False(BluffRoundFlow.ProgressWorthBroadcasting(remaining: 198, total: 200));
		Assert.True(BluffRoundFlow.ProgressWorthBroadcasting(remaining: 180, total: 200));
		Assert.False(BluffRoundFlow.ProgressWorthBroadcasting(remaining: 179, total: 200));
		Assert.True(BluffRoundFlow.ProgressWorthBroadcasting(remaining: 3, total: 200));
		Assert.True(BluffRoundFlow.ProgressWorthBroadcasting(remaining: 1, total: 200));
		// A small table sees every one.
		Assert.True(BluffRoundFlow.ProgressWorthBroadcasting(remaining: 5, total: 8));
		Assert.True(BluffRoundFlow.ProgressWorthBroadcasting(remaining: 4, total: 8));
		await Task.CompletedTask;
	}

	[Fact]
	public async Task A_write_after_the_deadline_is_refused_and_a_finish_after_it_closes_the_writing()
	{
		var table = await NewTable(writeSeconds: 15);
		await Start(table, "p0");
		table.Round.StartedAt = DateTime.UtcNow.AddSeconds(-16);

		Assert.Equal("BLUFF_TIME_UP", Assert.IsType<ErrorResponse>(await Write(table, "p1", "late")).Code);
		var closed = Assert.IsType<BluffActionResponse>(await Finish(table, "p1"));
		Assert.True(closed.PhaseEnded);
		Assert.Equal(BluffPhase.Voting, table.Round.Phase);
		Assert.True(table.Announcer.Has(AnnouncementAudience.All, null, "game.bluff_time_up_writing"));
	}

	[Fact]
	public async Task The_expiry_handler_closes_whichever_timed_phase_ran_out_and_nothing_else()
	{
		var table = await NewTable(writeSeconds: 15);
		var handler = new BluffExpirePhaseHandler();
		var command = new BluffExpirePhaseCommand { PlayerId = "p0" };

		Assert.Equal("BLUFF_WRONG_PHASE", Assert.IsType<ErrorResponse>(await handler.HandleAsync(command, table.Context)).Code);
		await Start(table, "p0");
		Assert.Equal("BLUFF_TIME_REMAINING", Assert.IsType<ErrorResponse>(await handler.HandleAsync(command, table.Context)).Code);

		table.Round.StartedAt = DateTime.UtcNow.AddSeconds(-16);
		var expired = Assert.IsType<BluffActionResponse>(await handler.HandleAsync(command, table.Context));
		Assert.Equal("timeout", expired.Action);
		Assert.Equal(BluffPhase.Voting, table.Round.Phase);

		// The vote runs out too: with nobody voting, the reveal has nothing but the truth.
		table.Round.StartedAt = DateTime.UtcNow.AddSeconds(-31);
		var revealed = Assert.IsType<BluffActionResponse>(await handler.HandleAsync(command, table.Context));
		Assert.True(revealed.RoundEnded);
		Assert.Equal(BluffPhase.Reveal, table.Round.Phase);
		Assert.True(table.Announcer.Has(AnnouncementAudience.All, null, "game.bluff_time_up_voting"));
		Assert.True(table.Announcer.Has(AnnouncementAudience.All, null, "game.bluff_reveal_truth"));
	}

	[Fact]
	public async Task Marks_are_quiet_until_the_last_ballot_reveals_the_round_to_the_room_and_to_each_player()
	{
		var table = await NewTable();
		await OpenVote(table, "A", "B", "C");
		var lieA = table.Round.Lies.First(lie => lie.Text == "A");

		var mark = Assert.IsType<BluffActionResponse>(await Vote(table, "p1", Index(table, "p1", lieA.Id), null));
		Assert.True(mark.Quiet);
		Assert.Equal("BLUFF_SAME_OPTION", Assert.IsType<ErrorResponse>(
			await Vote(table, "p1", null, Index(table, "p1", lieA.Id))).Code);
		Assert.Equal("BLUFF_UNKNOWN_OPTION", Assert.IsType<ErrorResponse>(await Vote(table, "p1", 9, null)).Code);
		// A stranger is stopped by the shared player guard before the ballot is ever looked for.
		Assert.Equal("PLAYER_NOT_FOUND", Assert.IsType<ErrorResponse>(await Vote(table, "ghost", 0, null)).Code);

		var complete = Assert.IsType<BluffActionResponse>(
			await Vote(table, "p1", null, Index(table, "p1", BluffBallotState.TruthKey)));
		Assert.False(complete.Quiet);
		Assert.True(table.Announcer.Has(AnnouncementAudience.Player, "p1", "game.bluff_you_voted"));

		await Vote(table, "p2", Index(table, "p2", BluffBallotState.TruthKey), Index(table, "p2", lieA.Id));
		var last = Assert.IsType<BluffActionResponse>(
			await Vote(table, "p0", Index(table, "p0", BluffBallotState.TruthKey), Index(table, "p0", table.Round.Lies[1].Id)));

		Assert.True(last.PhaseEnded);
		Assert.True(last.RoundEnded);
		Assert.Equal(BluffPhase.Reveal, table.Round.Phase);
		var truth = Assert.Single(table.Announcer.Sent, sent => sent.Key == "game.bluff_reveal_truth");
		Assert.Equal(table.Round.Truth, truth.Vars["truth"]);
		Assert.Equal(2, truth.Vars["count"]);
		var best = Assert.Single(table.Announcer.Sent, sent => sent.Key == "game.bluff_reveal_best");
		Assert.Equal("A", best.Vars["lie"]);
		Assert.Equal("p0", best.Vars["actorId"]);
		Assert.Equal(1, best.Vars["count"]);
		Assert.Single(table.Announcer.Sent, sent => sent.Key == "game.bluff_reveal_funniest");
		Assert.True(table.Announcer.Has(AnnouncementAudience.Player, "p0", "game.bluff_result_truth_fooled"));
		Assert.True(table.Announcer.Has(AnnouncementAudience.Player, "p1", "game.bluff_result_miss_none"));
		Assert.True(table.Announcer.Has(AnnouncementAudience.Player, "p2", "game.bluff_result_truth_none"));
		var leader = Assert.Single(table.Announcer.Sent, sent => sent.Key == "game.bluff_leader");
		Assert.Equal("p0", leader.Vars["actorId"]);
		Assert.Equal(1500, table.Bluff.Players[0].Score);
	}

	[Fact]
	public async Task A_bluff_shared_by_several_is_announced_with_its_first_author_and_how_many_more()
	{
		var table = await NewTable(4);
		await OpenVote(table, "Same", "same", "C", "D");
		var shared = table.Round.Lies.First(lie => lie.AuthorIds.Count == 2);
		foreach (var voter in new[] { "p2", "p3" })
		{
			await Vote(table, voter, Index(table, voter, shared.Id), Index(table, voter, BluffBallotState.TruthKey));
		}
		foreach (var author in new[] { "p0", "p1" })
		{
			await Vote(table, author, Index(table, author, BluffBallotState.TruthKey), Index(table, author, table.Round.Lies.First(lie => lie.Text == "C").Id));
		}

		var best = Assert.Single(table.Announcer.Sent, sent => sent.Key == "game.bluff_reveal_best_more");
		Assert.Equal(1, best.Vars["others"]);
		Assert.Equal(2, best.Vars["count"]);
		Assert.False(best.Vars.ContainsKey("actorId"));
	}

	[Fact]
	public async Task Only_the_master_moves_past_the_reveal_and_the_last_round_ends_the_match()
	{
		var table = await NewTable(rounds: 1);
		await OpenVote(table, "A", "B", "C");
		foreach (var voter in new[] { "p0", "p1", "p2" })
		{
			await Vote(table, voter, Index(table, voter, BluffBallotState.TruthKey), null);
			await Vote(table, voter, null, BluffRulebook.BallotOf(table.Round, voter, false)!.Options.First(option => option.Key != BluffBallotState.TruthKey).Index);
		}
		Assert.Equal(BluffPhase.Reveal, table.Round.Phase);

		Assert.Equal("BLUFF_NOT_MASTER", Assert.IsType<ErrorResponse>(await Next(table, "p1")).Code);

		// Everybody found the truth: level at 1000, so the one agreed round grows by one.
		var tied = Assert.IsType<BluffActionResponse>(await Next(table, "p0"));
		Assert.False(tied.GameEnded);
		Assert.True(table.Announcer.Has(AnnouncementAudience.All, null, "game.bluff_tie_breaker"));
		Assert.Equal(2, table.Round.RoundNumber);
		Assert.Equal(BluffPhase.Preparing, table.Round.Phase);
		Assert.True(table.Announcer.Sent.Count(sent => sent.Key == "game.bluff_round_preparing") >= 1);

		// Round two: only p1 finds the truth.
		await OpenVote(table, "A", "B", "C");
		var lieA = table.Round.Lies.First(lie => lie.Text == "A");
		await Vote(table, "p1", Index(table, "p1", BluffBallotState.TruthKey), Index(table, "p1", lieA.Id));
		foreach (var voter in new[] { "p0", "p2" })
		{
			var other = BluffRulebook.BallotOf(table.Round, voter, false)!.Options.First(option => option.Key != BluffBallotState.TruthKey);
			await Vote(table, voter, other.Index, BluffRulebook.BallotOf(table.Round, voter, false)!.Options.First(option => option.Index != other.Index).Index);
		}
		var ended = Assert.IsType<BluffActionResponse>(await Next(table, "p0"));

		Assert.True(ended.GameEnded);
		Assert.True(table.State.IsGameOver);
		Assert.Equal("p1", table.State.WinnerId);
		Assert.Equal(1, table.State.Players.First(player => player.Id == "p1").FinishPlace);
		// Both carry the winner as actor: the room hears the base line, the winner the first person.
		Assert.True(table.Announcer.Has(AnnouncementAudience.AllExcept, "p1", "game.bluff_final_score"));
		Assert.True(table.Announcer.Has(AnnouncementAudience.Player, "p1", "game.bluff_final_score_self"));
		Assert.True(table.Announcer.Has(AnnouncementAudience.AllExcept, "p1", "game.game_over"));
	}

	[Fact]
	public async Task A_vote_in_the_wrong_stage_is_refused()
	{
		var table = await NewTable();
		await OpenVote(table, "A", "B", "C");

		Assert.Equal("BLUFF_WRONG_PHASE", Assert.IsType<ErrorResponse>(await Vote(table, "p1", 0, null, final: true)).Code);
	}
}
