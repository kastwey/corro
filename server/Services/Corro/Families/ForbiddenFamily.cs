using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services;
using CorroServer.Services.Commands;
using CorroServer.Services.Rules;

namespace CorroServer.Services.Corro.Families;

/// <summary>The effective rules carried beside a forbidden-word game.</summary>
public sealed record ForbiddenRuntime(ForbiddenRulesConfig Rules) : IFamilyRuntime;

/// <summary>
/// Spoken-clue play with three roles a turn: one player gives clues, another guesses aloud, and a
/// third monitors the forbidden words. The classic seating is two equal teams alternating timed
/// turns, the monitor coming from the rival side; the host may instead seat everyone for
/// themselves, the three roles rotating through the whole table, which is how an odd table — or
/// three people — can play. Voice chat is optional because the same interaction works around a
/// physical table. Corro never records or transcribes speech; the humans mark correct answers,
/// passes and violations.
/// </summary>
public sealed class ForbiddenFamily : IGameFamily
{
	/// <summary>Two teams of at least two: the smallest table the TEAM rotation can seat.</summary>
	internal const int MinimumPlayers = 4;

	/// <summary>Everyone for themselves needs the three roles of a turn and nobody else: the
	/// smallest table of all, and the one a family of three asked for.</summary>
	internal const int MinimumSoloPlayers = 3;

	/// <summary>The ceiling is the engine's own table limit, not a family number: the role
	/// rotation works for any team size, and how long an evening a bigger table wants is the host's
	/// business. A package still has to ship enough tokens for every seat it declares.</summary>
	internal const int MaximumPlayers = LobbyInput.MaxPlayersPerGame;

	public string GameType => "forbidden";

	/// <summary>Two teams by default: one side's clue-giver is watched by the OTHER side's
	/// monitor, so there is no legal team seating with one team or an odd table.</summary>
	public int? RequiredTeamCount => 2;

	/// <summary>…unless the host seats everyone for themselves, when there are no teams to
	/// arrange at all and the lobby offers every table size from three up.</summary>
	public HouseRuleCondition? TeamsWaivedWhen
		=> new() { Rule = HouseRuleCatalog.ForbiddenModeRule, Is = ForbiddenMode.Solo };

	/// <summary>The real word decks a package can offer in the lobby, preserving manifest order.
	/// A locale the manifest lists but has no words for is not a choice, so it never appears.</summary>
	public IReadOnlyList<string> ContentLanguages(GameDefinition definition)
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
		// The range is the package's whole offer, across both seatings: three is the floor because
		// everyone-for-themselves seats it, and an odd maximum is fine because that seating takes
		// it too. The lobby itself keeps a TEAM table to the even sizes of four and up, so the
		// range no longer has to be even — it used to be, when teams were the only way to play.
		var players = definition.Manifest.Players;
		if (players.Min < MinimumSoloPlayers || players.Max > MaximumPlayers || players.Max < players.Min)
		{
			throw new InvalidOperationException(
				$"forbidden players must be between {MinimumSoloPlayers} and {MaximumPlayers}.");
		}
		if (definition.Manifest.Tokens.Count < players.Max)
		{
			throw new InvalidOperationException(
				$"players.max ({players.Max}) cannot exceed the number of tokens the package provides ({definition.Manifest.Tokens.Count}).");
		}
		// House rules must reference FORBIDDEN codes the engine implements — the same doctrine as
		// every other family. A package can expose choices, never invent mechanics.
		foreach (var rule in definition.Manifest.HouseRules)
		{
			if (!HouseRuleCatalog.IsKnownForbidden(rule.Id))
			{
				throw new InvalidOperationException($"forbidden rule '{rule.Id}' is not a known forbidden rule code.");
			}
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
		// One rotation is the floor: a match of none has nothing to decide. The former ceiling of
		// five was a package-authoring guardrail, and it became the host's business the moment
		// the length was theirs to choose — a table that wants a long evening may have one.
		if (rules.Cycles < 1)
		{
			throw new InvalidOperationException("forbiddenRules.cycles must be at least 1.");
		}
		if (!HouseRuleCatalog.ForbiddenEndModes.Contains(rules.EndMode))
		{
			throw new InvalidOperationException(
				$"forbiddenRules.endMode must be one of {string.Join(", ", HouseRuleCatalog.ForbiddenEndModes)}.");
		}
		if (rules.TargetScore < 1)
		{
			throw new InvalidOperationException("forbiddenRules.targetScore must be at least 1.");
		}
		if (!HouseRuleCatalog.ForbiddenModes.Contains(rules.Mode))
		{
			throw new InvalidOperationException(
				$"forbiddenRules.mode must be one of {string.Join(", ", HouseRuleCatalog.ForbiddenModes)}.");
		}
		// The lobby learns the seating from the host's rule choices, not from the manifest, so a
		// package whose default seating is everyone for themselves has to expose the choice: a
		// silent "solo" default would leave the lobby arranging teams the match then refuses.
		if (rules.PlaysSolo() && definition.Manifest.HouseRules.All(rule => rule.Id != HouseRuleCatalog.ForbiddenModeRule))
		{
			throw new InvalidOperationException(
				$"forbiddenRules.mode '{ForbiddenMode.Solo}' requires the '{HouseRuleCatalog.ForbiddenModeRule}' house rule, so the lobby seats the table accordingly.");
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
				var target = AnswerText.Normalize(word.Target);
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
					var normalized = AnswerText.Normalize(forbidden);
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
		var definition = start.Definition;
		var rules = definition.Manifest.ForbiddenRules ?? new ForbiddenRulesConfig();
		// The host's lobby choices override the package defaults. The EFFECTIVE rules are stored
		// on the state, so a restored match keeps the length — and the seating — the table agreed on.
		if (start.RuleValues is { Count: > 0 } chosen)
		{
			foreach (var (id, value) in chosen)
			{
				rules = HouseRuleCatalog.ApplyForbidden(rules, id, value);
			}
		}

		if (start.Players.Count > MaximumPlayers || start.Players.Any(player => player.IsBot))
		{
			throw new InvalidOperationException(
				$"forbidden games seat up to {MaximumPlayers} human players and no bots.");
		}
		var arranged = rules.PlaysSolo() ? SoloSides(start) : ArrangedTeams(start);

		var resolved = definition.ForbiddenWords?.GetValueOrDefault(start.Lang)
			?? throw new InvalidOperationException(
				$"forbidden word deck does not provide the selected language '{start.Lang}'.");
		var deck = OrderDeck(resolved, start.AlreadyDealt, start.Random);
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

	/// <summary>Everyone for themselves: one side per player, in seat order, and no arrangement to
	/// take — a team layout handed in here is a lobby that let the two settings disagree.</summary>
	private static List<IReadOnlyList<string>> SoloSides(FamilyStartContext start)
	{
		if (start.Players.Count < MinimumSoloPlayers)
		{
			throw new InvalidOperationException(
				$"forbidden games with everyone for themselves need at least {MinimumSoloPlayers} players.");
		}
		if (start.Teams is { Count: > 0 })
		{
			throw new InvalidOperationException("forbidden games with everyone for themselves take no team arrangement.");
		}
		return start.Players.Select(player => (IReadOnlyList<string>)new[] { player.Id }).ToList();
	}

	/// <summary>The classic seating: two equal teams of at least two, covering every player once.</summary>
	private static List<IReadOnlyList<string>> ArrangedTeams(FamilyStartContext start)
	{
		if (start.Players.Count < MinimumPlayers || start.Players.Count % 2 != 0)
		{
			throw new InvalidOperationException(
				$"forbidden team games need an even number of players, from {MinimumPlayers} to {MaximumPlayers}.");
		}
		var arranged = start.Teams?.Select(team => (IReadOnlyList<string>)team).ToList()
			?? throw new InvalidOperationException("forbidden team games require two arranged teams.");
		var allIds = arranged.SelectMany(team => team).ToList();
		var playerIds = start.Players.Select(player => player.Id).ToHashSet(StringComparer.Ordinal);
		if (arranged.Count != 2 || arranged.Any(team => team.Count != start.Players.Count / 2)
			|| allIds.Count != start.Players.Count || allIds.Distinct(StringComparer.Ordinal).Count() != allIds.Count
			|| allIds.Any(id => !playerIds.Contains(id)))
		{
			throw new InvalidOperationException("forbidden teams must be equal and cover every player exactly once.");
		}
		return arranged;
	}

	public IFamilyRuntime? CreateRuntime(GameDefinition definition)
		=> new ForbiddenRuntime(definition.Manifest.ForbiddenRules ?? new ForbiddenRulesConfig());

	public IFamilyRuntime? RuntimeFromState(GameState state)
		=> new ForbiddenRuntime(state.ForbiddenRules ?? new ForbiddenRulesConfig());

	public bool SnapshotCarriesRules => true;

	public Task<ServerResponse>? ProcessRoll(Func<int> rollSingleDie, Player player, GameContext context)
		=> null;

	public RoundClock? RoundClock(GameState state)
		=> state.Forbidden?.Turn is { Phase: ForbiddenTurnPhase.Active } turn
			? new RoundClock(turn.StartedAt, turn.DurationSeconds)
			: null;

	public GameCommand? ExpireRoundCommand(GameState state)
		=> state.Forbidden?.Turn is { Phase: ForbiddenTurnPhase.Active } turn
			? new ForbiddenExpireTurnCommand { PlayerId = turn.ClueGiverId }
			: null;

	/// <summary>
	/// The deck for one match: everything this table has never been dealt first, then the rest.
	/// Both halves are shuffled, so the order is fresh every time — only the PRIORITY is
	/// remembered. A group that plays several matches in a row used to meet repeats immediately,
	/// because each match reshuffled the whole deck as if it were the table's first.
	///
	/// With nothing unseen left the whole deck counts as unseen again, so a table never stalls.
	/// That is a safety net rather than the usual path: the table's memory recycles itself the
	/// moment a match completes the trip round the deck, so what normally arrives here is the
	/// memory of a trip in progress.
	/// </summary>
	internal static List<ForbiddenWordDef> OrderDeck(
		IReadOnlyList<ForbiddenWordDef> deck,
		IReadOnlyCollection<string> alreadyDealt,
		IRandomSource? random)
	{
		List<ForbiddenWordDef> Shuffled(List<ForbiddenWordDef> cards)
			=> (random is { } source ? source.Shuffle(cards) : cards).ToList();

		if (alreadyDealt.Count == 0)
		{
			return Shuffled(deck.ToList());
		}
		var seen = new HashSet<string>(alreadyDealt, StringComparer.Ordinal);
		var unseen = deck.Where(word => !seen.Contains(word.Id)).ToList();
		if (unseen.Count == 0)
		{
			return Shuffled(deck.ToList());
		}
		return Shuffled(unseen)
			.Concat(Shuffled(deck.Where(word => seen.Contains(word.Id)).ToList()))
			.ToList();
	}

	/// <summary>The cards this match dealt: the front of its deck, up to the cursor. A match that
	/// ran past the end of the deck (cursor wraps) has dealt all of it.</summary>
	public MatchDeal CardsDealt(GameState state)
	{
		var deck = state.ForbiddenDeck;
		var dealt = state.Forbidden?.CardCursor ?? 0;
		if (deck is null || deck.Count == 0 || dealt <= 0)
		{
			return MatchDeal.None;
		}
		return new MatchDeal(
			deck.Take(Math.Min(dealt, deck.Count)).Select(word => word.Id).ToList(),
			deck.Count);
	}

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
		// Role is not enough: the card must also be live. Dealing it while the turn is still
		// being prepared handed the clue-giver unlimited time to plan clues before starting the
		// clock, and let the monitor study the forbidden list at leisure — the timed turn stopped
		// measuring what it claims to measure. Hiding it on the CLIENT would not have fixed that:
		// the words were already in those two browsers, readable by anyone who looked.
		var live = turn.Phase == ForbiddenTurnPhase.Active;
		if (!live || (playerId != turn.ClueGiverId && playerId != turn.MonitorId))
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
		var losingSide = forbidden.Teams.FirstOrDefault(team => team.MemberIds.Contains(player.Id));
		if (losingSide is null)
		{
			return;
		}
		var rules = context.GameState.ForbiddenRules ?? new ForbiddenRulesConfig();
		if (rules.PlaysSolo())
		{
			// The rotation cannot go on truthfully without them, so the match ends where it stands:
			// the best score among those who stayed wins, and the one who left finishes last.
			var winner = forbidden.Teams
				.Where(side => side.TeamIndex != losingSide.TeamIndex)
				.OrderByDescending(side => side.Score)
				.ThenBy(side => side.TeamIndex)
				.First();
			FinishGame(context.GameState, winner.TeamIndex, retiredPlayerId: player.Id);
			var winnerName = PlayerName(context.GameState, winner.MemberIds[0]);
			await context.Announce("game.forbidden_forfeit_solo", new()
			{
				["player"] = player.Name,
				["winner"] = winnerName,
				["score"] = winner.Score,
			});
			await context.Announce("game.game_over", new() { ["winner"] = winnerName });
			return;
		}
		var winningTeam = forbidden.Teams.First(team => team.TeamIndex != losingSide.TeamIndex);
		FinishGame(context.GameState, winningTeam.TeamIndex);
		await context.Announce("game.forbidden_forfeit", new()
		{
			["player"] = player.Name,
			["team"] = TeamVar(winningTeam.TeamIndex),
		});
		await context.Announce("game.game_over", new() { ["winner"] = TeamVar(winningTeam.TeamIndex) });
	}

	internal static string TeamVar(int teamIndex) => $"__team:{EnginePalette.NameFor(teamIndex)}";

	internal static string PlayerName(GameState state, string playerId)
		=> state.Players.First(player => player.Id == playerId).Name;

	/// <summary>The spoken name of a side: the team's colour word in team play, the player's own
	/// name when everyone plays for themselves.</summary>
	internal static object SideVar(GameState state, int sideIndex)
	{
		var rules = state.ForbiddenRules ?? new ForbiddenRulesConfig();
		return rules.PlaysSolo()
			? PlayerName(state, state.Forbidden!.Teams.First(side => side.TeamIndex == sideIndex).MemberIds[0])
			: TeamVar(sideIndex);
	}

	/// <summary>
	/// Close the match with <paramref name="winnerTeamIndex"/> on top. Every member of the winning
	/// side finishes first; the others are placed by score, ties sharing a place — which in team
	/// play is simply second, and with everyone for themselves is a real ranking. A player who left
	/// (<paramref name="retiredPlayerId"/>) finishes last whatever their score said.
	/// </summary>
	internal static void FinishGame(GameState state, int winnerTeamIndex, string? retiredPlayerId = null)
	{
		var forbidden = state.Forbidden!;
		var sides = forbidden.Teams;
		var winner = sides.First(team => team.TeamIndex == winnerTeamIndex);
		var retiredSide = retiredPlayerId is null
			? null
			: sides.FirstOrDefault(side => side.MemberIds.Contains(retiredPlayerId));
		var ranked = sides.Where(side => side != winner && side != retiredSide).ToList();
		foreach (var participant in state.Players)
		{
			var side = sides.First(candidate => candidate.MemberIds.Contains(participant.Id));
			participant.Status = PlayerStatus.Finished;
			participant.FinishPlace = side == winner
				? 1
				: side == retiredSide
					? sides.Count
					: 2 + ranked.Count(other => other.Score > side.Score);
		}
		forbidden.Turn.Phase = ForbiddenTurnPhase.Finished;
		state.CurrentTurn = null;
		state.WinnerId = winner.MemberIds.FirstOrDefault();
		// A side of one is a person, so the banner can name them; a team is named by the client,
		// in each player's own language, from its colour.
		state.WinnerName = winner.MemberIds.Count == 1 ? PlayerName(state, winner.MemberIds[0]) : null;
		state.IsGameOver = true;
	}

	internal static Task AnnouncePreparingTurnAsync(
		Func<string, Dictionary<string, object>?, Task> announce,
		GameState state)
	{
		var turn = state.Forbidden!.Turn;
		var rules = state.ForbiddenRules ?? new ForbiddenRulesConfig();
		var vars = new Dictionary<string, object>
		{
			["clueGiver"] = PlayerName(state, turn.ClueGiverId),
			["guesser"] = PlayerName(state, turn.GuesserId),
			["monitor"] = PlayerName(state, turn.MonitorId),
			["actorId"] = turn.ClueGiverId,
		};
		if (rules.PlaysSolo())
		{
			return announce("game.forbidden_turn_preparing_solo", vars);
		}
		vars["team"] = TeamVar(turn.TeamIndex);
		return announce("game.forbidden_turn_preparing", vars);
	}
}
