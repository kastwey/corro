using CorroServer.Hubs;
using CorroServer.Models;
using CorroServer.Services;
using CorroServer.Services.Voice;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging.Abstractions;

namespace CorroServer.Tests;
using CorroServer.Tests.Doubles;

public class GameHubVoiceTests
{
	// Voice is a property of the deployment, and creating a game asks nothing about it. A host who
	// was never offered the choice must not be left unable to make it: every game the relay can
	// serve opens with the room available, and the host closes or reopens it from inside the game.
	[Fact]
	public async Task CreateLobby_OffersVoiceWheneverTheDeploymentSupportsIt()
	{
		var h = BuildLobbyHarness(voiceConfigured: true);

		await h.Hub.CreateGameLobby(new CreateGameRequest
		{
			HostName = "Host",
			HostToken = "disc",
			Board = "Test game",
		});

		var response = Assert.IsType<CreateGameResponse>(
			Assert.Single(h.Clients.Caller.Sends, send => send.Method == "GameCreated").Args[0]);
		Assert.True(response.Game.VoiceChatEnabled);
		Assert.True((await h.Repository.LoadGameAsync(response.GameId))!.VoiceChatEnabled);
	}

	[Fact]
	public async Task CreateLobby_LeavesVoiceOffWhenTheDeploymentHasNoRelay()
	{
		// Nothing to offer and nothing to render: the game is created exactly as it always was.
		var h = BuildLobbyHarness(voiceConfigured: false);

		await h.Hub.CreateGameLobby(new CreateGameRequest
		{
			HostName = "Host",
			HostToken = "disc",
			Board = "Test game",
		});

		var response = Assert.IsType<CreateGameResponse>(
			Assert.Single(h.Clients.Caller.Sends, send => send.Method == "GameCreated").Args[0]);
		Assert.False(response.Game.VoiceChatEnabled);
		Assert.False((await h.Repository.LoadGameAsync(response.GameId))!.VoiceChatEnabled);
	}

	[Fact]
	public async Task RequestVoiceToken_UsesTheAuthenticatedConnectionIdentity()
	{
		var h = await BuildHarness(enabled: true, callerPlayerId: "player");

		var result = await h.Hub.RequestVoiceToken();

		Assert.NotNull(result);
		Assert.Equal("wss://voice.test", result!.Url);
		Assert.Equal("token-player", result.Token);
		Assert.Equal((h.GameId, "player", "Player"), h.Voice.LastTokenRequest);
	}

	[Fact]
	public async Task RequestVoiceToken_RefusesAnUnauthenticatedConnection()
	{
		var h = await BuildHarness(enabled: true, callerPlayerId: "player", authenticate: false);

		Assert.Null(await h.Hub.RequestVoiceToken());
		Assert.Equal("NOT_AUTHENTICATED", h.Clients.Caller.LastError());
		Assert.Null(h.Voice.LastTokenRequest);
	}

	[Fact]
	public async Task RequestVoiceToken_RefusesVoiceThatTheHostHasNotEnabled()
	{
		var h = await BuildHarness(enabled: false, callerPlayerId: "player");

		Assert.Null(await h.Hub.RequestVoiceToken());
		Assert.Equal("VOICE_NOT_ENABLED", h.Clients.Caller.LastError());
	}

	[Fact]
	public async Task HostCanEnableAndDisableVoice_AndDisablingDeletesTheRoom()
	{
		var h = await BuildHarness(enabled: false, callerPlayerId: "host");

		await h.Hub.SetVoiceChatEnabled(true);
		Assert.True((await h.Repository.LoadGameAsync(h.GameId))!.VoiceChatEnabled);
		Assert.True(h.Clients.Group(h.GameId).Received("VoiceChatEnabledChanged"));
		Assert.Empty(h.Voice.DeletedRooms);

		await h.Hub.SetVoiceChatEnabled(false);
		Assert.False((await h.Repository.LoadGameAsync(h.GameId))!.VoiceChatEnabled);
		Assert.Equal(new[] { h.GameId }, h.Voice.DeletedRooms);
	}

	[Fact]
	public async Task NonHostCannotChangeVoiceAvailability()
	{
		var h = await BuildHarness(enabled: false, callerPlayerId: "player");

		await h.Hub.SetVoiceChatEnabled(true);

		Assert.False((await h.Repository.LoadGameAsync(h.GameId))!.VoiceChatEnabled);
		Assert.Equal("HOST_ONLY", h.Clients.Caller.LastError());
	}

	[Fact]
	public async Task HostMute_IsOneShotAtLiveKit_AndBroadcastsWhoWasMuted()
	{
		var h = await BuildHarness(enabled: true, callerPlayerId: "host");

		await h.Hub.MuteVoiceParticipant("player");

		Assert.Equal((h.GameId, "player"), h.Voice.LastMuteRequest);
		var send = Assert.Single(h.Clients.Group(h.GameId).Sends, s => s.Method == "VoiceParticipantMutedByHost");
		Assert.Equal("player", Property<string>(send.Args[0], "TargetPlayerId"));
		Assert.Equal("Player", Property<string>(send.Args[0], "TargetPlayerName"));
		Assert.Equal("host", Property<string>(send.Args[0], "HostPlayerId"));
	}

	[Fact]
	public async Task HostMute_RefusesAPlayerWithoutAPublishedMicrophone()
	{
		var h = await BuildHarness(enabled: true, callerPlayerId: "host");
		h.Voice.MuteResult = false;

		await h.Hub.MuteVoiceParticipant("player");

		Assert.Equal("VOICE_PLAYER_NOT_JOINED", h.Clients.Caller.LastError());
		Assert.False(h.Clients.Group(h.GameId).Received("VoiceParticipantMutedByHost"));
	}

	[Fact]
	public async Task HostCannotUseModerationAsTheirOwnMuteControl()
	{
		var h = await BuildHarness(enabled: true, callerPlayerId: "host");

		await h.Hub.MuteVoiceParticipant("host");

		Assert.Equal("VOICE_MUTE_SELF", h.Clients.Caller.LastError());
		Assert.Null(h.Voice.LastMuteRequest);
	}

	private static T Property<T>(object? value, string name)
		=> (T)value!.GetType().GetProperty(name)!.GetValue(value)!;

	private static async Task<Harness> BuildHarness(
		bool enabled,
		string callerPlayerId,
		bool authenticate = true)
	{
		var gameId = "game-" + Guid.NewGuid().ToString("N");
		var connectionId = "connection-" + Guid.NewGuid().ToString("N");
		var repository = new InMemoryGameRepository();
		await repository.CreateGameAsync(new GameDocument
		{
			Id = "game-doc-" + gameId,
			GameId = gameId,
			Status = GameStatus.Active,
			HostId = "host",
			InviteCode = "VOICE1",
			VoiceChatEnabled = enabled,
			Players = new List<LobbyPlayer>
			{
				new() { Id = "host", Name = "Host", Token = "disc", IsHost = true, PlayerSecretId = "host-secret" },
				new() { Id = "player", Name = "Player", Token = "cross", PlayerSecretId = "player-secret" },
			},
		});

		var timer = new NoopAuctionTimer();
		var voice = new FakeVoiceService();
		var registry = new GameSessionRegistry(
			new NoopHubContext(), repository, timer, TestFixtures.NewPackageRestorer(),
			voiceService: voice);
		if (authenticate)
		{
			registry.MapConnectionToGame(connectionId, gameId);
			registry.AuthenticateConnection(connectionId, callerPlayerId);
		}

		var clients = new CapturingCallerClients();
		var hub = new GameHub(
			repository,
			gameServiceFactory: null!,
			timer,
			packageStore: null!,
			packageRestorer: null!,
			registry,
			NullLogger<GameHub>.Instance,
			voiceService: voice)
		{
			Clients = clients,
			Context = new FakeCallerContext(connectionId),
		};
		return new Harness(hub, clients, repository, voice, gameId);
	}

	private static Harness BuildLobbyHarness(bool voiceConfigured)
	{
		var repository = new InMemoryGameRepository();
		var timer = new NoopAuctionTimer();
		var voice = new FakeVoiceService { Configured = voiceConfigured };
		var registry = new GameSessionRegistry(
			new NoopHubContext(), repository, timer, TestFixtures.NewPackageRestorer(),
			voiceService: voice);
		var clients = new CapturingCallerClients();
		var hub = new GameHub(
			repository,
			gameServiceFactory: null!,
			timer,
			new CorroServer.Services.Corro.CorroPackageStore(
				new CorroServer.Services.Sounds.CompositeSoundPackProvider(
					new CorroServer.Services.Sounds.DefaultSoundPackProvider())),
			packageRestorer: null!,
			registry,
			NullLogger<GameHub>.Instance,
			voiceService: voice)
		{
			Clients = clients,
			Context = new FakeCallerContext("lobby-connection"),
			Groups = new NoopGroupManager(),
		};
		return new Harness(hub, clients, repository, voice, string.Empty);
	}

	private sealed record Harness(
		GameHub Hub,
		CapturingCallerClients Clients,
		InMemoryGameRepository Repository,
		FakeVoiceService Voice,
		string GameId);

	private sealed class FakeVoiceService : ILiveKitVoiceService
	{
		public bool Configured { get; init; } = true;
		public bool IsConfigured => Configured;
		public (string Room, string PlayerId, string Name)? LastTokenRequest { get; private set; }
		public (string Room, string PlayerId)? LastMuteRequest { get; private set; }
		public bool MuteResult { get; set; } = true;
		public List<string> DeletedRooms { get; } = new();

		public VoiceJoinCredentials CreateJoinCredentials(string roomName, string participantId, string participantName)
		{
			LastTokenRequest = (roomName, participantId, participantName);
			return new VoiceJoinCredentials("wss://voice.test", $"token-{participantId}");
		}

		public Task<bool> MuteParticipantAsync(string roomName, string participantId)
		{
			LastMuteRequest = (roomName, participantId);
			return Task.FromResult(MuteResult);
		}

		public Task DeleteRoomAsync(string roomName)
		{
			DeletedRooms.Add(roomName);
			return Task.CompletedTask;
		}
	}
}
