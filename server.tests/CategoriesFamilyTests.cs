using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Corro;
using CorroServer.Services.Corro.Families;

namespace CorroServer.Tests;

public class CategoriesFamilyTests
{
	private static Task<GameDefinition> LoadPackage()
		=> new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir("letter-rush"));

	private static async Task<FamilyGame> StartGame(int players = 3)
	{
		var definition = await LoadPackage();
		var seats = Enumerable.Range(0, players)
			.Select(index => TestFixtures.NewPlayer($"p{index}", token: definition.Manifest.Tokens[index].Id))
			.ToList();
		return new CategoriesFamily().CreateGame(new FamilyStartContext
		{
			Players = seats,
			Definition = definition,
			Lang = "en",
		});
	}

	[Fact]
	public async Task The_shipped_package_loads_a_deck_per_locale_and_offers_both_as_content_languages()
	{
		var definition = await LoadPackage();

		Assert.Equal(new[] { "en", "es" }, new CategoriesFamily().ContentLanguages(definition));
		Assert.NotEmpty(definition.CategoryDecks!["en"].Categories);
		Assert.NotEmpty(definition.CategoryDecks["es"].Letters);
		new CategoriesFamily().ValidateDefinition(definition);
	}

	[Theory]
	[InlineData(2)]
	[InlineData(9)]
	public async Task A_table_outside_the_family_bounds_cannot_start(int players)
	{
		var definition = await LoadPackage();
		var seats = Enumerable.Range(0, players).Select(index => TestFixtures.NewPlayer($"p{index}")).ToList();

		Assert.Throws<InvalidOperationException>(() => new CategoriesFamily().CreateGame(new FamilyStartContext
		{
			Players = seats,
			Definition = definition,
			Lang = "en",
		}));
	}

	[Fact]
	public async Task Bots_cannot_be_seated_because_nobody_can_write_for_them()
	{
		var definition = await LoadPackage();
		var seats = Enumerable.Range(0, 2).Select(index => TestFixtures.NewPlayer($"p{index}")).ToList();
		seats.Add(new Player { Id = "bot", Name = "Bot", Token = "quill", IsBot = true });

		Assert.Throws<InvalidOperationException>(() => new CategoriesFamily().CreateGame(new FamilyStartContext
		{
			Players = seats,
			Definition = definition,
			Lang = "en",
		}));
	}

	[Fact]
	public async Task A_content_language_the_package_does_not_ship_is_refused_rather_than_guessed()
	{
		var definition = await LoadPackage();
		var seats = Enumerable.Range(0, 3).Select(index => TestFixtures.NewPlayer($"p{index}")).ToList();

		Assert.Throws<InvalidOperationException>(() => new CategoriesFamily().CreateGame(new FamilyStartContext
		{
			Players = seats,
			Definition = definition,
			Lang = "fr",
		}));
	}

	[Theory]
	[InlineData(10, 6, 1, 1, "roundSeconds")]
	[InlineData(120, 2, 1, 1, "categoriesPerRound")]
	[InlineData(120, 6, 0, 1, "pointsPerAnswer")]
	[InlineData(120, 6, 1, 9, "cycles")]
	public async Task Rules_outside_their_bounds_are_reported_with_the_offending_setting(
		int seconds,
		int perRound,
		int points,
		int cycles,
		string expected)
	{
		var definition = await LoadPackage();
		var broken = definition with
		{
			Manifest = definition.Manifest with
			{
				CategoriesRules = new CategoriesRulesConfig
				{
					RoundSeconds = seconds,
					CategoriesPerRound = perRound,
					PointsPerAnswer = points,
					Cycles = cycles,
				},
			},
		};

		var problem = Assert.Throws<InvalidOperationException>(
			() => new CategoriesFamily().ValidateDefinition(broken));
		Assert.Contains(expected, problem.Message);
	}

	[Fact]
	public async Task A_locale_whose_deck_is_too_small_to_avoid_repeating_itself_is_rejected()
	{
		var definition = await LoadPackage();
		var thin = definition with
		{
			CategoryDecks = new Dictionary<string, CategoryDeckDef>(StringComparer.OrdinalIgnoreCase)
			{
				["en"] = new CategoryDeckDef
				{
					Letters = definition.CategoryDecks!["en"].Letters,
					Categories = definition.CategoryDecks["en"].Categories.Take(6).ToList(),
				},
				["es"] = definition.CategoryDecks["es"],
			},
		};

		var problem = Assert.Throws<InvalidOperationException>(
			() => new CategoriesFamily().ValidateDefinition(thin));
		Assert.Contains("at least 24 categories", problem.Message);
	}

	[Fact]
	public async Task A_letter_pool_with_a_non_letter_entry_is_rejected()
	{
		var definition = await LoadPackage();
		var broken = definition with
		{
			CategoryDecks = new Dictionary<string, CategoryDeckDef>(StringComparer.OrdinalIgnoreCase)
			{
				["en"] = new CategoryDeckDef
				{
					Letters = new List<string> { "A", "B", "C", "D", "7" },
					Categories = definition.CategoryDecks!["en"].Categories,
				},
				["es"] = definition.CategoryDecks["es"],
			},
		};

		Assert.Throws<InvalidOperationException>(() => new CategoriesFamily().ValidateDefinition(broken));
	}

	// ── Hidden information ────────────────────────────────────────────────────

	[Fact]
	public async Task While_the_clock_runs_an_answer_belongs_to_its_writer_and_to_nobody_else()
	{
		var game = await StartGame();
		var state = game.State;
		var round = state.Categories!.Round;
		round.Phase = CategoriesRoundPhase.Writing;
		round.Prompts[0].Answers.First(answer => answer.PlayerId == "p1").Text = "Apple";
		round.Prompts[0].Answers.First(answer => answer.PlayerId == "p2").Text = "Avocado";
		var family = new CategoriesFamily();

		var mine = family.ProjectFor(state, "p1").Categories!.Round.Prompts[0].Answers;
		var judge = family.ProjectFor(state, "p0").Categories!.Round.Prompts[0].Answers;
		var spectator = family.ProjectFor(state, null).Categories!.Round.Prompts[0].Answers;

		Assert.True(family.HasHiddenInformation);
		Assert.Equal("Apple", mine.First(answer => answer.PlayerId == "p1").Text);
		Assert.Equal(string.Empty, mine.First(answer => answer.PlayerId == "p2").Text);
		Assert.All(judge, answer => Assert.Equal(string.Empty, answer.Text));
		Assert.All(spectator, answer => Assert.Equal(string.Empty, answer.Text));
		// The authoritative state is untouched: projection is a wire concern.
		Assert.Equal("Apple", round.Prompts[0].Answers.First(answer => answer.PlayerId == "p1").Text);
	}

	[Fact]
	public async Task Once_the_review_begins_the_answers_are_the_table_s_and_everyone_sees_them_all()
	{
		var game = await StartGame();
		var round = game.State.Categories!.Round;
		round.Phase = CategoriesRoundPhase.Review;
		round.Prompts[0].Answers.First(answer => answer.PlayerId == "p2").Text = "Avocado";

		var seen = new CategoriesFamily().ProjectFor(game.State, "p1").Categories!.Round.Prompts[0].Answers;

		Assert.Equal("Avocado", seen.First(answer => answer.PlayerId == "p2").Text);
	}

	[Fact]
	public async Task The_undealt_deck_never_reaches_a_client()
	{
		var game = await StartGame();

		Assert.NotNull(game.State.CategoryDeck);
		Assert.Null(new CategoriesFamily().ProjectFor(game.State, "p1").CategoryDeck);
		Assert.Null(new CategoriesFamily().ProjectFor(game.State, null).CategoryDeck);
	}

	// ── The shared round clock ────────────────────────────────────────────────

	[Fact]
	public async Task The_clock_is_only_armed_while_the_round_is_being_written()
	{
		var game = await StartGame();
		var family = new CategoriesFamily();
		var round = game.State.Categories!.Round;

		Assert.Null(family.RoundClock(game.State));
		Assert.Null(family.ExpireRoundCommand(game.State));

		round.Phase = CategoriesRoundPhase.Writing;
		round.StartedAt = new DateTime(2026, 8, 9, 12, 0, 0, DateTimeKind.Utc);

		var clock = Assert.NotNull(family.RoundClock(game.State));
		Assert.Equal(round.StartedAt, clock.StartedAt);
		Assert.Equal(round.DurationSeconds, clock.DurationSeconds);
		Assert.IsType<CategoriesExpireRoundCommand>(family.ExpireRoundCommand(game.State));

		round.Phase = CategoriesRoundPhase.Review;
		Assert.Null(family.RoundClock(game.State));
	}

	// ── Retirement ────────────────────────────────────────────────────────────

	[Fact]
	public async Task When_the_judge_leaves_the_round_restarts_under_the_next_judge()
	{
		var game = await StartGame(players: 4);
		var context = TestFixtures.NewContext(game.State, categoriesRules: game.State.CategoriesRules);
		var round = game.State.Categories!.Round;
		round.Phase = CategoriesRoundPhase.Writing;
		var judge = game.State.Players.First(player => player.Id == round.JudgeId);
		judge.IsBankrupt = true;

		await new CategoriesFamily().OnPlayerRetiredAsync(judge, context);

		var fresh = game.State.Categories!.Round;
		Assert.Equal("p1", fresh.JudgeId);
		Assert.Equal(CategoriesRoundPhase.Preparing, fresh.Phase);
		Assert.Equal(round.RoundNumber, fresh.RoundNumber);
		Assert.Equal("p1", game.State.CurrentTurn);
		Assert.DoesNotContain(game.State.Categories.Players, player => player.PlayerId == "p0");
		Assert.Contains(TestFixtures.Announcer(context).Sent, sent => sent.Key == "game.categories_judge_left");
	}

	[Fact]
	public async Task When_a_writer_leaves_their_answers_leave_with_them_and_the_round_carries_on()
	{
		var game = await StartGame(players: 4);
		var context = TestFixtures.NewContext(game.State, categoriesRules: game.State.CategoriesRules);
		var round = game.State.Categories!.Round;
		round.Phase = CategoriesRoundPhase.Writing;
		round.Prompts[0].Answers.First(answer => answer.PlayerId == "p1").Text = "Apple";
		var writer = game.State.Players.First(player => player.Id == "p1");
		writer.IsBankrupt = true;

		await new CategoriesFamily().OnPlayerRetiredAsync(writer, context);

		Assert.Equal(CategoriesRoundPhase.Writing, game.State.Categories!.Round.Phase);
		Assert.Equal("p0", game.State.Categories.Round.JudgeId);
		Assert.DoesNotContain(
			game.State.Categories.Round.Prompts.SelectMany(prompt => prompt.Answers),
			answer => answer.PlayerId == "p1");
	}

	[Fact]
	public async Task A_table_that_falls_below_three_ends_with_the_leader_taking_the_match()
	{
		var game = await StartGame();
		var context = TestFixtures.NewContext(game.State, categoriesRules: game.State.CategoriesRules);
		game.State.Categories!.Players.First(player => player.PlayerId == "p2").Score = 4;
		var leaver = game.State.Players.First(player => player.Id == "p1");
		leaver.IsBankrupt = true;

		await new CategoriesFamily().OnPlayerRetiredAsync(leaver, context);

		Assert.True(game.State.IsGameOver);
		Assert.Equal("p2", game.State.WinnerId);
		Assert.Null(game.State.CurrentTurn);
		Assert.Contains(TestFixtures.Announcer(context).Sent, sent => sent.Key == "game.categories_abandoned");
	}
}
