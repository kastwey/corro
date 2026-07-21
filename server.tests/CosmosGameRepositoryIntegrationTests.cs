using CorroServer.Models;
using CorroServer.Services;

namespace CorroServer.Tests;

/// <summary>
/// Integration tests for <see cref="CosmosGameRepository"/> against the local Cosmos emulator (the
/// same persistence the server uses, exercised locally) — the create→load→delete round-trip a game
/// relies on to survive a restart. Gated by <see cref="CosmosFactAttribute"/>, so they only run when
/// the emulator is up and are skipped — never failed — in CI.
/// </summary>
public class CosmosGameRepositoryIntegrationTests
{
	private static Task<CosmosGameRepository> NewRepositoryAsync() => Emulators.NewCosmosRepositoryAsync();

	private static GameDocument NewGame(
		string gameId,
		DateTime? lastUpdated = null,
		string? packageBlobKey = null) => new()
	{
		Id = $"game-{gameId}",
		GameId = gameId,
		Status = GameStatus.WaitingForPlayers,
		HostId = "host-1",
		InviteCode = "INV123",
		LastUpdated = lastUpdated ?? DateTime.UtcNow,
		PackageToken = packageBlobKey,
		PackageBlobKey = packageBlobKey,
		MaxPlayers = 4,
				Board = "galactic-empire",
		Settings = new GameSettings(),
		Players = new List<LobbyPlayer>
		{
			new() { Id = "host-1", Name = "Alice", Token = "disc", IsHost = true, IsReady = true, PlayerSecretId = "secret-1" }
		}
	};

	[CosmosFact]
	public async Task Create_then_Load_round_trips_the_game_then_Delete_removes_it()
	{
		var repo = await NewRepositoryAsync();
		var gameId = "itest-" + Guid.NewGuid().ToString("N")[..8];

		await repo.CreateGameAsync(NewGame(gameId));

		var loaded = await repo.LoadGameAsync(gameId); // reads back from the emulator
		Assert.NotNull(loaded);
		Assert.Equal($"game-{gameId}", loaded!.Id);
				Assert.Equal("galactic-empire", loaded.Board);
		Assert.Equal(GameStatus.WaitingForPlayers, loaded.Status);
		Assert.Single(loaded.Players);
		Assert.Equal("Alice", loaded.Players[0].Name);

		Assert.True(await repo.DeleteGameAsync(gameId));
		Assert.Null(await repo.LoadGameAsync(gameId)); // gone (NotFound -> null)
	}

	[CosmosFact]
	public async Task Load_returns_null_for_a_missing_game()
		=> Assert.Null(await (await NewRepositoryAsync()).LoadGameAsync("itest-does-not-exist-" + Guid.NewGuid().ToString("N")[..8]));

	[CosmosFact]
	public async Task Retention_queries_find_old_games_and_package_references()
	{
		var repo = await NewRepositoryAsync();
		var prefix = "itest-ret-" + Guid.NewGuid().ToString("N")[..8];
		var oldId = prefix + "-old";
		var freshId = prefix + "-fresh";
		var cutoff = new DateTime(2026, 6, 21, 0, 0, 0, DateTimeKind.Utc);
		var oldBlob = prefix + "-blob-old";
		var freshBlob = prefix + "-blob-fresh";

		try
		{
			await repo.CreateGameAsync(NewGame(oldId, cutoff.AddDays(-1), oldBlob));
			await repo.CreateGameAsync(NewGame(freshId, cutoff, freshBlob));

			var candidates = new List<GameDocument>();
			await foreach (var game in repo.GetGamesLastUpdatedBeforeAsync(cutoff, maxCount: 100))
			{
				if (game.GameId.StartsWith(prefix, StringComparison.Ordinal))
				{
					candidates.Add(game);
				}
			}

			Assert.Equal(new[] { oldId }, candidates.Select(game => game.GameId));
			Assert.True(await repo.HasPackageReferenceAsync(packageToken: null, oldBlob));
			var references = await repo.GetReferencedPackageBlobKeysAsync();
			Assert.Contains(oldBlob, references);
			Assert.Contains(freshBlob, references);
		}
		finally
		{
			await repo.DeleteGameAsync(oldId);
			await repo.DeleteGameAsync(freshId);
		}
	}
}
