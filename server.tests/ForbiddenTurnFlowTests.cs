using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Commands;
using CorroServer.Services.Corro;
using CorroServer.Services.Corro.Families;

namespace CorroServer.Tests;

public class ForbiddenTurnFlowTests
{
	private static async Task<(GameContext Context, ForbiddenState State, ForbiddenRulesConfig Rules)> StartedTurn()
	{
		var definition = await new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir("forbidden-words"));
		var players = Enumerable.Range(0, 4).Select(index => TestFixtures.NewPlayer($"p{index}", token: definition.Manifest.Tokens[index].Id)).ToList();
		var teams = new List<List<string>> { new() { "p0", "p1" }, new() { "p2", "p3" } };
		var game = new ForbiddenFamily().CreateGame(new FamilyStartContext
		{
			Players = players, Definition = definition, Lang = "en", Teams = teams,
		});
		var rules = game.State.ForbiddenRules!;
		var context = TestFixtures.NewContext(game.State, forbiddenRules: rules);
		var start = await new ForbiddenStartHandler().HandleAsync(new ForbiddenStartCommand { PlayerId = "p0" }, context);
		Assert.IsType<ForbiddenActionResponse>(start);
		return (context, game.State.Forbidden!, rules);
	}

	[Fact]
	public async Task Only_clue_giver_can_start_and_no_readiness_confirmation_is_required()
	{
		var definition = await new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir("forbidden-words"));
		var players = Enumerable.Range(0, 4).Select(index => TestFixtures.NewPlayer($"p{index}", token: definition.Manifest.Tokens[index].Id)).ToList();
		var game = new ForbiddenFamily().CreateGame(new FamilyStartContext
		{
			Players = players,
			Definition = definition,
			Teams = new() { new() { "p0", "p1" }, new() { "p2", "p3" } },
		});
		var context = TestFixtures.NewContext(game.State, forbiddenRules: game.State.ForbiddenRules);

		var guesserStart = await new ForbiddenStartHandler().HandleAsync(
			new ForbiddenStartCommand { PlayerId = "p1" }, context);
		var monitorStart = await new ForbiddenStartHandler().HandleAsync(
			new ForbiddenStartCommand { PlayerId = "p2" }, context);
		var start = await new ForbiddenStartHandler().HandleAsync(
			new ForbiddenStartCommand { PlayerId = "p0" }, context);
		var repeated = await new ForbiddenStartHandler().HandleAsync(
			new ForbiddenStartCommand { PlayerId = "p0" }, context);

		Assert.Equal("FORBIDDEN_WRONG_ROLE", Assert.IsType<ErrorResponse>(guesserStart).Code);
		Assert.Equal("FORBIDDEN_WRONG_ROLE", Assert.IsType<ErrorResponse>(monitorStart).Code);
		Assert.Equal("start", Assert.IsType<ForbiddenActionResponse>(start).Action);
		Assert.Equal(ForbiddenTurnPhase.Active, game.State.Forbidden!.Turn.Phase);
		Assert.NotNull(game.State.Forbidden.Turn.StartedAt);
		Assert.Equal("FORBIDDEN_ALREADY_STARTED", Assert.IsType<ErrorResponse>(repeated).Code);
	}

	[Fact]
	public async Task Correct_scores_deals_exactly_one_new_card_and_rejects_stale_double_activation()
	{
		var (context, state, rules) = await StartedTurn();
		var sequence = state.Turn.CardSequence;
		var target = state.Turn.Target;

		var response = await new ForbiddenCorrectHandler().HandleAsync(
			new ForbiddenCorrectCommand { PlayerId = "p0", CardSequence = sequence }, context);
		var stale = await new ForbiddenCorrectHandler().HandleAsync(
			new ForbiddenCorrectCommand { PlayerId = "p0", CardSequence = sequence }, context);

		Assert.IsType<ForbiddenActionResponse>(response);
		Assert.Equal(rules.CorrectPoints, state.Teams[0].Score);
		Assert.Equal(1, state.Turn.CorrectCount);
		Assert.NotEqual(sequence, state.Turn.CardSequence);
		Assert.NotEqual(target, state.Turn.Target);
		Assert.Equal("FORBIDDEN_STALE_CARD", Assert.IsType<ErrorResponse>(stale).Code);
		var announcement = Assert.Single(
			TestFixtures.Announcer(context).Sent,
			sent => sent.Key == "game.forbidden_correct");
		Assert.Equal(target, announcement.Vars["target"]);
	}

	[Fact]
	public async Task Only_monitor_can_report_a_violation_and_it_applies_the_configured_penalty()
	{
		var (context, state, rules) = await StartedTurn();
		var sequence = state.Turn.CardSequence;

		var wrongRole = await new ForbiddenViolationHandler().HandleAsync(
			new ForbiddenViolationCommand { PlayerId = "p1", CardSequence = sequence }, context);
		var response = await new ForbiddenViolationHandler().HandleAsync(
			new ForbiddenViolationCommand { PlayerId = "p2", CardSequence = sequence }, context);

		Assert.Equal("FORBIDDEN_WRONG_ROLE", Assert.IsType<ErrorResponse>(wrongRole).Code);
		Assert.IsType<ForbiddenActionResponse>(response);
		Assert.Equal(-rules.ViolationPenalty, state.Teams[0].Score);
		Assert.Equal(1, state.Turn.ViolationCount);
	}

	[Fact]
	public async Task Pass_limit_is_authoritative_and_does_not_change_score()
	{
		var (context, state, rules) = await StartedTurn();
		for (var index = 0; index < rules.PassesPerTurn; index++)
		{
			var passed = await new ForbiddenPassHandler().HandleAsync(new ForbiddenPassCommand
			{
				PlayerId = "p0",
				CardSequence = state.Turn.CardSequence,
			}, context);
			Assert.IsType<ForbiddenActionResponse>(passed);
		}

		var refused = await new ForbiddenPassHandler().HandleAsync(new ForbiddenPassCommand
		{
			PlayerId = "p0",
			CardSequence = state.Turn.CardSequence,
		}, context);

		Assert.Equal(0, state.Teams[0].Score);
		Assert.Equal("FORBIDDEN_NO_PASSES", Assert.IsType<ErrorResponse>(refused).Code);
	}

	[Fact]
	public async Task Timeout_rotates_team_and_roles_without_accepting_late_card_action()
	{
		var (context, state, _) = await StartedTurn();
		var expiredSequence = state.Turn.CardSequence;
		state.Turn.StartedAt = DateTime.UtcNow.AddMinutes(-5);

		var late = await new ForbiddenCorrectHandler().HandleAsync(new ForbiddenCorrectCommand
		{
			PlayerId = "p0",
			CardSequence = expiredSequence,
		}, context);

		var result = Assert.IsType<ForbiddenActionResponse>(late);
		Assert.True(result.TurnEnded);
		Assert.Equal(1, state.ActiveTeamIndex);
		Assert.Equal(ForbiddenTurnPhase.Preparing, state.Turn.Phase);
		Assert.Equal("p2", state.Turn.ClueGiverId);
		Assert.Equal("p3", state.Turn.GuesserId);
		Assert.Equal("p0", state.Turn.MonitorId);
		Assert.Equal("p2", context.GameState.CurrentTurn);
		Assert.Contains(TestFixtures.Announcer(context).Sent, sent => sent.Key == "game.forbidden_time_up");
		Assert.Contains(TestFixtures.Announcer(context).Sent, sent => sent.Key == "game.forbidden_turn_preparing");
	}
}
