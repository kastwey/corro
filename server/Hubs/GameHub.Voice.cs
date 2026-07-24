using CorroServer.Models;
using Microsoft.AspNetCore.SignalR;

namespace CorroServer.Hubs;

/// <summary>
/// Authoritative access to the optional LiveKit room. SignalR authenticates identity and
/// host authority; LiveKit carries media directly and never receives a player's Corro secret.
/// </summary>
public partial class GameHub
{
	public sealed record VoiceTokenResponse(string Url, string Token);

	public async Task<VoiceTokenResponse?> RequestVoiceToken()
	{
		if (!IsConnectionAuthenticated(out var playerId, out var gameId))
		{
			await SendVoiceError("NOT_AUTHENTICATED");
			return null;
		}
		if (_voiceService?.IsConfigured != true)
		{
			await SendVoiceError("VOICE_NOT_CONFIGURED");
			return null;
		}

		var game = await _gameRepository.LoadGameAsync(gameId!);
		if (game == null)
		{
			await SendVoiceError("GAME_NOT_FOUND");
			return null;
		}
		if (game.Status != GameStatus.Active || !game.VoiceChatEnabled)
		{
			await SendVoiceError("VOICE_NOT_ENABLED");
			return null;
		}

		var player = game.Players.FirstOrDefault(p => p.Id == playerId && !p.IsBot);
		if (player == null)
		{
			await SendVoiceError("PLAYER_NOT_FOUND");
			return null;
		}

		var credentials = _voiceService.CreateJoinCredentials(game.GameId, player.Id, player.Name);
		return new VoiceTokenResponse(credentials.Url, credentials.Token);
	}

	/// <summary>The host may open or close voice for this game at any time. Closing first
	/// updates every client, then deletes the LiveKit room as a best-effort transport cleanup.</summary>
	public async Task SetVoiceChatEnabled(bool enabled)
	{
		if (!IsConnectionAuthenticated(out var playerId, out var gameId))
		{
			await SendVoiceError("NOT_AUTHENTICATED");
			return;
		}
		var game = await _gameRepository.LoadGameAsync(gameId!);
		if (game == null)
		{
			await SendVoiceError("GAME_NOT_FOUND");
			return;
		}
		if (game.HostId != playerId)
		{
			await SendVoiceError("HOST_ONLY");
			return;
		}
		if (enabled && _voiceService?.IsConfigured != true)
		{
			await SendVoiceError("VOICE_NOT_CONFIGURED");
			return;
		}
		if (game.Status != GameStatus.Active)
		{
			await SendVoiceError("GAME_NOT_ACTIVE");
			return;
		}

		if (game.VoiceChatEnabled != enabled)
		{
			var saved = await _registry.SetVoiceChatEnabledAsync(game.GameId, enabled);
			if (saved == null)
			{
				await SendVoiceError("GAME_NOT_FOUND");
				return;
			}
			if (_registry.TryGetService(game.GameId, out var service) && service.GameState is { } state)
			{
				state.VoiceChatEnabled = enabled;
				await service.NotifyStateChangedAsync();
			}
		}

		await Clients.Group(game.GameId).SendAsync("VoiceChatEnabledChanged", new { Enabled = enabled });

		if (!enabled && _voiceService?.IsConfigured == true)
		{
			try { await _voiceService.DeleteRoomAsync(game.GameId); }
			catch (Exception ex)
			{
				// Honest clients already disconnected from the authoritative state push. A short
				// token TTL bounds replay if the relay was temporarily unreachable.
				_logger?.LogWarning(ex, "Could not delete disabled voice room for game {GameId}", game.GameId);
			}
		}
	}

	/// <summary>One-shot moderation: mute the target's current microphone track. The target
	/// remains allowed to unmute, by design; persistent disruption belongs to a future kick flow.</summary>
	public async Task MuteVoiceParticipant(string targetPlayerId)
	{
		if (!IsConnectionAuthenticated(out var playerId, out var gameId))
		{
			await SendVoiceError("NOT_AUTHENTICATED");
			return;
		}
		if (_voiceService?.IsConfigured != true)
		{
			await SendVoiceError("VOICE_NOT_CONFIGURED");
			return;
		}

		var game = await _gameRepository.LoadGameAsync(gameId!);
		if (game == null)
		{
			await SendVoiceError("GAME_NOT_FOUND");
			return;
		}
		if (game.HostId != playerId)
		{
			await SendVoiceError("HOST_ONLY");
			return;
		}
		if (!game.VoiceChatEnabled)
		{
			await SendVoiceError("VOICE_NOT_ENABLED");
			return;
		}
		if (targetPlayerId == playerId)
		{
			await SendVoiceError("VOICE_MUTE_SELF");
			return;
		}

		var host = game.Players.First(p => p.Id == playerId);
		var target = game.Players.FirstOrDefault(p => p.Id == targetPlayerId && !p.IsBot);
		if (target == null)
		{
			await SendVoiceError("PLAYER_NOT_FOUND");
			return;
		}

		try
		{
			if (!await _voiceService.MuteParticipantAsync(game.GameId, target.Id))
			{
				await SendVoiceError("VOICE_PLAYER_NOT_JOINED");
				return;
			}
			await Clients.Group(game.GameId).SendAsync("VoiceParticipantMutedByHost", new
			{
				TargetPlayerId = target.Id,
				TargetPlayerName = target.Name,
				HostPlayerId = host.Id,
				HostPlayerName = host.Name,
			});
		}
		catch (Exception ex)
		{
			_logger?.LogError(ex, "Could not mute voice participant {PlayerId} in game {GameId}", target.Id, game.GameId);
			await SendVoiceError("VOICE_MUTE_ERROR");
		}
	}

	private Task SendVoiceError(string code) => Clients.Caller.SendAsync("Error", code);
}