using CorroServer.Hubs;
using CorroServer.Models;
using CorroServer.Services;
using CorroServer.Services.Voice;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging.Abstractions;

namespace CorroServer.Tests;

public class GameHubVoiceTests
{
	[Fact]
	public async Task CreateLobby_PersistsVoiceWhenTheDeploymentSupportsIt()
	{
		var h = BuildLobbyHarness(voiceConfigured: true);

		await h.Hub.CreateGameLobby(new CreateGameRequest
		{
			HostName = "Host",
			HostToken = "disc",
			Board = "Test game",
			VoiceChatEnabled = true,
		});

		var response = Assert.IsType<CreateGameResponse>(
			Assert.Single(h.Clients.Caller.Sends, send => send.Method == "GameCreated").Args[0]);
		Assert.True(response.Game.VoiceChatEnabled);
		Assert.True((await h.Repository.LoadGameAsync(response.GameId))!.VoiceChatEnabled);
	}

	[Fact]
	public async Task CreateLobby_RejectsVoiceWhenTheDeploymentDoesNotSupportIt()
	{
		var h = BuildLobbyHarness(voiceConfigured: false);

		await h.Hub.CreateGameLobby(new CreateGameRequest
		{
			HostName = "Host",
			HostToken = "disc",
			Board = "Test game",
			VoiceChatEnabled = true,
		});

		Assert.Equal("VOICE_NOT_CONFIGURED", h.Clients.Caller.LastError());
		Assert.False(h.Clients.Caller.Received("GameCreated"));
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

	private sealed record CapturedSend(string Method, object?[] Args);

	private sealed class RecordingProxy : ISingleClientProxy
	{
		public List<CapturedSend> Sends { get; } = new();
		public bool Received(string method) => Sends.Any(s => s.Method == method);
		public string? LastError() => Sends.LastOrDefault(s => s.Method == "Error")?.Args.FirstOrDefault() as string;
		public Task SendCoreAsync(string method, object?[] args, CancellationToken cancellationToken = default)
		{
			Sends.Add(new CapturedSend(method, args));
			return Task.CompletedTask;
		}
		public Task<T> InvokeCoreAsync<T>(string method, object?[] args, CancellationToken cancellationToken = default)
			=> throw new NotImplementedException();
	}

	private sealed class CapturingCallerClients : IHubCallerClients
	{
		private readonly Dictionary<string, RecordingProxy> _groups = new();
		private readonly RecordingProxy _shared = new();
		public RecordingProxy Caller { get; } = new();
		public RecordingProxy Group(string name)
		{
			if (!_groups.TryGetValue(name, out var proxy))
			{
				proxy = new RecordingProxy();
				_groups[name] = proxy;
			}
			return proxy;
		}
		ISingleClientProxy IHubCallerClients.Caller => Caller;
		ISingleClientProxy IHubCallerClients.Client(string connectionId) => _shared;
		IClientProxy IHubCallerClients<IClientProxy>.Caller => Caller;
		IClientProxy IHubCallerClients<IClientProxy>.Others => _shared;
		IClientProxy IHubCallerClients<IClientProxy>.OthersInGroup(string groupName) => _shared;
		IClientProxy IHubClients<IClientProxy>.All => _shared;
		IClientProxy IHubClients<IClientProxy>.AllExcept(IReadOnlyList<string> excludedConnectionIds) => _shared;
		IClientProxy IHubClients<IClientProxy>.Client(string connectionId) => _shared;
		IClientProxy IHubClients<IClientProxy>.Clients(IReadOnlyList<string> connectionIds) => _shared;
		IClientProxy IHubClients<IClientProxy>.Group(string groupName) => Group(groupName);
		IClientProxy IHubClients<IClientProxy>.GroupExcept(string groupName, IReadOnlyList<string> excludedConnectionIds) => _shared;
		IClientProxy IHubClients<IClientProxy>.Groups(IReadOnlyList<string> groupNames) => _shared;
		IClientProxy IHubClients<IClientProxy>.User(string userId) => _shared;
		IClientProxy IHubClients<IClientProxy>.Users(IReadOnlyList<string> userIds) => _shared;
	}

	private sealed class FakeCallerContext : HubCallerContext
	{
		public FakeCallerContext(string connectionId) => ConnectionId = connectionId;
		public override string ConnectionId { get; }
		public override string? UserIdentifier => null;
		public override System.Security.Claims.ClaimsPrincipal? User => null;
		public override IDictionary<object, object?> Items { get; } = new Dictionary<object, object?>();
		public override Microsoft.AspNetCore.Http.Features.IFeatureCollection Features { get; }
			= new Microsoft.AspNetCore.Http.Features.FeatureCollection();
		public override CancellationToken ConnectionAborted => CancellationToken.None;
		public override void Abort() { }
	}

	private sealed class NoopAuctionTimer : IAuctionTimerService
	{
		public event Func<string, AuctionTimerTickEventArgs, Task>? OnTimerTick { add { } remove { } }
		public event Func<string, Task>? OnBidTimeout { add { } remove { } }
		public void StartTimers(string gameId, GameSettings settings, AuctionState auction) { }
		public void StopTimers(string gameId) { }
	}

	private sealed class NoopHubContext : IHubContext<GameHub>
	{
		public IHubClients Clients { get; } = new NoopHubClients();
		public IGroupManager Groups { get; } = new NoopGroupManager();
	}

	private sealed class NoopHubClients : IHubClients
	{
		private readonly RecordingProxy _proxy = new();
		ISingleClientProxy IHubClients.Client(string connectionId) => _proxy;
		IClientProxy IHubClients<IClientProxy>.All => _proxy;
		IClientProxy IHubClients<IClientProxy>.AllExcept(IReadOnlyList<string> excludedConnectionIds) => _proxy;
		IClientProxy IHubClients<IClientProxy>.Client(string connectionId) => _proxy;
		IClientProxy IHubClients<IClientProxy>.Clients(IReadOnlyList<string> connectionIds) => _proxy;
		IClientProxy IHubClients<IClientProxy>.Group(string groupName) => _proxy;
		IClientProxy IHubClients<IClientProxy>.GroupExcept(string groupName, IReadOnlyList<string> excludedConnectionIds) => _proxy;
		IClientProxy IHubClients<IClientProxy>.Groups(IReadOnlyList<string> groupNames) => _proxy;
		IClientProxy IHubClients<IClientProxy>.User(string userId) => _proxy;
		IClientProxy IHubClients<IClientProxy>.Users(IReadOnlyList<string> userIds) => _proxy;
	}

	private sealed class NoopGroupManager : IGroupManager
	{
		public Task AddToGroupAsync(string connectionId, string groupName, CancellationToken cancellationToken = default)
			=> Task.CompletedTask;
		public Task RemoveFromGroupAsync(string connectionId, string groupName, CancellationToken cancellationToken = default)
			=> Task.CompletedTask;
	}
}