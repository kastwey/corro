using CorroServer.Hubs;
using CorroServer.Models;
using CorroServer.Services;
using Microsoft.AspNetCore.SignalR;

namespace CorroServer.Tests;
using CorroServer.Tests.Doubles;

// The SignalR doubles a LOBBY hub test needs (create, join, start): a caller whose sends are
// recorded per group, and no-op timers, hub context and group manager. Shared by every test that
// drives GameHub's lobby methods, so a new one is a harness call rather than a hundred lines.

/// <summary>One send a hub made to a client proxy: the method and its arguments.</summary>
internal sealed record CapturedSend(string Method, object?[] Args);

/// <summary>A client proxy that keeps every send with its arguments, so a test can read the
/// response object the hub pushed rather than only the method name.</summary>
internal sealed class CapturingProxy : ISingleClientProxy
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

internal sealed class CapturingCallerClients : IHubCallerClients
{
	private readonly Dictionary<string, CapturingProxy> _groups = new();
	private readonly CapturingProxy _shared = new();
	public CapturingProxy Caller { get; } = new();
	public CapturingProxy Group(string name)
	{
		if (!_groups.TryGetValue(name, out var proxy))
		{
			proxy = new CapturingProxy();
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

internal sealed class NoopAuctionTimer : IAuctionTimerService
{
	public event Func<string, AuctionTimerTickEventArgs, Task>? OnTimerTick { add { } remove { } }
	public event Func<string, Task>? OnBidTimeout { add { } remove { } }
	public void StartTimers(string gameId, GameSettings settings, AuctionState auction) { }
	public void StopTimers(string gameId) { }
}

internal sealed class NoopHubContext : IHubContext<GameHub>
{
	public IHubClients Clients { get; } = new NoopHubClients();
	public IGroupManager Groups { get; } = new NoopGroupManager();
}

internal sealed class NoopHubClients : IHubClients
{
	private readonly CapturingProxy _proxy = new();
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

internal sealed class NoopGroupManager : IGroupManager
{
	public Task AddToGroupAsync(string connectionId, string groupName, CancellationToken cancellationToken = default)
		=> Task.CompletedTask;
	public Task RemoveFromGroupAsync(string connectionId, string groupName, CancellationToken cancellationToken = default)
		=> Task.CompletedTask;
}
