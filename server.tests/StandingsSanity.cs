using CorroServer.Models;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// What the final table promises in EVERY family, checked against the state a match really
/// finished in. Each family is free to count whatever its game is about — points, squares,
/// wedges, pieces home — but none of them may contradict the placings the match already
/// decided, leave a player out, or name the same player on two rows.
///
/// The families assert their own numbers in their own flow tests; this is the part that would
/// otherwise be re-written nine times and checked in eight of them.
/// </summary>
internal static class StandingsSanity
{
	public static void AssertSane(GameState state, MatchStandings? standings)
	{
		Assert.NotNull(standings);
		Assert.NotEmpty(standings!.Sides);
		Assert.StartsWith("game.end_measure_", standings.MeasureKey);

		var listed = new List<string>();
		foreach (var side in standings.Sides)
		{
			Assert.NotEmpty(side.MemberIds);
			foreach (var id in side.MemberIds)
			{
				Assert.Contains(state.Players, player => player.Id == id);
				Assert.DoesNotContain(id, listed); // nobody stands on two sides at once
				listed.Add(id);
			}

			// A row that pools players who did NOT finish together says nothing: the number
			// above it would belong to one of them and the place to the other.
			var places = side.MemberIds
				.Select(id => state.Players.First(player => player.Id == id).FinishPlace)
				.Distinct();
			Assert.Single(places);
			Assert.Equal(places.Single(), side.Place);
		}

		// Everyone who played is on it. Reading a table that quietly omits the player who came
		// last is how you learn you were not on it.
		Assert.Equal(
			state.Players.Select(player => player.Id).OrderBy(id => id, StringComparer.Ordinal),
			listed.OrderBy(id => id, StringComparer.Ordinal));

		// The rows follow the places the match stamped, with any unplaced side last — never the
		// measure, which in a penalty game would print the winner at the bottom.
		var order = standings.Sides
			.Select(side => side.Place <= 0 ? int.MaxValue : side.Place)
			.ToList();
		Assert.Equal(order.OrderBy(place => place), order);

		// And the top line is the winner's. A table that opens on anyone else is simply wrong,
		// whatever its numbers say.
		if (state.WinnerId is { Length: > 0 } winnerId && listed.Contains(winnerId))
		{
			Assert.Contains(winnerId, standings.Sides[0].MemberIds);
		}
	}
}
