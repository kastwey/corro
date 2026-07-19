using CorroServer.Controllers;
using CorroServer.Models;
using CorroServer.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;

namespace CorroServer.Tests;

public class GameControllerReadTests
{
	[Fact]
	public async Task GetGame_returns_not_found_for_an_unknown_id()
	{
		var result = await new GameController(new FakeRepository(null), NullLogger<GameController>.Instance)
			.GetGame("missing");

		Assert.Equal("GAME_NOT_FOUND", Assert.IsType<NotFoundObjectResult>(result.Result).Value);
	}

	[Fact]
	public async Task GetGame_never_exposes_player_credentials()
	{
		var game = new GameDocument
		{
			Id = "game-1",
			GameId = "1",
			Status = GameStatus.WaitingForPlayers,
			HostId = "host",
			InviteCode = "INV1",
			Players = new List<LobbyPlayer>
			{
				new()
				{
					Id = "host", Name = "Host", Token = "disc", IsHost = true,
					PlayerSecretId = "secret", RejoinCode = "REJOIN12",
				},
			},
		};

		var result = await new GameController(new FakeRepository(game), NullLogger<GameController>.Instance)
			.GetGame("1");

		var safe = Assert.IsType<GameDocument>(Assert.IsType<OkObjectResult>(result.Result).Value);
		var player = Assert.Single(safe.Players);
		Assert.Equal(string.Empty, player.PlayerSecretId);
		Assert.Null(player.RejoinCode);
	}

	private sealed class FakeRepository(GameDocument? game) : IGameRepository
	{
		public Task<GameDocument?> LoadGameAsync(string gameId) => Task.FromResult(game);
		public Task<GameDocument?> GetByInviteCodeAsync(string inviteCode) => Task.FromResult(game);
		public Task<GameDocument?> GetByRejoinCodeAsync(string rejoinCode) => Task.FromResult<GameDocument?>(null);
		public Task<bool> DeleteGameAsync(string gameId) => throw new NotImplementedException();
		public Task<GameDocument> CreateGameAsync(GameDocument value) => throw new NotImplementedException();
		public Task<GameDocument> UpdateGameAsync(GameDocument value) => throw new NotImplementedException();
	}
}
