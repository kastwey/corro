using CorroServer.Models;

namespace CorroServer.Services;

/// <summary>
/// Reclaiming a seat with a player's RE-ENTRY code (the account-less recovery path: the
/// browser data is gone, or the player moved to another device). The code is the
/// credential; the guards are: the game must still be playable, and NOBODY may be
/// connected on that seat. A successful claim ROTATES the seat's secret id — any older
/// browser session is invalidated and the claimer becomes the only owner — while the
/// code itself stays stable (rotating it would strand the player again if the new one
/// were lost).
/// </summary>
public static class RejoinService
{
	public sealed record ClaimResult
	{
		/// <summary>The fresh session on success; null when <see cref="Error"/> is set.</summary>
		public SeatClaimedResponse? Session { get; init; }
		/// <summary>GAME_NOT_FOUND (unknown code), GAME_OVER, or SEAT_CONNECTED.</summary>
		public string? Error { get; init; }
		/// <summary>The persisted document after the secret rotation (for cache refresh).</summary>
		public GameDocument? UpdatedGame { get; init; }
	}

	public static async Task<ClaimResult> ClaimAsync(
		string code,
		IGameRepository repository,
		Func<string, IEnumerable<string>> connectedPlayerIds)
	{
		var game = await repository.GetByRejoinCodeAsync(code);
		if (game == null)
		{
			return new ClaimResult { Error = "GAME_NOT_FOUND" };
		}

		if (game.Status is GameStatus.Completed or GameStatus.Abandoned)
		{
			return new ClaimResult { Error = "GAME_OVER" };
		}

		var player = game.Players.First(p => p.RejoinCode == code);
		if (connectedPlayerIds(game.GameId).Contains(player.Id))
		{
			return new ClaimResult { Error = "SEAT_CONNECTED" };
		}

		var newSecret = IdGenerator.SecureId();
		var updated = game with
		{
			Players = game.Players
				.Select(p => p.Id == player.Id ? p with { PlayerSecretId = newSecret } : p)
				.ToList(),
		};
		var saved = await repository.UpdateGameAsync(updated);

		return new ClaimResult
		{
			UpdatedGame = saved,
			Session = new SeatClaimedResponse
			{
				GameId = game.GameId,
				PlayerId = player.Id,
				PlayerSecretId = newSecret,
				PlayerName = player.Name,
				Token = player.Token,
				IsHost = player.IsHost,
				Board = game.Board,
				Status = game.Status,
				RejoinCode = code,
			},
		};
	}
}
