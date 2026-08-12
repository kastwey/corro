using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Corro.Families;
using CorroServer.Services.Rules;

namespace CorroServer.Services.Commands;

/// <summary>Authoritative flow around the pure categories rulebook: the guards every command
/// shares, the two phase transitions (writing closes, the round is scored) and their voice.</summary>
public static class CategoriesRoundFlow
{
	public static ErrorResponse? RequireState(
		GameContext context,
		out CategoriesState state,
		out CategoriesRuntime runtime)
	{
		state = context.GameState.Categories!;
		if (context.GameState.GameType != "categories" || context.GameState.Categories is null)
		{
			runtime = null!;
			return new ErrorResponse { Message = "Wrong game family", Code = "WRONG_FAMILY" };
		}
		runtime = context.FamilyRuntime as CategoriesRuntime
			?? new CategoriesRuntime(context.GameState.CategoriesRules ?? new CategoriesRulesConfig());
		return null;
	}

	/// <summary>The round the caller believes they are acting in must still be the live one:
	/// a slow click after a timeout would otherwise write into the round that replaced it.</summary>
	public static ErrorResponse? RequireRound(CategoriesState state, int roundNumber)
		=> roundNumber != state.Round.RoundNumber
			? new ErrorResponse { Message = "That round has already moved on", Code = "CATEGORIES_STALE_ROUND" }
			: null;

	public static ErrorResponse? RequirePhase(CategoriesState state, CategoriesRoundPhase phase)
		=> state.Round.Phase != phase
			? new ErrorResponse
			{
				Message = phase == CategoriesRoundPhase.Writing
					? "The writing clock is not running"
					: "The round is not at that stage",
				Code = "CATEGORIES_WRONG_PHASE",
			}
			: null;

	/// <summary>Only the judge rules; only the writers write. Neither can do the other's job.</summary>
	public static ErrorResponse? RequireJudge(CategoriesState state, string playerId)
		=> state.Round.JudgeId != playerId
			? new ErrorResponse { Message = "Only the judge rules on this round", Code = "CATEGORIES_NOT_JUDGE" }
			: null;

	public static ErrorResponse? RequireWriter(CategoriesState state, string playerId)
		=> state.Round.JudgeId == playerId
			? new ErrorResponse { Message = "The judge does not write this round", Code = "CATEGORIES_JUDGE_CANNOT_WRITE" }
			: null;

	public static bool DeadlinePassed(CategoriesState state)
		=> CategoriesRulebook.IsExpired(state.Round, DateTime.UtcNow);

	public static string PlayerName(GameState state, string playerId)
		=> state.Players.FirstOrDefault(player => player.Id == playerId)?.Name ?? playerId;

	/// <summary>Close the writing phase and hand the round to the judge, whether the clock ran
	/// out or the last writer finished early.</summary>
	public static async Task<CategoriesActionResponse> BeginReviewAsync(
		GameContext context,
		string action,
		bool timedOut)
	{
		var state = context.GameState.Categories!;
		CategoriesRulebook.BeginReview(state.Round);
		context.GameState.CurrentTurn = state.Round.JudgeId;

		await context.Announce(timedOut ? "game.categories_time_up" : "game.categories_all_finished", new()
		{
			["judge"] = PlayerName(context.GameState, state.Round.JudgeId),
		});
		await AnnounceReviewPromptAsync(context);
		return new CategoriesActionResponse { Action = action, ReviewStarted = true };
	}

	/// <summary>Name the category now under review, and where it sits in the round, so a judge
	/// working through six of them always knows how many are left.</summary>
	public static Task AnnounceReviewPromptAsync(GameContext context)
	{
		var round = context.GameState.Categories!.Round;
		var prompt = round.Prompts[round.ReviewIndex];
		return context.Announce("game.categories_review_prompt", new()
		{
			["category"] = prompt.Name,
			["position"] = round.ReviewIndex + 1,
			["count"] = round.Prompts.Count,
			["actorId"] = round.JudgeId,
		});
	}

	/// <summary>Every category is ruled: bank the points, say what each writer took from the
	/// round, and either deal the next round or end the match.</summary>
	public static async Task<CategoriesActionResponse> ScoreAndAdvanceAsync(GameContext context)
	{
		var state = context.GameState.Categories!;
		var runtime = context.Family<CategoriesRuntime>();
		var round = state.Round;

		foreach (var score in CategoriesRulebook.ScoreRound(state, round, runtime.Rules))
		{
			await context.Announce("game.categories_round_scored", VisualNarrativeVars.Add(new()
			{
				["player"] = PlayerName(context.GameState, score.PlayerId),
				["actorId"] = score.PlayerId,
				["round"] = round.RoundNumber,
				["points"] = score.Points,
				["total"] = score.Total,
			}, "outcome", targetPlayerId: score.PlayerId, tone: score.Points > 0 ? "gain" : "neutral"));
		}

		var seatOrder = context.GameState.Players
			.Where(player => !player.IsBankrupt)
			.Select(player => player.Id)
			.ToList();
		var deck = context.GameState.CategoryDeck
			?? throw new InvalidOperationException("categories deck missing from authoritative state");
		var advance = CategoriesRulebook.CompleteRound(state, seatOrder, deck, runtime.Rules);

		if (advance.GameOver && advance.WinnerId is { } winnerId)
		{
			CategoriesFamily.FinishGame(context.GameState, winnerId);
			var winner = state.Players.First(player => player.PlayerId == winnerId);
			await context.Announce("game.categories_final_score", new()
			{
				["player"] = PlayerName(context.GameState, winnerId),
				["actorId"] = winnerId,
				["total"] = winner.Score,
			});
			await context.Announce("game.game_over", new()
			{
				["winner"] = PlayerName(context.GameState, winnerId),
				["actorId"] = winnerId,
			});
			return new CategoriesActionResponse { Action = "rule", RoundEnded = true, GameEnded = true };
		}

		if (advance.TieBreakerStarted)
		{
			await context.Announce("game.categories_tie_breaker", new()
			{
				["cycle"] = state.Cycle,
				["score"] = state.Players.Max(player => player.Score),
			});
		}

		context.GameState.CurrentTurn = state.Round.JudgeId;
		await CategoriesFamily.AnnounceRoundPreparingAsync(context.Announce, context.GameState);
		return new CategoriesActionResponse { Action = "rule", RoundEnded = true };
	}
}

public sealed class CategoriesStartRoundHandler : PlayerCommandHandler<CategoriesStartRoundCommand>
{
	protected override async Task<ServerResponse> HandleAsync(
		CategoriesStartRoundCommand command,
		Player player,
		GameContext context)
	{
		if (CategoriesRoundFlow.RequireState(context, out var state, out _) is { } stateError)
		{
			return stateError;
		}
		if (CategoriesRoundFlow.RequireRound(state, command.RoundNumber) is { } roundError)
		{
			return roundError;
		}
		if (CategoriesRoundFlow.RequirePhase(state, CategoriesRoundPhase.Preparing) is { } phaseError)
		{
			return phaseError;
		}
		if (CategoriesRoundFlow.RequireJudge(state, player.Id) is { } judgeError)
		{
			return judgeError;
		}

		state.Round.StartedAt = DateTime.UtcNow;
		state.Round.Phase = CategoriesRoundPhase.Writing;
		await context.Announce("game.categories_round_started", new()
		{
			["player"] = player.Name,
			["letter"] = state.Round.Letter,
			["seconds"] = state.Round.DurationSeconds,
			["actorId"] = player.Id,
		});
		return new CategoriesActionResponse { Action = "start" };
	}
}

public sealed class CategoriesWriteHandler : PlayerCommandHandler<CategoriesWriteCommand>
{
	/// <summary>An answer longer than this is not an answer. The cap is generous enough for a
	/// full phrase and small enough that a sheet can never be used to push bulk at the table.</summary>
	internal const int MaxAnswerLength = 60;

	protected override async Task<ServerResponse> HandleAsync(
		CategoriesWriteCommand command,
		Player player,
		GameContext context)
	{
		if (CategoriesRoundFlow.RequireState(context, out var state, out _) is { } stateError)
		{
			return stateError;
		}
		if (CategoriesRoundFlow.RequireRound(state, command.RoundNumber) is { } roundError)
		{
			return roundError;
		}
		if (CategoriesRoundFlow.RequirePhase(state, CategoriesRoundPhase.Writing) is { } phaseError)
		{
			return phaseError;
		}
		if (CategoriesRoundFlow.RequireWriter(state, player.Id) is { } writerError)
		{
			return writerError;
		}
		// The clock is the whole game here: an answer that arrives after the deadline is not an
		// answer, so the crossing closes the round instead of accepting it.
		if (CategoriesRoundFlow.DeadlinePassed(state))
		{
			return await CategoriesRoundFlow.BeginReviewAsync(context, "write", timedOut: true);
		}
		if (state.Round.FinishedWriterIds.Contains(player.Id))
		{
			return new ErrorResponse { Message = "You already finished writing", Code = "CATEGORIES_ALREADY_FINISHED" };
		}

		foreach (var entry in command.Entries)
		{
			var text = (entry.Text ?? string.Empty).Trim();
			if (text.Length > MaxAnswerLength)
			{
				return new ErrorResponse { Message = "That answer is too long", Code = "CATEGORIES_ANSWER_TOO_LONG" };
			}
			if (!CategoriesRulebook.WriteAnswer(state.Round, player.Id, entry.CategoryId, text))
			{
				return new ErrorResponse { Message = "That category is not in this round", Code = "CATEGORIES_UNKNOWN_CATEGORY" };
			}
		}

		// Deliberately silent: a sheet is saved as it is typed, and a spoken line per keystroke
		// would talk over the very clock the writer is racing.
		return new CategoriesActionResponse { Action = "write" };
	}
}

public sealed class CategoriesFinishWritingHandler : PlayerCommandHandler<CategoriesFinishWritingCommand>
{
	protected override async Task<ServerResponse> HandleAsync(
		CategoriesFinishWritingCommand command,
		Player player,
		GameContext context)
	{
		if (CategoriesRoundFlow.RequireState(context, out var state, out _) is { } stateError)
		{
			return stateError;
		}
		if (CategoriesRoundFlow.RequireRound(state, command.RoundNumber) is { } roundError)
		{
			return roundError;
		}
		if (CategoriesRoundFlow.RequirePhase(state, CategoriesRoundPhase.Writing) is { } phaseError)
		{
			return phaseError;
		}
		if (CategoriesRoundFlow.RequireWriter(state, player.Id) is { } writerError)
		{
			return writerError;
		}
		if (CategoriesRoundFlow.DeadlinePassed(state))
		{
			return await CategoriesRoundFlow.BeginReviewAsync(context, "finish", timedOut: true);
		}
		if (state.Round.FinishedWriterIds.Contains(player.Id))
		{
			return new ErrorResponse { Message = "You already finished writing", Code = "CATEGORIES_ALREADY_FINISHED" };
		}

		state.Round.FinishedWriterIds.Add(player.Id);
		var writers = CategoriesRulebook.Writers(state, state.Round);
		var remaining = writers.Count - state.Round.FinishedWriterIds.Count;
		await context.Announce("game.categories_writer_finished", new()
		{
			["player"] = player.Name,
			["remaining"] = remaining,
			["actorId"] = player.Id,
		});

		// Everyone is done with time to spare: nobody should sit listening to a clock that no
		// longer decides anything.
		return remaining <= 0
			? await CategoriesRoundFlow.BeginReviewAsync(context, "finish", timedOut: false)
			: new CategoriesActionResponse { Action = "finish" };
	}
}

public sealed class CategoriesRulePromptHandler : PlayerCommandHandler<CategoriesRulePromptCommand>
{
	protected override async Task<ServerResponse> HandleAsync(
		CategoriesRulePromptCommand command,
		Player player,
		GameContext context)
	{
		if (CategoriesRoundFlow.RequireState(context, out var state, out var runtime) is { } stateError)
		{
			return stateError;
		}
		if (CategoriesRoundFlow.RequireRound(state, command.RoundNumber) is { } roundError)
		{
			return roundError;
		}
		if (CategoriesRoundFlow.RequirePhase(state, CategoriesRoundPhase.Review) is { } phaseError)
		{
			return phaseError;
		}
		if (CategoriesRoundFlow.RequireJudge(state, player.Id) is { } judgeError)
		{
			return judgeError;
		}

		var round = state.Round;
		if (command.PromptIndex != round.ReviewIndex)
		{
			return new ErrorResponse
			{
				Message = "That category has already been ruled",
				Code = "CATEGORIES_STALE_PROMPT",
			};
		}

		var prompt = round.Prompts[round.ReviewIndex];
		var rulings = new Dictionary<string, CategoriesVerdict>(StringComparer.Ordinal);
		foreach (var ruling in command.Rulings)
		{
			if (!TryParseVerdict(ruling.Verdict, out var verdict))
			{
				return new ErrorResponse { Message = "Unknown verdict", Code = "CATEGORIES_UNKNOWN_VERDICT" };
			}
			rulings[ruling.PlayerId] = verdict;
		}

		// Every answer that needs a human must have had one. Silently rejecting the ones a
		// malformed ruling left out would cost a player points they were never told about.
		var unruled = prompt.Answers
			.Where(answer => AnswerText.Normalize(answer.Text).Length > 0)
			.Select(answer => answer.PlayerId)
			.Where(id => !rulings.ContainsKey(id))
			.ToList();
		if (unruled.Count > 0)
		{
			return new ErrorResponse
			{
				Message = "Every written answer needs a verdict",
				Code = "CATEGORIES_INCOMPLETE_RULING",
			};
		}

		CategoriesRulebook.RulePrompt(prompt, rulings);
		await AnnounceRulingAsync(context, prompt, runtime.Rules);
		round.ReviewIndex++;

		if (round.ReviewIndex < round.Prompts.Count)
		{
			await CategoriesRoundFlow.AnnounceReviewPromptAsync(context);
			return new CategoriesActionResponse { Action = "rule" };
		}
		return await CategoriesRoundFlow.ScoreAndAdvanceAsync(context);
	}

	/// <summary>
	/// The table hears the shape of the ruling — how many answers stood, how many were repeated,
	/// how many fell — and each writer hears their OWN answer's fate privately. Reading every
	/// player's answer aloud on every category would be six players read out six times a round;
	/// hearing what happened to YOUR answer is the part nobody can get from a summary.
	/// </summary>
	private static async Task AnnounceRulingAsync(
		GameContext context,
		CategoriesPromptState prompt,
		CategoriesRulesConfig rules)
	{
		var accepted = prompt.Answers.Count(answer => answer.Verdict == CategoriesVerdict.Accepted);
		// The ruling is the moment of the round, and a player who is not reading the live region
		// has no other way to learn it: the surface moves straight on to the next category. It
		// therefore carries visual metadata, so the shared narrative shows it like any other
		// family's authoritative outcome.
		await context.Announce("game.categories_prompt_ruled", VisualNarrativeVars.Add(new()
		{
			["category"] = prompt.Name,
			["accepted"] = accepted,
			["duplicates"] = prompt.Answers.Count(answer => answer.Verdict == CategoriesVerdict.Duplicate),
			["rejected"] = prompt.Answers.Count(answer => answer.Verdict == CategoriesVerdict.Rejected),
		}, "outcome", count: accepted, tone: accepted > 0 ? "gain" : "neutral"));

		foreach (var answer in prompt.Answers)
		{
			if (AnswerText.Normalize(answer.Text).Length == 0)
			{
				continue;
			}
			var key = answer.Verdict switch
			{
				CategoriesVerdict.Accepted => "game.categories_answer_accepted",
				CategoriesVerdict.Duplicate => "game.categories_answer_duplicate",
				_ => "game.categories_answer_rejected",
			};
			// Targeted at its writer, so their own seat is the one the narrative emphasises.
			await context.Announcer.ToPlayer(answer.PlayerId, key, VisualNarrativeVars.Add(new()
			{
				["category"] = prompt.Name,
				["answer"] = answer.Text,
				["points"] = rules.PointsPerAnswer,
			}, "outcome", targetPlayerId: answer.PlayerId,
				tone: answer.Verdict == CategoriesVerdict.Accepted ? "gain" : "loss"));
		}
	}

	internal static bool TryParseVerdict(string? value, out CategoriesVerdict verdict)
	{
		switch (value?.ToLowerInvariant())
		{
			case "accepted": verdict = CategoriesVerdict.Accepted; return true;
			case "rejected": verdict = CategoriesVerdict.Rejected; return true;
			case "duplicate": verdict = CategoriesVerdict.Duplicate; return true;
			default: verdict = CategoriesVerdict.Pending; return false;
		}
	}
}

public sealed class CategoriesExpireRoundHandler : ICommandHandler<CategoriesExpireRoundCommand>
{
	public async Task<ServerResponse> HandleAsync(CategoriesExpireRoundCommand command, GameContext context)
	{
		if (CategoriesRoundFlow.RequireState(context, out var state, out _) is { } stateError)
		{
			return stateError;
		}
		if (CategoriesRoundFlow.RequirePhase(state, CategoriesRoundPhase.Writing) is { } phaseError)
		{
			return phaseError;
		}
		if (!CategoriesRoundFlow.DeadlinePassed(state))
		{
			return new ErrorResponse { Message = "Time remains", Code = "CATEGORIES_TIME_REMAINING" };
		}
		return await CategoriesRoundFlow.BeginReviewAsync(context, "timeout", timedOut: true);
	}
}
