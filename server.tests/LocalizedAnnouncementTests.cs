using CorroServer.Models;
using CorroServer.Tests.Integration;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// Announcements that name a square carry its per-locale names for a bilingual (package) board, so
/// the client can read them in each player's language — and a plain string for a classic board, so
/// single-language games are unaffected.
/// </summary>
public class LocalizedAnnouncementTests
{
	[Fact]
	public async Task A_bilingual_square_passes_its_localized_names_in_announcements()
	{
		var a = TestFixtures.NewPlayer("a", money: 1500, position: 4);
		var board = TestFixtures.StandardBoard();
		board[6] = new Square
		{
			Id = 6,
			Name = "Calle",
			Type = "property",
			Names = new Dictionary<string, string> { ["es"] = "Calle", ["en"] = "Street" },
		};
		var harness = new GameHarness(new[] { a }, board);

		await harness.RollAsync("a", 1, 1); // 4 -> 6 (lands on the property)

		var landed = harness.Announcer.Sent.First(s => s.Key.StartsWith("game.landed_on_property"));
		var names = Assert.IsAssignableFrom<Dictionary<string, string>>(landed.Vars["square"]);
		Assert.Equal("Street", names["en"]);
		Assert.Equal("Calle", names["es"]);
	}

	[Fact]
	public async Task A_single_language_square_passes_a_plain_name()
	{
		var a = TestFixtures.NewPlayer("a", money: 1500, position: 4);
		var board = TestFixtures.StandardBoard();
		board[6] = new Square { Id = 6, Name = "Plain Street", Type = "property" }; // no Names
		var harness = new GameHarness(new[] { a }, board);

		await harness.RollAsync("a", 1, 1);

		var landed = harness.Announcer.Sent.First(s => s.Key.StartsWith("game.landed_on_property"));
		Assert.Equal("Plain Street", Assert.IsType<string>(landed.Vars["square"]));
	}
}
