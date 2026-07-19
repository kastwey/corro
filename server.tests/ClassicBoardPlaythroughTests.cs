using System.IO.Compression;
using CorroServer.Models.Corro;
using CorroServer.Services.Corro;
using CorroServer.Tests.Integration;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// A real playthrough of the classic .corro package: load it the way an upload does (zip →
/// extract → definition), start a two-player game on the resulting board, and roll the dice across
/// several turns — asserting the players move around the actual Madrid board and that its landing
/// effects fire (the buy prompt, income tax, and the GO salary). The end-to-end "does an uploaded
/// package game actually play?" net, with deterministic dice and no Cosmos/SignalR.
/// </summary>
public class ClassicBoardPlaythroughTests
{
	/// <summary>Pack the classic fixture into a zip and load it through the upload path.</summary>
	private static async Task<GameDefinition> LoadClassicBoardFromZipAsync()
	{
		var fixture = CorroTestPaths.FixtureDir("corro-classic");
		var zipPath = Path.Combine(Path.GetTempPath(), "corro_play_" + Guid.NewGuid().ToString("N") + ".zip");
		var extractDir = Path.Combine(Path.GetTempPath(), "corro_play_" + Guid.NewGuid().ToString("N"));
		ZipFile.CreateFromDirectory(fixture, zipPath);
		try
		{
			await using var zip = File.OpenRead(zipPath);
			return await new CorroPackageLoader().LoadFromZipAsync(zip, extractDir);
		}
		finally
		{
			if (File.Exists(zipPath))
			{
				File.Delete(zipPath);
			}

			CorroPackageLoader.DeleteExtracted(extractDir);
		}
	}

	[Fact]
	public async Task A_two_player_game_loaded_from_the_classic_zip_plays_several_turns()
	{
		// Load + start: the uploaded package becomes a 2-player game on the real Madrid board.
		var def = await LoadClassicBoardFromZipAsync();
		Assert.Equal("corro-classic", def.Manifest.Id);
		var squares = GameDefinitionAdapter.ToSquares(def, "es");
		Assert.Equal(40, squares.Count);

		var ana = TestFixtures.NewPlayer("ana", money: 1500, position: 0);
		var beto = TestFixtures.NewPlayer("beto", money: 1500, position: 0);
		var harness = new GameHarness(new[] { ana, beto }, squares, rentRules: def.Manifest.Rules);

		// Turn 1 — Ana rolls 2+4 = 6 → a 100€ street: she gets a buy prompt and is NOT charged for
		// landing on an unowned property.
		await harness.RollAsync("ana", 2, 4);
		Assert.Equal(6, harness.Player("ana").Position);
		Assert.Equal("Calle 6", squares[6].Name);
		Assert.NotNull(harness.State.PendingPurchase);
		Assert.Equal(6, harness.State.PendingPurchase!.SquareIndex);
		Assert.Equal(100, harness.State.PendingPurchase.Price);
		Assert.Equal(1500, harness.Player("ana").Money);

		// Turn 2 — Beto rolls 1+3 = 4 → a tax square: the tax is charged on landing.
		await harness.RollAsync("beto", 1, 3);
		Assert.Equal(4, harness.Player("beto").Position);
		Assert.Equal("tax", squares[4].Behavior);
		Assert.True(harness.Player("beto").Money < 1500, "income tax was charged on landing");

		// Turn 3 — Ana (at 6) rolls 5+4 = 9 → position 15: the game keeps moving her around the ring.
		await harness.RollAsync("ana", 5, 4);
		Assert.Equal(15, harness.Player("ana").Position);

		// Turn 4 — Beto (at 4) rolls 2+5 = 7 → position 11: both players advance.
		await harness.RollAsync("beto", 2, 5);
		Assert.Equal(11, harness.Player("beto").Position);
		Assert.Equal("Calle 11", squares[11].Name);
	}

	[Fact]
	public async Task Passing_GO_pays_the_packages_salary()
	{
		var def = await LoadClassicBoardFromZipAsync();
		var squares = GameDefinitionAdapter.ToSquares(def, "es");

		var ana = TestFixtures.NewPlayer("ana", money: 1500, position: 37);
		var beto = TestFixtures.NewPlayer("beto", money: 1500, position: 0);
		var harness = new GameHarness(new[] { ana, beto }, squares, rentRules: def.Manifest.Rules);

		// Ana at 37 rolls 2+4 = 6 → 43 ≡ 3, passing GO. Position 3 is an unowned 60€ street (buy
		// prompt, no rent), so the only money change is the package's +200 GO salary.
		await harness.RollAsync("ana", 2, 4);
		Assert.Equal(3, harness.Player("ana").Position);
		Assert.Equal(1700, harness.Player("ana").Money);
	}
}
