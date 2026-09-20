using CorroServer.Models;
using CorroServer.Services;
using CorroServer.Models.Corro;
using CorroServer.Services.Commands;
using CorroServer.Services.Corro;
using CorroServer.Services.Corro.Families;

namespace CorroServer.Tests;

public class CategoriesRoundFlowTests
{
	private sealed record Table(GameContext Context, GameState State, CategoriesState Categories)
	{
		public CategoriesRoundState Round => Categories.Round;
		public string CategoryId(int index) => Round.Prompts[index].CategoryId;
	}

	private static async Task<Table> NewTable(int players = 3, int? roundSeconds = null)
	{
		var definition = await new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir("letter-rush"));
		if (roundSeconds is { } seconds)
		{
			definition = definition with
			{
				Manifest = definition.Manifest with
				{
					CategoriesRules = (definition.Manifest.CategoriesRules ?? new CategoriesRulesConfig())
						with { RoundSeconds = seconds },
				},
			};
		}
		var seats = Enumerable.Range(0, players)
			.Select(index => TestFixtures.NewPlayer($"p{index}", token: definition.Manifest.Tokens[index].Id))
			.ToList();
		var game = new CategoriesFamily().CreateGame(new FamilyStartContext
		{
			Players = seats,
			Definition = definition,
			Lang = "en",
		});
		var context = TestFixtures.NewContext(game.State, categoriesRules: game.State.CategoriesRules);
		return new Table(context, game.State, game.State.Categories!);
	}

	private static Task<ServerResponse> Start(Table table, string playerId)
		=> new CategoriesStartRoundHandler().HandleAsync(
			new CategoriesStartRoundCommand { PlayerId = playerId, RoundNumber = table.Round.RoundNumber },
			table.Context);

	private static Task<ServerResponse> Write(Table table, string playerId, params string[] answers)
		=> new CategoriesWriteHandler().HandleAsync(
			new CategoriesWriteCommand
			{
				PlayerId = playerId,
				RoundNumber = table.Round.RoundNumber,
				Entries = answers
					.Select((text, index) => new CategoriesEntry { CategoryId = table.CategoryId(index), Text = text })
					.ToList(),
			},
			table.Context);

	private static Task<ServerResponse> Finish(Table table, string playerId)
		=> new CategoriesFinishWritingHandler().HandleAsync(
			new CategoriesFinishWritingCommand { PlayerId = playerId, RoundNumber = table.Round.RoundNumber },
			table.Context);

	private static Task<ServerResponse> Rule(Table table, string playerId, params (string Player, string Verdict)[] rulings)
		=> new CategoriesRulePromptHandler().HandleAsync(
			new CategoriesRulePromptCommand
			{
				PlayerId = playerId,
				RoundNumber = table.Round.RoundNumber,
				PromptIndex = table.Round.ReviewIndex,
				Rulings = rulings
					.Select(entry => new CategoriesRuling { PlayerId = entry.Player, Verdict = entry.Verdict })
					.ToList(),
			},
			table.Context);

	/// <summary>Rule every remaining category of the round, accepting whatever was written.</summary>
	private static async Task RuleEverything(Table table, string judgeId)
	{
		while (table.Round.Phase == CategoriesRoundPhase.Review)
		{
			var prompt = table.Round.Prompts[table.Round.ReviewIndex];
			var rulings = prompt.Answers
				.Where(answer => answer.Text.Trim().Length > 0)
				.Select(answer => (answer.PlayerId, "accepted"))
				.ToArray();
			var response = await Rule(table, judgeId, rulings);
			Assert.IsType<CategoriesActionResponse>(response);
		}
	}

	// ── Starting ──────────────────────────────────────────────────────────────

	[Fact]
	public async Task Only_the_judge_starts_the_clock_and_only_once()
	{
		var table = await NewTable();

		var writerStart = await Start(table, "p1");
		var judgeStart = await Start(table, "p0");
		var repeated = await Start(table, "p0");

		Assert.Equal("CATEGORIES_NOT_JUDGE", Assert.IsType<ErrorResponse>(writerStart).Code);
		Assert.Equal("start", Assert.IsType<CategoriesActionResponse>(judgeStart).Action);
		Assert.Equal(CategoriesRoundPhase.Writing, table.Round.Phase);
		Assert.NotNull(table.Round.StartedAt);
		Assert.Equal("CATEGORIES_WRONG_PHASE", Assert.IsType<ErrorResponse>(repeated).Code);
		Assert.Contains(TestFixtures.Announcer(table.Context).Sent,
			sent => sent.Key == "game.categories_round_started");
	}

	[Fact]
	public async Task Nobody_can_write_before_the_clock_starts()
	{
		var table = await NewTable();

		var early = await Write(table, "p1", "Apple");

		Assert.Equal("CATEGORIES_WRONG_PHASE", Assert.IsType<ErrorResponse>(early).Code);
	}

	// ── Writing ───────────────────────────────────────────────────────────────

	[Fact]
	public async Task A_sheet_is_stored_as_it_is_written_and_resending_it_simply_replaces_it()
	{
		var table = await NewTable();
		await Start(table, "p0");

		await Write(table, "p1", "Apple");
		var second = await Write(table, "p1", "Apricot", "Almond");

		Assert.Equal("write", Assert.IsType<CategoriesActionResponse>(second).Action);
		Assert.Equal("Apricot", table.Round.Prompts[0].Answers.First(a => a.PlayerId == "p1").Text);
		Assert.Equal("Almond", table.Round.Prompts[1].Answers.First(a => a.PlayerId == "p1").Text);
		// Writing is silent on purpose: a line per keystroke would talk over the clock.
		Assert.DoesNotContain(TestFixtures.Announcer(table.Context).Sent,
			sent => sent.Key.StartsWith("game.categories_answer", StringComparison.Ordinal));
	}

	[Fact]
	public async Task The_judge_cannot_write_and_an_unknown_category_is_refused()
	{
		var table = await NewTable();
		await Start(table, "p0");

		var judge = await Write(table, "p0", "Apple");
		var unknown = await new CategoriesWriteHandler().HandleAsync(
			new CategoriesWriteCommand
			{
				PlayerId = "p1",
				RoundNumber = table.Round.RoundNumber,
				Entries = new() { new CategoriesEntry { CategoryId = "not-in-this-round", Text = "Apple" } },
			},
			table.Context);

		Assert.Equal("CATEGORIES_JUDGE_CANNOT_WRITE", Assert.IsType<ErrorResponse>(judge).Code);
		Assert.Equal("CATEGORIES_UNKNOWN_CATEGORY", Assert.IsType<ErrorResponse>(unknown).Code);
	}

	[Fact]
	public async Task An_answer_longer_than_the_cap_is_refused_whole_rather_than_truncated()
	{
		var table = await NewTable();
		await Start(table, "p0");

		var response = await Write(table, "p1", new string('a', CategoriesWriteHandler.MaxAnswerLength + 1));

		Assert.Equal("CATEGORIES_ANSWER_TOO_LONG", Assert.IsType<ErrorResponse>(response).Code);
		Assert.Equal(string.Empty, table.Round.Prompts[0].Answers.First(a => a.PlayerId == "p1").Text);
	}

	[Fact]
	public async Task A_stale_round_number_never_writes_into_the_round_that_replaced_it()
	{
		var table = await NewTable();
		await Start(table, "p0");

		var response = await new CategoriesWriteHandler().HandleAsync(
			new CategoriesWriteCommand
			{
				PlayerId = "p1",
				RoundNumber = table.Round.RoundNumber + 1,
				Entries = new() { new CategoriesEntry { CategoryId = table.CategoryId(0), Text = "Apple" } },
			},
			table.Context);

		Assert.Equal("CATEGORIES_STALE_ROUND", Assert.IsType<ErrorResponse>(response).Code);
	}

	[Fact]
	public async Task When_every_writer_finishes_the_round_moves_on_without_waiting_out_the_clock()
	{
		var table = await NewTable();
		await Start(table, "p0");
		await Write(table, "p1", "Apple");
		await Write(table, "p2", "Avocado");

		var first = await Finish(table, "p1");
		var second = await Finish(table, "p2");
		var repeated = await Finish(table, "p1");

		Assert.False(Assert.IsType<CategoriesActionResponse>(first).ReviewStarted);
		Assert.True(Assert.IsType<CategoriesActionResponse>(second).ReviewStarted);
		Assert.Equal(CategoriesRoundPhase.Review, table.Round.Phase);
		Assert.Equal("CATEGORIES_WRONG_PHASE", Assert.IsType<ErrorResponse>(repeated).Code);
		Assert.Contains(TestFixtures.Announcer(table.Context).Sent,
			sent => sent.Key == "game.categories_all_finished");
		Assert.Contains(TestFixtures.Announcer(table.Context).Sent,
			sent => sent.Key == "game.categories_review_prompt");
	}

	[Fact]
	public async Task A_finished_writer_cannot_slip_another_answer_in()
	{
		var table = await NewTable();
		await Start(table, "p0");
		await Finish(table, "p1");

		var late = await Write(table, "p1", "Apple");

		Assert.Equal("CATEGORIES_ALREADY_FINISHED", Assert.IsType<ErrorResponse>(late).Code);
	}

	// ── The clock ─────────────────────────────────────────────────────────────

	[Fact]
	public async Task An_answer_that_arrives_after_the_deadline_closes_the_round_instead_of_counting()
	{
		var table = await NewTable(roundSeconds: 30);
		await Start(table, "p0");
		await Write(table, "p1", "Apple");
		table.Round.StartedAt = DateTime.UtcNow.AddSeconds(-31);

		var late = await Write(table, "p1", "Apricot");

		Assert.True(Assert.IsType<CategoriesActionResponse>(late).ReviewStarted);
		Assert.Equal(CategoriesRoundPhase.Review, table.Round.Phase);
		Assert.Equal("Apple", table.Round.Prompts[0].Answers.First(a => a.PlayerId == "p1").Text);
	}

	[Fact]
	public async Task The_server_clock_expiry_only_resolves_a_round_whose_time_is_actually_up()
	{
		var table = await NewTable(roundSeconds: 30);
		await Start(table, "p0");

		var early = await new CategoriesExpireRoundHandler().HandleAsync(
			new CategoriesExpireRoundCommand { PlayerId = "p0" }, table.Context);
		table.Round.StartedAt = DateTime.UtcNow.AddSeconds(-31);
		var expired = await new CategoriesExpireRoundHandler().HandleAsync(
			new CategoriesExpireRoundCommand { PlayerId = "p0" }, table.Context);

		Assert.Equal("CATEGORIES_TIME_REMAINING", Assert.IsType<ErrorResponse>(early).Code);
		Assert.Equal("timeout", Assert.IsType<CategoriesActionResponse>(expired).Action);
		Assert.Equal(CategoriesRoundPhase.Review, table.Round.Phase);
		Assert.Contains(TestFixtures.Announcer(table.Context).Sent, sent => sent.Key == "game.categories_time_up");
	}

	// ── Judging ───────────────────────────────────────────────────────────────

	[Fact]
	public async Task Only_the_judge_rules_and_only_on_the_category_under_review()
	{
		var table = await NewTable();
		await Start(table, "p0");
		await Write(table, "p1", "Apple");
		await Write(table, "p2", "Avocado");
		await Finish(table, "p1");
		await Finish(table, "p2");

		var writer = await Rule(table, "p1", ("p1", "accepted"), ("p2", "accepted"));
		var stale = await new CategoriesRulePromptHandler().HandleAsync(
			new CategoriesRulePromptCommand
			{
				PlayerId = "p0",
				RoundNumber = table.Round.RoundNumber,
				PromptIndex = 3,
				Rulings = new() { new CategoriesRuling { PlayerId = "p1", Verdict = "accepted" } },
			},
			table.Context);

		Assert.Equal("CATEGORIES_NOT_JUDGE", Assert.IsType<ErrorResponse>(writer).Code);
		Assert.Equal("CATEGORIES_STALE_PROMPT", Assert.IsType<ErrorResponse>(stale).Code);
	}

	[Fact]
	public async Task A_ruling_that_leaves_a_written_answer_undecided_is_refused_rather_than_silently_rejecting_it()
	{
		var table = await NewTable();
		await Start(table, "p0");
		await Write(table, "p1", "Apple");
		await Write(table, "p2", "Avocado");
		await Finish(table, "p1");
		await Finish(table, "p2");

		var incomplete = await Rule(table, "p0", ("p1", "accepted"));
		var unknown = await Rule(table, "p0", ("p1", "maybe"), ("p2", "accepted"));

		Assert.Equal("CATEGORIES_INCOMPLETE_RULING", Assert.IsType<ErrorResponse>(incomplete).Code);
		Assert.Equal("CATEGORIES_UNKNOWN_VERDICT", Assert.IsType<ErrorResponse>(unknown).Code);
		Assert.Equal(0, table.Round.ReviewIndex);
	}

	[Fact]
	public async Task A_ruled_category_is_announced_to_the_table_and_privately_to_each_writer()
	{
		var table = await NewTable();
		await Start(table, "p0");
		await Write(table, "p1", "Apple");
		await Write(table, "p2", "Apple");
		await Finish(table, "p1");
		await Finish(table, "p2");

		await Rule(table, "p0", ("p1", "duplicate"), ("p2", "duplicate"));

		var announcer = TestFixtures.Announcer(table.Context);
		var summary = Assert.Single(announcer.Sent, sent => sent.Key == "game.categories_prompt_ruled");
		Assert.Equal(0, summary.Vars["accepted"]);
		Assert.Equal(2, summary.Vars["duplicates"]);
		Assert.Equal(1, table.Round.ReviewIndex);
		// Each writer hears the fate of THEIR OWN answer, which no summary can carry.
		Assert.Equal(2, announcer.Sent.Count(sent =>
			sent.Audience == AnnouncementAudience.Player && sent.Key == "game.categories_answer_duplicate"));
	}

	[Fact]
	public async Task Ruling_the_last_category_scores_the_round_and_deals_the_next_one_under_a_new_judge()
	{
		var table = await NewTable();
		await Start(table, "p0");
		await Write(table, "p1", "Apple", "Apricot", "Almond", "Anchor", "Arrow", "Atlas");
		await Finish(table, "p1");
		await Finish(table, "p2");

		await RuleEverything(table, "p0");

		Assert.Equal(6, table.Categories.Players.First(player => player.PlayerId == "p1").Score);
		Assert.Equal(0, table.Categories.Players.First(player => player.PlayerId == "p2").Score);
		Assert.Equal(2, table.Round.RoundNumber);
		Assert.Equal("p1", table.Round.JudgeId);
		Assert.Equal("p1", table.State.CurrentTurn);
		Assert.Equal(CategoriesRoundPhase.Preparing, table.Round.Phase);
		Assert.Contains(TestFixtures.Announcer(table.Context).Sent,
			sent => sent.Key == "game.categories_round_scored");
	}

	[Fact]
	public async Task The_match_ends_after_a_complete_judge_rotation_with_a_clear_leader()
	{
		var table = await NewTable();

		for (var round = 0; round < 3; round++)
		{
			var judge = table.Round.JudgeId;
			await Start(table, judge);
			// One writer answers everything, so a leader emerges instead of a three-way tie.
			var writer = judge == "p1" ? "p2" : "p1";
			await Write(table, writer, "Apple", "Apricot", "Almond", "Anchor", "Arrow", "Atlas");
			foreach (var id in new[] { "p0", "p1", "p2" }.Where(id => id != judge))
			{
				await Finish(table, id);
			}
			await RuleEverything(table, judge);
		}

		Assert.True(table.State.IsGameOver);
		Assert.Equal("p1", table.State.WinnerId);

		// The points each player collected from the accepted answers, carried to the final table.
		var standings = new CategoriesFamily().FinalStandings(table.State);
		StandingsSanity.AssertSane(table.State, standings);
		Assert.Equal("game.end_measure_points", standings!.MeasureKey);
		Assert.Equal("p1", standings.Sides[0].MemberIds.Single());
		Assert.Equal(
			table.State.Categories!.Players.First(player => player.PlayerId == "p1").Score,
			standings.Sides[0].Value);
		Assert.Contains(TestFixtures.Announcer(table.Context).Sent,
			sent => sent.Key == "game.categories_final_score");
		Assert.Contains(TestFixtures.Announcer(table.Context).Sent, sent => sent.Key == "game.game_over");
	}
}
