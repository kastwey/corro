using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Corro.Families;
using CorroServer.Services.Rules;

namespace CorroServer.Services.Commands;

/// <summary>
/// Turn flow of the trivia family (Trivial Pursuit style), on top of the pure
/// <see cref="TriviaRulebook"/>: roll → choose a landing → answer a question → a judge (or the
/// auto-matcher) rules → earn a wedge / roll again / pass the turn. The SERVER owns the voice:
/// every step is announced here with actorId + _self conventions, and the correct answer only
/// ever reaches the judge (privately) until the reveal.
/// </summary>
public static class TriviaTurnFlow
{
	/// <summary>The i18n key carrying a category's (themeable) name, spoken via $t in templates.
	/// Letter-suffixed (a..f) to satisfy the lowercase-no-digits key rule; the package overrides
	/// each with its real category name.</summary>
	internal static string CatKey(int category) => $"game.trivia_cat_{(char)('a' + category)}";

	public static async Task<ServerResponse> ProcessRollAsync(int rolled, Player player, GameContext context)
	{
		var (board, _) = context.Family<TriviaRuntime>();
		var trivia = context.GameState.Trivia
			?? throw new InvalidOperationException("trivia state missing");

		if (trivia.PendingMove != null || trivia.PendingQuestion != null)
		{
			return new ErrorResponse { Message = "Resolve the current step first", Code = "TRIVIA_RESOLVE_FIRST" };
		}

		await context.Announcer.Announce("game.trivia_rolled", new()
		{
			["player"] = player.Name,
			["value"] = rolled,
			["actorId"] = player.Id,
		}, AnnouncementPhase.Move);

		var seat = trivia.Players.First(p => p.PlayerId == player.Id);
		var options = TriviaRulebook.LegalLandings(board, seat.Node, rolled);
		if (options.Count == 0)
		{
			await EndTurnAsync(context);
			return new TriviaActionResponse { Action = "roll", TurnEnded = true };
		}

		trivia.PendingMove = new TriviaPendingMove { PlayerId = player.Id, Rolled = rolled, Options = options };
		return new TriviaActionResponse { Action = "roll" };
	}

	/// <summary>The player has picked a landing square: announce it and resolve what happens there
	/// (a question, a free extra roll, or an inert centre).</summary>
	public static async Task<ServerResponse> ResolveLandingAsync(Player player, GameContext context)
	{
		var (board, rules) = context.Family<TriviaRuntime>();
		var trivia = context.GameState.Trivia!;
		var seat = trivia.Players.First(p => p.PlayerId == player.Id);
		var node = seat.Node;

		if (TriviaRulebook.IsCenter(node))
		{
			// The landing is a CONSEQUENCE of the move (resolve phase), so the client's
			// announcement gate holds it — and the question dialog — until the piece finishes
			// walking to the square (see docs/game-families.md, "Pacing to the move animation").
			await context.Announce("game.trivia_moved_center",
				VisualNarrativeVars.Add(new() { ["player"] = player.Name, ["actorId"] = player.Id },
					"movement", player.Id, player.Id));

			if (TriviaRulebook.HasAllWedges(seat))
			{
				var finalCat = trivia.CategoryCursors.Sum() % TriviaCategories.Count;
				return await PoseQuestionAsync(player, context, finalCat, onWedge: false, atCenter: true, isFinal: true);
			}
			if (rules.CenterWild)
			{
				var wildCat = TriviaRulebook.FirstMissingWedge(seat);
				if (wildCat < 0)
				{
					wildCat = 0;
				}

				return await PoseQuestionAsync(player, context, wildCat, onWedge: false, atCenter: true, isFinal: false);
			}
			await EndTurnAsync(context);
			return new TriviaActionResponse { Action = "move", TurnEnded = true };
		}

		if (TriviaRulebook.IsRollAgain(board, node))
		{
			await context.Announce("game.trivia_roll_again",
				VisualNarrativeVars.Add(new() { ["player"] = player.Name, ["actorId"] = player.Id },
					"movement", player.Id, player.Id, tone: "gain"));
			return new TriviaActionResponse { Action = "move", RollAgain = true };
		}

		var category = TriviaRulebook.CategoryOfNode(board, node);
		var onWedge = TriviaRulebook.IsWedge(board, node);
		var moveKey = onWedge ? "game.trivia_moved_wedge" : "game.trivia_moved";
		// Resolve phase (not Move): the landing paces to the walk — the gate holds it and the
		// question dialog until the piece arrives (see docs/game-families.md).
		await context.Announce(moveKey, VisualNarrativeVars.Add(new()
		{
			["player"] = player.Name,
			["cat"] = CatKey(category),
			["actorId"] = player.Id,
		}, "movement", player.Id, player.Id));

		return await PoseQuestionAsync(player, context, category, onWedge, atCenter: false, isFinal: false);
	}

	private static async Task<ServerResponse> PoseQuestionAsync(
		Player player, GameContext context, int category, bool onWedge, bool atCenter, bool isFinal)
	{
		var (_, rules) = context.Family<TriviaRuntime>();
		var trivia = context.GameState.Trivia!;
		var deck = context.GameState.TriviaDeck ?? new List<Models.Corro.TriviaQuestionDef>();

		var def = TriviaRulebook.PickQuestion(deck, trivia.CategoryCursors, category);
		if (def is null)
		{
			await EndTurnAsync(context);
			return new TriviaActionResponse { Action = "move", TurnEnded = true };
		}

		var judgeId = "";
		if (rules.AnswerMode == "judge")
		{
			var order = context.GameState.Players.Select(p => p.Id).ToList();
			judgeId = TriviaRulebook.JudgeFor(order, trivia, player.Id, trivia.FixedJudgeId) ?? "";
		}

		var choices = new List<string>();
		var correctChoice = -1;
		if (rules.AnswerMode == "choice" && def.Choices.Count >= 2)
		{
			var n = def.Choices.Count;
			var offset = trivia.CategoryCursors.Sum() % n;
			choices = def.Choices.Skip(offset).Concat(def.Choices.Take(offset)).ToList();
			correctChoice = (n - offset) % n;
		}

		trivia.PendingQuestion = new TriviaPendingQuestion
		{
			PlayerId = player.Id,
			JudgeId = judgeId,
			QuestionId = def.Id,
			Category = category,
			Prompt = def.Prompt,
			Choices = choices,
			OnWedge = onWedge,
			AtCenter = atCenter,
			IsFinal = isFinal,
			CorrectAnswer = def.Answer,
			CorrectChoice = correctChoice,
		};

		var key = isFinal ? "game.trivia_final" : "game.trivia_question";
		await context.Announcer.Announce(key, new()
		{
			["player"] = player.Name,
			["cat"] = CatKey(category),
			["prompt"] = def.Prompt,
			["actorId"] = player.Id,
		});
		return new TriviaActionResponse { Action = "move" };
	}

	/// <summary>Reveal the answer, apply the verdict (wedge / win / roll again / pass), and clear
	/// the pending question. Called by the auto-matcher (choice/typed) and the human judge alike.</summary>
	public static async Task<ServerResponse> ResolveVerdictAsync(
		Player active, GameContext context, bool correct, string action)
	{
		var trivia = context.GameState.Trivia!;
		var q = trivia.PendingQuestion!;
		var seat = trivia.Players.First(p => p.PlayerId == active.Id);

		await context.Announce("game.trivia_reveal", VisualNarrativeVars.Add(
			new() { ["correct"] = q.CorrectAnswer ?? "" }, "detail"));

		if (correct)
		{
			await context.Announce("game.trivia_correct",
				VisualNarrativeVars.Add(new() { ["player"] = active.Name, ["actorId"] = active.Id },
					"outcome", targetPlayerId: active.Id, tone: "gain"));

			if (q.OnWedge && !seat.Wedges.Contains(q.Category))
			{
				seat.Wedges.Add(q.Category);
				await context.Announce("game.trivia_wedge", VisualNarrativeVars.Add(new()
				{
					["player"] = active.Name,
					["cat"] = CatKey(q.Category),
					["actorId"] = active.Id,
				}, "milestone", targetPlayerId: active.Id, count: seat.Wedges.Count, tone: "gain"));
				if (TriviaRulebook.HasAllWedges(seat))
				{
					await context.Announce("game.trivia_wedges_complete",
						VisualNarrativeVars.Add(new() { ["player"] = active.Name, ["actorId"] = active.Id },
							"detail", targetPlayerId: active.Id, tone: "gain"));
				}
			}

			trivia.PendingQuestion = null;

			if (q.IsFinal)
			{
				await HandleWinAsync(active, context);
				return new TriviaActionResponse { Action = action, GameEnded = true, TurnEnded = true };
			}

			// A correct answer earns another roll — the same player keeps the turn, so say so.
			await context.Announce("game.trivia_again", VisualNarrativeVars.Add(
				new() { ["player"] = active.Name, ["actorId"] = active.Id },
				"detail", targetPlayerId: active.Id, tone: "gain"));
			return new TriviaActionResponse { Action = action, RollAgain = true };
		}

		await context.Announce("game.trivia_wrong",
			VisualNarrativeVars.Add(new() { ["player"] = active.Name, ["actorId"] = active.Id },
				"outcome", targetPlayerId: active.Id, tone: "loss"));
		trivia.PendingQuestion = null;
		await EndTurnAsync(context);
		return new TriviaActionResponse { Action = action, TurnEnded = true };
	}

	private static async Task HandleWinAsync(Player player, GameContext context)
	{
		player.FinishPlace = 1;
		player.Status = PlayerStatus.Finished;
		context.GameState.WinnerId = player.Id;
		context.GameState.IsGameOver = true;
		await context.Announce("game.trivia_won", VisualNarrativeVars.Add(
			new() { ["player"] = player.Name, ["actorId"] = player.Id },
			"milestone", targetPlayerId: player.Id, tone: "gain"));
		await context.Announce("game.game_over", new() { ["winner"] = player.Name, ["actorId"] = player.Id });
	}

	internal static async Task EndTurnAsync(GameContext context)
	{
		context.Helper.NextTurn();
		var next = context.Helper.GetCurrentPlayer();
		if (next != null)
		{
			await context.Announce("game.turn_of", new() { ["player"] = next.Name, ["actorId"] = next.Id });
		}
	}
}

/// <summary>Trivia family: the host picks the judge before play begins (judgeMode "fixed").</summary>
public class TriviaChooseJudgeHandler : ICommandHandler<TriviaChooseJudgeCommand>
{
	public async Task<ServerResponse> HandleAsync(TriviaChooseJudgeCommand command, GameContext context)
	{
		if (context.RequirePlayer(command.PlayerId, out var player) is { } error)
		{
			return error;
		}

		var trivia = context.GameState.Trivia;
		if (trivia?.PendingJudgeSetup is not { } setup)
		{
			return new ErrorResponse { Message = "No judge choice pending", Code = "TRIVIA_NO_JUDGE_SETUP" };
		}

		if (setup.HostId != player.Id)
		{
			return new ErrorResponse { Message = "Only the host picks the judge", Code = "TRIVIA_NOT_HOST" };
		}

		var chosen = context.GameState.Players.FirstOrDefault(p => p.Id == command.JudgeId);
		var seat = trivia.Players.FirstOrDefault(p => p.PlayerId == command.JudgeId);
		if (chosen == null || chosen.IsBot || seat == null || seat.Retired)
		{
			return new ErrorResponse { Message = "That player cannot be the judge", Code = "TRIVIA_INVALID_JUDGE" };
		}

		trivia.FixedJudgeId = command.JudgeId;
		trivia.PendingJudgeSetup = null;
		context.GameState.CurrentTurn = context.GameState.Players.FirstOrDefault()?.Id;

		await context.Announce("game.trivia_judge_set", new() { ["judge"] = chosen.Name });
		var current = context.GameState.Players.FirstOrDefault(p => p.Id == context.GameState.CurrentTurn);
		if (current != null)
		{
			await context.Announce("game.turn_of", new() { ["player"] = current.Name, ["actorId"] = current.Id });
		}

		return new TriviaActionResponse { Action = "choose_judge" };
	}
}

/// <summary>Trivia family: resolve the pending move by picking a legal landing square.</summary>
public class TriviaMoveHandler : ICommandHandler<TriviaMoveCommand>
{
	public async Task<ServerResponse> HandleAsync(TriviaMoveCommand command, GameContext context)
	{
		if (context.RequirePlayer(command.PlayerId, out var player) is { } error)
		{
			return error;
		}

		var trivia = context.GameState.Trivia;
		if (trivia?.PendingMove is not { } pending || pending.PlayerId != player.Id)
		{
			return new ErrorResponse { Message = "No pending move", Code = "TRIVIA_NO_PENDING_MOVE" };
		}

		if (!pending.Options.Contains(command.Node))
		{
			return new ErrorResponse { Message = "That square is not a legal landing", Code = "TRIVIA_ILLEGAL_MOVE" };
		}

		var seat = trivia.Players.First(p => p.PlayerId == player.Id);
		seat.Node = command.Node;
		trivia.PendingMove = null;

		return await TriviaTurnFlow.ResolveLandingAsync(player, context);
	}
}

/// <summary>Trivia family: the active player submits their answer (written text or a choice index).</summary>
public class TriviaAnswerHandler : ICommandHandler<TriviaAnswerCommand>
{
	public async Task<ServerResponse> HandleAsync(TriviaAnswerCommand command, GameContext context)
	{
		if (context.RequirePlayer(command.PlayerId, out var player) is { } error)
		{
			return error;
		}

		var trivia = context.GameState.Trivia;
		if (trivia?.PendingQuestion is not { } q || q.PlayerId != player.Id)
		{
			return new ErrorResponse { Message = "No question to answer", Code = "TRIVIA_NO_PENDING_QUESTION" };
		}

		if (q.Submitted != null)
		{
			return new ErrorResponse { Message = "You already answered", Code = "TRIVIA_ALREADY_ANSWERED" };
		}

		var (_, rules) = context.Family<TriviaRuntime>();

		string submitted;
		if (rules.AnswerMode == "choice")
		{
			if (command.Choice < 0 || command.Choice >= q.Choices.Count)
			{
				return new ErrorResponse { Message = "Invalid choice", Code = "TRIVIA_BAD_CHOICE" };
			}

			submitted = q.Choices[command.Choice];
		}
		else
		{
			submitted = (command.Text ?? "").Trim();
			if (submitted.Length == 0)
			{
				return new ErrorResponse { Message = "Empty answer", Code = "TRIVIA_EMPTY_ANSWER" };
			}
		}
		q.Submitted = submitted;

		await context.Announce("game.trivia_answered", new()
		{
			["player"] = player.Name,
			["answer"] = submitted,
			["actorId"] = player.Id,
		});

		var hasJudge = rules.AnswerMode == "judge" && !string.IsNullOrEmpty(q.JudgeId);
		if (hasJudge)
		{
			// Prompt the judge privately — only they hear the correct answer.
			await context.Announcer.ToPlayer(q.JudgeId, "game.trivia_judge_prompt", new()
			{
				["player"] = player.Name,
				["answer"] = submitted,
				["correct"] = q.CorrectAnswer ?? "",
			});
			return new TriviaActionResponse { Action = "answer" };
		}

		bool correct;
		if (rules.AnswerMode == "choice")
		{
			correct = command.Choice == q.CorrectChoice;
		}
		else
		{
			var def = (context.GameState.TriviaDeck ?? new List<Models.Corro.TriviaQuestionDef>())
				.FirstOrDefault(d => d.Id == q.QuestionId);
			correct = def != null && TriviaRulebook.AnswerMatches(def, submitted);
		}

		return await TriviaTurnFlow.ResolveVerdictAsync(player, context, correct, "answer");
	}
}

/// <summary>Trivia family: the designated judge rules on the submitted answer.</summary>
public class TriviaJudgeHandler : ICommandHandler<TriviaJudgeCommand>
{
	public async Task<ServerResponse> HandleAsync(TriviaJudgeCommand command, GameContext context)
	{
		if (context.RequirePlayer(command.PlayerId, out var judge) is { } error)
		{
			return error;
		}

		var trivia = context.GameState.Trivia;
		if (trivia?.PendingQuestion is not { } q)
		{
			return new ErrorResponse { Message = "No question to judge", Code = "TRIVIA_NO_PENDING_QUESTION" };
		}

		if (q.JudgeId != judge.Id)
		{
			return new ErrorResponse { Message = "You are not the judge", Code = "TRIVIA_NOT_JUDGE" };
		}

		if (q.Submitted == null)
		{
			return new ErrorResponse { Message = "No answer submitted yet", Code = "TRIVIA_NOT_ANSWERED_YET" };
		}

		var active = context.GameState.Players.FirstOrDefault(p => p.Id == q.PlayerId);
		if (active == null)
		{
			return new ErrorResponse { Message = "Answering player is gone", Code = "TRIVIA_NO_PENDING_QUESTION" };
		}

		return await TriviaTurnFlow.ResolveVerdictAsync(active, context, command.Correct, "judge");
	}
}
