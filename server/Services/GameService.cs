using System.Diagnostics;
using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Commands;
using CorroServer.Services.Corro;
using CorroServer.Services.Corro.Families;
using CorroServer.Services.Rules;

namespace CorroServer.Services;

public class GameService : IGameService, IGamePresenter, IDisposable
{
	// Injected dependencies.
	private readonly ICorroRulebook _rulebook;
	private readonly CommandDispatcher _commandDispatcher;
	private readonly ILogger<GameService>? _logger;
	private readonly IGameAnnouncer _announcer;

	// Serializes command execution so concurrent SignalR invocations cannot
	// corrupt the shared, non-thread-safe GameState (one game = one lock).
	private readonly SemaphoreSlim _commandLock = new(1, 1);

	// Internal state (created during initialization)
	private GameState? _gameState;
	private GameStateHelper? _gameHelper;
	private GameSettings _settings = new(); // Default settings
											// The board's rent rules. Classic Corro by default; a game created from a .corro
											// definition supplies the package's rules. Flows into every command's GameContext.
	private RulesConfig _rentRules = RulesConfig.ClassicRules;
	// The family's board + rules (race circuit, track…), created by the game's family at start /
	// package re-attach. Null for the property family (its board lives in GameState.Squares).
	private IFamilyRuntime? _familyRuntime;

	// While a command runs, announcements are buffered here so they can be flushed as ONE
	// ordered batch (OnGameEvents) instead of one SignalR message each. Null outside a
	// command; announcements raised then (e.g. game end) flush immediately as a batch-of-one.
	// Commands are serialized by _commandLock, so this needs no extra synchronization.
	private List<AnnouncementDispatch>? _pendingBatch;

	public GameState? GameState => _gameState;
	public GameSettings Settings => _settings;

	/// <summary>
	/// Configure game settings (should be called before initializing the game)
	/// </summary>
	public void ConfigureSettings(GameSettings settings)
	{
		_settings = settings ?? new GameSettings();
	}

	public string GameId { get; private set; }
	public bool IsGameActive { get; private set; }

	public event Func<GameState, Task> OnGameStateChanged = delegate { return Task.CompletedTask; };
	public event Func<IReadOnlyList<AnnouncementDispatch>, Task> OnGameEvents = delegate { return Task.CompletedTask; };
	public event Func<Square, Task> OnSquareChanged = delegate { return Task.CompletedTask; };
	public event Func<CardDrawnNotification, Task> OnCardDrawn = delegate { return Task.CompletedTask; };

	/// <summary>
	/// Constructor with dependency injection (preferred for testing)
	/// </summary>
	public GameService(
		ICorroRulebook rulebook,
		IAuctionRulebook auctionRulebook,
		string? gameId = null,
		ILogger<GameService>? logger = null)
	{
		_rulebook = rulebook ?? throw new ArgumentNullException(nameof(rulebook));
		_commandDispatcher = new CommandDispatcher(rulebook, auctionRulebook);
		_logger = logger;
		GameId = gameId ?? Guid.NewGuid().ToString();
		// Per-game announcer. During a command the sink buffers dispatches into the current
		// batch; the batch is flushed as one OnGameEvents stream when the command ends. An
		// announcement raised outside a command flushes immediately as a batch-of-one.
		_announcer = new GameAnnouncer(dispatch =>
		{
			var batch = _pendingBatch;
			if (batch != null)
			{
				batch.Add(dispatch);
				return Task.CompletedTask;
			}
			return OnGameEvents(new[] { dispatch });
		}, logger);
	}

	/// <summary>
	/// Initialize a game from a loaded .corro <see cref="GameDefinition"/>: the board, settings
	/// and rent rules all come from the package (board names resolved for <paramref name="lang"/>,
	/// with the per-locale names carried for the client). The rulebook then drives it generically.
	/// </summary>
	public async Task InitializeFromDefinitionAsync(List<Player> players, GameDefinition definition, string lang = "en", GameSettings? settings = null, bool raceTeams = false, Dictionary<string, System.Text.Json.JsonElement>? ruleValues = null, List<List<string>>? teams = null)
	{
		if (IsGameActive)
		{
			throw new InvalidOperationException("Game is already active");
		}

		// The game's family builds the initial state (and its runtime); the plumbing below —
		// turns, announcements, persistence — is identical for every family.
		var family = GameFamilies.For(definition.Manifest.GameType);
		var game = family.CreateGame(new FamilyStartContext
		{
			Players = players,
			Definition = definition,
			Lang = lang,
			Settings = settings,
			RaceTeams = raceTeams,
			RuleValues = ruleValues,
			Teams = teams,
			Random = _rulebook.RandomSource,
		});

		_gameState = game.State;
		_familyRuntime = game.Runtime;
		if (game.Settings is { } familySettings)
		{
			_settings = familySettings;
		}

		if (game.RentRules is { } rentRules)
		{
			_rentRules = rentRules;
		}

		_gameHelper = new GameStateHelper(_gameState);
		IsGameActive = true;

		await NotifyStateChangedAsync();
		await AnnounceAsync("game.game_started", new Dictionary<string, object> { ["count"] = players.Count });
		if (game.PostStartAsync is { } postStart)
		{
			await postStart(AnnounceAsync);
		}
	}

	/// <summary>
	/// Rehydrate a previously persisted game (e.g. after a server restart) by adopting
	/// the saved <see cref="GameState"/> verbatim: player positions, money, properties,
	/// release-pass cards, square ownership / buildings / mortgages, current turn, bank,
	/// card decks and any in-flight state. It does NOT reset anything nor announce a
	/// new game — play simply resumes.
	/// </summary>
	/// <summary>
	/// Re-attach a package's rent rules to a restored game. The persisted snapshot carries the board,
	/// decks and cards, but the rent rules (<c>manifest.rules</c>) live only in the package files, so
	/// after <see cref="RestoreGameAsync"/> a package game must re-derive them here — otherwise rent
	/// falls back to the classic defaults. (Sounds are re-registered by re-staging the package.)
	/// </summary>
	public void AttachPackageDefinition(GameDefinition definition)
	{
		_rentRules = definition.Manifest.Rules;
		var family = GameFamilies.For(definition.Manifest.GameType);
		// A family whose snapshot carries its EFFECTIVE rules (journey: deck + house-rule
		// choices applied at start) rebuilds from the restored state — the re-staged
		// manifest only knows the defaults the host may have overridden in the lobby.
		_familyRuntime = family.SnapshotCarriesRules && _gameState != null
			? family.RuntimeFromState(_gameState) ?? family.CreateRuntime(definition)
			: family.CreateRuntime(definition);
	}

	public Task RestoreGameAsync(GameState savedState)
	{
		if (IsGameActive)
		{
			throw new InvalidOperationException("Game is already active");
		}

		ArgumentNullException.ThrowIfNull(savedState);

		_gameState = savedState;
		_gameHelper = new GameStateHelper(_gameState);
		IsGameActive = true;

		_logger?.LogInformation(
			"GameState restored: {PlayerCount} players, {SquareCount} squares, currentTurn={CurrentTurn}",
			_gameState.Players.Count, _gameState.Squares.Count, _gameState.CurrentTurn);

		return Task.CompletedTask;
	}

	public async Task<ServerResponse> ExecuteCommandAsync(GameCommand command)
	{
		_logger?.LogDebug("ExecuteCommandAsync: type={CommandType}, playerId={PlayerId}", command.GetType().Name, command.PlayerId);

		if (!IsGameActive || _gameState == null || _gameHelper == null)
		{
			_logger?.LogWarning("ExecuteCommandAsync: Game not active (IsGameActive={IsGameActive})", IsGameActive);
			return new ErrorResponse { Message = "Game is not active", Code = "GAME_NOT_ACTIVE" };
		}

		// Serialize per-game so two near-simultaneous commands (e.g. two bids)
		// cannot mutate the shared GameState concurrently.
		await _commandLock.WaitAsync();
		// Buffer this command's announcements so they ship as one ordered batch. A
		// checkpoint (CheckpointTurnSegmentAsync) may swap in a fresh list mid-command to
		// close a segment, so the finally flushes the CURRENT _pendingBatch, not this one.
		_pendingBatch = new List<AnnouncementDispatch>();
		try
		{
			// Create context for command handlers
			var context = new GameContext
			{
				GameState = _gameState,
				Helper = _gameHelper,
				Settings = _settings,
				RentRules = _rentRules,
				// A restored game whose package wasn't re-attached falls back to the snapshot's
				// board (with the family's default rules), like it always did.
				FamilyRuntime = _familyRuntime ?? GameFamilies.For(_gameState.GameType).RuntimeFromState(_gameState),
				Announce = AnnounceAsync,
				Announcer = _announcer,
				Presenter = this,
				Logger = _logger,
				// Lets card effects (e.g. "go back 3 spaces") trigger landing effects
				// without a rulebook ↔ card dependency cycle.
				ProcessLanding = (p, idx, ctx) => _rulebook.ProcessLandingEffectsAsync(p, idx, ctx)
			};

			// Dispatch command to appropriate handler
			var sw = Stopwatch.StartNew();
			var result = await _commandDispatcher.DispatchAsync(command, context);

			// After the command settles, auto-resolve any debts that became payable from
			// cash gained during it (rent received, card collection, GO salary, mortgage /
			// sale proceeds). Announcements append to this command's batch, so they read
			// after the event that produced the cash (e.g. "Eric paid you rent. You cleared
			// your debt."). Works regardless of whose turn it is.
			await _rulebook.SweepResolvableDebtsAsync(context);

			_logger?.LogDebug("ExecuteCommandAsync: type={CommandType} result={ResultType} in {ElapsedMs}ms",
				command.GetType().Name, result.Type, sw.ElapsedMilliseconds);

			return result;
		}
		catch (Exception ex)
		{
			_logger?.LogError(ex, "ExecuteCommandAsync: Exception");
			return new ErrorResponse { Message = ex.Message, Code = "EXECUTION_ERROR" };
		}
		finally
		{
			// Flush before releasing the lock so batches stay strictly ordered between
			// commands. A flush failure must not break command serialization. A checkpoint
			// may have already flushed earlier segments and swapped in a fresh list, so we
			// flush whatever remains in the CURRENT _pendingBatch.
			var remaining = _pendingBatch;
			_pendingBatch = null;
			if (remaining != null && remaining.Count > 0)
			{
				try { await OnGameEvents(remaining); }
				catch (Exception ex) { _logger?.LogError(ex, "ExecuteCommandAsync: failed to flush announcement batch"); }
			}
			_commandLock.Release();
		}
	}

	public Task<GameState> GetGameStateAsync()
	{
		if (_gameState == null)
		{
			throw new InvalidOperationException("Game is not initialized");
		}

		return Task.FromResult(_gameState);
	}

	public async Task EndGameAsync()
	{
		if (!IsGameActive)
		{
			return;
		}

		IsGameActive = false;


		await AnnounceAsync("game.game_ended", null);
		await NotifyStateChangedAsync();
	}

	/// <summary>
	/// Notifies clients that the game state has changed.
	/// Public for command hosts (the Hub and bot driver) so they can call it only after
	/// <see cref="ExecuteCommandAsync"/> has flushed the command's announcement batch.
	/// Command handlers deliberately cannot access this through <see cref="IGamePresenter"/>;
	/// a true mid-command segment must use <see cref="CheckpointTurnSegmentAsync"/>, which
	/// guarantees events before state itself.
	/// </summary>
	public async Task NotifyStateChangedAsync()
	{
		if (_gameState != null)
		{
			await OnGameStateChanged(_gameState);
		}
	}

	/// <summary>
	/// Records a player's live-connection state. The server owns the spoken voice, so the
	/// change is announced here ("X disconnected" / "X reconnected", with actorId so the
	/// rejoining player's client picks the first-person variant), then fresh state is
	/// broadcast so every panel shows who is away. No-op when nothing changed — the initial
	/// join arrives with the flag already true, so it never announces a fake "reconnect".
	/// </summary>
	public async Task SetPlayerConnectedAsync(string playerId, bool connected)
	{
		var player = _gameState?.Players.FirstOrDefault(p => p.Id == playerId);
		if (player == null || player.IsConnected == connected)
		{
			return;
		}

		player.IsConnected = connected;
		// AnnounceAsync applies the actorId → first-person convention: the reconnecting player
		// hears "player_reconnected_self" ("Te has vuelto a conectar…"), everyone else the base
		// line. For a disconnect the actor has no connection, so only the base line is heard.
		await AnnounceAsync(
			connected ? "game.player_reconnected" : "game.player_disconnected",
			new Dictionary<string, object> { ["player"] = player.Name, ["actorId"] = player.Id });
		await NotifyStateChangedAsync();
	}

	/// <summary>
	/// Closes the current turn segment mid-command (IGamePresenter): flushes the
	/// announcements buffered so far as their own ordered batch, swaps in a fresh batch for
	/// the rest of the command, then pushes the current state snapshot. The events go out
	/// BEFORE the state so the client buffers the segment's consequences and arms its hop,
	/// then the state starts that hop. Used by compound card movement to split
	/// "land here → card move → land there" instead of narrating both at once.
	/// </summary>
	public async Task CheckpointTurnSegmentAsync()
	{
		var segment = _pendingBatch;
		// Subsequent announcements (the next segment) accumulate into a new list; the
		// command's finally flushes it. Swap BEFORE flushing so the sink never re-enters
		// the list we are about to ship.
		_pendingBatch = new List<AnnouncementDispatch>();
		if (segment != null && segment.Count > 0)
		{
			await OnGameEvents(segment);
		}

		await NotifyStateChangedAsync();
	}

	/// <summary>Notifies clients that a single square's visual state changed (IGamePresenter).</summary>
	public Task NotifySquareChangedAsync(Square square) => OnSquareChanged(square);

	/// <summary>Reveals a drawn Chance / Community card to clients (IGamePresenter).</summary>
	public Task NotifyCardDrawnAsync(CardDrawnNotification notification) => OnCardDrawn(notification);

	private async Task AnnounceAsync(string key, Dictionary<string, object>? vars = null)
	{
		// Applies the actorId -> first-person (_self) convention in one place.
		await _announcer.Announce(key, vars);
	}

	public void Dispose()
	{
		_commandLock.Dispose();
	}
}
