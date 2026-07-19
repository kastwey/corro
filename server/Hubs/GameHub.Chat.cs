using CorroServer.Models;
using CorroServer.Services;
using Microsoft.AspNetCore.SignalR;

namespace CorroServer.Hubs;

/// <summary>
/// In-game player chat. Messages are authenticated with the player's secret (same contract
/// as JoinGameWithAuth), persisted with the game document (capped history, so a reconnect
/// gets the conversation back) and broadcast to the game group. Plain text end to end: the
/// client renders it as text and shows a disclaimer that the server stores it unencrypted.
/// </summary>
public partial class GameHub
{
	private const int ChatMaxLength = 500;

	public record SendChatRequest
	{
		public required string GameId { get; init; }
		public required string PlayerId { get; init; }
		public required string PlayerSecretId { get; init; }
		public required string Text { get; init; }
	}

	public async Task SendChatMessage(SendChatRequest request)
	{
		try
		{
			var game = await _gameRepository.LoadGameAsync(request.GameId);
			if (game == null)
			{
				await Clients.Caller.SendAsync("Error", "GAME_NOT_FOUND");
				return;
			}

			var player = game.Players.FirstOrDefault(p => p.Id == request.PlayerId);
			if (player == null)
			{
				await Clients.Caller.SendAsync("Error", "PLAYER_NOT_FOUND");
				return;
			}
			if (player.PlayerSecretId != request.PlayerSecretId)
			{
				await Clients.Caller.SendAsync("Error", "INVALID_CREDENTIALS");
				_logger?.LogWarning("SECURITY: Chat auth failed for player {PlayerId} in game {GameId}",
					request.PlayerId, request.GameId);
				return;
			}

			// Plain text, trimmed and bounded; an empty message is silently ignored.
			var text = (request.Text ?? string.Empty).Trim();
			if (text.Length == 0)
			{
				return;
			}

			if (text.Length > ChatMaxLength)
			{
				text = text[..ChatMaxLength];
			}

			var message = new ChatMessage
			{
				Id = IdGenerator.PlayerId(),
				PlayerId = player.Id,
				PlayerName = player.Name,
				Text = text,
			};

			// Persist through the registry's document cache so chat and game-state writes
			// never clobber each other's fields (see AppendChatMessageAsync).
			var saved = await _registry.AppendChatMessageAsync(request.GameId, message);
			if (saved == null)
			{
				await Clients.Caller.SendAsync("Error", "GAME_NOT_FOUND");
				return;
			}

			await Clients.Group(request.GameId).SendAsync("ChatMessage", message);
		}
		catch (Exception ex)
		{
			_logger?.LogError(ex, "Error in SendChatMessage");
			await Clients.Caller.SendAsync("Error", "CHAT_SEND_ERROR");
		}
	}
}
