using CorroServer.Models;
using CorroServer.Models.Corro;

namespace CorroServer.Services.Rules;

/// <summary>Pure state transitions for the forbidden-word family. Conversation adjudication
/// remains human: the clue-giver marks a correct answer, and the opposing monitor reports a
/// forbidden word. The rulebook never records, transcribes or attempts to understand speech.</summary>
public static class ForbiddenRulebook
{
	public sealed record TurnAdvance(bool GameOver, int? WinnerTeamIndex, bool TieBreakerStarted);

	/// <summary>
	/// The sides of a match: two equal teams in team play, or one side per player when everyone
	/// plays for themselves. Scores, turns taken and the rotation all live on the side, so the rest
	/// of the rulebook never asks which seating it is running — only the role assignment does.
	/// </summary>
	public static ForbiddenState CreateInitialState(
		IReadOnlyList<IReadOnlyList<string>> arrangedTeams,
		IReadOnlyList<ForbiddenWordDef> deck,
		ForbiddenRulesConfig rules)
	{
		if (rules.PlaysSolo())
		{
			if (arrangedTeams.Count < 3 || arrangedTeams.Any(side => side.Count != 1))
			{
				throw new InvalidOperationException(
					"forbidden games with everyone for themselves need at least three players, one per side.");
			}
		}
		else if (arrangedTeams.Count != 2 || arrangedTeams.Any(team => team.Count < 2)
			|| arrangedTeams[0].Count != arrangedTeams[1].Count)
		{
			throw new InvalidOperationException("forbidden games need two equal teams with at least two players each.");
		}
		if (deck.Count == 0)
		{
			throw new InvalidOperationException("forbidden word deck is empty.");
		}

		var teams = arrangedTeams.Select((members, index) => new ForbiddenTeamState
		{
			TeamIndex = index,
			MemberIds = members.ToList(),
		}).ToList();

		var state = new ForbiddenState
		{
			Teams = teams,
			ActiveTeamIndex = 0,
			Turn = BuildTurn(teams, activeTeamIndex: 0, turnNumber: 1, rules, cycle: 1),
		};
		DealNextCard(state, deck);
		return state;
	}

	public static bool IsExpired(ForbiddenTurnState turn, DateTime nowUtc)
		=> turn.Phase == ForbiddenTurnPhase.Active
			&& turn.StartedAt is { } started
			&& nowUtc >= started.AddSeconds(turn.DurationSeconds);

	public static int RemainingSeconds(ForbiddenTurnState turn, DateTime nowUtc)
	{
		if (turn.Phase != ForbiddenTurnPhase.Active || turn.StartedAt is not { } started)
		{
			return turn.DurationSeconds;
		}
		return Math.Max(0, (int)Math.Ceiling(
			(started.AddSeconds(turn.DurationSeconds) - nowUtc).TotalSeconds));
	}

	/// <summary>Replace the private card while preserving roles and the running clock.</summary>
	public static ForbiddenWordDef DealNextCard(ForbiddenState state, IReadOnlyList<ForbiddenWordDef> deck)
	{
		if (deck.Count == 0)
		{
			throw new InvalidOperationException("forbidden word deck is empty.");
		}
		var card = deck[state.CardCursor % deck.Count];
		state.CardCursor++;
		state.CardSequence++;
		state.Turn.CardSequence = state.CardSequence;
		state.Turn.CardId = card.Id;
		state.Turn.Target = card.Target;
		state.Turn.ForbiddenWords = card.Forbidden.ToList();
		return card;
	}

	/// <summary>The side a player scores for: their team, or themselves.</summary>
	public static ForbiddenTeamState SideOf(ForbiddenState state, string playerId)
		=> state.Teams.First(side => side.MemberIds.Contains(playerId));

	/// <summary>
	/// A correct guess: the active side scores, and when everyone plays for themselves the guesser
	/// scores too — guessing has to pay, or the only player with a reason to try is the one giving
	/// the clues, and the monitor (the one player NOT gaining this turn) has a reason to listen.
	/// Returns the sides credited, the clue-giver's first.
	/// </summary>
	public static IReadOnlyList<ForbiddenTeamState> AwardCorrect(ForbiddenState state, ForbiddenRulesConfig rules)
	{
		var turn = state.Turn;
		var credited = new List<ForbiddenTeamState> { state.Teams[turn.TeamIndex] };
		if (rules.PlaysSolo())
		{
			credited.Add(SideOf(state, turn.GuesserId));
		}
		foreach (var side in credited)
		{
			side.Score += rules.CorrectPoints;
		}
		turn.CorrectCount++;
		return credited;
	}

	/// <summary>A reported slip costs the side that spoke it — the clue-giver's, in either seating.</summary>
	public static ForbiddenTeamState PenaliseViolation(ForbiddenState state, ForbiddenRulesConfig rules)
	{
		var side = state.Teams[state.Turn.TeamIndex];
		side.Score -= rules.ViolationPenalty;
		state.Turn.ViolationCount++;
		return side;
	}

	/// <summary>Close the active side's turn and either prepare the next side in rotation or
	/// decide the match after a complete clue-giver rotation. A tie adds one whole rotation.</summary>
	public static TurnAdvance CompleteTurn(
		ForbiddenState state,
		IReadOnlyList<ForbiddenWordDef> deck,
		ForbiddenRulesConfig rules)
	{
		var completedTeam = state.Teams[state.ActiveTeamIndex];
		completedTeam.TurnsTaken++;
		state.Turn.Phase = ForbiddenTurnPhase.Finished;

		// Ending on a target score: the first side there wins — but only once EVERY side has taken
		// the same number of turns. Stopping the moment a side crosses would hand the match to
		// whoever happened to play first, and equal opportunity is the rule this family is built
		// on (it is why a tie adds a WHOLE rotation rather than one turn). Level on the target,
		// nobody has won yet and play continues.
		var ranked = state.Teams.OrderByDescending(team => team.Score).ToList();
		var leaderAlone = ranked[0].Score != ranked[1].Score;
		if (rules.EndMode == "score")
		{
			var levelTurns = state.Teams.Select(team => team.TurnsTaken).Distinct().Count() == 1;
			if (levelTurns && ranked[0].Score >= rules.TargetScore && leaderAlone)
			{
				return new TurnAdvance(
					GameOver: true,
					WinnerTeamIndex: ranked[0].TeamIndex,
					TieBreakerStarted: false);
			}
		}

		var cycleComplete = state.Teams.All(team =>
			team.TurnsTaken >= state.Cycle * team.MemberIds.Count);
		var tieBreaker = false;
		if (cycleComplete)
		{
			// Rotations decide the match only when the host asked for a fixed length; on a target
			// score they just keep dealing turns until somebody gets there. A lead shared at the
			// top — by two teams, or by two of five players — is what a rotation more settles.
			if (rules.EndMode != "score" && state.Cycle >= rules.Cycles)
			{
				if (leaderAlone)
				{
					return new TurnAdvance(
						GameOver: true,
						WinnerTeamIndex: ranked[0].TeamIndex,
						TieBreakerStarted: false);
				}
				tieBreaker = true;
			}
			state.Cycle++;
		}

		state.ActiveTeamIndex = (state.ActiveTeamIndex + 1) % state.Teams.Count;
		state.Turn = BuildTurn(
			state.Teams,
			state.ActiveTeamIndex,
			state.Turn.TurnNumber + 1,
			rules,
			state.Cycle);
		DealNextCard(state, deck);
		return new TurnAdvance(false, null, tieBreaker);
	}

	/// <summary>
	/// Who guesses for the active player when everyone plays for themselves, as a distance along
	/// the table: the next seat in the first rotation, the one after in the second, and so on round
	/// the table before starting again. With three players the direction alternates each rotation;
	/// with five every player gives clues to each of the other four once in four rotations. A fixed
	/// distance paired the same two people all evening (asked for by a table of three, where the
	/// first player only ever gave clues to the second). The monitor is the next seat after the
	/// guesser's distance, so monitoring walks the table too, and the two never coincide.
	/// </summary>
	internal static (int Guesser, int Monitor) SoloSeatDistances(int playerCount, int cycle)
	{
		var partners = playerCount - 1;
		var guesser = (cycle - 1) % partners + 1;
		var monitor = guesser % partners + 1;
		return (guesser, monitor);
	}

	private static ForbiddenTurnState BuildTurn(
		IReadOnlyList<ForbiddenTeamState> teams,
		int activeTeamIndex,
		int turnNumber,
		ForbiddenRulesConfig rules,
		int cycle)
	{
		if (rules.PlaysSolo())
		{
			// Everyone for themselves: the active player gives the clues, and the guesser and the
			// monitor sit a distance along the table that changes with the rotation. Over a whole
			// rotation every player still holds every role once, so the seating is as fair as two
			// teams — with any number of players from three up — without always pairing the same two.
			var count = teams.Count;
			var (guesser, monitor) = SoloSeatDistances(count, cycle);
			return new ForbiddenTurnState
			{
				TurnNumber = turnNumber,
				TeamIndex = activeTeamIndex,
				ClueGiverId = teams[activeTeamIndex].MemberIds[0],
				GuesserId = teams[(activeTeamIndex + guesser) % count].MemberIds[0],
				MonitorId = teams[(activeTeamIndex + monitor) % count].MemberIds[0],
				DurationSeconds = rules.TurnSeconds,
			};
		}

		var team = teams[activeTeamIndex];
		var rival = teams[(activeTeamIndex + 1) % teams.Count];
		var index = team.TurnsTaken % team.MemberIds.Count;
		return new ForbiddenTurnState
		{
			TurnNumber = turnNumber,
			TeamIndex = activeTeamIndex,
			ClueGiverId = team.MemberIds[index],
			GuesserId = team.MemberIds[(index + 1) % team.MemberIds.Count],
			MonitorId = rival.MemberIds[index % rival.MemberIds.Count],
			DurationSeconds = rules.TurnSeconds,
		};
	}
}
