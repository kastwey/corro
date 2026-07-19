using CorroServer.Models;
using CorroServer.Services;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// Unit tests for <see cref="InMemoryGameRepository"/>, the zero-Azure fallback used when no CosmosDB
/// connection string is configured (clone-and-run / offline dev). They pin the behaviour the lobby relies
/// on so create/join/persistence flows work without the emulator, matching <see cref="CosmosGameRepository"/>.
/// </summary>
public class InMemoryGameRepositoryTests
{
	private static GameDocument Doc(string gameId, string invite = "INV",
		GameStatus status = GameStatus.WaitingForPlayers) => new()
		{
			Id = $"game-{gameId}",
			GameId = gameId,
			Status = status,
			HostId = "host",
			InviteCode = invite,
			MaxPlayers = 4,
			Players = new List<LobbyPlayer> { new() { Id = "host", Name = "Ana", Token = "disc", PlayerSecretId = "secret", IsHost = true } }
		};

	[Fact]
	public async Task Create_then_Load_round_trips_the_game_by_id_with_or_without_prefix()
	{
		var repo = new InMemoryGameRepository();
		await repo.CreateGameAsync(Doc("g1"));

		Assert.Equal("g1", (await repo.LoadGameAsync("g1"))!.GameId);      // bare id
		Assert.Equal("g1", (await repo.LoadGameAsync("game-g1"))!.GameId); // document-prefixed id
		Assert.Null(await repo.LoadGameAsync("missing"));
	}

	[Fact]
	public async Task GetByInviteCode_finds_the_matching_game_only()
	{
		var repo = new InMemoryGameRepository();
		await repo.CreateGameAsync(Doc("g1", invite: "AAAAAA"));
		await repo.CreateGameAsync(Doc("g2", invite: "BBBBBB"));

		Assert.Equal("g2", (await repo.GetByInviteCodeAsync("BBBBBB"))!.GameId);
		Assert.Null(await repo.GetByInviteCodeAsync("ZZZZZZ"));
	}

	[Fact]
	public async Task Delete_removes_the_game_and_reports_whether_it_existed()
	{
		var repo = new InMemoryGameRepository();
		await repo.CreateGameAsync(Doc("g1"));

		Assert.True(await repo.DeleteGameAsync("g1"));
		Assert.Null(await repo.LoadGameAsync("g1"));
		Assert.False(await repo.DeleteGameAsync("g1")); // already gone
	}
}
