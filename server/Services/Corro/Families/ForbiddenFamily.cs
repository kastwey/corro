using System.Globalization;
using System.Text;
using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Commands;
using CorroServer.Services.Rules;

namespace CorroServer.Services.Corro.Families;

/// <summary>The effective rules carried beside a forbidden-word game.</summary>
public sealed record ForbiddenRuntime(ForbiddenRulesConfig Rules) : IFamilyRuntime;

/// <summary>
/// Team spoken-clue play: two equal teams alternate timed turns. One teammate gives clues,
/// the next guesses aloud, and one rotating opponent monitors the forbidden words. Voice chat
/// is optional because the same interaction works around a physical table. Corro never records
/// or transcribes speech; the humans mark correct answers, passes and violations.
/// </summary>
public sealed class ForbiddenFamily : IGameFamily
{
	public string GameType => "forbidden";

	/// <summary>Two teams, always: one side's clue-giver is watched by the OTHER side's monitor,
	/// so there is no legal seating with one team or an odd table.</summary>
	public int? RequiredTeamCount => 2;

	/// <summary>The real word decks a package can offer in the lobby, preserving manifest order.</summary>
	public static List<string> AvailableWordLanguages(GameDefinition definition)
		=> definition.Manifest.Locales
			.Where(locale => definition.ForbiddenWords?.ContainsKey(locale) == true)
			.Distinct(StringComparer.OrdinalIgnoreCase)
			.ToList();

	public async Task<GameDefinition> LoadDefinitionAsync(
		string packageDir,
		Manifest manifest,
		Dictionary<string, Dictionary<string, string>> i18n)
	{
		var words = new Dictionary<string, List<ForbiddenWordDef>>(StringComparer.OrdinalIgnoreCase);
		foreach (var locale in manifest.Locales)
		{
			var deck = await PackageJson.ReadOptionalAsync<List<ForbiddenWordDef>>(
				packageDir,
				$"words.{locale}.json");
			if (deck is { Count: > 0 })
			{
				words[locale] = deck;
			}
		}

		return new GameDefinition
		{
			Manifest = manifest,
			ForbiddenWords = words,
			Cards = new List<CardDef>(),
			I18n = i18n,
		};
	}

	public void ValidateDefinition(GameDefinition definition)
	{
		var players = definition.Manifest.Players;
		if (players.Min < 4 || players.Max > 8 || players.Max < players.Min)
		{
			throw new InvalidOperationException("forbidden players must be between 4 and 8.");
		}
		if (players.Min % 2 != 0 || players.Max % 2 != 0)
		{
			throw new InvalidOperationException("forbidden players.min and players.max must be even for two equal teams.");
		}
		if (definition.Manifest.Tokens.Count < players.Max)
		{
			throw new InvalidOperationException(
				$"players.max ({players.Max}) cannot exceed the number of tokens the package provides ({definition.Manifest.Tokens.Count}).");
		}
		if (definition.Manifest.HouseRules.Count > 0)
		{
			throw new InvalidOperationException("forbidden packages do not support houseRules yet.");
		}

		var rules = definition.Manifest.ForbiddenRules ?? new ForbiddenRulesConfig();
		if (rules.TurnSeconds is < 5 or > 300)
		{
			throw new InvalidOperationException("forbiddenRules.turnSeconds must be between 5 and 300.");
		}
		if (rules.PassesPerTurn is < 0 or > 10)
		{
			throw new InvalidOperationException("forbiddenRules.passesPerTurn must be between 0 and 10.");
		}
		if (rules.CorrectPoints is < 1 or > 10)
		{
			throw new InvalidOperationException("forbiddenRules.correctPoints must be between 1 and 10.");
		}
		if (rules.ViolationPenalty is < 0 or > 10)
		{
			throw new InvalidOperationException("forbiddenRules.violationPenalty must be between 0 and 10.");
		}
		if (rules.Cycles is < 1 or > 5)
		{
			throw new InvalidOperationException("forbiddenRules.cycles must be between 1 and 5.");
		}

		if (definition.ForbiddenWords is not { Count: > 0 })
		{
			throw new InvalidOperationException("forbidden package has no word decks (words.<locale>.json).");
		}

		foreach (var locale in definition.Manifest.Locales)
		{
			if (!definition.ForbiddenWords.TryGetValue(locale, out var deck) || deck.Count < 8)
			{
				throw new InvalidOperationException(
					$"forbidden locale '{locale}' needs at least 8 cards in words.{locale}.json.");
			}

			var ids = new HashSet<string>(StringComparer.Ordinal);
			var targets = new HashSet<string>(StringComparer.Ordinal);
			foreach (var word in deck)
			{
				if (string.IsNullOrWhiteSpace(word.Id) || !ids.Add(word.Id))
				{
					throw new InvalidOperationException(
						$"forbidden locale '{locale}' has a blank or duplicate card id '{word.Id}'.");
				}
				var target = Normalize(word.Target);
				if (target.Length == 0 || !targets.Add(target))
				{
					throw new InvalidOperationException(
						$"forbidden card '{word.Id}' ({locale}) has a blank or duplicate target.");
				}
				if (word.Forbidden.Count < 3 || word.Forbidden.Count > 8)
				{
					throw new InvalidOperationException(
						$"forbidden card '{word.Id}' ({locale}) needs between 3 and 8 forbidden words.");
				}
				var banned = new HashSet<string>(StringComparer.Ordinal);
				foreach (var forbidden in word.Forbidden)
				{
					var normalized = Normalize(forbidden);
					if (normalized.Length == 0 || normalized == target || !banned.Add(normalized))
					{
						throw new InvalidOperationException(
							$"forbidden card '{word.Id}' ({locale}) has a blank, duplicate or target-matching forbidden word.");
					}
				}
			}
		}
	}

	public FamilyGame CreateGame(FamilyStartContext start)
	{
		if (start.Players.Count is < 4 or > 8 || start.Players.Count % 2 != 0
			|| start.Players.Any(player => player.IsBot))
		{
			throw new InvalidOperationException("forbidden games need 4, 6 or 8 human players.");
		}

		var arranged = start.Teams?.Select(team => (IReadOnlyList<string>)team).ToList()
			?? throw new InvalidOperationException("forbidden games require two arranged teams.");
		var allIds = arranged.SelectMany(team => team).ToList();
		var playerIds = start.Players.Select(player => player.Id).ToHashSet(StringComparer.Ordinal);
		if (arranged.Count != 2 || arranged.Any(team => team.Count != start.Players.Count / 2)
			|| allIds.Count != start.Players.Count || allIds.Distinct(StringComparer.Ordinal).Count() != allIds.Count
			|| allIds.Any(id => !playerIds.Contains(id)))
		{
			throw new InvalidOperationException("forbidden teams must be equal and cover every player exactly once.");
		}

		var definition = start.Definition;
		var rules = definition.Manifest.ForbiddenRules ?? new ForbiddenRulesConfig();
		var resolved = definition.ForbiddenWords?.GetValueOrDefault(start.Lang)
			?? throw new InvalidOperationException(
				$"forbidden word deck does not provide the selected language '{start.Lang}'.");
		var deck = (start.Random is { } random ? random.Shuffle(resolved) : resolved).ToList();
		var forbidden = ForbiddenRulebook.CreateInitialState(arranged, deck, rules);
		var teamOf = arranged
			.SelectMany((team, index) => team.Select(id => (id, index)))
			.ToDictionary(pair => pair.id, pair => pair.index, StringComparer.Ordinal);

		var state = new GameState
		{
			GameType = GameType,
			Forbidden = forbidden,
			ForbiddenDeck = deck,
			ForbiddenRules = rules,
			Players = start.Players.Select(player => new Player
			{
				Id = player.Id,
				Name = player.Name,
				Token = player.Token,
				IsBot = false,
				Position = 0,
				Money = 0,
				Color = EnginePalette.ColorFor(teamOf[player.Id]),
			}).ToList(),
			CurrentTurn = forbidden.Turn.ClueGiverId,
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
			Runtime = new ForbiddenRuntime(rules),
			PostStartAsync = announce => AnnouncePreparingTurnAsync(announce, state),
		};
	}

	public IFamilyRuntime? CreateRuntime(GameDefinition definition)
		=> new ForbiddenRuntime(definition.Manifest.ForbiddenRules ?? new ForbiddenRulesConfig());

	public IFamilyRuntime? RuntimeFromState(GameState state)
		=> new ForbiddenRuntime(state.ForbiddenRules ?? new ForbiddenRulesConfig());

	public bool SnapshotCarriesRules => true;

	public Task<ServerResponse>? ProcessRoll(Func<int> rollSingleDie, Player player, GameContext context)
		=> null;

	public bool HasHiddenInformation => true;

	public GameState ProjectFor(GameState state, string? playerId)
	{
		var projected = state with { ForbiddenDeck = null };
		var forbidden = state.Forbidden;
		if (forbidden is null)
		{
			return projected;
		}

		var turn = forbidden.Turn;
		if (playerId != turn.ClueGiverId && playerId != turn.MonitorId)
		{
			projected = projected with
			{
				Forbidden = forbidden with
				{
					Turn = turn with
					{
						CardId = null,
						Target = null,
						ForbiddenWords = new List<string>(),
					},
				},
			};
		}
		return projected;
	}

	public async Task OnPlayerRetiredAsync(Player player, GameContext context)
	{
		var forbidden = context.GameState.Forbidden;
		if (forbidden is null || context.GameState.IsGameOver)
		{
			return;
		}
		var losingTeam = forbidden.Teams.FirstOrDefault(team => team.MemberIds.Contains(player.Id));
		if (losingTeam is null)
		{
			return;
		}
		var winner = forbidden.Teams.First(team => team.TeamIndex != losingTeam.TeamIndex);
		FinishGame(context.GameState, winner.TeamIndex);
		await context.Announce("game.forbidden_forfeit", new()
		{
			["player"] = player.Name,
			["team"] = TeamVar(winner.TeamIndex),
		});
		await context.Announce("game.game_over", new() { ["winner"] = TeamVar(winner.TeamIndex) });
	}

	internal static string TeamVar(int teamIndex) => $"__team:{EnginePalette.NameFor(teamIndex)}";

	internal static void FinishGame(GameState state, int winnerTeamIndex)
	{
		var forbidden = state.Forbidden!;
		var winner = forbidden.Teams.First(team => team.TeamIndex == winnerTeamIndex);
		foreach (var participant in state.Players)
		{
			var won = winner.MemberIds.Contains(participant.Id);
			participant.Status = PlayerStatus.Finished;
			participant.FinishPlace = won ? 1 : 2;
		}
		forbidden.Turn.Phase = ForbiddenTurnPhase.Finished;
		state.CurrentTurn = null;
		state.WinnerId = winner.MemberIds.FirstOrDefault();
		state.IsGameOver = true;
	}

	internal static Task AnnouncePreparingTurnAsync(
		Func<string, Dictionary<string, object>?, Task> announce,
		GameState state)
	{
		var turn = state.Forbidden!.Turn;
		string Name(string id) => state.Players.First(player => player.Id == id).Name;
		return announce("game.forbidden_turn_preparing", new()
		{
			["team"] = TeamVar(turn.TeamIndex),
			["clueGiver"] = Name(turn.ClueGiverId),
			["guesser"] = Name(turn.GuesserId),
			["monitor"] = Name(turn.MonitorId),
			["actorId"] = turn.ClueGiverId,
		});
	}

	private static string Normalize(string value)
	{
		var decomposed = (value ?? string.Empty).Trim().ToLowerInvariant().Normalize(NormalizationForm.FormD);
		var builder = new StringBuilder(decomposed.Length);
		foreach (var character in decomposed)
		{
			if (CharUnicodeInfo.GetUnicodeCategory(character) == UnicodeCategory.NonSpacingMark)
			{
				continue;
			}
			if (char.IsLetterOrDigit(character))
			{
				builder.Append(character);
			}
			else if (char.IsWhiteSpace(character))
			{
				builder.Append(' ');
			}
		}
		return string.Join(' ', builder.ToString().Split(' ', StringSplitOptions.RemoveEmptyEntries));
	}
}
