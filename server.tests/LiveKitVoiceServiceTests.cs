using System.Text;
using System.Text.Json;
using CorroServer.Controllers;
using CorroServer.Services.Voice;
using Livekit.Server.Sdk.Dotnet;
using Microsoft.Extensions.Options;

namespace CorroServer.Tests;

public class LiveKitVoiceServiceTests
{
	[Fact]
	public void Empty_configuration_disables_voice_without_becoming_invalid()
	{
		var options = new LiveKitOptions();

		Assert.True(options.IsEmpty);
		Assert.False(options.IsConfigured);
	}

	[Theory]
	[InlineData("wss://voice.example.org", true)]
	[InlineData("ws://localhost:7880", true)]
	[InlineData("ws://voice.example.org", false)]
	[InlineData("https://voice.example.org", false)]
	public void Browser_url_requires_wss_except_on_loopback(string url, bool expected)
		=> Assert.Equal(expected, LiveKitOptions.IsSupportedBrowserUrl(url));

	[Fact]
	public void Api_url_is_derived_from_the_browser_url()
	{
		var secure = CompleteOptions("wss://voice.example.org/livekit");
		var local = CompleteOptions("ws://localhost:7880");

		Assert.Equal("https://voice.example.org/livekit", secure.EffectiveApiUrl);
		Assert.Equal("http://localhost:7880", local.EffectiveApiUrl);
		Assert.True(secure.IsConfigured);
		Assert.True(local.IsConfigured);
	}

	[Fact]
	public void Join_token_is_short_lived_and_limited_to_microphone_audio()
	{
		var options = CompleteOptions("wss://voice.example.org");
		var service = new LiveKitVoiceService(Options.Create(options));
		var before = DateTimeOffset.UtcNow.ToUnixTimeSeconds();

		var credentials = service.CreateJoinCredentials("game-42", "player-7", "Ana");
		using var payload = DecodeJwtPayload(credentials.Token);
		var root = payload.RootElement;

		Assert.Equal("wss://voice.example.org", credentials.Url);
		Assert.Equal("voice-key", root.GetProperty("iss").GetString());
		Assert.Equal("player-7", root.GetProperty("sub").GetString());
		Assert.Equal("Ana", root.GetProperty("name").GetString());
		Assert.InRange(root.GetProperty("exp").GetInt64(), before + 4 * 60, before + 5 * 60 + 5);

		var grant = root.GetProperty("video");
		Assert.Equal("game-42", grant.GetProperty("room").GetString());
		Assert.True(grant.GetProperty("roomJoin").GetBoolean());
		Assert.True(grant.GetProperty("canPublish").GetBoolean());
		Assert.True(grant.GetProperty("canSubscribe").GetBoolean());
		Assert.False(grant.GetProperty("canPublishData").GetBoolean());
		Assert.Equal("microphone", Assert.Single(grant.GetProperty("canPublishSources").EnumerateArray()).GetString());
	}

	[Fact]
	public void Disabled_service_refuses_to_mint_a_token()
	{
		var service = new LiveKitVoiceService(Options.Create(new LiveKitOptions()));

		Assert.False(service.IsConfigured);
		Assert.Throws<InvalidOperationException>(() =>
			service.CreateJoinCredentials("game", "player", "Player"));
	}

	[Fact]
	public async Task Host_mute_targets_only_published_microphone_audio_tracks()
	{
		var rooms = new FakeRoomClient();
		rooms.Participant.Tracks.Add(new TrackInfo { Sid = "mic", Type = TrackType.Audio, Source = TrackSource.Microphone });
		rooms.Participant.Tracks.Add(new TrackInfo { Sid = "screen-audio", Type = TrackType.Audio, Source = TrackSource.ScreenShareAudio });
		rooms.Participant.Tracks.Add(new TrackInfo { Sid = "camera", Type = TrackType.Video, Source = TrackSource.Camera });
		var service = new LiveKitVoiceService(Options.Create(CompleteOptions("wss://voice.example.org")), rooms);

		Assert.True(await service.MuteParticipantAsync("game", "player"));
		Assert.Equal(new[] { ("game", "player", "mic") }, rooms.Mutes);
	}

	[Fact]
	public async Task Host_mute_reports_false_when_the_player_has_no_microphone_track()
	{
		var rooms = new FakeRoomClient();
		rooms.Participant.Tracks.Add(new TrackInfo { Sid = "screen-audio", Type = TrackType.Audio, Source = TrackSource.ScreenShareAudio });
		var service = new LiveKitVoiceService(Options.Create(CompleteOptions("wss://voice.example.org")), rooms);

		Assert.False(await service.MuteParticipantAsync("game", "player"));
		Assert.Empty(rooms.Mutes);
	}

	[Fact]
	public async Task Deleting_a_game_closes_its_livekit_room()
	{
		var rooms = new FakeRoomClient();
		var service = new LiveKitVoiceService(Options.Create(CompleteOptions("wss://voice.example.org")), rooms);

		await service.DeleteRoomAsync("game-42");

		Assert.Equal(new[] { "game-42" }, rooms.DeletedRooms);
	}

	[Fact]
	public void Public_config_reveals_only_availability_not_relay_credentials()
	{
		var options = CompleteOptions("wss://voice.example.org");
		var controller = new ConfigController(
			Options.Create(new CorroServer.Services.SiteBrandingOptions()),
			new LiveKitVoiceService(Options.Create(options), new FakeRoomClient()));

		var json = JsonSerializer.Serialize(controller.GetVoice().Value);

		Assert.Contains("available", json, StringComparison.OrdinalIgnoreCase);
		Assert.Contains("true", json, StringComparison.OrdinalIgnoreCase);
		Assert.DoesNotContain(options.Url!, json);
		Assert.DoesNotContain(options.ApiKey!, json);
		Assert.DoesNotContain(options.ApiSecret!, json);
	}

	private static LiveKitOptions CompleteOptions(string url) => new()
	{
		Url = url,
		ApiKey = "voice-key",
		ApiSecret = "a-test-secret-that-never-leaves-the-server",
		TokenLifetimeMinutes = 5,
	};

	private static JsonDocument DecodeJwtPayload(string jwt)
	{
		var encoded = jwt.Split('.')[1].Replace('-', '+').Replace('_', '/');
		encoded = encoded.PadRight(encoded.Length + (4 - encoded.Length % 4) % 4, '=');
		return JsonDocument.Parse(Encoding.UTF8.GetString(Convert.FromBase64String(encoded)));
	}

	private sealed class FakeRoomClient : ILiveKitRoomClient
	{
		public ParticipantInfo Participant { get; } = new();
		public List<(string Room, string Participant, string Track)> Mutes { get; } = new();
		public List<string> DeletedRooms { get; } = new();

		public Task<ParticipantInfo> GetParticipantAsync(string roomName, string participantId)
			=> Task.FromResult(Participant);

		public Task MuteTrackAsync(string roomName, string participantId, string trackSid)
		{
			Mutes.Add((roomName, participantId, trackSid));
			return Task.CompletedTask;
		}

		public Task DeleteRoomAsync(string roomName)
		{
			DeletedRooms.Add(roomName);
			return Task.CompletedTask;
		}
	}
}