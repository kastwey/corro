using CorroServer.Models;
using CorroServer.Models.Corro;

namespace CorroServer.Services.Rules;

/// <summary>
/// Pure state transitions for the bluff family. Everybody writes a bluff to the same question,
/// then everybody votes for the truth among a handful of bluffs — and for the funniest one. The
/// judge is the room itself: no human rules, so the only decisions here are mechanical and every
/// one of them is fair by construction. Each bluff is dealt onto the same number of ballots, the
/// points are what the votes say, and a big table narrows its field in a final before it reveals.
/// </summary>
public static class BluffRulebook
{
	/// <summary>A bluff longer than this is not a bluff. Generous for a sentence, small enough
	/// that nobody can push bulk at a hall through the text box.</summary>
	public const int MaxLieLength = 80;

	/// <summary>Two players would be one bluff and one truth: a coin toss. Three is a game.</summary>
	public const int MinimumPlayers = 3;

	public enum WriteOutcome { Saved, NotWriting, AlreadyFinished, TooLong, MatchesTruth }

	public enum VoteOutcome { Marked, WrongPhase, NoBallot, UnknownOption, SameOption, NotAsked }

	public sealed record RoundAdvance(bool GameOver, string? WinnerId, bool TieBreakerStarted);

	/// <summary>A marked ballot, and whether that mark was the one that completed it.</summary>
	public sealed record VoteResult(VoteOutcome Outcome, bool BallotCompleted);

	public static BluffState CreateInitialState(
		IReadOnlyList<string> playerIds,
		string masterId,
		IReadOnlyList<BluffQuestionDef> deck,
		BluffRulesConfig rules)
	{
		if (playerIds.Count < MinimumPlayers)
		{
			throw new InvalidOperationException("bluff games need at least three players.");
		}
		if (deck.Count == 0)
		{
			throw new InvalidOperationException("bluff deck offers no questions.");
		}
		if (!playerIds.Contains(masterId))
		{
			throw new InvalidOperationException("the bluff master must be one of the players.");
		}

		var state = new BluffState
		{
			Players = playerIds.Select(id => new BluffPlayerState { PlayerId = id }).ToList(),
			MasterId = masterId,
			RoundsToPlay = rules.Rounds,
			// Replaced on the next line: the first deal reads the cursor it is dealt from.
			Round = null!,
		};
		state.Round = DealRound(state, deck, roundNumber: 1);
		return state;
	}

	/// <summary>Deal the next question with one blank entry per player. The cursor wraps, so a
	/// long match reuses the deck rather than running dry.</summary>
	public static BluffRoundState DealRound(BluffState state, IReadOnlyList<BluffQuestionDef> deck, int roundNumber)
	{
		var question = deck[state.QuestionCursor % deck.Count];
		state.QuestionCursor++;
		return new BluffRoundState
		{
			RoundNumber = roundNumber,
			QuestionId = question.Id,
			Question = question.Question,
			Truth = question.Truth,
			TruthVariants = question.AlsoTrue.ToList(),
			Entries = state.Players.Select(player => new BluffEntryState { PlayerId = player.PlayerId }).ToList(),
		};
	}

	public static void StartWriting(BluffRoundState round, BluffRulesConfig rules, DateTime nowUtc)
	{
		round.Phase = BluffPhase.Writing;
		round.StartedAt = nowUtc;
		round.DurationSeconds = rules.WriteSeconds;
	}

	public static bool IsTimed(BluffRoundState round)
		=> round.Phase is BluffPhase.Writing or BluffPhase.Voting or BluffPhase.FinalVoting;

	public static bool IsExpired(BluffRoundState round, DateTime nowUtc)
		=> IsTimed(round)
			&& round.StartedAt is { } started
			&& nowUtc >= started.AddSeconds(round.DurationSeconds);

	/// <summary>Whether a bluff IS the truth, as the engine compares text: case, accents and
	/// punctuation never count, and the deck's other wordings count as the truth too.</summary>
	public static bool MatchesTruth(BluffRoundState round, string text)
	{
		var normalized = AnswerText.Normalize(text);
		if (normalized.Length == 0)
		{
			return false;
		}
		return normalized == AnswerText.Normalize(round.Truth)
			|| round.TruthVariants.Any(variant => AnswerText.Normalize(variant) == normalized);
	}

	/// <summary>Store (or replace) one player's bluff. The truth is refused outright: a bluff that
	/// happens to be true would sit on every ballot beside the real one and nobody could tell.</summary>
	public static WriteOutcome Write(BluffRoundState round, string playerId, string text)
	{
		if (round.Phase != BluffPhase.Writing)
		{
			return WriteOutcome.NotWriting;
		}
		var entry = round.Entries.FirstOrDefault(candidate => candidate.PlayerId == playerId);
		if (entry is null)
		{
			return WriteOutcome.NotWriting;
		}
		if (entry.Finished)
		{
			return WriteOutcome.AlreadyFinished;
		}
		var trimmed = text.Trim();
		if (trimmed.Length > MaxLieLength)
		{
			return WriteOutcome.TooLong;
		}
		if (MatchesTruth(round, trimmed))
		{
			return WriteOutcome.MatchesTruth;
		}
		entry.Text = trimmed;
		return WriteOutcome.Saved;
	}

	/// <summary>The writer has nothing more to add. False when they are not writing this round
	/// or had already said so.</summary>
	public static bool FinishWriting(BluffRoundState round, string playerId)
	{
		var entry = round.Entries.FirstOrDefault(candidate => candidate.PlayerId == playerId);
		if (entry is null || entry.Finished || round.Phase != BluffPhase.Writing)
		{
			return false;
		}
		entry.Finished = true;
		return true;
	}

	public static int WritersRemaining(BluffRoundState round)
		=> round.Entries.Count(entry => !entry.Finished);

	/// <summary>
	/// Close the writing: gather identical bluffs into one with every author, and deal the ballots.
	/// Each ballot carries the truth and up to <see cref="BluffRulesConfig.BallotSize"/> bluffs,
	/// never the voter's own. With more bluffs than that, the least-shown are dealt first, so
	/// every bluff lands on practically the same number of ballots — the fairness the vote rests on.
	/// </summary>
	public static void CloseWriting(
		BluffRoundState round,
		BluffRulesConfig rules,
		IRandomSource? random,
		DateTime nowUtc)
	{
		round.Lies.Clear();
		var byText = new Dictionary<string, BluffLieState>(StringComparer.Ordinal);
		foreach (var entry in round.Entries)
		{
			var normalized = AnswerText.Normalize(entry.Text);
			if (normalized.Length == 0)
			{
				continue;
			}
			if (!byText.TryGetValue(normalized, out var lie))
			{
				lie = new BluffLieState { Id = $"lie-{round.RoundNumber}-{round.Lies.Count + 1}", Text = entry.Text };
				byText[normalized] = lie;
				round.Lies.Add(lie);
			}
			lie.AuthorIds.Add(entry.PlayerId);
		}

		round.Ballots.Clear();
		var ring = Shuffled(round.Lies, random);
		var ballotSize = Math.Max(1, rules.BallotSize);
		foreach (var entry in round.Entries)
		{
			var picks = DealBluffs(ring, entry.PlayerId, ballotSize);
			round.Ballots.Add(BuildBallot(entry.PlayerId, picks, round.Truth, random, asksFunny: picks.Count >= 2, truthKnown: false));
		}

		round.Phase = BluffPhase.Voting;
		round.StartedAt = nowUtc;
		round.DurationSeconds = rules.VoteSeconds;
	}

	/// <summary>
	/// The bluffs one voter's first ballot carries, and the count of how often each has been
	/// dealt so far: all the ones they did not write when they fit, else the ones dealt the
	/// fewest times yet, the ring deciding between equals. Dealing the least-shown first keeps
	/// every bluff within a showing or two of every other, which is as even as "never your own"
	/// allows: the slack appears only when the bluff shown least is the voter's own.
	/// </summary>
	internal static List<BluffLieState> DealBluffs(IReadOnlyList<BluffLieState> ring, string playerId, int ballotSize)
	{
		var eligible = ring.Where(lie => !lie.AuthorIds.Contains(playerId)).ToList();
		var picks = eligible.Count <= ballotSize
			? eligible
			: eligible.OrderBy(lie => lie.ShownCount).Take(ballotSize).ToList();
		foreach (var lie in picks)
		{
			lie.ShownCount++;
		}
		return picks;
	}

	private static BluffBallotState BuildBallot(
		string playerId,
		IReadOnlyList<BluffLieState> picks,
		string truth,
		IRandomSource? random,
		bool asksFunny,
		bool truthKnown)
	{
		var options = picks
			.Select(lie => new BluffOptionState { Text = lie.Text, Key = lie.Id })
			.ToList();
		if (!truthKnown)
		{
			options.Add(new BluffOptionState { Text = truth, Key = BluffBallotState.TruthKey });
		}
		var ordered = Shuffled(options, random);
		return new BluffBallotState
		{
			PlayerId = playerId,
			Options = ordered.Select((option, index) => option with { Index = index }).ToList(),
			AsksFunny = asksFunny && picks.Count >= 2,
			TruthKnown = truthKnown,
		};
	}

	public static BluffBallotState? BallotOf(BluffRoundState round, string playerId, bool final)
		=> (final ? round.FinalBallots : round.Ballots).FirstOrDefault(ballot => ballot.PlayerId == playerId);

	public static bool IsComplete(BluffBallotState ballot)
		=> ballot.TruthPick is not null && (!ballot.AsksFunny || ballot.FunnyPick is not null);

	/// <summary>Mark a ballot. Either mark may be given or changed while the vote is open; the
	/// two may never point at the same line, since a bluff you took for the truth is no bluff
	/// to you.</summary>
	public static VoteResult Vote(BluffRoundState round, string playerId, bool final, int? truthPick, int? funnyPick)
	{
		var expected = final ? BluffPhase.FinalVoting : BluffPhase.Voting;
		if (round.Phase != expected)
		{
			return new VoteResult(VoteOutcome.WrongPhase, false);
		}
		var ballot = BallotOf(round, playerId, final);
		if (ballot is null)
		{
			return new VoteResult(VoteOutcome.NoBallot, false);
		}
		if (funnyPick is not null && !ballot.AsksFunny)
		{
			return new VoteResult(VoteOutcome.NotAsked, false);
		}
		var nextTruth = truthPick ?? ballot.TruthPick;
		var nextFunny = funnyPick ?? ballot.FunnyPick;
		if ((nextTruth is { } truthIndex && truthIndex >= ballot.Options.Count)
			|| (nextFunny is { } funnyIndex && funnyIndex >= ballot.Options.Count)
			|| nextTruth < 0 || nextFunny < 0)
		{
			return new VoteResult(VoteOutcome.UnknownOption, false);
		}
		if (nextTruth is not null && nextTruth == nextFunny)
		{
			// Changing your mind about the truth onto the line you called funniest drops the
			// funny mark rather than refusing the truth, which is the mark that matters.
			if (truthPick is not null && funnyPick is null)
			{
				nextFunny = null;
			}
			else
			{
				return new VoteResult(VoteOutcome.SameOption, false);
			}
		}
		var wasComplete = IsComplete(ballot);
		ballot.TruthPick = nextTruth;
		ballot.FunnyPick = nextFunny;
		return new VoteResult(VoteOutcome.Marked, !wasComplete && IsComplete(ballot));
	}

	public static int VotersRemaining(BluffRoundState round, bool final)
		=> (final ? round.FinalBallots : round.Ballots).Count(ballot => !IsComplete(ballot));

	/// <summary>Whether a table big enough for a final is playing one: when every bluff is seen by
	/// fewer than half the room, a first vote only narrows the field.</summary>
	public static bool NeedsFinal(BluffRoundState round, BluffRulesConfig rules)
		=> round.Lies.Count > 2 * Math.Max(1, rules.BallotSize);

	/// <summary>
	/// Close the first vote: count the marks, and either open the final among the bluffs the room
	/// liked most or go straight to the reveal. Returns true when a final was opened.
	/// </summary>
	public static bool CloseVoting(
		BluffRoundState round,
		BluffRulesConfig rules,
		IRandomSource? random,
		DateTime nowUtc)
	{
		var lies = round.Lies.ToDictionary(lie => lie.Id, StringComparer.Ordinal);
		round.TruthFinderIds.Clear();
		foreach (var ballot in round.Ballots)
		{
			if (ballot.TruthPick is { } truthIndex)
			{
				var key = ballot.Options[truthIndex].Key;
				if (key == BluffBallotState.TruthKey)
				{
					round.TruthFinderIds.Add(ballot.PlayerId);
				}
				else if (lies.TryGetValue(key, out var believed))
				{
					believed.BelieverIds.Add(ballot.PlayerId);
				}
			}
			if (ballot.FunnyPick is { } funnyIndex && lies.TryGetValue(ballot.Options[funnyIndex].Key, out var funny))
			{
				funny.FunnyVoterIds.Add(ballot.PlayerId);
			}
		}

		if (!NeedsFinal(round, rules))
		{
			round.Phase = BluffPhase.Reveal;
			round.StartedAt = null;
			return false;
		}

		// Votes first, then originality (fewer authors), then the draw: a shuffle before a stable
		// sort is the lot, and the lot is announced as such.
		var finalists = Shuffled(round.Lies, random)
			.OrderByDescending(lie => lie.BelieverIds.Count + lie.FunnyVoterIds.Count)
			.ThenBy(lie => lie.AuthorIds.Count)
			.Take(Math.Max(2, rules.Finalists))
			.ToList();
		foreach (var lie in finalists)
		{
			lie.Finalist = true;
		}

		round.FinalBallots.Clear();
		var finders = new HashSet<string>(round.TruthFinderIds, StringComparer.Ordinal);
		foreach (var entry in round.Entries)
		{
			var picks = finalists.Where(lie => !lie.AuthorIds.Contains(entry.PlayerId)).ToList();
			round.FinalBallots.Add(BuildBallot(
				entry.PlayerId,
				picks,
				round.Truth,
				random,
				asksFunny: false,
				truthKnown: finders.Contains(entry.PlayerId)));
		}
		round.HasFinal = true;
		round.Phase = BluffPhase.FinalVoting;
		round.StartedAt = nowUtc;
		round.DurationSeconds = rules.VoteSeconds;
		return true;
	}

	/// <summary>Close the final: count its marks and put the round on the table.</summary>
	public static void CloseFinal(BluffRoundState round)
	{
		var lies = round.Lies.ToDictionary(lie => lie.Id, StringComparer.Ordinal);
		round.FinalTruthFinderIds.Clear();
		foreach (var ballot in round.FinalBallots)
		{
			if (ballot.TruthPick is not { } index)
			{
				continue;
			}
			var key = ballot.Options[index].Key;
			if (key == BluffBallotState.TruthKey)
			{
				round.FinalTruthFinderIds.Add(ballot.PlayerId);
			}
			else if (lies.TryGetValue(key, out var believed))
			{
				believed.FinalBelieverIds.Add(ballot.PlayerId);
			}
		}
		round.Phase = BluffPhase.Reveal;
		round.StartedAt = null;
	}

	/// <summary>
	/// Bank the round. Finding the truth pays <see cref="BluffRulesConfig.TruthPoints"/>; every
	/// player a bluff fools pays its authors <see cref="BluffRulesConfig.FoolPoints"/>, divided
	/// between them when several wrote the same thing — the obvious bluff is worth less per head
	/// than the original one. With a final, the first vote pays half and the final pays full: the
	/// truth was harder to spot among seven, and fooling the whole room is the real prize.
	/// </summary>
	public static BluffRevealState Score(BluffState state, BluffRoundState round, BluffRulesConfig rules)
	{
		var firstTruth = rules.TruthPoints;
		var finalTruth = rules.TruthPoints / 2;
		var firstFool = round.HasFinal ? rules.FoolPoints / 2 : rules.FoolPoints;
		var finalFool = rules.FoolPoints;

		var truthPoints = new Dictionary<string, int>(StringComparer.Ordinal);
		foreach (var finder in round.TruthFinderIds)
		{
			truthPoints[finder] = firstTruth;
		}
		foreach (var finder in round.FinalTruthFinderIds)
		{
			truthPoints[finder] = truthPoints.GetValueOrDefault(finder) + finalTruth;
		}

		var foolPoints = new Dictionary<string, int>(StringComparer.Ordinal);
		var fooled = new Dictionary<string, int>(StringComparer.Ordinal);
		var shown = new Dictionary<string, int>(StringComparer.Ordinal);
		foreach (var lie in round.Lies)
		{
			var votes = lie.BelieverIds.Count + lie.FinalBelieverIds.Count;
			var worth = lie.BelieverIds.Count * firstFool + lie.FinalBelieverIds.Count * finalFool;
			var each = worth / Math.Max(1, lie.AuthorIds.Count);
			foreach (var author in lie.AuthorIds)
			{
				foolPoints[author] = each;
				fooled[author] = votes;
				shown[author] = lie.ShownCount;
			}
		}

		var results = new List<BluffPlayerResult>();
		foreach (var player in state.Players)
		{
			var gained = truthPoints.GetValueOrDefault(player.PlayerId) + foolPoints.GetValueOrDefault(player.PlayerId);
			player.Score += gained;
			results.Add(new BluffPlayerResult
			{
				PlayerId = player.PlayerId,
				FoundTruth = truthPoints.ContainsKey(player.PlayerId),
				TruthPoints = truthPoints.GetValueOrDefault(player.PlayerId),
				FooledCount = fooled.GetValueOrDefault(player.PlayerId),
				FoolPoints = foolPoints.GetValueOrDefault(player.PlayerId),
				ShownCount = shown.GetValueOrDefault(player.PlayerId),
				Total = player.Score,
			});
		}

		var best = round.Lies
			.Where(lie => lie.BelieverIds.Count + lie.FinalBelieverIds.Count > 0)
			.OrderByDescending(lie => lie.BelieverIds.Count + lie.FinalBelieverIds.Count)
			.ThenBy(lie => lie.AuthorIds.Count)
			.FirstOrDefault();
		var funniest = round.Lies
			.Where(lie => lie.FunnyVoterIds.Count > 0)
			.OrderByDescending(lie => lie.FunnyVoterIds.Count)
			.ThenBy(lie => lie.AuthorIds.Count)
			.FirstOrDefault();

		round.Reveal = new BluffRevealState
		{
			TruthFinderCount = round.TruthFinderIds.Count + round.FinalTruthFinderIds.Count,
			BestLieId = best?.Id,
			FunniestLieId = funniest?.Id,
			Results = results,
		};
		return round.Reveal;
	}

	/// <summary>The players in score order, best first. Seat order breaks ties, so the list is stable.</summary>
	public static List<BluffPlayerState> Standings(BluffState state)
		=> state.Players.OrderByDescending(player => player.Score).ToList();

	/// <summary>Close the revealed round and either deal the next one or decide the match. A tie
	/// at the top adds one round, so the winner always wins outright.</summary>
	public static RoundAdvance CompleteRound(BluffState state, IReadOnlyList<BluffQuestionDef> deck)
	{
		var round = state.Round;
		round.Phase = BluffPhase.Finished;
		var tieBreaker = false;
		if (round.RoundNumber >= state.RoundsToPlay)
		{
			var best = state.Players.Max(player => player.Score);
			var leaders = state.Players.Where(player => player.Score == best).ToList();
			if (leaders.Count == 1)
			{
				return new RoundAdvance(GameOver: true, WinnerId: leaders[0].PlayerId, TieBreakerStarted: false);
			}
			state.RoundsToPlay++;
			tieBreaker = true;
		}
		state.Round = DealRound(state, deck, round.RoundNumber + 1);
		return new RoundAdvance(false, null, tieBreaker);
	}

	/// <summary>Who runs the table once <paramref name="leavingId"/> is gone: the next seat in
	/// order still in the game.</summary>
	public static string NextMaster(BluffState state, IReadOnlyList<string> seatOrder, string leavingId)
	{
		var remaining = seatOrder
			.Where(id => id != leavingId && state.Players.Any(player => player.PlayerId == id))
			.ToList();
		if (remaining.Count == 0)
		{
			throw new InvalidOperationException("bluff game has no players left to run it.");
		}
		return remaining[0];
	}

	private static List<T> Shuffled<T>(IReadOnlyList<T> items, IRandomSource? random)
		=> (random is { } source ? source.Shuffle(items) : items).ToList();
}
