using CorroServer.Services.Rules;

namespace CorroServer.Services;

/// <summary>Transport-independent team arrangement for the waiting room.</summary>
public static class LobbyTeams
{
	/// <summary>
	/// Deal every player into the teams at random: shuffle the roster, then hand the players
	/// out one per team in turn, so the teams end up as even as the roster allows (a spare
	/// player joins the first team dealt). Placements are complete — nobody is left in the
	/// pool — and no team can exceed <paramref name="teamSize"/>, which round-robin dealing
	/// guarantees whenever the roster fits the table.
	/// Returns the player id to team index map the caller writes onto the document.
	/// </summary>
	public static IReadOnlyDictionary<string, int> DealAtRandom(
		IReadOnlyList<string> playerIds, int teamCount, int teamSize, IRandomSource random)
	{
		var placements = new Dictionary<string, int>();
		if (teamCount < 2 || teamSize < 1)
		{
			return placements;
		}

		var counts = new int[teamCount];
		foreach (var playerId in random.Shuffle(playerIds))
		{
			// Always the emptiest team, earliest first: identical to plain round-robin for a
			// roster that fits, and it still degrades sanely if one ever does not.
			var target = -1;
			for (var team = 0; team < teamCount; team++)
			{
				if (counts[team] < teamSize && (target < 0 || counts[team] < counts[target]))
				{
					target = team;
				}
			}

			if (target < 0)
			{
				break; // more players than places: the rest stay in the pool
			}

			placements[playerId] = target;
			counts[target]++;
		}

		return placements;
	}
}
