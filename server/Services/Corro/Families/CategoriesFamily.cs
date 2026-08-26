using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Commands;
using CorroServer.Services.Rules;

namespace CorroServer.Services.Corro.Families;

/// <summary>The effective rules carried beside a categories game.</summary>
public sealed record CategoriesRuntime(CategoriesRulesConfig Rules) : IFamilyRuntime;

/// <summary>
/// Simultaneous written play: one letter, several categories, one authoritative clock, and
/// everybody writing at once. There is no turn order at all — the only role is the ROUND JUDGE,
/// who does not write and who rules on the answers once the clock is spent. The judge rotates,
/// so every player writes the same number of rounds and arbitrates the same number of rounds.
///
/// The engine never decides whether an answer is good. It offers the judge two mechanical hints —
/// whether the answer starts with the round's letter, and which answers coincide — and the human
/// rules. Blank answers are the one exception: nobody needs a judge to rule on nothing.
/// </summary>
public sealed class CategoriesFamily : IGameFamily
{
	public string GameType => "categories";

	/// <summary>The smallest table that can play: one judge plus two writers, because with a
	/// single writer no answer could ever coincide with anybody's and half the game is missing.</summary>
	internal const int MinimumPlayers = 3;
	internal const int MaximumPlayers = 8;

	/// <summary>The real category decks a package can offer in the lobby, preserving manifest
	/// order. A locale the manifest lists but has no deck for is not a choice, so it never appears.</summary>
	public IReadOnlyList<string> ContentLanguages(GameDefinition definition)
		=> definition.Manifest.Locales
			.Where(locale => definition.CategoryDecks?.ContainsKey(locale) == true)
			.Distinct(StringComparer.OrdinalIgnoreCase)
			.ToList();

	public async Task<GameDefinition> LoadDefinitionAsync(
		string packageDir,
		Manifest manifest,
		Dictionary<string, Dictionary<string, string>> i18n)
	{
		var decks = new Dictionary<string, CategoryDeckDef>(StringComparer.OrdinalIgnoreCase);
		foreach (var locale in manifest.Locales)
		{
			var deck = await PackageJson.ReadOptionalAsync<CategoryDeckDef>(
				packageDir,
				$"categories.{locale}.json");
			if (deck is { Categories.Count: > 0 })
			{
				decks[locale] = deck;
			}
		}

		return new GameDefinition
		{
			Manifest = manifest,
			CategoryDecks = decks,
			Cards = new List<CardDef>(),
			I18n = i18n,
		};
	}

	public void ValidateDefinition(GameDefinition definition)
	{
		var players = definition.Manifest.Players;
		if (players.Min < MinimumPlayers || players.Max > MaximumPlayers || players.Max < players.Min)
		{
			throw new InvalidOperationException(
				$"categories players must be between {MinimumPlayers} and {MaximumPlayers}.");
		}
		if (definition.Manifest.Tokens.Count < players.Max)
		{
			throw new InvalidOperationException(
				$"players.max ({players.Max}) cannot exceed the number of tokens the package provides ({definition.Manifest.Tokens.Count}).");
		}
		if (definition.Manifest.HouseRules.Count > 0)
		{
			throw new InvalidOperationException("categories packages do not support houseRules yet.");
		}

		var rules = definition.Manifest.CategoriesRules ?? new CategoriesRulesConfig();
		if (rules.RoundSeconds is < 30 or > 600)
		{
			throw new InvalidOperationException("categoriesRules.roundSeconds must be between 30 and 600.");
		}
		if (rules.CategoriesPerRound is < 3 or > 12)
		{
			throw new InvalidOperationException("categoriesRules.categoriesPerRound must be between 3 and 12.");
		}
		if (rules.PointsPerAnswer is < 1 or > 10)
		{
			throw new InvalidOperationException("categoriesRules.pointsPerAnswer must be between 1 and 10.");
		}
		if (rules.Cycles is < 1 or > 5)
		{
			throw new InvalidOperationException("categoriesRules.cycles must be between 1 and 5.");
		}

		if (definition.CategoryDecks is not { Count: > 0 })
		{
			throw new InvalidOperationException("categories package has no decks (categories.<locale>.json).");
		}

		foreach (var locale in definition.Manifest.Locales)
		{
			if (!definition.CategoryDecks.TryGetValue(locale, out var deck))
			{
				throw new InvalidOperationException(
					$"categories locale '{locale}' has no deck (categories.{locale}.json).");
			}
			ValidateDeck(locale, deck, rules);
		}
	}

	/// <summary>One locale's deck: enough distinct categories to keep a match from repeating
	/// itself immediately, and a letter pool whose entries are real, single and distinct.</summary>
	private static void ValidateDeck(string locale, CategoryDeckDef deck, CategoriesRulesConfig rules)
	{
		// Two full rounds' worth is the floor: with exactly one round of categories, every round
		// of a match would ask the same questions in the same order.
		var minimumCategories = rules.CategoriesPerRound * 2;
		if (deck.Categories.Count < minimumCategories)
		{
			throw new InvalidOperationException(
				$"categories locale '{locale}' needs at least {minimumCategories} categories in categories.{locale}.json.");
		}

		var ids = new HashSet<string>(StringComparer.Ordinal);
		var names = new HashSet<string>(StringComparer.Ordinal);
		foreach (var category in deck.Categories)
		{
			if (string.IsNullOrWhiteSpace(category.Id) || !ids.Add(category.Id))
			{
				throw new InvalidOperationException(
					$"categories locale '{locale}' has a blank or duplicate category id '{category.Id}'.");
			}
			var name = AnswerText.Normalize(category.Name);
			if (name.Length == 0 || !names.Add(name))
			{
				throw new InvalidOperationException(
					$"category '{category.Id}' ({locale}) has a blank or duplicate name.");
			}
		}

		if (deck.Letters.Count < 5)
		{
			throw new InvalidOperationException(
				$"categories locale '{locale}' needs at least 5 letters in categories.{locale}.json.");
		}
		var letters = new HashSet<string>(StringComparer.Ordinal);
		foreach (var letter in deck.Letters)
		{
			var normalized = AnswerText.Normalize(letter);
			if (normalized.Length == 0 || !letter.Trim().All(char.IsLetter) || !letters.Add(normalized))
			{
				throw new InvalidOperationException(
					$"categories locale '{locale}' has a blank, duplicate or non-letter entry in letters: '{letter}'.");
			}
		}
	}

	public FamilyGame CreateGame(FamilyStartContext start)
	{
		if (start.Players.Count is < MinimumPlayers or > MaximumPlayers
			|| start.Players.Any(player => player.IsBot))
		{
			throw new InvalidOperationException(
				$"categories games need between {MinimumPlayers} and {MaximumPlayers} human players.");
		}

		var definition = start.Definition;
		var rules = definition.Manifest.CategoriesRules ?? new CategoriesRulesConfig();
		var resolved = definition.CategoryDecks?.GetValueOrDefault(start.Lang)
			?? throw new InvalidOperationException(
				$"categories deck does not provide the selected language '{start.Lang}'.");
		// Both piles are shuffled ONCE, at start: the cursors then walk them in order, so a long
		// match exhausts every letter and every category before it repeats any of them.
		var deck = new CategoryDeckDef
		{
			Letters = (start.Random is { } letterRandom ? letterRandom.Shuffle(resolved.Letters) : resolved.Letters).ToList(),
			Categories = (start.Random is { } categoryRandom ? categoryRandom.Shuffle(resolved.Categories) : resolved.Categories).ToList(),
		};

		var playerIds = start.Players.Select(player => player.Id).ToList();
		var categories = CategoriesRulebook.CreateInitialState(playerIds, deck, rules);

		var state = new GameState
		{
			GameType = GameType,
			Categories = categories,
			CategoryDeck = deck,
			CategoriesRules = rules,
			Players = start.Players.Select((player, index) => new Player
			{
				Id = player.Id,
				Name = player.Name,
				Token = player.Token,
				IsBot = false,
				Position = 0,
				Money = 0,
				Color = EnginePalette.ColorFor(index),
			}).ToList(),
			CurrentTurn = categories.Round.JudgeId,
			BoardName = definition.Manifest.Name is { Count: > 0 }
				? new Dictionary<string, string>(definition.Manifest.Name)
				: null,
			CenterBrand = definition.Manifest.CenterBrand,
			Tokens = definition.Manifest.Tokens,
			Currency = definition.Manifest.Currency,
			Terminology = definition.Manifest.Terminology,
		};

		return new FamilyGame
		{
			State = state,
			Runtime = new CategoriesRuntime(rules),
			PostStartAsync = announce => AnnounceRoundPreparingAsync(announce, state),
		};
	}

	public IFamilyRuntime? CreateRuntime(GameDefinition definition)
		=> new CategoriesRuntime(definition.Manifest.CategoriesRules ?? new CategoriesRulesConfig());

	public IFamilyRuntime? RuntimeFromState(GameState state)
		=> new CategoriesRuntime(state.CategoriesRules ?? new CategoriesRulesConfig());

	public bool SnapshotCarriesRules => true;

	public Task<ServerResponse>? ProcessRoll(Func<int> rollSingleDie, Player player, GameContext context)
		=> null;

	public RoundClock? RoundClock(GameState state)
		=> state.Categories?.Round is { Phase: CategoriesRoundPhase.Writing } round
			? new RoundClock(round.StartedAt, round.DurationSeconds)
			: null;

	public GameCommand? ExpireRoundCommand(GameState state)
		=> state.Categories?.Round is { Phase: CategoriesRoundPhase.Writing } round
			? new CategoriesExpireRoundCommand { PlayerId = round.JudgeId }
			: null;

	public bool HasHiddenInformation => true;

	/// <summary>
	/// While the clock runs, an answer belongs to the person who wrote it and to nobody else —
	/// not to a rival, not to the judge, and not to a spectator. The deck goes too: it holds
	/// every letter and category the match has not dealt yet.
	///
	/// Once the round reaches review the answers become the shared subject of the table, so
	/// everyone sees them all: that is exactly when they are read out and ruled on.
	/// </summary>
	public GameState ProjectFor(GameState state, string? playerId)
	{
		var projected = state with { CategoryDeck = null };
		var categories = state.Categories;
		if (categories?.Round is not { Phase: CategoriesRoundPhase.Preparing or CategoriesRoundPhase.Writing } round)
		{
			return projected;
		}

		return projected with
		{
			Categories = categories with
			{
				Round = round with
				{
					Prompts = round.Prompts.Select(prompt => prompt with
					{
						Answers = prompt.Answers
							.Select(answer => answer.PlayerId == playerId
								? answer
								: answer with { Text = string.Empty })
							.ToList(),
					}).ToList(),
				},
			},
		};
	}

	/// <summary>
	/// A seat that leaves must never strand the round. If the judge goes, the next player in seat
	/// order inherits the ruling; if a writer goes, their answers leave with them so the judge is
	/// not asked to rule on a player who is not there. When too few remain to play at all, the
	/// leader takes the match.
	/// </summary>
	public async Task OnPlayerRetiredAsync(Player player, GameContext context)
	{
		var state = context.GameState;
		var categories = state.Categories;
		if (categories is null || state.IsGameOver)
		{
			return;
		}

		// The shared leave flow has already marked the leaver bankrupt, so seat order is simply
		// everyone still standing, in the order they were seated.
		var seatOrder = state.Players
			.Where(seat => !seat.IsBankrupt)
			.Select(seat => seat.Id)
			.ToList();
		categories.Players.RemoveAll(entry => entry.PlayerId == player.Id);
		foreach (var prompt in categories.Round.Prompts)
		{
			prompt.Answers.RemoveAll(answer => answer.PlayerId == player.Id);
		}
		categories.Round.FinishedWriterIds.RemoveAll(id => id == player.Id);

		if (categories.Players.Count < MinimumPlayers)
		{
			var leader = categories.Players
				.OrderByDescending(entry => entry.Score)
				.FirstOrDefault();
			FinishGame(state, leader?.PlayerId);
			var winner = state.Players.FirstOrDefault(seat => seat.Id == leader?.PlayerId);
			await context.Announce("game.categories_abandoned", new()
			{
				["player"] = player.Name,
			});
			if (winner is not null)
			{
				await context.Announce("game.game_over", new()
				{
					["winner"] = winner.Name,
					["actorId"] = winner.Id,
				});
			}
			return;
		}

		if (categories.Round.JudgeId != player.Id)
		{
			return;
		}

		// The judge left mid-round. Restart the round under a new judge rather than trying to
		// finish a review nobody saw: the answers were written for a table that no longer exists,
		// and the replacement judge would be ruling on their own writing.
		var rules = (context.FamilyRuntime as CategoriesRuntime)?.Rules
			?? state.CategoriesRules
			?? new CategoriesRulesConfig();
		var deck = state.CategoryDeck
			?? throw new InvalidOperationException("categories deck missing from authoritative state");
		var judgeId = CategoriesRulebook.NextJudge(categories, seatOrder, player.Id);
		categories.Round = CategoriesRulebook.DealRound(
			categories,
			deck,
			rules,
			categories.Round.RoundNumber,
			judgeId);
		state.CurrentTurn = judgeId;
		await context.Announce("game.categories_judge_left", new()
		{
			["player"] = player.Name,
			["judge"] = state.Players.First(seat => seat.Id == judgeId).Name,
		});
		await AnnounceRoundPreparingAsync(context.Announce, state);
	}

	internal static void FinishGame(GameState state, string? winnerId)
	{
		var categories = state.Categories!;
		var placings = categories.Players
			.OrderByDescending(entry => entry.Score)
			.Select(entry => entry.PlayerId)
			.ToList();
		foreach (var participant in state.Players)
		{
			participant.Status = PlayerStatus.Finished;
			var place = placings.IndexOf(participant.Id);
			participant.FinishPlace = place >= 0 ? place + 1 : placings.Count + 1;
		}
		categories.Round.Phase = CategoriesRoundPhase.Finished;
		state.CurrentTurn = null;
		state.WinnerId = winnerId;
		state.IsGameOver = true;
	}

	/// <summary>The round card, spoken: which round, who judges, and the letter everybody writes
	/// to. The categories themselves are read on the surface, where they can be reviewed at
	/// leisure — reading six prompts aloud before every round would be read over, every time.</summary>
	internal static Task AnnounceRoundPreparingAsync(
		Func<string, Dictionary<string, object>?, Task> announce,
		GameState state)
	{
		var round = state.Categories!.Round;
		return announce("game.categories_round_preparing", new()
		{
			["round"] = round.RoundNumber,
			["judge"] = state.Players.First(player => player.Id == round.JudgeId).Name,
			["letter"] = round.Letter,
			["count"] = round.Prompts.Count,
			["actorId"] = round.JudgeId,
		});
	}

	/// <summary>The points each player collected from the accepted answers.</summary>
	public MatchStandings? FinalStandings(GameState state)
		=> FinalStandingsBuilder.ByPlayer(state, StandingsMeasure.Points, playerId =>
			state.Categories?.Players.FirstOrDefault(player => player.PlayerId == playerId)?.Score);
}
