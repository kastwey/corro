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

	/// <summary>
	/// The signed-in account that took this seat, or null — which is the normal case and always
	/// will be. Accounts are additive: nothing about sitting down, playing or coming back may ever
	/// require one, so this is recorded when it happens to be known and never demanded.
	///
	/// It is what lets a table belong to a PERSON rather than to a browser: the account's own list
	/// of tables is a query for this field, and re-entry from a new device becomes "this seat is
	/// already mine" instead of "type the code you wrote down". The re-entry code keeps working
	/// regardless — a player may sign in after sitting down, or come back from a browser where
	/// they are not signed in.
	///
	/// NOT a credential, unlike the two fields above: it identifies, it does not authorize. What
	/// authorizes is the session cookie the caller presents, which the server reads for itself and
	/// never takes from the client.
	/// </summary>
	public string? UserId { get; init; }

	/// <summary>
	/// Whether this seat is held by a signed-in account — WITHOUT saying which. It is what
	/// <see cref="UserId"/> is replaced by on the way to a client (see
	/// <c>GameDocument.Sanitized</c>), so the table can offer "ask them to be friends" for a seat
	/// that could accept one, and nobody at the table learns an id that would let them recognise
	/// the same person across every other table they ever sit at.
	/// </summary>
	public bool HasAccount { get; init; }

	/// <summary>
	/// The public name of the account holding this seat, or null when there is none.
	///
	/// Shown to everybody at the table, and deliberately NOT filtered by that player's presence
	/// setting: that setting decides who finds them in a list of strangers, and the people they
	/// dealt into a game are not strangers. A handle is a name chosen to be public; the account
	/// display name, which usually comes from a provider and is often a real name, still is not
	/// published anywhere by this.
	///
	/// Denormalized when the seat is taken, exactly as a chat message keeps its author's name: it
	/// spares a lookup on every broadcast, and a handle can only change once every thirty days, so
	/// a table outliving one is not a case worth a per-render query.
	/// </summary>
	public string? Handle { get; init; }
}

// DTOs for the unified API.
public record CreateGameRequest
{
	public required string HostName { get; init; }
	public required string HostToken { get; init; }
	/// <summary>Language selected for shared package content (for example, a Forbidden Words
	/// deck). Unsupported values are rejected when the package exposes an explicit choice.</summary>
	public string Language { get; init; } = "en";
	public int MaxPlayers { get; init; } = 8;
	public required string Board { get; init; }
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

/// <summary>Host request: deal every player in the room into the teams at random.</summary>
public record FillTeamsRequest
{
	public required string GameId { get; init; }
	public required string HostId { get; init; }
}

/// <summary>Host request: change the one shared content-deck language (the words being
/// guessed, the questions being asked) while the game is still in its waiting room.</summary>
public record SetContentLanguageRequest
{
	public required string GameId { get; init; }
	public required string HostId { get; init; }
	public required string Language { get; init; }
}

/// <summary>Host request: set the board's house-rule values for the NEXT match, from a table
/// with nothing running. Applied over the package defaults when that match starts.</summary>
public record SetTableRulesRequest
{
	public required string GameId { get; init; }
	public required string HostId { get; init; }
	/// <summary>ruleId -> value, exactly as the create form sends it. Null clears them.</summary>
	public Dictionary<string, System.Text.Json.JsonElement>? RuleValues { get; init; }
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
/// <summary>
/// A seat a browser says it holds, offered to an account at sign-in. The secret is the PROOF, sent
/// back from where the browser stored it — not a request to be trusted.
/// </summary>
public record SeatAdoption
{
	public required string GameId { get; init; }
	public required string PlayerId { get; init; }
	public required string PlayerSecretId { get; init; }
}

public record SavedGameInfo
{
	public required string GameId { get; init; }
	public required GameStatus Status { get; init; }
	public required string Board { get; init; }
	public required string HostId { get; init; }
	public int MaxPlayers { get; init; }
	public DateTime CreatedAt { get; init; }
	public List<SavedGamePlayerInfo> Players { get; init; } = new();
	/// <summary>
	/// Which of those seats is the CALLER's, when the server is the one who knows. Filled by the
	/// account listing, where the table was found BY the seat; null for the browser's own list,
	/// which already knows which seat it holds because it stored the credentials for it.
	/// </summary>
	public string? YourPlayerId { get; init; }
}

public record SavedGamePlayerInfo
{
	public required string Id { get; init; }
	public required string Name { get; init; }
	public required string Token { get; init; }
	public bool IsHost { get; init; }
	public bool Connected { get; init; }
}

/// <summary>
/// Somebody asked to this table. Addressed by ACCOUNT, and carrying the public names of both ends
/// so the invitation can be shown and answered without a lookup — the same denormalization a chat
/// message makes for its author.
/// </summary>
public record TableInvitation
{
	/// <summary>
	/// The account invited. STORED — it is what the invitation is addressed to, and what finds it
	/// again for somebody who was away — and stripped on the way to a client by
	/// <c>GameDocument.Sanitized</c>, exactly like a seat's secret. The handle is what is shown.
	/// </summary>
	[JsonPropertyName("userId")]
	public string? UserId { get; init; }

	/// <summary>Their public name, which is how they are named to themselves and to the table.</summary>
	[JsonPropertyName("handle")]
	public required string Handle { get; init; }

	/// <summary>Who asked them, by public name.</summary>
	[JsonPropertyName("invitedBy")]
	public required string InvitedBy { get; init; }

	[JsonPropertyName("invitedAtUtc")]
	public DateTime InvitedAtUtc { get; init; }
}

/// <summary>
/// Somebody asking to be let into this table. The other direction of the same conversation, kept
/// apart from <see cref="TableInvitation"/> because a different person answers it: an invitation is
/// answered by the person invited, a request by the table's host.
/// </summary>
public record TableJoinRequest
{
	/// <summary>Stored, and stripped on the way out — see <see cref="TableInvitation.UserId"/>.</summary>
	[JsonPropertyName("userId")]
	public string? UserId { get; init; }

	[JsonPropertyName("handle")]
	public required string Handle { get; init; }

	[JsonPropertyName("requestedAtUtc")]
	public DateTime RequestedAtUtc { get; init; }
}
