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

	private static GameDocument NewGame(string gameId) => new()
	{
		Id = $"game-{gameId}",
		GameId = gameId,
		Status = GameStatus.WaitingForPlayers,
		HostId = "host-1",
		InviteCode = "INV123",
		MaxPlayers = 4,
				Board = "imperio-galactico",
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
				Assert.Equal("imperio-galactico", loaded.Board);
		Assert.Equal(GameStatus.WaitingForPlayers, loaded.Status);
		Assert.Single(loaded.Players);
		Assert.Equal("Alice", loaded.Players[0].Name);

		Assert.True(await repo.DeleteGameAsync(gameId));
		Assert.Null(await repo.LoadGameAsync(gameId)); // gone (NotFound -> null)
	}

	[CosmosFact]
	public async Task Load_returns_null_for_a_missing_game()
		=> Assert.Null(await (await NewRepositoryAsync()).LoadGameAsync("itest-does-not-exist-" + Guid.NewGuid().ToString("N")[..8]));
}
