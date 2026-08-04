using System.Text.Json;
using System.Text.Json.Serialization;

namespace CorroServer.Models;

// Primary persisted document shared by lobbies and active games.
public record GameDocument
{
	[JsonPropertyName("id")]
	public required string Id { get; init; } // Cosmos DB requires the lowercase "id" field.

	[JsonPropertyName("gameId")]
	public required string GameId { get; init; }

	[JsonPropertyName("status")]
	public required GameStatus Status { get; init; }

	[JsonPropertyName("hostId")]
	public required string HostId { get; init; }

	[JsonPropertyName("players")]
	public List<LobbyPlayer> Players { get; init; } = new();

	[JsonPropertyName("maxPlayers")]
	public int MaxPlayers { get; init; } = 8;

	/// <summary>
	/// People asked to this table, and people asking to be let in. Both live HERE rather than in a
	/// store of their own, because both are facts about this table: they survive a reload, they
	/// reach somebody who was away when they were made, and they expire without anybody sweeping up
	/// — a table that fills, starts or is deleted takes them with it.
	/// </summary>
	[JsonPropertyName("invitations")]
	public List<TableInvitation> Invitations { get; init; } = new();

	[JsonPropertyName("joinRequests")]
	public List<TableJoinRequest> JoinRequests { get; init; } = new();

	/// <summary>Whether somebody else could still sit down: waiting, and not yet full. Bots hold
	/// seats like anybody else, so they count.</summary>
	[JsonIgnore]
	public bool HasRoom => Status == GameStatus.WaitingForPlayers && Players.Count < MaxPlayers;

	[JsonPropertyName("board")]
	public string Board { get; init; } = string.Empty;

	/// <summary>Host-selected package-content language. It may change while waiting and is fixed
	/// when game start resolves the authoritative content deck.</summary>
	[JsonPropertyName("language")]
	public string Language { get; init; } = "en";

	/// <summary>The content languages this package offers (see IGameFamily.ContentLanguages).
	/// Persisted with the waiting room so the host can change the shared deck before starting
	/// without depending on transient package staging; empty when content is not language-split.</summary>
	[JsonPropertyName("contentLanguages")]
	public List<string> ContentLanguages { get; init; } = new();

	/// <summary>Token of the staged .corro package (null for a built-in board).</summary>
	[JsonPropertyName("packageToken")]
	public string? PackageToken { get; init; }

	/// <summary>
	/// The family this table is set up to play ("property", "exploding", "forbidden"…), taken from
	/// the staged package when the table is created. A table knows what game it is FOR even while
	/// no match is running, which is what lets its own page offer the family's setup — a bot chair
	/// where bots exist, and nothing where they don't — without staging the package to ask.
	/// </summary>
	[JsonPropertyName("gameType")]
	public string? GameType { get; init; }

	/// <summary>For a shipped board: its package id, so the game can be re-staged from server/Packages
	/// on restore (after a restart). Null for an uploaded board.</summary>
	[JsonPropertyName("shippedBoardId")]
	public string? ShippedBoardId { get; init; }

	/// <summary>For an uploaded board: the durable blob key holding its .corro archive, so the game
	/// can be re-staged from blob storage on restore. Null for a shipped board.</summary>
	[JsonPropertyName("packageBlobKey")]
	public string? PackageBlobKey { get; init; }

	/// <summary>Classic pairs mode for a race board (host's lobby choice): opposite seats are
	/// partners; requires exactly four players to start.</summary>
	[JsonPropertyName("raceTeams")]
	public bool RaceTeams { get; init; }

	/// <summary>Journey team mode: how many equal-size teams (a divisor of MaxPlayers, at
	/// least two members each). Null/0 = individual play. With teams, MaxPlayers is EXACT:
	/// the game starts full, every player placed in a team by the host (LobbyPlayer.TeamIndex).</summary>
	[JsonPropertyName("teamCount")]
	public int? TeamCount { get; init; }

	/// <summary>Whether the host has made the deployment's optional voice room available to
	/// this game. Joining remains opt-in for every player; media never enters the game state.</summary>
	[JsonPropertyName("voiceChatEnabled")]
	public bool VoiceChatEnabled { get; init; }

	/// <summary>In-game chat history (capped; oldest dropped first). Persisted with the game so a
	/// reconnecting player gets the conversation back. Stored OUTSIDE GameState on purpose: state
	/// broadcasts must not re-send the whole chat on every move. NOT encrypted at rest beyond
	/// Cosmos defaults — the UI shows players a disclaimer that a database admin could read it.</summary>
	[JsonPropertyName("chatMessages")]
	public List<ChatMessage> ChatMessages { get; init; } = new();

	/// <summary>The host's chosen values for the package's declared smallBuilding rules (ruleId -> value),
	/// applied over the package defaults when the game starts. Null for a built-in board.</summary>
	[JsonPropertyName("ruleValues")]
	public Dictionary<string, JsonElement>? RuleValues { get; init; }

	[JsonPropertyName("settings")]
	public GameSettings Settings { get; init; } = new();

	[JsonPropertyName("inviteCode")]
	public required string InviteCode { get; init; }

	[JsonPropertyName("createdAt")]
	public DateTime CreatedAt { get; init; } = DateTime.UtcNow;

	[JsonPropertyName("lastUpdated")]
	public DateTime LastUpdated { get; init; } = DateTime.UtcNow;

	[JsonPropertyName("gameState")]
	public GameState? GameState { get; init; } // Null while the lobby is waiting for players.

	/// <summary>
	/// The snapshot of the match that just finished, kept after it is retired — the same state the
	/// end screen is built from, so the result survives the match that produced it and a player who
	/// reconnects afterwards still learns how it ended.
	///
	/// This is where the live snapshot MOVES on game over: the table stops playing (GameState back to
	/// null) without losing what happened, and at roughly no cost in document size. Cleared when the
	/// next match starts, because by then there is a game to look at instead.
	/// </summary>
	[JsonPropertyName("lastMatch")]
	public GameState? LastMatch { get; init; }

	/// <summary>How many matches this table has finished. Ordinal for the next one, and the honest
	/// way to tell a table that has never played from one between games.</summary>
	[JsonPropertyName("matchesPlayed")]
	public int MatchesPlayed { get; init; }

	/// <summary>
	/// Copy safe to SEND TO CLIENTS: every player's credentials (secret id, re-entry code)
	/// are stripped. Persistence always stores the full document; any hub message carrying
	/// a GameDocument (LobbyUpdated, create/join/start responses) must go through this —
	/// broadcasting the raw document would hand every lobby member the other players'
	/// keys, including the re-entry code that can take over their seat.
	/// The embedded snapshot travels in payloads that are NOT per-player, so a
	/// hidden-information family exposes only its PUBLIC state projection here (families
	/// without hidden information pass through untouched).
	/// </summary>
	public GameDocument Sanitized() => this with
	{
		// The account id goes no further than the server. It was being sent to every client at the
		// table and used by none of them: an opaque string, but a STABLE one, so it would let
		// anybody keep a note of it and recognise the same person at every other table for as long
		// as the account exists. What a table actually needs is whether a seat could accept a
		// friend request, which is a boolean.
		Players = Players.Select(p => p with
		{
			PlayerSecretId = "",
			RejoinCode = null,
			HasAccount = p.UserId is { Length: > 0 },
			UserId = null,
		}).ToList(),
		// The same rule as a seat: who was invited is stored, and the ACCOUNT behind them is not
		// sent anywhere. The public names are what a table shows and what the invited player
		// answers with.
		Invitations = Invitations.Select(i => i with { UserId = null }).ToList(),
		JoinRequests = JoinRequests.Select(r => r with { UserId = null }).ToList(),
		GameState = GameState is null ? null
			: Services.Corro.Families.GameFamilies.For(GameState.GameType).ProjectFor(GameState, null),
		// A finished match is projected exactly like a live one. Nothing in the end screen needs a
		// rival's hand, and "the game is over" is not a reason to relax the family's own contract.
		LastMatch = LastMatch is null ? null
			: Services.Corro.Families.GameFamilies.For(LastMatch.GameType).ProjectFor(LastMatch, null),
	};
}

// Shared lobby and game lifecycle states.
[JsonConverter(typeof(JsonStringEnumConverter))]
public enum GameStatus
{
	WaitingForPlayers,  // Lobby accepting players.
	Starting,           // Lobby starting (transition)
	Active,             // Game in progress.
	Paused,             // Game paused.
	Completed,          // Game completed.
	Abandoned           // Game abandoned.
}

/// <summary>One in-game chat message. PlayerName is denormalized at send time so history
/// renders without a player lookup (and survives a player leaving).</summary>
public record ChatMessage
{
	[JsonPropertyName("id")]
	public required string Id { get; init; }

	[JsonPropertyName("playerId")]
	public required string PlayerId { get; init; }

	[JsonPropertyName("playerName")]
	public required string PlayerName { get; init; }

	[JsonPropertyName("text")]
	public required string Text { get; init; }

	[JsonPropertyName("sentAt")]
	public DateTime SentAt { get; init; } = DateTime.UtcNow;
}

/// <summary>
/// Game configuration settings - stored in CosmosDB with the game.
/// Defaults reproduce the standard board rules; the optional smallBuilding rules default OFF.
/// </summary>
public record GameSettings
{
	// ── Auction timing ────────────────────────────────────────────────────────

	/// <summary>
	/// Time before auction closes if no one bids (default: 20 seconds)
	/// </summary>
	[JsonPropertyName("auctionBidTimeoutSeconds")]
	public int AuctionBidTimeoutSeconds { get; init; } = 20;

	/// <summary>
	/// The advertised opening price of an auction (default: 1). Bidding still starts from 0, so
	/// any bid of at least this much wins an otherwise-unbid lot. Parametrised for other boards.
	/// </summary>
	[JsonPropertyName("auctionStartingPrice")]
	public int AuctionStartingPrice { get; init; } = 1;

	// ── Money ─────────────────────────────────────────────────────────────────

	/// <summary>
	/// Starting money for each player (default: 1500)
	/// </summary>
	[JsonPropertyName("startingMoney")]
	public int StartingMoney { get; init; } = 1500;

	/// <summary>
	/// Money received when passing GO (default: 200)
	/// </summary>
	[JsonPropertyName("goBonus")]
	public int GoBonus { get; init; } = 200;

	/// <summary>
	/// SmallBuilding rule: landing exactly on GO pays double the GO bonus (default: false).
	/// </summary>
	[JsonPropertyName("doubleGoSalary")]
	public bool DoubleGoSalary { get; init; } = false;

	// ── Dice ──────────────────────────────────────────────────────────────────

	/// <summary>Use the bonus die after each player completes their first lap.</summary>
	[JsonPropertyName("useBonusDie")]
	public bool UseBonusDie { get; init; } = false;

	// ── Free Parking ────────────────────────────────────────────────────────────

	/// <summary>
	/// SmallBuilding rule: taxes and fines accumulate in the Free Parking pot and are
	/// collected by whoever lands on Free Parking (default: false = money goes to the bank).
	/// </summary>
	[JsonPropertyName("freeParkingJackpot")]
	public bool FreeParkingJackpot { get; init; } = false;

	// ── Auction on decline ──────────────────────────────────────────────────────

	/// <summary>
	/// Official rule: an unbought property is put up for auction when its purchase is
	/// declined (default: true). When false, declining simply ends the buy offer.
	/// </summary>
	[JsonPropertyName("auctionOnDecline")]
	public bool AuctionOnDecline { get; init; } = true;

	// ── Building ────────────────────────────────────────────────────────────────

	/// <summary>
	/// Official rule: the bank stocks only 32 smallBuildings and 12 bigBuildings (default: true).
	/// </summary>
	[JsonPropertyName("buildingShortage")]
	public bool BuildingShortage { get; init; } = true;

	/// <summary>
	/// Official rule: smallBuildings must be built evenly across a colour group (default: true).
	/// </summary>
	[JsonPropertyName("evenBuildRule")]
	public bool EvenBuildRule { get; init; } = true;

	/// <summary>
	/// SmallBuilding rule: no buildings may be erected until a player completes their first
	/// lap around the board (default: false).
	/// </summary>
	[JsonPropertyName("noBuildingFirstLap")]
	public bool NoBuildingFirstLap { get; init; } = false;

	/// <summary>
	/// How many smallBuildings the bank stocks (default: 32). Only enforced when
	/// <see cref="BuildingShortage"/> is on. Parametrised for non-Corro boards.
	/// </summary>
	[JsonPropertyName("maxSmallBuildings")]
	public int MaxSmallBuildings { get; init; } = 32;

	/// <summary>
	/// How many bigBuildings the bank stocks (default: 12). Only enforced when
	/// <see cref="BuildingShortage"/> is on. Parametrised for non-Corro boards.
	/// </summary>
	[JsonPropertyName("maxBigBuildings")]
	public int MaxBigBuildings { get; init; } = 12;

	/// <summary>
	/// Percentage of the build cost the bank refunds when a building is sold back (default: 50).
	/// Parametrised for non-Corro boards.
	/// </summary>
	[JsonPropertyName("buildingSellbackPercent")]
	public int BuildingSellbackPercent { get; init; } = 50;

	/// <summary>
	/// How many small constructions combine into the big one (default: 4, as in the classic 4 smallBuildings
	/// then a bigBuilding). A board can set 5 (or another value); the build logic and the property rent
	/// table length (base + levels + big) follow it. Persisted so a restored game keeps the rule.
	/// </summary>
	[JsonPropertyName("buildingLevels")]
	public int BuildingLevels { get; init; } = 4;

	// ── Mortgage ────────────────────────────────────────────────────────────────

	/// <summary>
	/// Interest percentage charged when lifting a mortgage (default: 10).
	/// </summary>
	[JsonPropertyName("mortgageInterestRate")]
	public int MortgageInterestRate { get; init; } = 10;

	/// <summary>
	/// Percentage of a property's price the bank pays to mortgage it — i.e. the mortgage value
	/// (default: 50). Parametrised for non-Corro boards.
	/// </summary>
	[JsonPropertyName("mortgageValuePercent")]
	public int MortgageValuePercent { get; init; } = 50;

	// ── Rent ──────────────────────────────────────────────────────────────────

	/// <summary>
	/// Multiplier applied to the base rent of an UNIMPROVED property when the owner holds the
	/// whole colour group (default: 2 — the classic game "double rent"). Parametrised for other boards.
	/// </summary>
	[JsonPropertyName("unimprovedFullGroupRentMultiplier")]
	public int UnimprovedFullGroupRentMultiplier { get; init; } = 2;

	// ── Holding ────────────────────────────────────────────────────────────────────

	/// <summary>
	/// Cost to pay the release cost and leave holding (default: 50).
	/// </summary>
	[JsonPropertyName("holdingReleaseCost")]
	public int HoldingReleaseCost { get; init; } = 50;

	/// <summary>
	/// Maximum turns a player may stay in holding before being forced to pay the release cost (default: 3).
	/// </summary>
	[JsonPropertyName("maxHoldingTurns")]
	public int MaxHoldingTurns { get; init; } = 3;

	/// <summary>
	/// Official rule: a player in holding still collects rent on their properties
	/// (default: true). When false, a held landlord earns no rent.
	/// </summary>
	[JsonPropertyName("collectRentWhileHeld")]
	public bool CollectRentWhileHeld { get; init; } = true;
}

