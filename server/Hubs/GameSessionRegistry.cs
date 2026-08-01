using System.Collections.Concurrent;
using CorroServer.Models;
using CorroServer.Services;
using CorroServer.Services.Corro;
using CorroServer.Services.Corro.Families;
using CorroServer.Services.Voice;
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
	// Coalesce concurrent deletion requests (game-over, host action and retention) per game.
	private readonly ConcurrentDictionary<string, Lazy<Task<bool>>> _deletions = new();
	// Connections that announced they are about to be replaced by the same player's next page
	// (the waiting room handing over to the board). See DeclareHandoff.
	private readonly ConcurrentDictionary<string, byte> _handoffConnections = new();
	// One gate per game for read-modify-write changes to its document (see MutateDocumentAsync).
	private readonly ConcurrentDictionary<string, SemaphoreSlim> _documentLocks = new();

	private readonly IHubContext<GameHub> _hub;
	private readonly IGameRepository _repository;
	private readonly IAuctionTimerService _timers;
	private readonly INopeWindowService? _nopeWindow;
	private readonly IForbiddenTurnTimerService? _forbiddenTimer;
	private readonly PackageRestorer _restorer;
	private readonly ILogger<GameSessionRegistry>? _logger;
	private readonly ILiveKitVoiceService? _voiceService;

	public GameSessionRegistry(
		IHubContext<GameHub> hub,
		IGameRepository repository,
		IAuctionTimerService timers,
		PackageRestorer restorer,
		ILogger<GameSessionRegistry>? logger = null,
		// The exploding family's real-time Nope window. Optional so the slim test constructions
		// keep working; DI injects the registered singleton in the running app.
		INopeWindowService? nopeWindow = null,
		// The voice relay is optional for deployments and for slim tests.
		ILiveKitVoiceService? voiceService = null,
		// The forbidden family's authoritative clue-turn clock. Optional for slim tests.
		IForbiddenTurnTimerService? forbiddenTimer = null)
	{
		_hub = hub;
		_repository = repository;
		_timers = timers;
		_nopeWindow = nopeWindow;
		_forbiddenTimer = forbiddenTimer;
		_restorer = restorer;
		_logger = logger;
		_voiceService = voiceService;
		SubscribeToAuctionTimerEvents();
		SubscribeToNopeWindowEvents();
		SubscribeToForbiddenTimerEvents();
	}

	// ── Live services ─────────────────────────────────────────────────────────

	public bool HasService(string gameId) => _gameServices.ContainsKey(gameId);

	/// <summary>Whether this process is actively serving or persisting the game.</summary>
	public bool HasActivity(string gameId)
		=> _gameServices.ContainsKey(gameId)
		|| _persisters.ContainsKey(gameId)
		|| _connectionGameMap.Values.Contains(gameId)
		|| _lobbyConnections.Values.Contains(gameId);

	public bool TryGetService(string gameId, out IGameService service) => _gameServices.TryGetValue(gameId, out service!);

	/// <summary>Register a freshly created/restored game service: subscribe its events, then track it.</summary>
	public void RegisterService(string gameId, IGameService service)
	{
		SubscribeToGameEvents(service, gameId);
		_gameServices[gameId] = service;
		// A restored game may already be inside a timed clue turn. Re-arm from the persisted
		// authoritative timestamp immediately; a newly-created game is still preparing, so this
		// is a no-op there.
		ArmOrCancelForbiddenTimer(gameId, service);
	}

	// ── Connection maps ───────────────────────────────────────────────────────

	public void MapConnectionToGame(string connectionId, string gameId) => _connectionGameMap[connectionId] = gameId;
	public void AuthenticateConnection(string connectionId, string playerId) => _authenticatedConnections[connectionId] = playerId;
	public void MapLobbyConnection(string connectionId, string gameId) => _lobbyConnections[connectionId] = gameId;

	public bool TryRemoveGameConnection(string connectionId, out string gameId) => _connectionGameMap.TryRemove(connectionId, out gameId!);
	public bool TryRemoveAuthConnection(string connectionId, out string playerId) => _authenticatedConnections.TryRemove(connectionId, out playerId!);
	public bool TryRemoveLobbyConnection(string connectionId, out string gameId) => _lobbyConnections.TryRemove(connectionId, out gameId!);

	/// <summary>
	/// Records that this connection is about to be replaced by the same player's next page, so its
	/// death is a handover rather than a departure. Leaving the waiting room for the board is a full
	/// page navigation: the old connection dies and a new one authenticates a moment later, which
	/// otherwise reads exactly like a drop and a reconnection — the whole table hears "X went away"
	/// and the player themselves "you have reconnected", seconds into a game they never left.
	/// </summary>
	public void DeclareHandoff(string connectionId) => _handoffConnections[connectionId] = 0;

	/// <summary>
	/// Whether this connection's death was announced in advance, clearing the record. Every
	/// connection disconnects eventually, so consuming it there is what keeps this from growing.
	/// </summary>
	public bool TryConsumeHandoff(string connectionId) => _handoffConnections.TryRemove(connectionId, out _);

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

	/// <summary>
	/// Read-modify-write a game document under a per-game lock, so two clients changing the same
	/// table at the same moment cannot each save a version that still contains the other's change.
	///
	/// The read happens INSIDE the lock and goes to the repository, never to the cache: the whole
	/// point is to see what the previous writer just saved. Two people leaving a table at the same
	/// instant is the case this exists for — without it the second write puts the first one's seat
	/// back, and a table nobody is sitting at survives because each of them saw the other.
	///
	/// `mutate` returns null when it decides there is nothing to change. Returns the saved document
	/// (or the untouched one), or null when the game no longer exists.
	/// </summary>
	public async Task<GameDocument?> MutateDocumentAsync(string gameId, Func<GameDocument, GameDocument?> mutate)
	{
		var gate = _documentLocks.GetOrAdd(gameId, _ => new SemaphoreSlim(1, 1));
		await gate.WaitAsync();
		try
		{
			var document = await _repository.LoadGameAsync(gameId);
			if (document is null)
			{
				return null;
			}
			var mutated = mutate(document);
			if (mutated is null)
			{
				return document;
			}
			var saved = await _repository.UpdateGameAsync(mutated);
			_persistedDocuments[gameId] = saved;
			return saved;
		}
		finally
		{
			gate.Release();
		}
	}

	/// <summary>Persist the host's platform-level voice switch through the same document cache
	/// used by state/chat writes, so a concurrent game snapshot cannot restore an older value.</summary>
	public async Task<GameDocument?> SetVoiceChatEnabledAsync(string gameId, bool enabled)
	{
		if (!_persistedDocuments.TryGetValue(gameId, out var doc) || doc == null)
		{
			doc = await _repository.LoadGameAsync(gameId);
			if (doc == null)
			{
				return null;
			}
		}

		var saved = await _repository.UpdateGameAsync(doc with { VoiceChatEnabled = enabled });
		_persistedDocuments[gameId] = saved;
		return saved;
	}

	// ── Lifecycle ─────────────────────────────────────────────────────────────

	/// <summary>
	/// Stop the clocks and drop the in-memory game service. Returns the removed service (already
	/// un-tracked) so the caller can dispose it; null when none was live.
	///
	/// Deliberately does NOT touch the voice room: a match ends far more often than a table does,
	/// and the conversation is the table's, not the match's.
	/// </summary>
	private async Task<IGameService?> StopLiveMatchAsync(string gameId)
	{
		_timers.StopTimers(gameId);
		_nopeWindow?.Cancel(gameId);
		_forbiddenTimer?.Cancel(gameId);
		if (_gameServices.TryRemove(gameId, out var service))
		{
			try { await service.EndGameAsync(); }
			catch (Exception ex) { _logger?.LogError(ex, "Error ending game {GameId}", gameId); }
			return service;
		}
		return null;
	}

	/// <summary>
	/// Stop live work for a game being deleted: the match AND the room it was talking in.
	/// </summary>
	public async Task<IGameService?> TearDownGameAsync(string gameId)
	{
		if (_voiceService?.IsConfigured == true)
		{
			try { await _voiceService.DeleteRoomAsync(gameId); }
			catch (Exception ex) { _logger?.LogWarning(ex, "Could not delete voice room for game {GameId}", gameId); }
		}
		return await StopLiveMatchAsync(gameId);
	}

	/// <summary>
	/// Canonical permanent deletion used by every lifecycle path. It first ends live work and flushes
	/// persistence, then removes Cosmos. Only after Cosmos confirms deletion does it release an
	/// uploaded package, and only when no other game references the same token/blob.
	/// </summary>
	public async Task<bool> DeleteGameAsync(string gameId, GameDocument? knownDocument = null)
	{
		var deletion = _deletions.GetOrAdd(gameId, _ => new Lazy<Task<bool>>(
			() => DeleteGameCoreAsync(gameId, knownDocument),
			LazyThreadSafetyMode.ExecutionAndPublication));

		try
		{
			return await deletion.Value;
		}
		finally
		{
			if (_deletions.TryGetValue(gameId, out var current) && ReferenceEquals(current, deletion))
			{
				_deletions.TryRemove(gameId, out _);
			}
		}
	}

	private async Task<bool> DeleteGameCoreAsync(string gameId, GameDocument? knownDocument)
	{
		var removed = await TearDownGameAsync(gameId);
		if (removed is IDisposable disposable)
		{
			disposable.Dispose();
		}

		// EndGameAsync may have queued one last snapshot. Wait before deleting so a late upsert cannot
		// resurrect the document after cleanup.
		if (_persisters.TryRemove(gameId, out var persister))
		{
			try { await persister.WaitForIdleAsync(); }
			catch (Exception ex) { _logger?.LogError(ex, "Error flushing persister for game {GameId}", gameId); }
		}

		_persistedDocuments.TryRemove(gameId, out var cachedDocument);
		var document = await _repository.LoadGameAsync(gameId) ?? knownDocument ?? cachedDocument;
		var deleted = await _repository.DeleteGameAsync(gameId);
		if (!deleted)
		{
			return false;
		}

		if (document is not null)
		{
			var packageToken = document.PackageToken ?? document.GameState?.PackageToken;
			var blobKey = document.PackageBlobKey;
			try
			{
				var tokenStillUsed = await _repository.HasPackageReferenceAsync(packageToken, packageBlobKey: null);
				var blobStillUsed = await _repository.HasPackageReferenceAsync(packageToken: null, blobKey);
				if (!tokenStillUsed || !blobStillUsed)
				{
					await _restorer.ReleaseAsync(
						tokenStillUsed ? null : packageToken,
						blobStillUsed ? null : blobKey);
				}
			}
			catch (Exception ex)
			{
				// Cosmos deletion already succeeded. Leave a possible blob orphan for the daily sweep rather
				// than turning a transient Storage failure into a broken, restorable game document.
				_logger?.LogError(ex, "Game {GameId} was deleted but package cleanup failed", gameId);
			}
		}

		_documentLocks.TryRemove(gameId, out _);
		_logger?.LogInformation("Game {GameId} permanently deleted", gameId);
		return true;
	}

	/// <summary>
	/// Retires a finished match and leaves its TABLE standing. Game-over is read from the
	/// authoritative <see cref="GameState.IsGameOver"/> flag (set by the rulebook for both a manual
	/// bankruptcy and an auto-forced one).
	///
	/// A finished match used to delete everything, which made the last roll of a game the end of the
	/// group that played it: the chat, the seats, the invite code and the voice room all went with
	/// it, and playing again meant starting from an empty form. The people are the durable part, so
	/// they are what survives. What is disposed of is the match: its clocks, its in-memory service
	/// and its live snapshot — which is not thrown away but moved to <c>LastMatch</c>, so the result
	/// outlives the game that produced it.
	///
	/// Deletion is still what happens to a TABLE, from the host's own action or the retention sweep.
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

		try { await RetireMatchAsync(gameId, state); }
		catch (Exception ex) { _logger?.LogError(ex, "Error retiring the finished match of table {GameId}", gameId); }
	}

	/// <summary>
	/// Ends the live match and returns the table to rest: clocks stopped, service dropped, the final
	/// snapshot moved from <c>GameState</c> to <c>LastMatch</c> and the status back to waiting. The
	/// package is NOT released and the voice room is NOT deleted — both belong to the table, which is
	/// still there and, most likely, about to play again.
	///
	/// Returns the saved table document, or null when there was nothing persisted to retire.
	/// </summary>
	public async Task<GameDocument?> RetireMatchAsync(string gameId, GameState finalState)
	{
		var removed = await StopLiveMatchAsync(gameId);
		if (removed is IDisposable disposable)
		{
			disposable.Dispose();
		}

		// EndGameAsync may have queued one last snapshot. Wait for it, and drop the persister, so a
		// late write cannot put the finished match back into the table as if it were still running.
		if (_persisters.TryRemove(gameId, out var persister))
		{
			try { await persister.WaitForIdleAsync(); }
			catch (Exception ex) { _logger?.LogError(ex, "Error flushing persister for game {GameId}", gameId); }
		}

		var document = await _repository.LoadGameAsync(gameId)
			?? (_persistedDocuments.TryGetValue(gameId, out var cached) ? cached : null);
		if (document == null)
		{
			return null;
		}

		var saved = await _repository.UpdateGameAsync(document with
		{
			Status = GameStatus.WaitingForPlayers,
			GameState = null,
			LastMatch = finalState,
			MatchesPlayed = document.MatchesPlayed + 1,
		});
		_persistedDocuments[gameId] = saved;

		// Everyone still connected has stopped playing at this table and is now just sitting at it,
		// so they move into its waiting-room group. Without this the host's NEXT match would be
		// announced to a group none of them is in, and the table would look abandoned from inside.
		foreach (var connectionId in GameConnectionIds(gameId))
		{
			MapLobbyConnection(connectionId, gameId);
			try { await _hub.Groups.AddToGroupAsync(connectionId, $"lobby_{gameId}"); }
			catch (Exception ex) { _logger?.LogWarning(ex, "Could not seat connection {ConnectionId} at table {GameId}", connectionId, gameId); }
		}

		// The table is at rest and everyone in it should know, whether or not they were looking at
		// the board when it happened.
		await _hub.Clients.Group(gameId).SendAsync("MatchEnded", saved.Sanitized());

		_logger?.LogInformation(
			"Match {Number} retired for table {GameId}; the table remains", saved.MatchesPlayed, gameId);
		return saved;
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

	private void SubscribeToForbiddenTimerEvents()
	{
		if (_forbiddenTimer == null)
		{
			return;
		}
		// Visual countdown only: this event never writes to a live region. The authoritative
		// timeout itself goes through a command and the normal server-owned announcement voice.
		_forbiddenTimer.OnTimerTick += async (gameId, args) =>
			await _hub.Clients.Group(gameId).SendAsync("ForbiddenTimerTick", new
			{
				secondsRemaining = args.SecondsRemaining,
			});
		_forbiddenTimer.OnTurnExpired += async gameId => await ExpireForbiddenTurnViaCommand(gameId);
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

	/// <summary>Run the per-second bid timer while an auction is live, and retire it the moment
	/// the auction resolves — however it resolved (the last rival passing, a bid winning it, the
	/// property family's own paths). Like its two siblings above this is driven by the STATE, not
	/// by which command ran, so no caller has to remember to stop it.
	///
	/// Re-arming on every state change is free: the countdown is computed from the authoritative
	/// <see cref="AuctionState.CurrentPhaseStartedAt"/> (see
	/// <c>AuctionTimerService.EvaluateBidTick</c>), never from the timer's own elapsed time, so the
	/// timer is only a heartbeat. Restoring a game is the one case that arms explicitly instead
	/// (GameHub gives the revived auction a FRESH window first, then arms).</summary>
	private void ArmOrCancelAuctionTimer(string gameId, IGameService gameService)
	{
		if (ShouldRunBidTimer(gameService.GameState) is { } auction)
		{
			_timers.StartTimers(gameId, gameService.Settings, auction);
		}
		else
		{
			_timers.StopTimers(gameId);
		}
	}

	/// <summary>The auction the bid timer should be running for, or null when it must be retired.
	/// Pure, so the rule is unit-testable without a registry, timers or a live game — the same
	/// treatment the dispatcher's guards and <c>AuctionTimerService.EvaluateBidTick</c> get.</summary>
	internal static AuctionState? ShouldRunBidTimer(GameState? state)
		=> state?.ActiveAuction is { IsActive: true } auction ? auction : null;

	/// <summary>Keep the forbidden turn clock aligned with the live projected state. Card
	/// changes do not reset it: every re-arm samples the same StartedAt value.</summary>
	private void ArmOrCancelForbiddenTimer(string gameId, IGameService gameService)
	{
		if (_forbiddenTimer == null)
		{
			return;
		}
		if (gameService.GameState?.Forbidden?.Turn is { Phase: ForbiddenTurnPhase.Active } turn
			&& !gameService.GameState.IsGameOver)
		{
			_forbiddenTimer.Arm(
				gameId,
				() => gameService.GameState?.Forbidden?.Turn is { Phase: ForbiddenTurnPhase.Active } live
					? live.StartedAt
					: null,
				() => gameService.GameState?.Forbidden?.Turn.DurationSeconds ?? turn.DurationSeconds);
		}
		else
		{
			_forbiddenTimer.Cancel(gameId);
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

	private async Task ExpireForbiddenTurnViaCommand(string gameId)
	{
		try
		{
			if (!_gameServices.TryGetValue(gameId, out var gameService)
				|| gameService.GameState?.Forbidden?.Turn is not { Phase: ForbiddenTurnPhase.Active } turn)
			{
				return;
			}

			var response = await gameService.ExecuteCommandAsync(
				new ForbiddenExpireTurnCommand { PlayerId = turn.ClueGiverId });
			// A human card action may have crossed the same deadline and resolved it first. Its
			// serialized command leaves this callback with a harmless NOT_ACTIVE error; do not
			// broadcast that internal race as a player error.
			if (response is not ForbiddenActionResponse)
			{
				return;
			}

			await _hub.Clients.Group(gameId).SendAsync("CommandResponse", response);
			await gameService.NotifyStateChangedAsync();
			await CleanupIfGameOverAsync(gameId, gameService);
		}
		catch (Exception exception)
		{
			_logger?.LogError(exception, "ExpireForbiddenTurnViaCommand: error for {GameId}", gameId);
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

			// The auction may already be over: a winning bid nobody could match, or the last rival
			// passing, resolves it through the normal command path. The bid timer is retired by the
			// state change that follows (ArmOrCancelAuctionTimer), but a tick already in flight
			// cannot be recalled — it would issue EndAuctionCommand against nothing, and the
			// resulting NO_ACTIVE_AUCTION error was broadcast to EVERY player as if something had
			// gone wrong with an auction that in fact ended correctly. There is simply nothing to do.
			if (gameService.GameState?.ActiveAuction is null or { IsActive: false })
			{
				_logger?.LogDebug(
					"EndAuctionViaCommand: auction for {GameId} already resolved; ignoring the {Reason} tick",
					gameId, reason);
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
			ArmOrCancelForbiddenTimer(gameId, gameService);
			ArmOrCancelAuctionTimer(gameId, gameService);

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
