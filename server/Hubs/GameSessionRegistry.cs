using System.Collections.Concurrent;
using CorroServer.Models;
using CorroServer.Services;
using CorroServer.Services.Corro;
using CorroServer.Services.Corro.Families;
using Microsoft.AspNetCore.SignalR;

namespace CorroServer.Hubs;

/// <summary>
/// Owns the process-wide LIVE game state that used to live in <see cref="GameHub"/>'s static fields:
/// the in-memory game services, the connection↔game / connection↔player maps, and the per-game
/// persistence writers. A single injected singleton (not Hub statics), so dependencies flow through DI,
/// the state is unit-testable, and server-initiated pushes (auction timers, game events) reach clients
/// via the injected <see cref="IHubContext{GameHub}"/> instead of a captured static context.
///
/// The Hub is now a thin transport that delegates here; timer callbacks are wired once in the ctor.
/// </summary>
public sealed class GameSessionRegistry
{
	// ── Live, process-wide state ──────────────────────────────────────────────
	private readonly ConcurrentDictionary<string, IGameService> _gameServices = new();
	private readonly ConcurrentDictionary<string, string> _connectionGameMap = new();   // connectionId -> gameId
	private readonly ConcurrentDictionary<string, string> _lobbyConnections = new();     // connectionId -> gameId
	private readonly ConcurrentDictionary<string, string> _authenticatedConnections = new(); // connectionId -> playerId
																							 // Last known persisted document per game, so per-command writes reuse its non-state fields (invite
																							 // code, host, players, history…) without re-reading from Cosmos every command.
	private readonly ConcurrentDictionary<string, GameDocument> _persistedDocuments = new();
	// Per-game background persister: coalesces snapshots and writes them off the awaited command path.
	private readonly ConcurrentDictionary<string, GameStatePersister> _persisters = new();

	private readonly IHubContext<GameHub> _hub;
	private readonly IGameRepository _repository;
	private readonly IAuctionTimerService _timers;
	private readonly INopeWindowService? _nopeWindow;
	private readonly PackageRestorer _restorer;
	private readonly ILogger<GameSessionRegistry>? _logger;

	public GameSessionRegistry(
		IHubContext<GameHub> hub,
		IGameRepository repository,
		IAuctionTimerService timers,
		PackageRestorer restorer,
		ILogger<GameSessionRegistry>? logger = null,
		// The exploding family's real-time Nope window. Optional so the slim test constructions
		// keep working; DI injects the registered singleton in the running app.
		INopeWindowService? nopeWindow = null)
	{
		_hub = hub;
		_repository = repository;
		_timers = timers;
		_nopeWindow = nopeWindow;
		_restorer = restorer;
		_logger = logger;
		SubscribeToAuctionTimerEvents();
		SubscribeToNopeWindowEvents();
	}

	// ── Live services ─────────────────────────────────────────────────────────

	public bool HasService(string gameId) => _gameServices.ContainsKey(gameId);

	public bool TryGetService(string gameId, out IGameService service) => _gameServices.TryGetValue(gameId, out service!);

	/// <summary>Register a freshly created/restored game service: subscribe its events, then track it.</summary>
	public void RegisterService(string gameId, IGameService service)
	{
		SubscribeToGameEvents(service, gameId);
		_gameServices[gameId] = service;
	}

	// ── Connection maps ───────────────────────────────────────────────────────

	public void MapConnectionToGame(string connectionId, string gameId) => _connectionGameMap.TryAdd(connectionId, gameId);
	public void AuthenticateConnection(string connectionId, string playerId) => _authenticatedConnections.TryAdd(connectionId, playerId);
	public void MapLobbyConnection(string connectionId, string gameId) => _lobbyConnections.TryAdd(connectionId, gameId);

	public bool TryRemoveGameConnection(string connectionId, out string gameId) => _connectionGameMap.TryRemove(connectionId, out gameId!);
	public bool TryRemoveAuthConnection(string connectionId, out string playerId) => _authenticatedConnections.TryRemove(connectionId, out playerId!);
	public bool TryRemoveLobbyConnection(string connectionId, out string gameId) => _lobbyConnections.TryRemove(connectionId, out gameId!);

	/// <summary>The authenticated connection + its game for a connection, or false when not authenticated.</summary>
	public bool IsAuthenticated(string connectionId, out string? playerId, out string? gameId)
	{
		playerId = null;
		gameId = null;
		if (!_authenticatedConnections.TryGetValue(connectionId, out playerId))
		{
			return false;
		}

		if (!_connectionGameMap.TryGetValue(connectionId, out gameId))
		{
			return false;
		}

		return true;
	}

	/// <summary>
	/// The authenticated connection ids of a player within a game (a player may have several, e.g.
	/// multiple tabs). Empty when the player has no tracked connection — callers treat that as "nobody".
	/// </summary>
	public IReadOnlyList<string> ConnectionsForPlayer(string? playerId, string gameId)
	{
		if (string.IsNullOrEmpty(playerId))
		{
			return Array.Empty<string>();
		}

		return _authenticatedConnections
			.Where(kv => kv.Value == playerId
				&& _connectionGameMap.TryGetValue(kv.Key, out var g) && g == gameId)
			.Select(kv => kv.Key)
			.ToList();
	}

	/// <summary>The distinct player ids currently connected (authenticated) to a game (for the saved-games list).</summary>
	public HashSet<string> ConnectedPlayerIds(string gameId)
		=> _authenticatedConnections
			.Where(kv => _connectionGameMap.TryGetValue(kv.Key, out var g) && g == gameId)
			.Select(kv => kv.Value)
			.ToHashSet();

	/// <summary>Connection ids currently mapped to a game (used to detach them when the game is deleted).</summary>
	public IReadOnlyList<string> GameConnectionIds(string gameId)
		=> _connectionGameMap.Where(kv => kv.Value == gameId).Select(kv => kv.Key).ToList();

	/// <summary>Lobby connection ids for a game (used to detach them when the game is deleted).</summary>
	public IReadOnlyList<string> LobbyConnectionIds(string gameId)
		=> _lobbyConnections.Where(kv => kv.Value == gameId).Select(kv => kv.Key).ToList();

	/// <summary>Forget a game+auth connection mapping (its group removal is the Hub's job).</summary>
	public void ForgetGameConnection(string connectionId)
	{
		_connectionGameMap.TryRemove(connectionId, out _);
		_authenticatedConnections.TryRemove(connectionId, out _);
	}

	public void ForgetLobbyConnection(string connectionId) => _lobbyConnections.TryRemove(connectionId, out _);

	// ── Persistence cache ─────────────────────────────────────────────────────

	/// <summary>Seed/refresh the cached document for a game (its non-state fields feed the persister).</summary>
	public void CacheDocument(string gameId, GameDocument document) => _persistedDocuments[gameId] = document;

	/// <summary>
	/// Appends a chat message to the game's document THROUGH the persistence cache — the same
	/// document instance the per-command persister reuses — so chat writes carry the freshest
	/// persisted GameState and state writes carry the freshest chat, instead of clobbering each
	/// other from independent Cosmos reads. Returns the saved document, or null when the game
	/// doesn't exist. The history is capped (oldest dropped) to bound document size.
	/// </summary>
	public async Task<GameDocument?> AppendChatMessageAsync(string gameId, ChatMessage message, int cap = 200)
	{
		if (!_persistedDocuments.TryGetValue(gameId, out var doc) || doc == null)
		{
			doc = await _repository.LoadGameAsync(gameId);
			if (doc == null)
			{
				return null;
			}
		}
		var messages = doc.ChatMessages.ToList();
		messages.Add(message);
		if (messages.Count > cap)
		{
			messages.RemoveRange(0, messages.Count - cap);
		}

		var saved = await _repository.UpdateGameAsync(doc with { ChatMessages = messages });
		_persistedDocuments[gameId] = saved;
		return saved;
	}

	// ── Lifecycle ─────────────────────────────────────────────────────────────

	/// <summary>
	/// Stop timers and drop the in-memory game service for a game being deleted from the lobby. Returns
	/// the removed service (already un-tracked) so the caller can end it; null when none was live.
	/// </summary>
	public async Task<IGameService?> TearDownGameAsync(string gameId)
	{
		_timers.StopTimers(gameId);
		if (_gameServices.TryRemove(gameId, out var service))
		{
			await service.EndGameAsync();
			return service;
		}
		return null;
	}

	/// <summary>
	/// Removes, finishes and DELETES a game once it is over so it neither leaks in <c>_gameServices</c>
	/// nor lingers in Cosmos. Game-over is read from the authoritative <see cref="GameState.IsGameOver"/>
	/// flag (set by the rulebook for both a manual bankruptcy and an auto-forced one).
	/// </summary>
	public async Task CleanupIfGameOverAsync(string gameId, IGameService gameService)
	{
		GameState state;
		try { state = await gameService.GetGameStateAsync(); }
		catch { return; } // game already torn down

		if (!state.IsGameOver)
		{
			return;
		}

		// Stop any running auction timers for this game.
		_timers.StopTimers(gameId);

		// Release any .corro package bound to this game: unregister its sound pack, delete its
		// extracted temp folder, and delete its durable blob (uploads only; shipped boards have none).
		if (state.PackageToken is { } packageToken)
		{
			await _restorer.ReleaseAsync(packageToken);
		}

		if (_gameServices.TryRemove(gameId, out var removed))
		{
			try { await removed.EndGameAsync(); }
			catch (Exception ex) { _logger?.LogError(ex, "Error ending game {GameId}", gameId); }

			if (removed is IDisposable disposable)
			{
				disposable.Dispose();
			}

			_logger?.LogInformation("Game {GameId} finished and removed from memory", gameId);
		}

		// Flush the last persisted snapshot (EndGameAsync raised a final state change) and drop the
		// per-game persister + cached document so they don't leak.
		if (_persisters.TryRemove(gameId, out var persister))
		{
			try { await persister.WaitForIdleAsync(); }
			catch (Exception ex) { _logger?.LogError(ex, "Error flushing persister for game {GameId}", gameId); }
		}
		_persistedDocuments.TryRemove(gameId, out _);

		// The game is over and won: delete it from the server immediately (no replay/resume). The
		// persister is already idle and removed, so this won't be resurrected by a write.
		try { await _repository.DeleteGameAsync(gameId); }
		catch (Exception ex) { _logger?.LogError(ex, "Error deleting finished game {GameId}", gameId); }
	}

	// ── Wiring (moved verbatim from the Hub's static callbacks) ───────────────

	private void SubscribeToAuctionTimerEvents()
	{
		_timers.OnTimerTick += async (gameId, args) =>
		{
			await _hub.Clients.Group(gameId).SendAsync("AuctionTimerTick", new
			{
				SquareIndex = args.SquareIndex,
				SecondsRemaining = args.SecondsRemaining,
				CurrentBid = args.CurrentBid,
				HighestBidderId = args.HighestBidderId,
				HighestBidderName = args.HighestBidderName
			});
		};

		_timers.OnBidTimeout += async (gameId) => await EndAuctionViaCommand(gameId, "bid_timeout");

		_logger?.LogInformation("Auction timer events subscribed");
	}

	private void SubscribeToNopeWindowEvents()
	{
		if (_nopeWindow == null)
		{
			return;
		}
		// When the suspense window elapses, resolve the pending action through the command
		// pipeline (business logic stays in the handler), then broadcast the new state.
		_nopeWindow.OnWindowExpired += async (gameId) => await ResolveExplodingWindowViaCommand(gameId);
	}

	/// <summary>Arm the Nope window while an exploding action is pending, cancel it otherwise.
	/// Called on every state change; the timer reads the live authoritative window start, so a
	/// Nope (which advances that stamp) restarts the countdown with no extra bookkeeping here.</summary>
	private void ArmOrCancelNopeWindow(string gameId, IGameService gameService)
	{
		if (_nopeWindow == null)
		{
			return;
		}

		if (gameService.GameState?.Exploding?.PendingAction != null)
		{
			var millis = gameService.GameState?.ExplodingRules?.NopeWindowMillis ?? 2000;
			_nopeWindow.Arm(gameId,
				() => gameService.GameState?.Exploding?.PendingAction?.WindowStartedAt,
				millis);
		}
		else
		{
			_nopeWindow.Cancel(gameId);
		}
	}

	/// <summary>
	/// Resolve the pending exploding action once its Nope window elapsed, by executing the
	/// resolve command through the game service (so the effect-or-fizzle logic stays in the
	/// handler), then broadcasting the response + full state to the group.
	/// </summary>
	private async Task ResolveExplodingWindowViaCommand(string gameId)
	{
		try
		{
			if (!_gameServices.TryGetValue(gameId, out var gameService))
			{
				return;
			}

			var currentTurn = gameService.GameState?.CurrentTurn;
			if (string.IsNullOrEmpty(currentTurn))
			{
				return;
			}

			var response = await gameService.ExecuteCommandAsync(
				new ExplodingResolveWindowCommand { PlayerId = currentTurn });
			await _hub.Clients.Group(gameId).SendAsync("CommandResponse", response);

			// Broadcast the resolved state per player (the actor hears their _self lines); this
			// also persists via the OnGameStateChanged subscription.
			await gameService.NotifyStateChangedAsync();
		}
		catch (Exception ex)
		{
			_logger?.LogError(ex, "ResolveExplodingWindowViaCommand: error for {GameId}", gameId);
		}
	}

	/// <summary>
	/// End an auction by executing the EndAuctionCommand through the game service, so the business
	/// logic stays in the command handler, not here. Broadcasts the response + full state to the group.
	/// </summary>
	private async Task EndAuctionViaCommand(string gameId, string reason)
	{
		try
		{
			if (!_gameServices.TryGetValue(gameId, out var gameService))
			{
				_logger?.LogWarning("EndAuctionViaCommand: GameService not found for {GameId}", gameId);
				return;
			}

			var currentTurn = gameService.GameState?.CurrentTurn;
			if (string.IsNullOrEmpty(currentTurn))
			{
				_logger?.LogWarning("EndAuctionViaCommand: No current turn for {GameId}", gameId);
				return;
			}

			_logger?.LogInformation("EndAuctionViaCommand: Ending auction for {GameId} (reason: {Reason})", gameId, reason);

			var command = new EndAuctionCommand { PlayerId = currentTurn, Reason = reason };
			var response = await gameService.ExecuteCommandAsync(command);

			await _hub.Clients.Group(gameId).SendAsync("CommandResponse", response);

			// Broadcast the full updated state so every board repaints ownership, money and turn after a
			// timer-driven auction end (the per-square "SquareChanged" message has no client handler).
			// NotifyStateChangedAsync also persists via the OnGameStateChanged subscription.
			await gameService.NotifyStateChangedAsync();

			_logger?.LogInformation("EndAuctionViaCommand: Auction ended for {GameId}", gameId);
		}
		catch (Exception ex)
		{
			_logger?.LogError(ex, "EndAuctionViaCommand: Error for {GameId}", gameId);
		}
	}

	/// <summary>
	/// Get (or lazily create) the background persister for a game. Its write delegate reuses the cached
	/// <see cref="GameDocument"/> so no Cosmos READ happens per command; it falls back to a one-time
	/// load only when the document isn't cached. The cache is refreshed with the upsert result.
	/// </summary>
	private GameStatePersister GetOrCreatePersister(string gameId)
		=> _persisters.GetOrAdd(gameId, id => new GameStatePersister(id, async state =>
		{
			if (!_persistedDocuments.TryGetValue(id, out var doc) || doc == null)
			{
				doc = await _repository.LoadGameAsync(id);
				if (doc == null)
				{
					return; // nothing persisted for this game (e.g. in-memory only)
				}

				_persistedDocuments[id] = doc;
			}

			var saved = await _repository.UpdateGameAsync(doc with { GameState = state });
			_persistedDocuments[id] = saved; // keep the cached fields (status, history, _ts…) fresh
		}, _logger));

	/// <summary>
	/// Send a state update to a game's clients honouring the family's hidden-information contract:
	/// families without hidden information broadcast to the group (one send, like always); a
	/// hidden-information family sends each player THEIR projection, per connection. Persistence is
	/// the caller's concern and always stores the FULL state — projection is wire-only.
	/// </summary>
	public async Task SendStateToClientsAsync(string gameId, GameState gameState)
	{
		var family = GameFamilies.For(gameState.GameType);
		var sends = GameStateFanout.PlanPerPlayer(gameState, family, pid => ConnectionsForPlayer(pid, gameId));
		if (sends == null)
		{
			await _hub.Clients.Group(gameId).SendAsync("GameStateChanged", gameState);
			return;
		}
		foreach (var send in sends)
		{
			await _hub.Clients.Clients(send.ConnectionIds).SendAsync("GameStateChanged", send.State);
		}
	}

	/// <summary>Subscribe to a game service's events to broadcast changes and persist to Cosmos.</summary>
	private void SubscribeToGameEvents(IGameService gameService, string gameId)
	{
		gameService.OnGameStateChanged += async (gameState) =>
		{
			await SendStateToClientsAsync(gameId, gameState);

			// Exploding family: arm the real-time Nope window whenever a played action is pending
			// (and cancel it once it resolves). The timer reads the live PendingAction.WindowStartedAt,
			// so a Nope — which moves that stamp and re-fires this event — restarts the countdown.
			ArmOrCancelNopeWindow(gameId, gameService);

			// Persist OFF the awaited command path: a per-game background writer coalesces (latest-wins)
			// and reuses the cached GameDocument (no per-command Cosmos read).
			GetOrCreatePersister(gameId).Enqueue(gameState);
		};

		gameService.OnGameEvents += async (dispatches) =>
		{
			if (dispatches.Count == 0)
			{
				return;
			}

			// One action = one ordered batch. Each player hears their own personalized view (the actor
			// gets the first-person "_self" lines, everyone else the base lines), so render + send per
			// player connection.
			var players = gameService.GameState?.Players;
			if (players == null)
			{
				return;
			}

			foreach (var player in players)
			{
				var connections = ConnectionsForPlayer(player.Id, gameId);
				if (connections.Count == 0)
				{
					continue;
				}

				var events = GameHub.RenderBatchForPlayer(dispatches, player.Id);
				if (events.Count == 0)
				{
					continue;
				}

				await _hub.Clients.Clients(connections).SendAsync("GameEvents", events);
			}
			_logger?.LogDebug("GameEvents batch ({Count} events) sent for game {GameId}", dispatches.Count, gameId);
		};

		gameService.OnSquareChanged += async (square) =>
			await _hub.Clients.Group(gameId).SendAsync("SquareChanged", square);

		gameService.OnCardDrawn += async (card) =>
			await _hub.Clients.Group(gameId).SendAsync("CardDrawn", card);
	}
}
