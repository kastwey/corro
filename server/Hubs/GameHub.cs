using System.Collections.Concurrent;
using CorroServer.Models;
using CorroServer.Services;
using CorroServer.Services.Corro;
using CorroServer.Services.Corro.Families;
using CorroServer.Services.Voice;
using Microsoft.AspNetCore.SignalR;

namespace CorroServer.Hubs;

/// <summary>
/// Main GameHub partial class containing core functionality.
/// Split into partial classes for maintainability:
/// - GameHub.cs (this file): Core, constructor, connection management
/// - GameHub.Events.cs: Event subscription logic
/// - GameHub.Commands.cs: Game command methods
/// - GameHub.Lobby.cs: Lobby management methods
/// </summary>
public partial class GameHub : Hub
{
	// ============================================
	// INSTANCE FIELDS (injected dependencies)
	// ============================================
	// Live process-wide state (games, connections, persisters) now lives in the injected
	// GameSessionRegistry singleton instead of static Hub fields.

	private readonly IGameRepository _gameRepository;
	private readonly IGameServiceFactory _gameServiceFactory;
	private readonly IAuctionTimerService _auctionTimerService;
	private readonly CorroServer.Services.Corro.CorroPackageStore _packageStore;
	private readonly CorroServer.Services.Corro.PackageRestorer _packageRestorer;
	private readonly GameSessionRegistry _registry;
	private readonly ILogger<GameHub>? _logger;
	private readonly Services.Rules.IRandomSource _random;
	private readonly PresenceRegistry? _presence;
	private readonly Services.Accounts.IUserRepository? _users;
	private readonly Services.Accounts.FriendshipService? _friendships;
	private readonly Services.Bots.BotDriver? _botDriver;
	private readonly ILiveKitVoiceService? _voiceService;

	/// <summary>
	/// The account behind this connection, or null — which is the normal case, and a fully
	/// supported one: playing never requires signing in.
	///
	/// Read from the connection's OWN principal, which the session cookie established during the
	/// SignalR handshake. Deliberately not a parameter on any hub method: a client that could name
	/// its account could name somebody else's, and every seat this stamps would become a claim
	/// anybody could make.
	/// </summary>
	private string? SignedInUserId()
		=> Services.Accounts.SessionPrincipal.UserId(Context.User);

	/// <summary>
	/// The caller's public name, for the seat they are about to take. Null for anybody playing
	/// without an account or who has not chosen one — which is the ordinary case and always will
	/// be, since nothing about sitting down requires either.
	/// </summary>
	private async Task<string?> HandleOfCallerAsync()
	{
		if (_users is null || SignedInUserId() is not { Length: > 0 } userId) return null;
		var user = await _users.GetUserAsync(userId);
		return user?.Handle is { Length: > 0 } handle ? handle : null;
	}

	public GameHub(
		IGameRepository gameRepository,
		IGameServiceFactory gameServiceFactory,
		IAuctionTimerService auctionTimerService,
		CorroServer.Services.Corro.CorroPackageStore packageStore,
		CorroServer.Services.Corro.PackageRestorer packageRestorer,
		GameSessionRegistry registry,
		ILogger<GameHub> logger,
		// The hub's own randomness (today: the turn-order shuffle). Same source the rulebook
		// uses, so the E2E environment's ScriptedRandomSource (identity shuffle → join order)
		// makes the whole game deterministic. Optional so tests keep their slim constructions.
		Services.Rules.IRandomSource? randomSource = null,
		// Drives bot seats from outside the engine. Optional for the same slim-tests reason.
		Services.Bots.BotDriver? botDriver = null,
		// Optional for slim Hub tests; the running app always registers the singleton.
		ILiveKitVoiceService? voiceService = null,
		// Who is here, by account. Optional for the same slim-tests reason.
		PresenceRegistry? presence = null,
		// Read once per seat taken, to record the public name a table shows. Optional for the same
		// slim-tests reason.
		Services.Accounts.IUserRepository? users = null,
		// Whether two people are friends, which is what a message policy of "only friends" means.
		// Optional for the same slim-tests reason.
		Services.Accounts.FriendshipService? friendships = null)
	{
		_gameRepository = gameRepository;
		_gameServiceFactory = gameServiceFactory;
		_auctionTimerService = auctionTimerService;
		_packageStore = packageStore;
		_packageRestorer = packageRestorer;
		_registry = registry;
		_logger = logger;
		_random = randomSource ?? new Services.Rules.SystemRandomSource();
		_botDriver = botDriver;
		_voiceService = voiceService;
		_presence = presence;
		_users = users;
		_friendships = friendships;
	}

	// ============================================
	// CONNECTION LIFECYCLE
	// ============================================

	/// <summary>
	/// "I am about to be replaced": the page announces its own navigation to another page of the
	/// SAME game (the waiting room handing over to the board) so the disconnection that follows is
	/// not mistaken for the player leaving. Scoped to this connection, so it can only ever silence
	/// the caller's own handover.
	/// </summary>
	public Task DeclareHandoff()
	{
		if (IsConnectionAuthenticated(out _, out _))
		{
			_registry.DeclareHandoff(Context.ConnectionId);
		}
		return Task.CompletedTask;
	}

	/// <summary>
	/// A connection arrives. The only thing recorded here is PRESENCE, and only for somebody with a
	/// session: being here is about the account, not about any seat, so it starts the moment the
	/// page connects rather than when they sit down at a table.
	/// </summary>
	public override async Task OnConnectedAsync()
	{
		var arrived = false;
		string? arrivingUserId = null;
		if (SignedInUserId() is { Length: > 0 } userId)
		{
			// A second tab is not an arrival. Only the connection that brought somebody INTO the
			// room is worth telling anybody about.
			arrived = !(_presence?.IsOnline(userId) ?? false);
			arrivingUserId = userId;
			_presence?.Add(userId, Context.ConnectionId);
		}

		await base.OnConnectedAsync();

		// AFTER the handshake, never inside it. Telling the room costs a lookup per person who
		// could see the arrival, so doing it before base.OnConnectedAsync made every new connection
		// wait on work proportional to how many were already there — which is exactly backwards,
		// and showed up as a busy server refusing to finish anything.
		if (arrived && arrivingUserId is not null)
		{
			await AnnouncePresenceAsync(arrivingUserId, arriving: true);
		}
	}

	public override async Task OnDisconnectedAsync(Exception? exception)
	{
		// Announced navigations (waiting room → board) are a handover, not a departure. Read once
		// here so the record is cleared for every connection, announced or not.
		var handedOver = _registry.TryConsumeHandoff(Context.ConnectionId);
		string? departedUserId = null;

		// Presence drops this connection; the person only leaves the list with their last one, so
		// a second tab — or a navigation from the table to the board — never blinks them out.
		if (SignedInUserId() is { Length: > 0 } presentUserId)
		{
			_presence?.Remove(presentUserId, Context.ConnectionId);
			// And closing one tab is not leaving: only the last connection going means they are gone.
			if (_presence?.IsOnline(presentUserId) == false)
			{
				departedUserId = presentUserId;
			}
		}

		// Clean up game mapping
		var hadGame = _registry.TryRemoveGameConnection(Context.ConnectionId, out var gameId);
		if (hadGame)
		{
			await Groups.RemoveFromGroupAsync(Context.ConnectionId, gameId);
		}

		// Clean up authenticated connection
		if (_registry.TryRemoveAuthConnection(Context.ConnectionId, out var playerId))
		{
			_logger?.LogInformation("Player {PlayerId} disconnected and removed from authenticated connections", playerId);

			// Mark the player as away in the live game so the others see it in the panel and
			// hear the announcement. JoinGameWithAuth flips it back on rejoin.
			//
			// But ONLY when no live connection remains: a transport reconnect often re-auths the
			// NEW connection (JoinGameWithAuth → connected=true, a no-op since the flag is still
			// true) BEFORE this fires for the dead OLD one. Marking away unconditionally then
			// leaves the just-rejoined player stuck "disconnected" forever (their turn even reads
			// "X's turn. Disconnected"). TryRemoveAuthConnection above already dropped THIS
			// connection, so a remaining count of 0 means they are truly gone. Also supports
			// multiple tabs correctly.
			//
			// A declared handover is exempt: the player is mid-navigation inside this same game, so
			// marking them away would announce a departure and then a reconnection they never made.
			// The cost of trusting it is bounded — a page that declares a handover and then never
			// arrives (the tab is closed mid-navigation) leaves them listed as present until they
			// truly connect again, which is a far rarer and quieter failure than the false pair.
			if (!handedOver && hadGame && _registry.TryGetService(gameId, out var gameService)
				&& _registry.ConnectionsForPlayer(playerId, gameId).Count == 0)
			{
				await gameService.SetPlayerConnectedAsync(playerId, false);
			}
		}

		// Clean up lobby
		if (_registry.TryRemoveLobbyConnection(Context.ConnectionId, out var lobbyGameId))
		{
			await Groups.RemoveFromGroupAsync(Context.ConnectionId, $"lobby_{lobbyGameId}");
			await Clients.Group($"lobby_{lobbyGameId}").SendAsync("PlayerLeft", Context.ConnectionId);
		}

		await base.OnDisconnectedAsync(exception);

		// Same reasoning as the arrival: told after, so a departure never holds up the teardown of
		// a connection that has already gone.
		if (departedUserId is not null)
		{
			await AnnouncePresenceAsync(departedUserId, arriving: false);
		}
	}

	// ============================================
	// AUTHENTICATION HELPERS
	// ============================================

	/// <summary>
	/// Validates that the current connection is authenticated
	/// </summary>
	private bool IsConnectionAuthenticated(out string? playerId, out string? gameId)
		=> _registry.IsAuthenticated(Context.ConnectionId, out playerId, out gameId);

	// ============================================
	// GAME CONNECTION METHODS
	// ============================================

	public async Task JoinGame(string gameId)
	{
		try
		{
			if (!_registry.TryGetService(gameId, out var gameService))
			{
				await Clients.Caller.SendAsync("Error", "GAME_NOT_FOUND");
				return;
			}

			_registry.MapConnectionToGame(Context.ConnectionId, gameId);
			await Groups.AddToGroupAsync(Context.ConnectionId, gameId);

			await Clients.Caller.SendAsync("GameJoined", new { GameId = gameId });
			// An unauthenticated join gets the PUBLIC view: a hidden-information family must
			// not hand a nameless connection anyone's hand (identity for the other families).
			await Clients.Caller.SendAsync("GameStateChanged",
				gameService.GameState is { } joinState
					? GameFamilies.For(joinState.GameType).ProjectFor(joinState, null)
					: gameService.GameState);
		}
		catch (Exception ex)
		{
			_logger?.LogError(ex, "Error in JoinGame");
			await Clients.Caller.SendAsync("Error", "GAME_JOIN_ERROR");
		}
	}

	public async Task JoinGameWithAuth(string gameId, string playerId, string playerSecretId)
	{
		try
		{
			var game = await _gameRepository.LoadGameAsync(gameId);
			if (game == null)
			{
				await Clients.Caller.SendAsync("Error", "GAME_NOT_FOUND");
				return;
			}

			var player = game.Players.FirstOrDefault(p => p.Id == playerId);
			if (player == null)
			{
				await Clients.Caller.SendAsync("Error", "PLAYER_NOT_FOUND");
				return;
			}

			// 🔐 CRITICAL: Verify playerSecretId matches
			if (player.PlayerSecretId != playerSecretId)
			{
				await Clients.Caller.SendAsync("Error", "INVALID_CREDENTIALS");
				_logger?.LogWarning("SECURITY: Authentication failed for player {PlayerId} in game {GameId}", playerId, gameId);
				return;
			}

			// ✅ Authentication successful
			_registry.MapConnectionToGame(Context.ConnectionId, gameId);
			_registry.AuthenticateConnection(Context.ConnectionId, playerId);

			// Every authenticated (re)join hands the caller their RE-ENTRY code, privately —
			// the account-less recovery key (see ClaimSeatByRejoinCode). Games created before
			// the feature get one minted on first contact.
			if (string.IsNullOrEmpty(player.RejoinCode))
			{
				game = game with
				{
					Players = game.Players
						.Select(p => p.Id == playerId ? p with { RejoinCode = IdGenerator.RejoinCode() } : p)
						.ToList(),
				};
				game = await _gameRepository.UpdateGameAsync(game);
				_registry.CacheDocument(gameId, game);
				player = game.Players.First(p => p.Id == playerId);
			}

			await Groups.AddToGroupAsync(Context.ConnectionId, gameId);

			_logger?.LogDebug("JoinGameWithAuth: gameId={GameId}, status={Status}, hasGameState={HasGameState}", gameId, game.Status, game.GameState != null);

			// If game is still in lobby, send lobby state
			if (game.Status == GameStatus.WaitingForPlayers)
			{
				// A player authenticated to a table with no match running IS in its waiting room,
				// whichever page they are looking at. Putting them in that group is what makes the
				// table live for them: the roster as people arrive, and the host's next match.
				_registry.MapLobbyConnection(Context.ConnectionId, gameId);
				await Groups.AddToGroupAsync(Context.ConnectionId, $"lobby_{gameId}");

				_logger?.LogDebug("Game {GameId} still in lobby, sending LobbyState", gameId);
				// The whole sanitized table, exactly as LobbyUpdated sends it. It used to be a
				// bespoke roster payload, which meant every field the table view needed — the invite
				// code, the shared deck, the team count — had to be added to it one at a time while
				// the very same document was already being broadcast on the next change.
				await Clients.Caller.SendAsync("LobbyState", game.Sanitized());
				await Clients.Caller.SendAsync("GameJoined", new { GameId = gameId, PlayerId = playerId, RejoinCode = player.RejoinCode });
				return;
			}

			// If no active GameService but game is Active, restore it
			if (!_registry.HasService(gameId) && game.Status == GameStatus.Active)
			{
				_logger?.LogInformation("Restoring GameService for active game {GameId}", gameId);
				var gameService = _gameServiceFactory.Create();
				gameService.ConfigureSettings(game.Settings);

				if (game.GameState != null)
				{
					// Rehydrate the full persisted snapshot so play resumes exactly where
					// it left off (positions, money, properties, ownership, current turn…).
					await gameService.RestoreGameAsync(game.GameState);

					// A package game's rent rules + sounds live in the package files, not the snapshot:
					// re-stage the package (shipped by id / uploaded from blob) under its existing token
					// so sounds re-register and rent rules are re-attached.
					var definition = await _packageRestorer.ReStageAsync(game);
					if (definition != null)
					{
						gameService.AttachPackageDefinition(definition);
					}

					// Re-apply the host's house-rule choices over the package defaults, exactly as
					// StartGame does — otherwise settings driven by RuleValues (e.g. the auction bid
					// timeout) revert to the default on every restart. Also repairs games started before
					// the effective settings were persisted, since RuleValues are stored on the document.
					gameService.ConfigureSettings(GameDefinitionAdapter.EffectiveSettings(game, definition));
				}
				else
				{
					// An Active game always has a persisted snapshot; without one there is nothing to
									 // restore (and no built-in board path any more). Log and return rather than fabricate
					// a fresh board that would silently reset everyone's progress.
					_logger?.LogError("Active game {GameId} has no GameState snapshot; cannot restore.", gameId);
					await Clients.Caller.SendAsync("Error", "GAME_RESTORE_FAILED");
					return;
				}

				_registry.RegisterService(gameId, gameService);
				// Bot seats survive restarts like any player: re-attach their driver.
				_botDriver?.Attach(gameId, gameService);
				// Seed the persistence cache with the loaded document so per-command writes
				// reuse it instead of re-reading from Cosmos every turn.
				_registry.CacheDocument(gameId, game);
				_logger?.LogInformation("GameService restored for {GameId}", gameId);

				// If the game was frozen mid-auction, its per-second bid timer died with the
				// evicted in-memory game. Restart it so the countdown resumes; give it a fresh
				// bid window (the persisted phase-start may be minutes old while everyone was
				// away) so it doesn't expire the instant play resumes.
				var restoredAuction = gameService.GameState?.ActiveAuction;
				if (restoredAuction != null && restoredAuction.IsActive)
				{
					restoredAuction.CurrentPhaseStartedAt = DateTime.UtcNow;
					_auctionTimerService.StartTimers(gameId, gameService.Settings, restoredAuction);
					_logger?.LogInformation("Restarted auction timer for restored game {GameId}", gameId);
				}
			}

			// Send current game state
			if (_registry.TryGetService(gameId, out var gs))
			{
				if (gs.GameState is { } liveState)
				{
					// The document is authoritative for this platform switch. Keeping the restored
					// snapshot in step also repairs games saved before voice chat existed.
					liveState.VoiceChatEnabled = game.VoiceChatEnabled;
				}
				// An authenticated rejoin means this player is back online: flip the flag and
				// announce it (no-op on the initial join, where the flag is already true).
				// Done BEFORE sending the state so the caller's own snapshot shows them connected.
				await gs.SetPlayerConnectedAsync(playerId, true);

				_logger?.LogDebug("Sending GameStateChanged with {SquareCount} squares", gs.GameState?.Squares?.Count ?? 0);
				// The (re)joining player receives THEIR projection of the state — identity for
				// families without hidden information.
				await Clients.Caller.SendAsync("GameStateChanged",
					gs.GameState is { } authState
						? GameFamilies.For(authState.GameType).ProjectFor(authState, playerId)
						: gs.GameState);
			}

			// The chat history lives on the document (not in GameState, so state broadcasts
			// don't re-send it): hand the caller the conversation once per (re)join.
			if (game.ChatMessages.Count > 0)
			{
				await Clients.Caller.SendAsync("ChatHistory", game.ChatMessages);
			}

			await Clients.Caller.SendAsync("GameJoined", new { GameId = gameId, PlayerId = playerId, RejoinCode = player.RejoinCode });
			_logger?.LogInformation("Player {PlayerId} successfully authenticated and joined game {GameId}", playerId, gameId);
		}
		catch (Exception ex)
		{
			_logger?.LogError(ex, "Error in JoinGameWithAuth");
			await Clients.Caller.SendAsync("Error", "GAME_AUTH_ERROR");
		}
	}
}
