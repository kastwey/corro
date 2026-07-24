using Livekit.Server.Sdk.Dotnet;
using Microsoft.Extensions.Options;

namespace CorroServer.Services.Voice;

/// <summary>
/// Mints least-privilege join tokens and performs the host's one-shot mute through
/// LiveKit Room Service. The API secret remains inside this singleton.
/// </summary>
public sealed class LiveKitVoiceService : ILiveKitVoiceService
{
	private readonly LiveKitOptions _options;
	private readonly ILiveKitRoomClient? _rooms;

	public LiveKitVoiceService(IOptions<LiveKitOptions> options) : this(options, null) { }

	internal LiveKitVoiceService(IOptions<LiveKitOptions> options, ILiveKitRoomClient? rooms)
	{
		_options = options.Value;
		if (_options.IsConfigured)
		{
			_rooms = rooms ?? new LiveKitRoomClient(
				_options.EffectiveApiUrl!,
				_options.ApiKey!,
				_options.ApiSecret!);
		}
	}

	public bool IsConfigured => _options.IsConfigured;

	public VoiceJoinCredentials CreateJoinCredentials(
		string roomName,
		string participantId,
		string participantName)
	{
		EnsureConfigured();
		var token = new AccessToken(_options.ApiKey!, _options.ApiSecret!)
			.WithIdentity(participantId)
			.WithName(participantName)
			.WithGrants(new VideoGrants
			{
				Room = roomName,
				RoomJoin = true,
				CanPublish = true,
				CanSubscribe = true,
				CanPublishData = false,
				CanPublishSources = new List<string> { "microphone" },
			})
			.WithTtl(TimeSpan.FromMinutes(_options.TokenLifetimeMinutes))
			.ToJwt();

		return new VoiceJoinCredentials(_options.Url!, token);
	}

	public async Task<bool> MuteParticipantAsync(string roomName, string participantId)
	{
		EnsureConfigured();
		var participant = await _rooms!.GetParticipantAsync(roomName, participantId);
		var microphoneTracks = participant.Tracks
			.Where(track => track.Type == TrackType.Audio && track.Source == TrackSource.Microphone)
			.ToList();
		foreach (var track in microphoneTracks)
		{
			await _rooms.MuteTrackAsync(roomName, participantId, track.Sid);
		}
		return microphoneTracks.Count > 0;
	}

	public async Task DeleteRoomAsync(string roomName)
	{
		EnsureConfigured();
		await _rooms!.DeleteRoomAsync(roomName);
	}

	private void EnsureConfigured()
	{
		if (!IsConfigured)
		{
			throw new InvalidOperationException("LiveKit voice chat is not configured.");
		}
	}
}