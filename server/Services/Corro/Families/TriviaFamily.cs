using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Commands;
using CorroServer.Services.Rules;

namespace CorroServer.Services.Corro.Families;

/// <summary>Trivia-family runtime: the wheel board and its rules, for the command handlers.</summary>
public sealed record TriviaRuntime(TriviaBoardDef Board, TriviaRulesConfig Rules) : IFamilyRuntime;

/// <summary>
/// The trivia family (Trivial Pursuit style): one piece per player on a hub-and-spoke WHEEL.
/// Roll and move; landing asks a question of the square's category; a correct answer on a
/// category headquarters ("wedge") earns that wedge; collect all six, return to the centre and
/// answer a final question to win. Answers are adjudicated by a human judge (rotating by
/// default, or a fixed judge the host picks at game start) or auto-matched (choice/typed modes).
/// This is the first BOARD family with hidden information — a pending question's correct answer
/// reaches only the judge, through <see cref="ProjectFor"/> — and the first without bots (a bot
/// with the answer card is meaningless), which it opts out of simply by shipping no bot policy.
/// </summary>
public sealed class TriviaFamily : IGameFamily
{
	public string GameType => "trivia";

	public async Task<GameDefinition> LoadDefinitionAsync(string packageDir, Manifest manifest,
		Dictionary<string, Dictionary<string, string>> i18n)
	{
		var board = await PackageJson.ReadAsync<TriviaBoardDef>(packageDir, "board.json");
		var questions = new Dictionary<string, List<TriviaQuestionDef>>();
		foreach (var loc in manifest.Locales)
		{
			var qs = await PackageJson.ReadOptionalAsync<List<TriviaQuestionDef>>(packageDir, $"questions.{loc}.json");
			if (qs is { Count: > 0 })
			{
				questions[loc] = qs;
			}
		}
		return new GameDefinition
		{
			Manifest = manifest,
			TriviaBoard = board,
			TriviaQuestions = questions,
			Cards = new List<CardDef>(),
			I18n = i18n,
		};
	}

	/// <summary>Structural checks of a "trivia" wheel: a coherent spoke length, exactly six wedge
	/// slots covering the six categories, in-range slot categories, valid rule modes, and a
	/// question deck that covers every category in each shipped locale.</summary>
	public void ValidateDefinition(GameDefinition d)
	{
		var board = d.TriviaBoard
			?? throw new InvalidOperationException("trivia package has no board (board.json).");

		if (board.SpokeLength < 1)
		{
			throw new InvalidOperationException("trivia board spokeLength must be at least 1.");
		}

		if (board.Ring.Count < TriviaCategories.Count)
		{
			throw new InvalidOperationException($"trivia ring must have at least {TriviaCategories.Count} slots.");
		}

		var wedges = TriviaRulebook.WedgeRingIndices(board);
		if (wedges.Length != TriviaCategories.Count)
		{
			throw new InvalidOperationException(
				$"trivia ring must have exactly {TriviaCategories.Count} wedge slots (one category headquarters each).");
		}

		var wedgeCats = wedges.Select(k => board.Ring[k].Category).ToHashSet();
		if (wedgeCats.Count != TriviaCategories.Count || wedgeCats.Any(c => c < 0 || c >= TriviaCategories.Count))
		{
			throw new InvalidOperationException(
				$"the {TriviaCategories.Count} wedges must cover categories 0..{TriviaCategories.Count - 1}, each exactly once.");
		}

		foreach (var slot in board.Ring)
		{
			if (slot.Category < 0 || slot.Category >= TriviaCategories.Count)
			{
				throw new InvalidOperationException(
					$"trivia ring slot category {slot.Category} is out of range (0..{TriviaCategories.Count - 1}).");
			}
		}

		var rules = d.Manifest.TriviaRules ?? new TriviaRulesConfig();
		if (rules.AnswerMode is not ("judge" or "choice" or "typed"))
		{
			throw new InvalidOperationException("triviaRules.answerMode must be \"judge\", \"choice\" or \"typed\".");
		}

		if (rules.JudgeMode is not ("rotating" or "fixed"))
		{
			throw new InvalidOperationException("triviaRules.judgeMode must be \"rotating\" or \"fixed\".");
		}

		if (d.TriviaQuestions is not { Count: > 0 })
		{
			throw new InvalidOperationException("trivia package has no questions (questions.<locale>.json).");
		}

		foreach (var (loc, qs) in d.TriviaQuestions)
		{
			for (var c = 0; c < TriviaCategories.Count; c++)
			{
				if (qs.All(q => q.Category != c))
				{
					throw new InvalidOperationException(
						$"trivia locale '{loc}' has no question for category {c}; every category needs at least one.");
				}
			}

			if (rules.AnswerMode == "choice")
			{
				foreach (var q in qs)
				{
					if (q.Choices.Count < 2)
					{
						throw new InvalidOperationException(
							$"trivia question '{q.Id}' ({loc}) needs at least two choices for \"choice\" mode.");
					}
				}
			}
		}
	}

	/// <summary>Trivia-family game start: everyone at the centre with no wedges, the deck resolved
	/// to the game's language and shuffled into deal order. In "judge"+"fixed" mode the first turn
	/// is gated behind the host's judge choice (CurrentTurn stays null until then).</summary>
	public FamilyGame CreateGame(FamilyStartContext start)
	{
		var definition = start.Definition;
		var board = definition.TriviaBoard
			?? throw new InvalidOperationException("trivia package has no board (board.json).");
		var rules = definition.Manifest.TriviaRules ?? new TriviaRulesConfig();

		var lang = start.Lang;
		var resolved = definition.TriviaQuestions?.GetValueOrDefault(lang)
			?? definition.TriviaQuestions?.Values.FirstOrDefault()
			?? new List<TriviaQuestionDef>();
		var deck = (start.Random is { } rnd ? rnd.Shuffle(resolved) : resolved).ToList();

		var trivia = TriviaRulebook.CreateInitialState(start.Players.Select(p => p.Id));
		var needsJudgeSetup = rules.AnswerMode == "judge" && rules.JudgeMode == "fixed";
		var hostId = start.Players.FirstOrDefault()?.Id;
		if (needsJudgeSetup && hostId != null)
		{
			trivia.PendingJudgeSetup = new TriviaPendingJudgeSetup { HostId = hostId };
		}

		var state = new GameState
		{
			GameType = "trivia",
			Trivia = trivia,
			TriviaBoard = board,
			TriviaDeck = deck,
			TriviaRules = rules,

			Players = start.Players.Select((p, i) => new Player
			{
				Id = p.Id,
				Name = p.Name,
				Token = p.Token,
				IsBot = p.IsBot,
				Position = 0,
				Money = 0,
				Color = EnginePalette.ColorFor(i),
			}).ToList(),
			CurrentTurn = needsJudgeSetup ? null : start.Players.FirstOrDefault()?.Id,
			BoardName = definition.Manifest.Name is { Count: > 0 } ? new Dictionary<string, string>(definition.Manifest.Name) : null,
			CenterBrand = definition.Manifest.CenterBrand,
			Tokens = definition.Manifest.Tokens,
			Currency = definition.Manifest.Currency,
			Terminology = definition.Manifest.Terminology,
		};

		return new FamilyGame { State = state, Runtime = new TriviaRuntime(board, rules) };
	}

	public IFamilyRuntime? CreateRuntime(GameDefinition definition)
		=> definition.TriviaBoard is { } board
			? new TriviaRuntime(board, definition.Manifest.TriviaRules ?? new TriviaRulesConfig())
			: null;

	public IFamilyRuntime? RuntimeFromState(GameState state)
		=> state.TriviaBoard is { } board
			? new TriviaRuntime(board, state.TriviaRules ?? new TriviaRulesConfig())
			: null;

	/// <summary>The snapshot carries the resolved deck and the effective rules, so a restored
	/// game rebuilds its runtime from state rather than the re-staged package defaults.</summary>
	public bool SnapshotCarriesRules => true;

	/// <summary>One die, then a choice of landing square (resolved by <see cref="TriviaMoveHandler"/>).</summary>
	public Task<ServerResponse>? ProcessRoll(Func<int> rollSingleDie, Player player, GameContext context)
		=> TriviaTurnFlow.ProcessRollAsync(rollSingleDie(), player, context);

	/// <summary>Trivia hides the correct answer of the pending question (and the whole answer-bearing
	/// deck): the answer reaches only the judge; everyone else — and the public view — get it blanked.</summary>
	public bool HasHiddenInformation => true;

	public GameState ProjectFor(GameState state, string? playerId)
	{
		if (state.Trivia is not { } trivia)
		{
			return state;
		}

		// The deck carries every answer — it never goes to any client.
		var projected = state with { TriviaDeck = null };

		if (trivia.PendingQuestion is { } q && q.JudgeId != playerId)
		{
			projected = projected with
			{
				Trivia = trivia with
				{
					PendingQuestion = q with { CorrectAnswer = null, CorrectChoice = -1 },
				},
			};
		}

		return projected;
	}

	/// <summary>Fold a leaver so play never stalls: mark the seat retired, drop any pending move or
	/// question they were part of (reassigning the judge when someone else can still rule), and
	/// release the start-time judge gate if the host is the one who left.</summary>
	public Task OnPlayerRetiredAsync(Player player, GameContext context)
	{
		if (context.GameState.Trivia is not { } trivia)
		{
			return Task.CompletedTask;
		}

		var seat = trivia.Players.FirstOrDefault(p => p.PlayerId == player.Id);
		if (seat != null)
		{
			seat.Retired = true;
		}

		if (trivia.PendingMove?.PlayerId == player.Id)
		{
			trivia.PendingMove = null;
		}

		if (trivia.PendingQuestion is { } q)
		{
			if (q.PlayerId == player.Id)
			{
				trivia.PendingQuestion = null;
			}
			else if (q.JudgeId == player.Id)
			{
				var order = context.GameState.Players.Select(p => p.Id).ToList();
				var replacement = TriviaRulebook.JudgeFor(order, trivia, q.PlayerId, trivia.FixedJudgeId);
				trivia.PendingQuestion = replacement is { } nj ? q with { JudgeId = nj } : null;
			}
		}

		if (trivia.FixedJudgeId == player.Id)
		{
			trivia.FixedJudgeId = null;
		}

		if (trivia.PendingJudgeSetup?.HostId == player.Id)
		{
			trivia.PendingJudgeSetup = null;
			if (context.GameState.CurrentTurn == null)
			{
				context.GameState.CurrentTurn = context.GameState.Players
					.FirstOrDefault(p => p.Id != player.Id && p.Status == PlayerStatus.Active)?.Id;
			}
		}

		return Task.CompletedTask;
	}
}
