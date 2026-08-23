using CorroServer.Models;

namespace CorroServer.Services;

// ============================================
// GAME SERVICE INTERFACES
// ============================================

public interface IGameStateHelper
{
	Player? GetPlayer(string playerId);
	int GetPlayerMoney(string playerId);
	void SetPlayerMoney(string playerId, int amount);
	void AddPlayerMoney(string playerId, int amount);
	void SetPlayerPosition(string playerId, int position);
	int GetBankMoney();
	void SetBankMoney(int amount);
	void AddPlayerReleasePass(string playerId);
	void RemovePlayerReleasePass(string playerId);
	void AddPlayerProperty(string playerId, int squareIndex);
	void RemovePlayerProperty(string playerId, int squareIndex);
	List<Player> GetAllPlayers();
	List<Square> GetSquares();
	Square? GetSquare(int index);
	void SetCurrentTurn(string? playerId);
	Player? GetCurrentPlayer();
	void NextTurn();
	int GetPlayerReleasePasses(string playerId);
	string? GetCurrentTurn();
	(string? Id, string? Name) GetNextTurnInfo(string actingPlayerId);

	// Board operations (moved from IBoardService)
	void LoadBoard(List<BoardData> boardData);

	// Debt management
	string CreateDebt(string debtorId, string? creditorId, int amount, DebtReason reason, string description);
	List<DebtState> GetDebtsFor(string playerId);
	DebtState? GetDebt(string debtId);
	void RemoveDebt(string debtId);
	bool HasPendingDebts(string playerId);
	int GetTotalDebt(string playerId);
	(bool success, string? debtId) TryPay(string payerId, string? recipientId, int amount, DebtReason reason, string description);

	/// <summary>
	/// Returns and clears the set of players whose money increased since the last call.
	/// Used by the post-command debt sweep to auto-resolve recoverable debts.
	/// </summary>
	IReadOnlyCollection<string> DrainMoneyGainers();
}

// ============================================
// GAME SERVICE INTERFACES (Segregated - ISP)
// ============================================

/// <summary>
/// Read-only access to game state. Use when you only need to query state.
/// </summary>
public interface IGameStateReader
{
	GameState? GameState { get; }
	GameSettings Settings { get; }
	string GameId { get; }
	bool IsGameActive { get; }
	Task<GameState> GetGameStateAsync();
}

/// <summary>
/// Command execution capability. Use when you need to modify game state.
/// </summary>
public interface IGameCommandExecutor
{
	Task<ServerResponse> ExecuteCommandAsync(GameCommand command);
	Task NotifyStateChangedAsync();

	/// <summary>
	/// Record a player's live-connection state: flips <see cref="Player.IsConnected"/>,
	/// announces the change to the whole game and broadcasts fresh state. No-op when the
	/// state is unchanged (e.g. the initial join) or the player is unknown.
	/// </summary>
	Task SetPlayerConnectedAsync(string playerId, bool connected);

	event Func<GameState, Task> OnGameStateChanged;
	/// <summary>
	/// Raised once per action with the ordered batch of announcements it produced, so the
	/// client receives a single stream it can render as one coalesced utterance plus its
	/// earcons/visuals. The audience of each dispatch is preserved for per-player rendering.
	/// </summary>
	event Func<IReadOnlyList<AnnouncementDispatch>, Task> OnGameEvents;
	event Func<CardDrawnNotification, Task> OnCardDrawn;

	/// <summary>
	/// Raised for a response the rulebook addressed to the whole table rather than to the
	/// caller — a side effect nobody commanded, such as the auction that opens when a purchase
	/// is declined. Raised from the SERVICE, so it reaches the table whoever ran the command:
	/// the hub for a person, the bot driver for a bot.
	/// </summary>
	event Func<ServerResponse, Task> OnBroadcast;
}

/// <summary>
/// Game lifecycle management. Use for initialization and cleanup.
/// </summary>
public interface IGameLifecycle
{
	/// <summary>Initialize a game from an uploaded .corro package definition (generic engine).
	/// <paramref name="ruleValues"/> carries the host's house-rule choices for families whose
	/// rules live outside <see cref="GameSettings"/> (journey); <paramref name="teams"/> the
	/// journey team seating (each inner list one team, in turn order).</summary>
	Task InitializeFromDefinitionAsync(List<Player> players, Models.Corro.GameDefinition definition, string lang = "en", GameSettings? settings = null, bool raceTeams = false, Dictionary<string, System.Text.Json.JsonElement>? ruleValues = null, List<List<string>>? teams = null);
	void ConfigureSettings(GameSettings settings);
	Task EndGameAsync();

	/// <summary>
	/// Rehydrate a previously persisted game (e.g. after a server restart) from its
	/// saved <see cref="GameState"/>, resuming play exactly where it left off instead
	/// of resetting players to the starting position.
	/// </summary>
	Task RestoreGameAsync(GameState savedState);

	/// <summary>
	/// Re-attach a package's rent rules after restoring a package game (the snapshot has the board and
	/// cards, but the rent rules live in the package files and must be re-derived).
	/// </summary>
	void AttachPackageDefinition(Models.Corro.GameDefinition definition);
}

/// <summary>
/// Full game service interface combining all capabilities.
/// Use this when you need complete access to the game.
/// </summary>
public interface IGameService : IGameStateReader, IGameCommandExecutor, IGameLifecycle
{
}

/// <summary>
/// Factory to create GameService instances with their dependencies
/// </summary>
public interface IGameServiceFactory
{
	IGameService Create(string? gameId = null);
}

// ============================================
// REPOSITORY INTERFACES
// ============================================

public interface IGameRepository
{
	Task<GameDocument?> LoadGameAsync(string gameId);
	Task<bool> DeleteGameAsync(string gameId);

	/// <summary>
	/// Tables that have asked this account to join, or that this account has asked to be let into.
	/// A cross-partition read of the same shape as <c>GetGamesForUserAsync</c>, and for the same
	/// reason: it runs when somebody opens the lobby, and keeping ONE source of truth beats a
	/// per-account index that could still list a table after it stopped existing.
	/// </summary>
	Task<IReadOnlyList<GameDocument>> GetTablesInvitingUserAsync(
		string userId, int maxCount, CancellationToken ct = default);
	/// <summary>Oldest games whose last activity (or creation for legacy documents) precedes a cutoff.</summary>
	IAsyncEnumerable<GameDocument> GetGamesLastUpdatedBeforeAsync(
		DateTime cutoffUtc,
		int maxCount,
		CancellationToken ct = default);
	/// <summary>Whether another persisted game still needs this staged token or durable blob.</summary>
	Task<bool> HasPackageReferenceAsync(
		string? packageToken,
		string? packageBlobKey,
		CancellationToken ct = default);
	/// <summary>All durable uploaded-package blob keys currently referenced by games.</summary>
	Task<IReadOnlySet<string>> GetReferencedPackageBlobKeysAsync(CancellationToken ct = default);
	Task<GameDocument?> GetByInviteCodeAsync(string inviteCode);
	/// <summary>The game holding a player whose re-entry code matches, or null.</summary>
	Task<GameDocument?> GetByRejoinCodeAsync(string rejoinCode);
	/// <summary>
	/// Every table this ACCOUNT holds a seat at, most recently active first. This is what makes a
	/// table belong to a person rather than to a browser: the account-less list lives in the
	/// player's own storage and cannot follow them to another device, and this one can.
	/// </summary>
	Task<IReadOnlyList<GameDocument>> GetGamesForUserAsync(
		string userId,
		int maxCount,
		CancellationToken ct = default);
	/// <summary>
	/// Hand every seat one account holds to another, when two accounts turn out to be one person.
	/// Returns how many moved, which is what the caller reports and logs.
	///
	/// A seat is only ever RE-POINTED: the player id, the secret, the re-entry code and the game
	/// itself are untouched, so nobody at the table sees anything change and a browser already
	/// playing on that seat keeps working.
	/// </summary>
	Task<int> ReassignSeatsAsync(
		string fromUserId,
		string toUserId,
		CancellationToken ct = default);
	Task<GameDocument> CreateGameAsync(GameDocument game);
	Task<GameDocument> UpdateGameAsync(GameDocument game);
}

