using CorroServer.Models;

namespace CorroServer.Services;

/// <summary>
/// Reclaiming a seat you already hold, from a browser that cannot prove it — the data is gone, or
/// you moved to another device. There are two ways to prove the seat is yours, and they differ
/// ONLY in that proof:
///
///  * a RE-ENTRY code, the account-less path: the code IS the credential;
///  * a signed-in ACCOUNT, which the seat recorded when it was taken.
///
/// Everything after the proof is deliberately one piece of code, because it is where the security
/// lives: the game must still be playable, NOBODY may be connected on that seat, and a successful
/// claim ROTATES the seat's secret id, so any older browser session is invalidated and the claimer
/// becomes its only owner. The re-entry code itself stays stable — rotating it would strand the
/// player again if the new one were lost.
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

	/// <summary>Claim with the player's own re-entry code.</summary>
	public static async Task<ClaimResult> ClaimAsync(
		string code,
		IGameRepository repository,
		Func<string, IEnumerable<string>> connectedPlayerIds)
	{
		var game = await repository.GetByRejoinCodeAsync(code);
		var player = game?.Players.FirstOrDefault(p => p.RejoinCode == code);
		return await ClaimSeatAsync(game, player, repository, connectedPlayerIds);
	}

	/// <summary>
	/// Claim the seat this ACCOUNT holds at a table. No code to type and none to have kept: the
	/// seat recorded whose it was when it was taken, so a new device with the same session is
	/// simply the same person coming back.
	///
	/// `userId` comes from the caller's session and never from a request — the hub reads it from
	/// its own principal. If that ever changed, this would become "claim anyone's seat".
	/// </summary>
	public static async Task<ClaimResult> ClaimForUserAsync(
		string gameId,
		string userId,
		IGameRepository repository,
		Func<string, IEnumerable<string>> connectedPlayerIds)
	{
		var game = await repository.LoadGameAsync(gameId);
		var player = game?.Players.FirstOrDefault(p => p.UserId == userId);
		return await ClaimSeatAsync(game, player, repository, connectedPlayerIds);
	}

	/// <summary>The half that is the same however the seat was proved: the guards, the rotation
	/// and the fresh session.</summary>
	private static async Task<ClaimResult> ClaimSeatAsync(
		GameDocument? game,
		LobbyPlayer? player,
		IGameRepository repository,
		Func<string, IEnumerable<string>> connectedPlayerIds)
	{
		if (game == null || player == null)
		{
			return new ClaimResult { Error = "GAME_NOT_FOUND" };
		}

		if (game.Status is GameStatus.Completed or GameStatus.Abandoned)
		{
			return new ClaimResult { Error = "GAME_OVER" };
		}

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
				RejoinCode = player.RejoinCode,
			},
		};
	}
}
