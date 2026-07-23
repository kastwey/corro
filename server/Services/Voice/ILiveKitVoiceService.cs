namespace CorroServer.Services.Voice;

public sealed record VoiceJoinCredentials(string Url, string Token);

/// <summary>Server-only boundary around token minting and LiveKit Room Service moderation.</summary>
public interface ILiveKitVoiceService
{
	bool IsConfigured { get; }
	VoiceJoinCredentials CreateJoinCredentials(string roomName, string participantId, string participantName);
	Task<bool> MuteParticipantAsync(string roomName, string participantId);
	Task DeleteRoomAsync(string roomName);
}