using CorroServer.Models;

namespace CorroServer.Services.Corro.Families;

/// <summary>
/// Turns "what this family counts" into the engine's <see cref="MatchStandings"/>. Most families
/// end with one row per player and a number read off their own sub-state, so they say which key
/// names the measure and how to find the number, and nothing else.
///
/// The ORDER always comes from <see cref="Player.FinishPlace"/>, which every family stamps as its
/// match ends. The number is never sorted by: a penalty count is won by the lowest score, and a
/// table that ranked by the number would put that winner last.
/// </summary>
internal static class FinalStandingsBuilder
{
	/// <summary>
	/// One row per player, best first. <paramref name="valueOf"/> returns null for a player the
	/// family has nothing to say about (a seat that never played), who is then left out of the
	/// table entirely rather than shown with a made-up zero; when that leaves nothing, the whole
	/// table is null and the end screen keeps its plain ranked list.
	/// </summary>
	public static MatchStandings? ByPlayer(GameState state, string measureKey, Func<string, int?> valueOf,
		IEnumerable<Player>? order = null)
	{
		var sides = new List<StandingSide>();
		foreach (var player in order ?? state.Players)
		{
			if (valueOf(player.Id) is not { } value)
			{
				continue;
			}

			sides.Add(new StandingSide
			{
				MemberIds = new[] { player.Id },
				Place = player.FinishPlace,
				Value = value,
			});
		}

		return Build(measureKey, sides);
	}

	/// <summary>
	/// One row per SIDE that plays together, best first: the members in seating order and the
	/// side's number. The place comes from the members — partners share it.
	///
	/// A team index makes the client name the side from the shared palette ("the red team"), and
	/// belongs only where the match ALREADY speaks that way; a family whose voice names the two
	/// partners instead passes null, and the row simply reads "Ana and Berto".
	/// </summary>
	public static MatchStandings? ByTeam(GameState state, string measureKey,
		IEnumerable<(int? TeamIndex, IReadOnlyList<string> MemberIds, int Value)> teams)
	{
		var sides = new List<StandingSide>();
		foreach (var (teamIndex, memberIds, value) in teams)
		{
			if (memberIds.Count == 0)
			{
				continue;
			}

			var place = state.Players
				.Where(player => memberIds.Contains(player.Id))
				.Select(player => player.FinishPlace)
				.DefaultIfEmpty(0)
				.Max();

			sides.Add(new StandingSide
			{
				MemberIds = memberIds,
				Place = place,
				TeamIndex = teamIndex,
				Value = value,
			});
		}

		return Build(measureKey, sides);
	}

	/// <summary>Order by place and hand back the table — or null when there is no row to show.
	/// A side still waiting for a place (0) sorts LAST rather than first, which is where an
	/// unplaced seat belongs.</summary>
	private static MatchStandings? Build(string measureKey, List<StandingSide> sides)
	{
		if (sides.Count == 0)
		{
			return null;
		}

		var ordered = sides
			.OrderBy(side => side.Place <= 0 ? int.MaxValue : side.Place)
			.ToList();

		return new MatchStandings { MeasureKey = measureKey, Sides = ordered };
	}
}

/// <summary>The i18n keys naming what a family counts. Each has a translation in every locale,
/// and a package may override it like any other `game.*` key (calling points "credits", say).</summary>
internal static class StandingsMeasure
{
	public const string Points = "game.end_measure_points";
	public const string Square = "game.end_measure_square";
	public const string Wedges = "game.end_measure_wedges";
	public const string PiecesHome = "game.end_measure_pieces_home";
	public const string Parts = "game.end_measure_parts";
}
