using Livekit.Server.Sdk.Dotnet;

namespace CorroServer.Services.Voice;

/// <summary>Small testable seam over the generated Twirp client.</summary>
internal interface ILiveKitRoomClient
{
	Task<ParticipantInfo> GetParticipantAsync(string roomName, string participantId);
	Task MuteTrackAsync(string roomName, string participantId, string trackSid);
	Task DeleteRoomAsync(string roomName);
}

internal sealed class LiveKitRoomClient : ILiveKitRoomClient
{
	private readonly RoomServiceClient _client;

	public LiveKitRoomClient(string apiUrl, string apiKey, string apiSecret)
	{
		_client = new RoomServiceClient(apiUrl, apiKey, apiSecret);
	}

	public Task<ParticipantInfo> GetParticipantAsync(string roomName, string participantId)
		=> _client.GetParticipant(new RoomParticipantIdentity
		{
			Room = roomName,
			Identity = participantId,
		});

	public async Task MuteTrackAsync(string roomName, string participantId, string trackSid)
	{
		await _client.MutePublishedTrack(new MuteRoomTrackRequest
		{
			Room = roomName,
			Identity = participantId,
			TrackSid = trackSid,
			Muted = true,
		});
	}

	public async Task DeleteRoomAsync(string roomName)
	{
		await _client.DeleteRoom(new DeleteRoomRequest { Room = roomName });
	}
}