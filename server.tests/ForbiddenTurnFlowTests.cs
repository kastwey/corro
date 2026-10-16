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

	private static async Task<(GameContext Context, ForbiddenState State, ForbiddenRulesConfig Rules)> StartedSoloTurn()
	{
		var definition = await new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir("forbidden-words"));
		var players = Enumerable.Range(0, 3).Select(index => TestFixtures.NewPlayer($"p{index}", token: definition.Manifest.Tokens[index].Id)).ToList();
		var game = new ForbiddenFamily().CreateGame(new FamilyStartContext
		{
			Players = players, Definition = definition, Lang = "en",
			RuleValues = new()
			{
				["forbiddenMode"] = System.Text.Json.JsonSerializer.SerializeToElement("solo"),
				// One rotation: the shortest match the rules allow, whatever the package ships.
				["forbiddenCycles"] = System.Text.Json.JsonSerializer.SerializeToElement(1),
			},
		});
		var rules = game.State.ForbiddenRules!;
		var context = TestFixtures.NewContext(game.State, forbiddenRules: rules);
		Assert.IsType<ForbiddenActionResponse>(
			await new ForbiddenStartHandler().HandleAsync(new ForbiddenStartCommand { PlayerId = "p0" }, context));
		return (context, game.State.Forbidden!, rules);
	}

	// Everyone for themselves speaks in names, never in team colours: every line the team seating
	// says about "the Red team" has a counterpart here that names the person, because "the Ana
	// gains a point" is not a sentence anybody should hear.
	[Fact]
	public async Task Everyone_for_themselves_credits_both_players_and_speaks_in_names()
	{
		var (context, state, rules) = await StartedSoloTurn();
		var announcer = TestFixtures.Announcer(context);
		Assert.Contains(announcer.Sent, sent => sent.Key == "game.forbidden_turn_started_solo" && (string)sent.Vars["player"] == "p0");
		Assert.DoesNotContain(announcer.Sent, sent => sent.Key == "game.forbidden_turn_started");

		var correct = await new ForbiddenCorrectHandler().HandleAsync(
			new ForbiddenCorrectCommand { PlayerId = "p0", CardSequence = state.Turn.CardSequence }, context);

		Assert.IsType<ForbiddenActionResponse>(correct);
		Assert.Equal(new[] { rules.CorrectPoints, rules.CorrectPoints, 0 }, state.Teams.Select(side => side.Score));
		var line = Assert.Single(announcer.Sent, sent => sent.Key == "game.forbidden_correct_solo");
		Assert.Equal("p0", line.Vars["player"]);
		Assert.Equal("p1", line.Vars["guesser"]);
		Assert.Equal(rules.CorrectPoints, line.Vars["score"]);
		Assert.Equal(rules.CorrectPoints, line.Vars["guesserScore"]);
		Assert.False(line.Vars.ContainsKey("team"));

		var violation = await new ForbiddenViolationHandler().HandleAsync(
			new ForbiddenViolationCommand { PlayerId = "p2", CardSequence = state.Turn.CardSequence }, context);

		Assert.IsType<ForbiddenActionResponse>(violation);
		Assert.Equal(new[] { rules.CorrectPoints - rules.ViolationPenalty, rules.CorrectPoints, 0 }, state.Teams.Select(side => side.Score));
		var slip = Assert.Single(announcer.Sent, sent => sent.Key == "game.forbidden_violation_solo");
		Assert.Equal("p0", slip.Vars["clueGiver"]);
		Assert.Equal("p2", slip.Vars["monitor"]);
	}

	[Fact]
	public async Task A_solo_timeout_moves_the_three_roles_one_seat_along()
	{
		var (context, state, _) = await StartedSoloTurn();
		state.Turn.StartedAt = DateTime.UtcNow.AddMinutes(-5);

		var late = await new ForbiddenCorrectHandler().HandleAsync(new ForbiddenCorrectCommand
		{
			PlayerId = "p0",
			CardSequence = state.Turn.CardSequence,
		}, context);

		Assert.True(Assert.IsType<ForbiddenActionResponse>(late).TurnEnded);
		Assert.Equal(("p1", "p2", "p0"), (state.Turn.ClueGiverId, state.Turn.GuesserId, state.Turn.MonitorId));
		Assert.Equal("p1", context.GameState.CurrentTurn);
		var announcer = TestFixtures.Announcer(context);
		Assert.Equal("p0", Assert.Single(announcer.Sent, sent => sent.Key == "game.forbidden_time_up_solo").Vars["player"]);
		var preparing = Assert.Single(announcer.Sent, sent => sent.Key == "game.forbidden_turn_preparing_solo");
		Assert.Equal("p1", preparing.Vars["clueGiver"]);
		Assert.Equal("p1", preparing.Vars["actorId"]);
		Assert.DoesNotContain(announcer.Sent, sent => sent.Key is "game.forbidden_time_up" or "game.forbidden_turn_preparing");
	}

	[Fact]
	public async Task A_solo_match_is_won_by_name_once_the_rotation_leaves_a_lone_leader()
	{
		var (context, state, _) = await StartedSoloTurn();
		state.Teams[2].Score = 6; // nobody else scores: p2 leads alone once everyone has given clues
		var announcer = TestFixtures.Announcer(context);

		for (var turn = 0; turn < 3; turn++)
		{
			state.Turn.Phase = ForbiddenTurnPhase.Active;
			state.Turn.StartedAt = DateTime.UtcNow.AddMinutes(-5);
			await new ForbiddenExpireTurnHandler().HandleAsync(new ForbiddenExpireTurnCommand { PlayerId = state.Turn.ClueGiverId }, context);
		}

		Assert.True(context.GameState.IsGameOver);
		Assert.Equal("p2", context.GameState.WinnerId);
		var won = Assert.Single(announcer.Sent, sent => sent.Key == "game.forbidden_won_solo");
		Assert.Equal("p2", won.Vars["player"]);
		Assert.Equal("p2", won.Vars["actorId"]);
		Assert.Equal("p2", Assert.Single(announcer.Sent, sent => sent.Key == "game.game_over").Vars["winner"]);
		Assert.DoesNotContain(announcer.Sent, sent => sent.Key == "game.forbidden_team_won");
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
