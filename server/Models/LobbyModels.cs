using System.Text.Json.Serialization;

namespace CorroServer.Models;

// Player information in the lobby/game
public record LobbyPlayer
{
	public required string Id { get; init; }
	public required string Name { get; init; }
	public required string Token { get; init; }
	/// <summary>The race-board seat (squadron/colour) this player picked in the lobby; null on
	/// property boards or when the player left the choice to the game start (first free seat).</summary>
	public string? SeatId { get; init; }
	public bool IsHost { get; init; }
	public bool IsReady { get; init; }
	/// <summary>A machine-driven seat the HOST added while waiting (see Services/Bots). Bots
	/// never connect or authenticate: no secret, no re-entry code.</summary>
	public bool IsBot { get; init; }
	/// <summary>Journey team mode: the team (0-based) the HOST placed this player in while
	/// waiting; null = still in the unassigned pool. Public — the whole room watches the
	/// arrangement.</summary>
	public int? TeamIndex { get; init; }
	public DateTime JoinedAt { get; init; } = DateTime.UtcNow;

	// Secret ID for secure authentication - not publicly exposed
	public required string PlayerSecretId { get; init; }

	/// <summary>The player's personal RE-ENTRY code (8 unambiguous characters): typed in the
	/// lobby's code box it reclaims THIS seat from any browser, as long as nobody is connected
	/// on it (see GameHub.ClaimSeatByRejoinCode). It is a credential: persisted with the game,
	/// shown only to its own player, and stripped from every client-bound document.</summary>
	public string? RejoinCode { get; init; }
}

// DTOs for the unified API.
public record CreateGameRequest
{
	public required string HostName { get; init; }
	public required string HostToken { get; init; }
	/// <summary>Language used for package content that is selected once per game (for example,
	/// trivia questions). Unsupported or missing values fall back to English.</summary>
	public string Language { get; init; } = "en";
	public int MaxPlayers { get; init; } = 8;
	public string Board { get; init; } = "imperio-galactico";
	public GameSettings? Settings { get; init; }
	/// <summary>Token of an uploaded .corro package (from /api/packages); set for a package game.</summary>
	public string? PackageToken { get; init; }
	/// <summary>The host's chosen values for the package's declared smallBuilding rules (ruleId -> value).
	/// Applied server-side via the rule catalog over the package defaults. Null for built-in boards.</summary>
	public Dictionary<string, System.Text.Json.JsonElement>? RuleValues { get; init; }
	/// <summary>The host's chosen race-board seat (squadron/colour); null for property boards.</summary>
	public string? HostSeatId { get; init; }
	/// <summary>Classic pairs mode (race boards with four seats): opposite seats are partners.
	/// The game then needs exactly four players to start.</summary>
	public bool RaceTeams { get; init; }

	/// <summary>Journey team mode: how many equal-size teams (a divisor of MaxPlayers with at
	/// least two members each). Null/0 = individual play. Team mode makes MaxPlayers EXACT:
	/// the game only starts full, everyone placed in a team by the host.</summary>
	public int? TeamCount { get; init; }
}

/// <summary>Host request: place a player in a journey team (or back in the pool with null).</summary>
public record AssignTeamRequest
{
	public required string GameId { get; init; }
	public required string HostId { get; init; }
	public required string PlayerId { get; init; }
	/// <summary>0-based team; null returns the player to the unassigned pool.</summary>
	public int? TeamIndex { get; init; }
}

/// <summary>Host request: seat a bot in the waiting room (families with a bot policy only).</summary>
public record AddBotRequest
{
	public required string GameId { get; init; }
	public required string HostId { get; init; }
	/// <summary>The bot's name, chosen (or rolled from the silly-name hat) by the host;
	/// null/blank falls back to the plain "Bot N".</summary>
	public string? Name { get; init; }
}

/// <summary>Host request: remove a previously added bot from the waiting room.</summary>
public record RemoveBotRequest
{
	public required string GameId { get; init; }
	public required string HostId { get; init; }
	public required string PlayerId { get; init; }
}

public record CreateGameResponse
{
	public required string GameId { get; init; }
	public required string InviteCode { get; init; }
	public required GameDocument Game { get; init; }
	public required string HostSecretId { get; init; }
	/// <summary>The host's personal re-entry code (private to the caller).</summary>
	public required string HostRejoinCode { get; init; }
}

public record JoinGameRequest
{
	public required string GameId { get; init; }
	public required string PlayerName { get; init; }
	public required string PlayerToken { get; init; }
	/// <summary>The joiner's chosen race-board seat (squadron/colour); null for property boards.</summary>
	public string? SeatId { get; init; }
}

public record JoinGameResponse
{
	public required string PlayerId { get; init; }
	public required string PlayerSecretId { get; init; }
	public required GameDocument Game { get; init; }
	/// <summary>The joiner's personal re-entry code (private to the caller).</summary>
	public required string RejoinCode { get; init; }
}

/// <summary>A seat successfully reclaimed with a re-entry code: the FULL fresh session.
/// The secret id is newly rotated, so any older browser session is invalidated; the
/// re-entry code itself stays stable (it is the player's durable key).</summary>
public record SeatClaimedResponse
{
	public required string GameId { get; init; }
	public required string PlayerId { get; init; }
	public required string PlayerSecretId { get; init; }
	public required string PlayerName { get; init; }
	public required string Token { get; init; }
	public bool IsHost { get; init; }
	public required string Board { get; init; }
	public required GameStatus Status { get; init; }
	public required string RejoinCode { get; init; }
}

public record StartGameRequest
{
	public required string GameId { get; init; }
	public required string HostId { get; init; }
}

public record StartGameResponse
{
	public required string GameId { get; init; }
	public required GameDocument Game { get; init; }
}

// Live information about a game the user has saved locally, used to populate the
// "your games" list in the lobby (status + who is currently connected).
public record SavedGameInfo
{
	public required string GameId { get; init; }
	public required GameStatus Status { get; init; }
	public required string Board { get; init; }
	public required string HostId { get; init; }
	public int MaxPlayers { get; init; }
	public DateTime CreatedAt { get; init; }
	public List<SavedGamePlayerInfo> Players { get; init; } = new();
}

public record SavedGamePlayerInfo
{
	public required string Id { get; init; }
	public required string Name { get; init; }
	public required string Token { get; init; }
	public bool IsHost { get; init; }
	public bool Connected { get; init; }
}
