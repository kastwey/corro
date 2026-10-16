using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Corro.Families;
using CorroServer.Services.Rules;

namespace CorroServer.Services.Commands;

/// <summary>Authoritative flow around the pure forbidden-word rulebook.</summary>
public static class ForbiddenTurnFlow
{
	public static ErrorResponse? RequireState(GameContext context, out ForbiddenState state, out ForbiddenRuntime runtime)
	{
		state = context.GameState.Forbidden!;
		if (context.GameState.GameType != "forbidden" || context.GameState.Forbidden is null)
		{
			runtime = null!;
			return new ErrorResponse { Message = "Wrong game family", Code = "WRONG_FAMILY" };
		}
		runtime = context.FamilyRuntime as ForbiddenRuntime ?? new ForbiddenRuntime(
			context.GameState.ForbiddenRules ?? new ForbiddenRulesConfig());
		return null;
	}

	public static ErrorResponse? RequireActiveCard(
		ForbiddenState state,
		string playerId,
		string requiredRoleId,
		int cardSequence)
	{
		if (state.Turn.Phase != ForbiddenTurnPhase.Active)
		{
			return new ErrorResponse { Message = "The timed turn is not active", Code = "FORBIDDEN_NOT_ACTIVE" };
		}
		if (playerId != requiredRoleId)
		{
			return new ErrorResponse { Message = "That action belongs to another role", Code = "FORBIDDEN_WRONG_ROLE" };
		}
		if (cardSequence != state.Turn.CardSequence)
		{
			return new ErrorResponse { Message = "That card has already changed", Code = "FORBIDDEN_STALE_CARD" };
		}
		return null;
	}

	public static async Task<ForbiddenActionResponse> ExpireTurnAsync(GameContext context)
	{
		var state = context.GameState.Forbidden!;
		var runtime = context.Family<ForbiddenRuntime>();
		var solo = runtime.Rules.PlaysSolo();
		var oldTurn = state.Turn;
		var team = state.Teams[oldTurn.TeamIndex];
		await context.Announce(solo ? "game.forbidden_time_up_solo" : "game.forbidden_time_up", new()
		{
			// The same fact under either seating: who just played, and where that leaves them.
			[solo ? "player" : "team"] = ForbiddenFamily.SideVar(context.GameState, team.TeamIndex),
			["correct"] = oldTurn.CorrectCount,
			["score"] = team.Score,
		});

		var deck = context.GameState.ForbiddenDeck
			?? throw new InvalidOperationException("forbidden deck missing from authoritative state");
		var advance = ForbiddenRulebook.CompleteTurn(state, deck, runtime.Rules);
		if (advance.GameOver && advance.WinnerTeamIndex is { } winnerIndex)
		{
			ForbiddenFamily.FinishGame(context.GameState, winnerIndex);
			var winner = state.Teams.First(entry => entry.TeamIndex == winnerIndex);
			var winnerVar = ForbiddenFamily.SideVar(context.GameState, winnerIndex);
			if (solo)
			{
				await context.Announce("game.forbidden_won_solo", new()
				{
					["player"] = winnerVar,
					["score"] = winner.Score,
					["actorId"] = winner.MemberIds[0],
				});
			}
			else
			{
				await context.Announce("game.forbidden_team_won", new()
				{
					["team"] = winnerVar,
					["score"] = winner.Score,
				});
			}
			await context.Announce("game.game_over", new() { ["winner"] = winnerVar });
			return new ForbiddenActionResponse { Action = "timeout", TurnEnded = true, GameEnded = true };
		}

		if (advance.TieBreakerStarted)
		{
			await context.Announce(solo ? "game.forbidden_tie_breaker_solo" : "game.forbidden_tie_breaker", new()
			{
				["cycle"] = state.Cycle,
				["score"] = state.Teams.Max(side => side.Score),
			});
		}
		context.GameState.CurrentTurn = state.Turn.ClueGiverId;
		await ForbiddenFamily.AnnouncePreparingTurnAsync(context.Announce, context.GameState);
		return new ForbiddenActionResponse { Action = "timeout", TurnEnded = true };
	}

	public static bool DeadlinePassed(ForbiddenState state)
		=> ForbiddenRulebook.IsExpired(state.Turn, DateTime.UtcNow);

	public static string PlayerName(GameState state, string playerId)
		=> ForbiddenFamily.PlayerName(state, playerId);
}

public sealed class ForbiddenStartHandler : PlayerCommandHandler<ForbiddenStartCommand>
{
	protected override async Task<ServerResponse> HandleAsync(ForbiddenStartCommand command, Player player, GameContext context)
	{
		if (ForbiddenTurnFlow.RequireState(context, out var state, out var runtime) is { } stateError)
		{
			return stateError;
		}
		var turn = state.Turn;
		if (turn.Phase != ForbiddenTurnPhase.Preparing)
		{
			return new ErrorResponse { Message = "The turn has already started", Code = "FORBIDDEN_ALREADY_STARTED" };
		}
		if (turn.ClueGiverId != player.Id)
		{
			return new ErrorResponse { Message = "Only the clue-giver starts the turn", Code = "FORBIDDEN_WRONG_ROLE" };
		}

		turn.StartedAt = DateTime.UtcNow;
		turn.Phase = ForbiddenTurnPhase.Active;
		var vars = new Dictionary<string, object>
		{
			["player"] = player.Name,
			["seconds"] = turn.DurationSeconds,
			["actorId"] = player.Id,
		};
		if (runtime.Rules.PlaysSolo())
		{
			await context.Announce("game.forbidden_turn_started_solo", vars);
		}
		else
		{
			vars["team"] = ForbiddenFamily.TeamVar(turn.TeamIndex);
			await context.Announce("game.forbidden_turn_started", vars);
		}
		return new ForbiddenActionResponse { Action = "start" };
	}
}

public sealed class ForbiddenCorrectHandler : PlayerCommandHandler<ForbiddenCorrectCommand>
{
	protected override async Task<ServerResponse> HandleAsync(ForbiddenCorrectCommand command, Player player, GameContext context)
	{
		if (ForbiddenTurnFlow.RequireState(context, out var state, out var runtime) is { } stateError)
		{
			return stateError;
		}
		if (ForbiddenTurnFlow.RequireActiveCard(state, player.Id, state.Turn.ClueGiverId, command.CardSequence) is { } actionError)
		{
			return actionError;
		}
		if (ForbiddenTurnFlow.DeadlinePassed(state))
		{
			return await ForbiddenTurnFlow.ExpireTurnAsync(context);
		}

		var turn = state.Turn;
		var target = turn.Target ?? string.Empty;
		var credited = ForbiddenRulebook.AwardCorrect(state, runtime.Rules);
		var vars = new Dictionary<string, object>
		{
			["player"] = player.Name,
			["guesser"] = ForbiddenTurnFlow.PlayerName(context.GameState, turn.GuesserId),
			["target"] = target,
			["points"] = runtime.Rules.CorrectPoints,
			["score"] = credited[0].Score,
			["actorId"] = player.Id,
		};
		if (runtime.Rules.PlaysSolo())
		{
			// Two people just scored, so the line names both totals: the clue-giver's, then the guesser's.
			vars["guesserScore"] = credited[1].Score;
			await context.Announce("game.forbidden_correct_solo", vars);
		}
		else
		{
			vars["team"] = ForbiddenFamily.TeamVar(credited[0].TeamIndex);
			await context.Announce("game.forbidden_correct", vars);
		}
		ForbiddenRulebook.DealNextCard(state, context.GameState.ForbiddenDeck!);
		return new ForbiddenActionResponse { Action = "correct" };
	}
}

public sealed class ForbiddenPassHandler : PlayerCommandHandler<ForbiddenPassCommand>
{
	protected override async Task<ServerResponse> HandleAsync(ForbiddenPassCommand command, Player player, GameContext context)
	{
		if (ForbiddenTurnFlow.RequireState(context, out var state, out var runtime) is { } stateError)
		{
			return stateError;
		}
		if (ForbiddenTurnFlow.RequireActiveCard(state, player.Id, state.Turn.ClueGiverId, command.CardSequence) is { } actionError)
		{
			return actionError;
		}
		if (ForbiddenTurnFlow.DeadlinePassed(state))
		{
			return await ForbiddenTurnFlow.ExpireTurnAsync(context);
		}
		if (state.Turn.PassesUsed >= runtime.Rules.PassesPerTurn)
		{
			return new ErrorResponse { Message = "No passes remain", Code = "FORBIDDEN_NO_PASSES" };
		}

		var target = state.Turn.Target ?? string.Empty;
		state.Turn.PassesUsed++;
		await context.Announce("game.forbidden_passed", new()
		{
			["player"] = player.Name,
			["target"] = target,
			["remaining"] = runtime.Rules.PassesPerTurn - state.Turn.PassesUsed,
			["actorId"] = player.Id,
		});
		ForbiddenRulebook.DealNextCard(state, context.GameState.ForbiddenDeck!);
		return new ForbiddenActionResponse { Action = "pass" };
	}
}

public sealed class ForbiddenViolationHandler : PlayerCommandHandler<ForbiddenViolationCommand>
{
	protected override async Task<ServerResponse> HandleAsync(ForbiddenViolationCommand command, Player player, GameContext context)
	{
		if (ForbiddenTurnFlow.RequireState(context, out var state, out var runtime) is { } stateError)
		{
			return stateError;
		}
		if (ForbiddenTurnFlow.RequireActiveCard(state, player.Id, state.Turn.MonitorId, command.CardSequence) is { } actionError)
		{
			return actionError;
		}
		if (ForbiddenTurnFlow.DeadlinePassed(state))
		{
			return await ForbiddenTurnFlow.ExpireTurnAsync(context);
		}

		var turn = state.Turn;
		var target = turn.Target ?? string.Empty;
		var penalised = ForbiddenRulebook.PenaliseViolation(state, runtime.Rules);
		var vars = new Dictionary<string, object>
		{
			["monitor"] = player.Name,
			["clueGiver"] = ForbiddenTurnFlow.PlayerName(context.GameState, turn.ClueGiverId),
			["target"] = target,
			["points"] = runtime.Rules.ViolationPenalty,
			["score"] = penalised.Score,
			["actorId"] = player.Id,
		};
		if (runtime.Rules.PlaysSolo())
		{
			await context.Announce("game.forbidden_violation_solo", vars);
		}
		else
		{
			vars["team"] = ForbiddenFamily.TeamVar(penalised.TeamIndex);
			await context.Announce("game.forbidden_violation", vars);
		}
		ForbiddenRulebook.DealNextCard(state, context.GameState.ForbiddenDeck!);
		return new ForbiddenActionResponse { Action = "violation" };
	}
}

public sealed class ForbiddenExpireTurnHandler : ICommandHandler<ForbiddenExpireTurnCommand>
{
	public async Task<ServerResponse> HandleAsync(ForbiddenExpireTurnCommand command, GameContext context)
	{
		if (ForbiddenTurnFlow.RequireState(context, out var state, out _) is { } stateError)
		{
			return stateError;
		}
		if (state.Turn.Phase != ForbiddenTurnPhase.Active)
		{
			return new ErrorResponse { Message = "The timed turn is not active", Code = "FORBIDDEN_NOT_ACTIVE" };
		}
		if (!ForbiddenTurnFlow.DeadlinePassed(state))
		{
			return new ErrorResponse { Message = "Time remains", Code = "FORBIDDEN_TIME_REMAINING" };
		}
		return await ForbiddenTurnFlow.ExpireTurnAsync(context);
	}
}
