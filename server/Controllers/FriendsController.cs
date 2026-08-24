using CorroServer.Hubs;
using CorroServer.Services;
using CorroServer.Services.Accounts;
using Microsoft.AspNetCore.Mvc;

namespace CorroServer.Controllers;

/// <summary>
/// Asking to be friends, answering, and undoing either.
///
/// Everything here needs a session, and every route names the other player by HANDLE — the only
/// name the asker can see. Account ids never appear on the wire.
///
/// Not one of these is a GET, including the ones that only undo something. The session cookie is
/// <c>SameSite=Lax</c>, which means a plain link from anywhere on the web arrives with it attached:
/// a GET that changed a relationship could be fired by an image tag in a forum post. The reads are
/// GETs; everything that writes is a POST or a DELETE, which that rule does not carry.
///
/// The refusal policy lives in <see cref="FriendshipService"/> — read its summary before changing
/// what any of these report, because two of the outcomes are deliberately vague and it explains who
/// that protects.
/// </summary>
[ApiController]
[Route("api/friends")]
public class FriendsController : ControllerBase
{
	private readonly FriendshipService _friendships;
	private readonly IGameRepository _games;
	private readonly GameSessionRegistry _sessions;
	private readonly PresenceRegistry _presence;
	private readonly IUserRepository _users;

	public FriendsController(
		FriendshipService friendships,
		IGameRepository games,
		GameSessionRegistry sessions,
		PresenceRegistry presence,
		IUserRepository users)
	{
		_friendships = friendships;
		_games = games;
		_sessions = sessions;
		_presence = presence;
		_users = users;
	}

	/// <summary>
	/// One entry in the player's own list.
	///
	/// <paramref name="JoinableGameId"/> is the one place the rule that presence never names a table
	/// is deliberately narrowed, and it is narrowed twice over: only for a FRIEND, and only for a
	/// table that still has room. Knowing that a friend is somewhere with a free seat is the whole
	/// point of asking to join them; knowing which table a stranger is at is not.
	/// </summary>
	public sealed record FriendEntry(string Handle, string Relationship, string? JoinableGameId);

	/// <summary>The other player, named the way the asker sees them.</summary>
	public sealed record HandleRequest(string Handle);

	/// <summary>
	/// This player's friends and unanswered requests, in one list with each entry saying which it
	/// is. One list rather than three arrays because the client renders one roster: sorting people
	/// into buckets is a decision about layout, and this is not the place for it.
	/// </summary>
	[HttpGet]
	public async Task<ActionResult<object>> GetFriends(CancellationToken ct)
	{
		if (SessionPrincipal.UserId(User) is not { Length: > 0 } userId)
		{
			return Unauthorized();
		}

		var entries = await _friendships.ListAsync(userId, ct);
		var friends = new List<FriendEntry>();
		foreach (var entry in entries)
		{
			friends.Add(new FriendEntry(
				entry.Handle,
				entry.Relationship.ToString(),
				entry.Relationship == FriendshipService.Relationship.Friends
					? await JoinableTableOfAsync(entry.Handle, userId, ct)
					: null));
		}
		return new { Friends = friends };
	}

	/// <summary>
	/// Asks somebody to be friends. Answers the same way whether the handle is unknown or belongs to
	/// somebody who chose not to be listed: telling them apart would make this a way to test which
	/// handles exist.
	/// </summary>
	[HttpPost("requests")]
	public async Task<IActionResult> RequestFriendship(
		[FromBody] HandleRequest request, CancellationToken ct)
	{
		if (SessionPrincipal.UserId(User) is not { Length: > 0 } userId)
		{
			return Unauthorized();
		}

		var outcome = await _friendships.RequestAsync(
			userId, request?.Handle ?? string.Empty, DateTime.UtcNow, ct);

		return outcome switch
		{
			FriendshipService.RequestOutcome.NoSuchPlayer
				=> NotFound(new { code = "NO_SUCH_PLAYER" }),
			FriendshipService.RequestOutcome.Self
				=> BadRequest(new { code = "SELF" }),
			// Sent, AcceptedTheirs and Unchanged all leave the asker in a state their own list can
			// describe, so the client re-reads rather than being told a story here.
			_ => Ok(new { outcome = outcome.ToString() }),
		};
	}

	/// <summary>Somebody at the same table, named by their SEAT rather than by a name.</summary>
	public sealed record TableRequest(string GameId, string PlayerId);

	/// <summary>
	/// Asks somebody sitting at the same table. The route exists because the list of who is online
	/// is opt-in: a player who keeps to themselves there would otherwise be unreachable by the very
	/// people they actually play with.
	///
	/// The target is a SEAT, not a name. The caller never learns their handle or their account, and
	/// the caller must hold a seat at that table themselves — otherwise anybody with a game code
	/// could walk a table's seats to find out which of them are signed in.
	/// </summary>
	[HttpPost("requests/table")]
	public async Task<IActionResult> RequestFromTable(
		[FromBody] TableRequest request, CancellationToken ct)
	{
		if (SessionPrincipal.UserId(User) is not { Length: > 0 } userId)
		{
			return Unauthorized();
		}

		if (request is null)
		{
			return BadRequest(new { code = "NO_SUCH_SEAT" });
		}

		// The live table first: a game in progress lives in the session registry and its document
		// may be older than the seat arrangement.
		var game = _sessions.TryGetDocument(request.GameId, out var live)
			? live
			: await _games.LoadGameAsync(request.GameId);
		if (game is null)
		{
			return NotFound(new { code = "NO_SUCH_SEAT" });
		}

		// Sitting here is the whole authorisation. Note it is the ACCOUNT that must hold a seat:
		// somebody who joined before signing in has no account on their seat and cannot ask this
		// way, which is the safe direction to be wrong in.
		if (!game.Players.Any(p => p.UserId == userId))
		{
			return Forbid();
		}

		var target = game.Players.FirstOrDefault(p => p.Id == request.PlayerId);
		if (target?.UserId is not { Length: > 0 } targetUserId)
		{
			// No such seat, a bot, or somebody playing without an account: one answer for all
			// three, because the caller has no business telling them apart.
			return NotFound(new { code = "NO_SUCH_SEAT" });
		}

		var outcome = await _friendships.RequestFromTableAsync(
			userId, targetUserId, DateTime.UtcNow, ct);

		return outcome switch
		{
			FriendshipService.RequestOutcome.NoSuchPlayer => NotFound(new { code = "NO_SUCH_SEAT" }),
			FriendshipService.RequestOutcome.Self => BadRequest(new { code = "SELF" }),
			_ => Ok(new { outcome = outcome.ToString() }),
		};
	}

	/// <summary>Says yes to a request addressed to this player.</summary>
	[HttpPost("requests/accept")]
	public Task<IActionResult> Accept([FromBody] HandleRequest request, CancellationToken ct) =>
		Respond(request, accept: true, ct);

	/// <summary>
	/// Says no. The other player is not told — see <see cref="FriendshipService"/> — and the refusal
	/// is remembered, so the same request cannot arrive again tomorrow.
	/// </summary>
	[HttpPost("requests/decline")]
	public Task<IActionResult> Decline([FromBody] HandleRequest request, CancellationToken ct) =>
		Respond(request, accept: false, ct);

	/// <summary>
	/// Ends a friendship, from either side. Friendships only — a request that has been sent cannot
	/// be taken back, for the reason spelled out on <see cref="FriendshipService.RemoveFriendAsync"/>.
	/// </summary>
	[HttpDelete("{handle}")]
	public async Task<IActionResult> RemoveFriend(string handle, CancellationToken ct)
	{
		if (SessionPrincipal.UserId(User) is not { Length: > 0 } userId)
		{
			return Unauthorized();
		}

		return await _friendships.RemoveFriendAsync(userId, handle, ct)
			? NoContent()
			: NotFound(new { code = "NO_SUCH_FRIENDSHIP" });
	}

	/// <summary>
	/// The table a friend is sitting at, if it is one this reader could join: waiting, with room,
	/// and not one they are already at. Read from the live session registry rather than by querying
	/// games, so it costs nothing per friend and cannot name a table nobody is actually at.
	/// </summary>
	private async Task<string?> JoinableTableOfAsync(
		string handle, string readerId, CancellationToken ct)
	{
		var friend = await _users.GetUserAsync(
			(await _users.GetHandleClaimAsync(PlayerHandle.Normalize(handle), ct))?.UserId
				?? string.Empty, ct);
		if (friend is null)
		{
			return null;
		}

		foreach (var connectionId in _presence.ConnectionsOf(friend.UserId))
		{
			if (!_sessions.TryLocateConnection(connectionId, out var gameId, out _))
			{
				continue;
			}

			var game = await _games.LoadGameAsync(gameId);
			if (game is null || !game.HasRoom)
			{
				continue;
			}
			// A table the reader is already sitting at is not one to ask to be let into.
			if (game.Players.Any(p => p.UserId == readerId))
			{
				continue;
			}

			return gameId;
		}
		return null;
	}

	private async Task<IActionResult> Respond(
		HandleRequest? request, bool accept, CancellationToken ct)
	{
		if (SessionPrincipal.UserId(User) is not { Length: > 0 } userId)
		{
			return Unauthorized();
		}

		var outcome = await _friendships.RespondAsync(
			userId, request?.Handle ?? string.Empty, accept, DateTime.UtcNow, ct);

		return outcome == FriendshipService.RespondOutcome.NoRequest
			? NotFound(new { code = "NO_REQUEST" })
			: NoContent();
	}
}
