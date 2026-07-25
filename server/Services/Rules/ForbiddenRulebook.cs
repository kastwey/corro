using CorroServer.Models;
using CorroServer.Models.Corro;

namespace CorroServer.Services.Rules;

/// <summary>Pure state transitions for the forbidden-word family. Conversation adjudication
/// remains human: the clue-giver marks a correct answer, and the opposing monitor reports a
/// forbidden word. The rulebook never records, transcribes or attempts to understand speech.</summary>
public static class ForbiddenRulebook
{
	public sealed record TurnAdvance(bool GameOver, int? WinnerTeamIndex, bool TieBreakerStarted);

	public static ForbiddenState CreateInitialState(
		IReadOnlyList<IReadOnlyList<string>> arrangedTeams,
		IReadOnlyList<ForbiddenWordDef> deck,
		ForbiddenRulesConfig rules)
	{
		if (arrangedTeams.Count != 2 || arrangedTeams.Any(team => team.Count < 2)
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
			Turn = BuildTurn(teams, activeTeamIndex: 0, turnNumber: 1, rules),
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

	/// <summary>Close the active team's turn and either prepare the next alternating team or
	/// decide the match after a complete clue-giver rotation. A tie adds one whole rotation.</summary>
	public static TurnAdvance CompleteTurn(
		ForbiddenState state,
		IReadOnlyList<ForbiddenWordDef> deck,
		ForbiddenRulesConfig rules)
	{
		var completedTeam = state.Teams[state.ActiveTeamIndex];
		completedTeam.TurnsTaken++;
		state.Turn.Phase = ForbiddenTurnPhase.Finished;

		var cycleComplete = state.Teams.All(team =>
			team.TurnsTaken >= state.Cycle * team.MemberIds.Count);
		var tieBreaker = false;
		if (cycleComplete)
		{
			if (state.Cycle >= rules.Cycles)
			{
				var first = state.Teams[0].Score;
				var second = state.Teams[1].Score;
				if (first != second)
				{
					return new TurnAdvance(
						GameOver: true,
						WinnerTeamIndex: first > second ? 0 : 1,
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
			rules);
		DealNextCard(state, deck);
		return new TurnAdvance(false, null, tieBreaker);
	}

	private static ForbiddenTurnState BuildTurn(
		IReadOnlyList<ForbiddenTeamState> teams,
		int activeTeamIndex,
		int turnNumber,
		ForbiddenRulesConfig rules)
	{
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
