using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Commands;
using CorroServer.Services.Rules;

namespace CorroServer.Services.Corro.Families;

/// <summary>The effective rules carried beside a bluff game.</summary>
public sealed record BluffRuntime(BluffRulesConfig Rules) : IFamilyRuntime;

/// <summary>
/// Simultaneous bluffing for a room of any size: one question with a true answer nobody expects,
/// everybody writes a convincing lie against the clock, then everybody votes for the truth among
/// a handful of those lies — and for the funniest. There is no turn, no judge and no piece: the
/// room is the judge, and the only seat with a job is the MASTER (the host), who opens each round
/// and moves the table past each reveal so the results can be read out.
///
/// The engine decides nothing about what is true: the deck says, and the votes say the rest.
/// </summary>
public sealed class BluffFamily : IGameFamily
{
	public string GameType => "bluff";

	internal const int MinimumPlayers = BluffRulebook.MinimumPlayers;

	/// <summary>A hall, not a table. The number is a safety ceiling for one server, not a game
	/// rule: whoever is in when the match starts plays.</summary>
	internal const int MaximumPlayers = 500;

	public bool UsesTokens => false;
	public bool OpenSeating => true;
	public int SeatLimit => MaximumPlayers;

	/// <summary>The real question decks a package can offer in the lobby, preserving manifest
	/// order. A locale the manifest lists but has no deck for is not a choice, so it never appears.</summary>
	public IReadOnlyList<string> ContentLanguages(GameDefinition definition)
		=> definition.Manifest.Locales
			.Where(locale => definition.BluffQuestions?.ContainsKey(locale) == true)
			.Distinct(StringComparer.OrdinalIgnoreCase)
			.ToList();

	public async Task<GameDefinition> LoadDefinitionAsync(
		string packageDir,
		Manifest manifest,
		Dictionary<string, Dictionary<string, string>> i18n)
	{
		var decks = new Dictionary<string, List<BluffQuestionDef>>(StringComparer.OrdinalIgnoreCase);
		foreach (var locale in manifest.Locales)
		{
			var deck = await PackageJson.ReadOptionalAsync<List<BluffQuestionDef>>(
				packageDir,
				$"truths.{locale}.json");
			if (deck is { Count: > 0 })
			{
				decks[locale] = deck;
			}
		}

		return new GameDefinition
		{
			Manifest = manifest,
			BluffQuestions = decks,
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
				$"bluff players must be between {MinimumPlayers} and {MaximumPlayers}.");
		}
		// House rules must reference BLUFF codes the engine implements — the same doctrine as
		// every other family. A package can expose choices, never invent mechanics.
		foreach (var rule in definition.Manifest.HouseRules)
		{
			if (!HouseRuleCatalog.IsKnownBluff(rule.Id))
			{
				throw new InvalidOperationException($"bluff rule '{rule.Id}' is not a known bluff rule code.");
			}
		}

		var rules = definition.Manifest.BluffRules ?? new BluffRulesConfig();
		ValidateRules(rules);

		if (definition.BluffQuestions is not { Count: > 0 })
		{
			throw new InvalidOperationException("bluff package has no decks (truths.<locale>.json).");
		}
		foreach (var locale in definition.Manifest.Locales)
		{
			if (!definition.BluffQuestions.TryGetValue(locale, out var deck))
			{
				throw new InvalidOperationException(
					$"bluff locale '{locale}' has no deck (truths.{locale}.json).");
			}
			ValidateDeck(locale, deck, rules);
		}
	}

	internal static void ValidateRules(BluffRulesConfig rules)
	{
		if (rules.WriteSeconds is < 15 or > 300)
		{
			throw new InvalidOperationException("bluffRules.writeSeconds must be between 15 and 300.");
		}
		if (rules.VoteSeconds is < 10 or > 180)
		{
			throw new InvalidOperationException("bluffRules.voteSeconds must be between 10 and 180.");
		}
		if (rules.Rounds is < 1 or > 20)
		{
			throw new InvalidOperationException("bluffRules.rounds must be between 1 and 20.");
		}
		if (rules.TruthPoints is < 1 or > 10000)
		{
			throw new InvalidOperationException("bluffRules.truthPoints must be between 1 and 10000.");
		}
		if (rules.FoolPoints is < 0 or > 10000)
		{
			throw new InvalidOperationException("bluffRules.foolPoints must be between 0 and 10000.");
		}
		if (rules.BallotSize is < 3 or > 9)
		{
			throw new InvalidOperationException("bluffRules.ballotSize must be between 3 and 9.");
		}
		if (rules.Finalists < 2 || rules.Finalists > rules.BallotSize)
		{
			throw new InvalidOperationException("bluffRules.finalists must be between 2 and ballotSize.");
		}
	}

	/// <summary>One locale's deck: enough questions for a whole match without a repeat, every one
	/// of them with a question and a truth, and no two sharing an id.</summary>
	private static void ValidateDeck(string locale, List<BluffQuestionDef> deck, BluffRulesConfig rules)
	{
		if (deck.Count < rules.Rounds)
		{
			throw new InvalidOperationException(
				$"bluff locale '{locale}' needs at least {rules.Rounds} questions in truths.{locale}.json.");
		}
		var ids = new HashSet<string>(StringComparer.Ordinal);
		foreach (var question in deck)
		{
			if (string.IsNullOrWhiteSpace(question.Id) || !ids.Add(question.Id))
			{
				throw new InvalidOperationException(
					$"bluff locale '{locale}' has a blank or duplicate question id '{question.Id}'.");
			}
			if (string.IsNullOrWhiteSpace(question.Question))
			{
				throw new InvalidOperationException($"bluff question '{question.Id}' ({locale}) has no text.");
			}
			if (AnswerText.Normalize(question.Truth).Length == 0)
			{
				throw new InvalidOperationException($"bluff question '{question.Id}' ({locale}) has no truth.");
			}
			if (question.Truth.Trim().Length > BluffRulebook.MaxLieLength)
			{
				throw new InvalidOperationException(
					$"bluff question '{question.Id}' ({locale}) has a truth longer than {BluffRulebook.MaxLieLength} characters.");
			}
		}
	}

	public FamilyGame CreateGame(FamilyStartContext start)
	{
		var definition = start.Definition;
		var rules = definition.Manifest.BluffRules ?? new BluffRulesConfig();
		// The host's lobby choices override the package defaults. The EFFECTIVE rules are stored
		// on the state, so a restored match keeps the length the table agreed on.
		if (start.RuleValues is { Count: > 0 } chosen)
		{
			foreach (var (id, value) in chosen)
			{
				rules = HouseRuleCatalog.ApplyBluff(rules, id, value);
			}
		}
		ValidateRules(rules);

		if (start.Players.Count is < MinimumPlayers or > MaximumPlayers
			|| start.Players.Any(player => player.IsBot))
		{
			throw new InvalidOperationException(
				$"bluff games need between {MinimumPlayers} and {MaximumPlayers} human players.");
		}

		var resolved = definition.BluffQuestions?.GetValueOrDefault(start.Lang)
			?? throw new InvalidOperationException(
				$"bluff deck does not provide the selected language '{start.Lang}'.");
		var deck = OrderDeck(resolved, start.AlreadyDealt, start.Random);

		var playerIds = start.Players.Select(player => player.Id).ToList();
		// The host runs the table. A context without one (a unit test) hands the job to the
		// first seat, which is also where it goes when the host leaves.
		var masterId = start.HostId is { } host && playerIds.Contains(host) ? host : playerIds[0];
		var bluff = BluffRulebook.CreateInitialState(playerIds, masterId, deck, rules);

		var state = new GameState
		{
			GameType = GameType,
			Bluff = bluff,
			BluffDeck = deck,
			BluffRules = rules,
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
			CurrentTurn = null,
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
			Runtime = new BluffRuntime(rules),
			PostStartAsync = announce => AnnounceRoundPreparingAsync(announce, state),
		};
	}

	/// <summary>The deck in deal order: what this table has not been asked yet comes first, so a
	/// group playing several matches in a row meets new questions before a repeat.</summary>
	internal static List<BluffQuestionDef> OrderDeck(
		IReadOnlyList<BluffQuestionDef> deck,
		IReadOnlyCollection<string> alreadyDealt,
		IRandomSource? random)
	{
		List<BluffQuestionDef> Shuffled(List<BluffQuestionDef> questions)
			=> (random is { } source ? source.Shuffle(questions) : questions).ToList();

		if (alreadyDealt.Count == 0)
		{
			return Shuffled(deck.ToList());
		}
		var seen = new HashSet<string>(alreadyDealt, StringComparer.Ordinal);
		var unseen = deck.Where(question => !seen.Contains(question.Id)).ToList();
		if (unseen.Count == 0)
		{
			return Shuffled(deck.ToList());
		}
		return Shuffled(unseen)
			.Concat(Shuffled(deck.Where(question => seen.Contains(question.Id)).ToList()))
			.ToList();
	}

	public MatchDeal CardsDealt(GameState state)
	{
		var deck = state.BluffDeck;
		var dealt = state.Bluff?.QuestionCursor ?? 0;
		if (deck is null || deck.Count == 0 || dealt <= 0)
		{
			return MatchDeal.None;
		}
		return new MatchDeal(
			deck.Take(Math.Min(dealt, deck.Count)).Select(question => question.Id).ToList(),
			deck.Count);
	}

	public IFamilyRuntime? CreateRuntime(GameDefinition definition)
		=> new BluffRuntime(definition.Manifest.BluffRules ?? new BluffRulesConfig());

	public IFamilyRuntime? RuntimeFromState(GameState state)
		=> new BluffRuntime(state.BluffRules ?? new BluffRulesConfig());

	public bool SnapshotCarriesRules => true;

	public Task<ServerResponse>? ProcessRoll(Func<int> rollSingleDie, Player player, GameContext context)
		=> null;

	public RoundClock? RoundClock(GameState state)
		=> state.Bluff?.Round is { } round && BluffRulebook.IsTimed(round)
			? new RoundClock(round.StartedAt, round.DurationSeconds)
			: null;

	public GameCommand? ExpireRoundCommand(GameState state)
		=> state.Bluff?.Round is { } round && BluffRulebook.IsTimed(round)
			? new BluffExpirePhaseCommand { PlayerId = state.Bluff.MasterId }
			: null;

	public bool HasHiddenInformation => true;

	/// <summary>
	/// What each connection may see. The deck never leaves the server. Until the reveal, the
	/// truth is blank, a bluff belongs to its writer alone, and a ballot to its voter alone — with
	/// every option's key removed, because a ballot that said which line was the truth would be no
	/// vote. Who found the truth stays each player's own secret until the reveal, when the bluffs,
	/// their authors and their believers become the shared subject of the room.
	/// </summary>
	public GameState ProjectFor(GameState state, string? playerId)
	{
		var projected = state with { BluffDeck = null };
		var bluff = state.Bluff;
		if (bluff is null)
		{
			return projected;
		}
		var round = bluff.Round;
		var revealed = round.Phase is BluffPhase.Reveal or BluffPhase.Finished;

		var ownBallot = round.Ballots.Where(ballot => ballot.PlayerId == playerId).Select(Blind).ToList();
		var ownFinal = round.FinalBallots.Where(ballot => ballot.PlayerId == playerId).Select(Blind).ToList();

		return projected with
		{
			Bluff = bluff with
			{
				Round = round with
				{
					Truth = revealed ? round.Truth : string.Empty,
					TruthVariants = new List<string>(),
					Entries = round.Entries
						.Select(entry => revealed || entry.PlayerId == playerId
							? entry
							: entry with { Text = string.Empty })
						.ToList(),
					Lies = revealed ? round.Lies : new List<BluffLieState>(),
					Ballots = ownBallot,
					FinalBallots = ownFinal,
					TruthFinderIds = revealed
						? round.TruthFinderIds
						: round.TruthFinderIds.Where(id => id == playerId).ToList(),
					FinalTruthFinderIds = revealed
						? round.FinalTruthFinderIds
						: round.FinalTruthFinderIds.Where(id => id == playerId).ToList(),
					PendingCount = round.Phase switch
					{
						BluffPhase.Writing => BluffRulebook.WritersRemaining(round),
						BluffPhase.Voting => BluffRulebook.VotersRemaining(round, final: false),
						BluffPhase.FinalVoting => BluffRulebook.VotersRemaining(round, final: true),
						_ => 0,
					},
				},
			},
		};
	}

	/// <summary>A ballot as its owner sees it: the lines, in their order, with no key on any.</summary>
	private static BluffBallotState Blind(BluffBallotState ballot)
		=> ballot with
		{
			Options = ballot.Options.Select(option => option with { Key = string.Empty }).ToList(),
		};

	/// <summary>
	/// A seat that leaves must never strand the round. Their bluff and ballot leave with them, so
	/// no phase waits on somebody who is not there; if they ran the table, the next seat in order
	/// takes over. When too few remain to play at all, the leader takes the match.
	/// </summary>
	public async Task OnPlayerRetiredAsync(Player player, GameContext context)
	{
		var state = context.GameState;
		var bluff = state.Bluff;
		if (bluff is null || state.IsGameOver)
		{
			return;
		}

		var seatOrder = state.Players
			.Where(seat => !seat.IsBankrupt)
			.Select(seat => seat.Id)
			.ToList();
		bluff.Players.RemoveAll(entry => entry.PlayerId == player.Id);
		var round = bluff.Round;
		round.Entries.RemoveAll(entry => entry.PlayerId == player.Id);
		round.Ballots.RemoveAll(ballot => ballot.PlayerId == player.Id);
		round.FinalBallots.RemoveAll(ballot => ballot.PlayerId == player.Id);

		if (bluff.Players.Count < MinimumPlayers)
		{
			var leader = BluffRulebook.Standings(bluff).FirstOrDefault();
			FinishGame(state, leader?.PlayerId);
			await context.Announce("game.bluff_abandoned", new()
			{
				["player"] = player.Name,
			});
			if (leader is not null)
			{
				await context.Announce("game.game_over", new()
				{
					["winner"] = PlayerName(state, leader.PlayerId),
					["actorId"] = leader.PlayerId,
				});
			}
			return;
		}

		if (bluff.MasterId == player.Id)
		{
			bluff.MasterId = BluffRulebook.NextMaster(bluff, seatOrder, player.Id);
			await context.Announce("game.bluff_master_left", new()
			{
				["player"] = player.Name,
				["master"] = PlayerName(state, bluff.MasterId),
				["actorId"] = bluff.MasterId,
			});
		}

		// A departure can be the last thing a phase was waiting for.
		var runtime = (context.FamilyRuntime as BluffRuntime)?.Rules ?? state.BluffRules ?? new BluffRulesConfig();
		await BluffRoundFlow.SettleIfEveryoneIsDoneAsync(context, runtime);
	}

	internal static void FinishGame(GameState state, string? winnerId)
	{
		var bluff = state.Bluff!;
		var placings = BluffRulebook.Standings(bluff).Select(entry => entry.PlayerId).ToList();
		foreach (var participant in state.Players)
		{
			participant.Status = PlayerStatus.Finished;
			var place = placings.IndexOf(participant.Id);
			participant.FinishPlace = place >= 0 ? place + 1 : placings.Count + 1;
		}
		bluff.Round.Phase = BluffPhase.Finished;
		state.CurrentTurn = null;
		state.WinnerId = winnerId;
		state.IsGameOver = true;
	}

	internal static string PlayerName(GameState state, string playerId)
		=> state.Players.FirstOrDefault(player => player.Id == playerId)?.Name ?? playerId;

	/// <summary>The round card, spoken: which round of how many, and who opens it. The question
	/// itself is not read until the clock starts, so nobody gets a head start thinking.</summary>
	internal static Task AnnounceRoundPreparingAsync(
		Func<string, Dictionary<string, object>?, Task> announce,
		GameState state)
	{
		var bluff = state.Bluff!;
		return announce("game.bluff_round_preparing", new()
		{
			["round"] = bluff.Round.RoundNumber,
			["total"] = bluff.RoundsToPlay,
			["master"] = PlayerName(state, bluff.MasterId),
			["actorId"] = bluff.MasterId,
		});
	}
}
