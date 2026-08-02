using CorroServer.Services;
using CorroServer.Services.Rules;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// Dealing the waiting room into teams at random: the host's one-click arrangement. The
/// randomness is injected, so what is pinned here is the SHAPE of the result — everyone
/// placed, teams as even as the roster allows, nobody over the table's team size.
/// </summary>
public class LobbyTeamsTests
{
	private static List<string> Roster(int count)
		=> Enumerable.Range(1, count).Select(n => $"p{n}").ToList();

	[Fact]
	public void Every_player_is_placed_and_the_teams_come_out_even()
	{
		var placements = LobbyTeams.DealAtRandom(Roster(6), teamCount: 2, teamSize: 3, new ScriptedRandomSource());

		Assert.Equal(6, placements.Count);
		Assert.Equal(3, placements.Count(p => p.Value == 0));
		Assert.Equal(3, placements.Count(p => p.Value == 1));
		Assert.All(placements, p => Assert.InRange(p.Value, 0, 1));
	}

	[Fact]
	public void A_half_empty_room_still_splits_as_evenly_as_it_can()
	{
		// Five players around a table for eight: 3 and 2, and never 4 in a team of 4 while the
		// other holds 1 — the point of the button is a playable arrangement, not a full one.
		var placements = LobbyTeams.DealAtRandom(Roster(5), teamCount: 2, teamSize: 4, new ScriptedRandomSource());

		Assert.Equal(5, placements.Count);
		var sizes = placements.GroupBy(p => p.Value).Select(g => g.Count()).OrderBy(n => n).ToList();
		Assert.Equal(new[] { 2, 3 }, sizes);
	}

	[Fact]
	public void The_shuffle_decides_who_goes_where()
	{
		// The scripted source shuffles to the identity, so the deal is the plain round-robin
		// over the roster order: this is what an E2E can rely on.
		var placements = LobbyTeams.DealAtRandom(Roster(4), teamCount: 2, teamSize: 2, new ScriptedRandomSource());

		Assert.Equal(0, placements["p1"]);
		Assert.Equal(1, placements["p2"]);
		Assert.Equal(0, placements["p3"]);
		Assert.Equal(1, placements["p4"]);
	}

	[Fact]
	public void Nobody_is_placed_beyond_the_table_or_without_teams()
	{
		var overfull = LobbyTeams.DealAtRandom(Roster(5), teamCount: 2, teamSize: 2, new ScriptedRandomSource());
		Assert.Equal(4, overfull.Count); // the fifth stays in the pool rather than overfilling a team
		Assert.All(overfull.GroupBy(p => p.Value), group => Assert.Equal(2, group.Count()));

		Assert.Empty(LobbyTeams.DealAtRandom(Roster(4), teamCount: 1, teamSize: 4, new ScriptedRandomSource()));
		Assert.Empty(LobbyTeams.DealAtRandom(Roster(4), teamCount: 2, teamSize: 0, new ScriptedRandomSource()));
		Assert.Empty(LobbyTeams.DealAtRandom(new List<string>(), teamCount: 2, teamSize: 2, new ScriptedRandomSource()));
	}
}
