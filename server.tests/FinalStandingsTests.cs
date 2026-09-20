using CorroServer.Models;
using CorroServer.Services;
using CorroServer.Services.Corro;
using CorroServer.Services.Corro.Families;
using CorroServer.Services.Rules;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// The plumbing around the final table: WHEN it is filled in and when it is not. The tables
/// themselves — one per family, built from a match played to its end — live with each family's
/// flow tests, where the state comes from real play instead of an assignment.
/// </summary>
public class FinalStandingsTests
{
	private static List<Player> FourPlayers() => new()
	{
		new() { Id = "a", Name = "Ana", Token = "disc" },
		new() { Id = "b", Name = "Berto", Token = "star" },
		new() { Id = "c", Name = "Carla", Token = "cup" },
		new() { Id = "d", Name = "Dani", Token = "hat" },
	};

	private static async Task<GameService> FourColoursAsync()
	{
		var definition = await new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir("four-colours"));
		var service = new GameService(new CorroRulebook(), new AuctionRulebook());
		await service.InitializeFromDefinitionAsync(FourPlayers(), definition, "en");
		return service;
	}

	[Fact]
	public async Task A_running_match_has_no_final_table()
	{
		var service = await FourColoursAsync();

		await service.NotifyStateChangedAsync();

		Assert.Null(service.GameState!.FinalStandings);
	}

	[Fact]
	public async Task Publishing_a_finished_state_fills_the_table_in_from_the_family()
	{
		var service = await FourColoursAsync();
		var state = service.GameState!;
		foreach (var (seat, index) in state.Shedding!.Seats.Select((seat, index) => (seat, index)))
		{
			seat.Score = index * 10;
			state.Players.First(player => player.Id == seat.PlayerId).FinishPlace = index + 1;
		}
		state.IsGameOver = true;

		await service.NotifyStateChangedAsync();

		var standings = state.FinalStandings;
		Assert.NotNull(standings);
		Assert.Equal("game.end_measure_points", standings!.MeasureKey);
		Assert.Equal(new[] { 0, 10, 20, 30 }, standings.Sides.Select(side => side.Value));
	}

	[Fact]
	public async Task The_table_is_sealed_once_and_never_rebuilt_from_a_state_being_torn_down()
	{
		// The state is published again while the match is retired, and by then seats can already
		// have been folded. A second pass would quietly replace a real table with that wreckage.
		var service = await FourColoursAsync();
		var state = service.GameState!;
		state.Shedding!.Seats[0].Score = 42;
		state.IsGameOver = true;
		await service.NotifyStateChangedAsync();

		state.Shedding.Seats[0].Score = 0;
		state.Shedding.Seats.Clear();
		await service.NotifyStateChangedAsync();

		Assert.Equal(42, state.FinalStandings!.Sides.First(side => side.MemberIds.Contains("a")).Value);
	}

	[Fact]
	public void A_sealed_table_survives_the_round_trip_through_persistence()
	{
		// The table is stored with the game and read back when the table view offers "see the
		// standings" again. A shape that serializes but cannot be read back would not lose the
		// table: it would break the whole document, and with it the finished match's own table.
		var state = new GameState
		{
			GameType = "forbidden",
			FinalStandings = new MatchStandings
			{
				MeasureKey = "game.end_measure_points",
				Sides = new[]
				{
					new StandingSide { MemberIds = new[] { "a", "b" }, Place = 1, TeamIndex = 0, Value = 12 },
					new StandingSide { MemberIds = new[] { "c" }, Place = 2, Value = 9 },
				},
			},
		};

		var restored = System.Text.Json.JsonSerializer.Deserialize<GameState>(
			System.Text.Json.JsonSerializer.Serialize(state))!;

		var sides = restored.FinalStandings!.Sides;
		Assert.Equal("game.end_measure_points", restored.FinalStandings.MeasureKey);
		Assert.Equal(new[] { "a", "b" }, sides[0].MemberIds);
		Assert.Equal(0, sides[0].TeamIndex);
		Assert.Equal(12, sides[0].Value);
		Assert.Null(sides[1].TeamIndex);
	}

	[Fact]
	public void The_two_families_that_count_nothing_worth_showing_hand_back_no_table()
	{
		// Everyone but the winner ends a property match bankrupt with nothing, and the exploding
		// family only records the order players fell in — which the ranked list already says.
		var property = GameFamilies.For("property").FinalStandings(new GameState { GameType = "property" });
		var exploding = GameFamilies.For("exploding").FinalStandings(new GameState { GameType = "exploding" });

		Assert.Null(property);
		Assert.Null(exploding);
	}
}
