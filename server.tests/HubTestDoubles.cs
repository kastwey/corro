using CorroServer.Hubs;
using CorroServer.Models;
using CorroServer.Services;
using CorroServer.Services.Corro;
using Microsoft.AspNetCore.SignalR;

namespace CorroServer.Tests.Doubles;

// The stand-ins every hub test needs: a recording Clients, a caller context that can carry a
// session, and the few services the hub constructor asks for.
//
// They were copied privately into two test files before this, and a third copy was the moment to
// stop. Nothing here decides anything — a double that made a judgement would be a second
// implementation of the thing under test.

internal sealed class RecordingProxy : ISingleClientProxy
{
	private readonly List<string> _methods = new();
	private readonly List<string> _errors = new();
	public bool Received(string method) => _methods.Contains(method);

	/// <summary>The last error CODE pushed to this target, or null if none — the hub sends
	/// rejections as <c>Error</c> with the code as its single argument.</summary>
	public string? LastError() => _errors.Count > 0 ? _errors[^1] : null;

	public Task SendCoreAsync(string method, object?[] args, CancellationToken cancellationToken = default)
	{
		_methods.Add(method);
		if (method == "Error" && args is [string code, ..])
		{
			_errors.Add(code);
		}
		return Task.CompletedTask;
	}
	public Task<T> InvokeCoreAsync<T>(string method, object?[] args, CancellationToken cancellationToken = default)
		=> throw new NotImplementedException();
}

internal sealed class FakeClients : IHubCallerClients
{
	private readonly RecordingProxy _caller = new();
	private readonly Dictionary<string, RecordingProxy> _groups = new();
	private readonly RecordingProxy _shared = new();

	/// <summary>Recording proxy for the caller (test-facing accessor).</summary>
	public RecordingProxy Caller => _caller;

	/// <summary>Recording proxy for a group, stable per group name (test-facing accessor).</summary>
	public RecordingProxy Group(string groupName)
	{
		if (!_groups.TryGetValue(groupName, out var proxy))
		{
			proxy = new RecordingProxy();
			_groups[groupName] = proxy;
		}
		return proxy;
	}

	ISingleClientProxy IHubCallerClients.Caller => _caller;
	ISingleClientProxy IHubCallerClients.Client(string connectionId) => _shared;
	IClientProxy IHubCallerClients<IClientProxy>.Caller => _caller;
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

internal sealed class FakeCallerContext : HubCallerContext
{
	public FakeCallerContext(string connectionId, System.Security.Claims.ClaimsPrincipal? user = null)
	{
		ConnectionId = connectionId;
		User = user;
	}
	public override string ConnectionId { get; }
	public override string? UserIdentifier => null;
	/// <summary>The session the handshake established, or null for an anonymous connection.</summary>
	public override System.Security.Claims.ClaimsPrincipal? User { get; }
	public override IDictionary<object, object?> Items { get; } = new Dictionary<object, object?>();
	public override Microsoft.AspNetCore.Http.Features.IFeatureCollection Features { get; }
		= new Microsoft.AspNetCore.Http.Features.FeatureCollection();
	public override CancellationToken ConnectionAborted => CancellationToken.None;
	public override void Abort() { }
}

internal sealed class FakeGameService : IGameService
{
	private readonly ServerResponse _response;
	public FakeGameService(ServerResponse response) => _response = response;

	public bool NotifyStateChangedCalled { get; private set; }
	public GameState? GameStateOverride { get; init; }
	public GameCommand? LastCommand { get; private set; }

	public Task<ServerResponse> ExecuteCommandAsync(GameCommand command)
	{
		LastCommand = command;
		return Task.FromResult(_response);
	}
	public Task NotifyStateChangedAsync() { NotifyStateChangedCalled = true; return Task.CompletedTask; }
	public Task SetPlayerConnectedAsync(string playerId, bool connected) => Task.CompletedTask;

	public GameState? GameState => GameStateOverride;
	public GameSettings Settings => new();
	public string GameId => "g";
	public bool IsGameActive => true;
	public Task<GameState> GetGameStateAsync() => Task.FromResult(new GameState());
	public Task InitializeFromDefinitionAsync(List<Player> players, CorroServer.Models.Corro.GameDefinition definition, string lang = "en", GameSettings? settings = null, bool raceTeams = false, Dictionary<string, System.Text.Json.JsonElement>? ruleValues = null, List<List<string>>? teams = null) => Task.CompletedTask;
	public void ConfigureSettings(GameSettings settings) { }
	public Task EndGameAsync() => Task.CompletedTask;
	public Task RestoreGameAsync(GameState savedState) => Task.CompletedTask;
	public void AttachPackageDefinition(CorroServer.Models.Corro.GameDefinition definition) { }
	public event Func<GameState, Task>? OnGameStateChanged { add { } remove { } }

	// Real, raisable event so the Hub's announcement-batch send path can be driven.
	private Func<IReadOnlyList<AnnouncementDispatch>, Task>? _onGameEvents;
	public event Func<IReadOnlyList<AnnouncementDispatch>, Task>? OnGameEvents
	{
		add => _onGameEvents += value;
		remove => _onGameEvents -= value;
	}
	public Task RaiseGameEventsAsync(IReadOnlyList<AnnouncementDispatch> batch)
		=> _onGameEvents?.Invoke(batch) ?? Task.CompletedTask;

	public event Func<Square, Task>? OnSquareChanged { add { } remove { } }
	public event Func<CardDrawnNotification, Task>? OnCardDrawn { add { } remove { } }

	// Real, raisable too: the registry subscribes to this one, so a test can prove the trip from
	// a rulebook's table-wide response to the group without going through a whole property game.
	private Func<ServerResponse, Task>? _onBroadcast;
	public event Func<ServerResponse, Task>? OnBroadcast
	{
		add => _onBroadcast += value;
		remove => _onBroadcast -= value;
	}
	public Task RaiseBroadcastAsync(ServerResponse response)
		=> _onBroadcast?.Invoke(response) ?? Task.CompletedTask;
}

internal sealed class FakeGameServiceFactory : IGameServiceFactory
{
	public IGameService Create(string? gameId = null) => new FakeGameService(
		new BidPlacedResponse { SquareIndex = 0, SquareName = "", BidderId = "", BidderName = "", Amount = 0 });
}

internal sealed class FakeAuctionTimer : IAuctionTimerService
{
	public void StartTimers(string gameId, GameSettings settings, AuctionState auction) { }
	public void StopTimers(string gameId) { }
	public event Func<string, AuctionTimerTickEventArgs, Task>? OnTimerTick { add { } remove { } }
	public event Func<string, Task>? OnBidTimeout { add { } remove { } }
}

internal sealed class FakeHubContext : IHubContext<GameHub>
{
	private readonly FakeHubClients _clients = new();
	public IHubClients Clients => _clients;
	public IGroupManager Groups { get; } = new FakeGroupManager();
	/// <summary>Recording proxy that backs every client target (test-facing accessor).</summary>
	public RecordingProxy GroupProxy => _clients.Proxy;
}

internal sealed class FakeHubClients : IHubClients
{
	private readonly RecordingProxy _proxy = new();
	public RecordingProxy Proxy => _proxy;
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

internal sealed class FakeGroupManager : IGroupManager
{
	public Task AddToGroupAsync(string connectionId, string groupName, CancellationToken cancellationToken = default) => Task.CompletedTask;
	public Task RemoveFromGroupAsync(string connectionId, string groupName, CancellationToken cancellationToken = default) => Task.CompletedTask;
}
