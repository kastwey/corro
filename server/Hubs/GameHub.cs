using System.Collections.Concurrent;
using CorroServer.Models;
using CorroServer.Services;
using CorroServer.Services.Corro;
using CorroServer.Services.Corro.Families;
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
	private readonly Services.Bots.BotDriver? _botDriver;

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
		Services.Bots.BotDriver? botDriver = null)
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
	}

	// ============================================
	// CONNECTION LIFECYCLE
	// ============================================

	public override async Task OnDisconnectedAsync(Exception? exception)
	{
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
			if (hadGame && _registry.TryGetService(gameId, out var gameService)
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
				_logger?.LogDebug("Game {GameId} still in lobby, sending LobbyState", gameId);
				await Clients.Caller.SendAsync("LobbyState", new
				{
					GameId = gameId,
					Status = game.Status.ToString(),
					Players = game.Players.Select(p => new { p.Id, p.Name, p.Token, p.IsHost, p.IsReady }).ToList()
				});
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
