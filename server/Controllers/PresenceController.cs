using CorroServer.Hubs;
using CorroServer.Services.Accounts;
using Microsoft.AspNetCore.Mvc;

namespace CorroServer.Controllers;

/// <summary>
/// Who is around right now.
///
/// Two rules shape every answer here, and both are about what a stranger is allowed to learn.
///
/// Only the HANDLE is published — never the display name, which is seeded from the provider
/// profile and is usually somebody's real name. A handle is chosen to be public; a name imported
/// from Google was not, and publishing it because somebody signed in would be publishing a
/// decision they never made.
///
/// And the list needs a session to read. Not because the data is secret from members, but because
/// an open endpoint listing everybody online is a census anybody can harvest on a timer. Sending a
/// friend request needs an account anyway, so requiring one to see the list costs nothing.
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class PresenceController : ControllerBase
{
	private readonly PresenceRegistry _presence;
	private readonly GameSessionRegistry _sessions;
	private readonly IUserRepository _users;

	public PresenceController(
		PresenceRegistry presence,
		GameSessionRegistry sessions,
		IUserRepository users)
	{
		_presence = presence;
		_sessions = sessions;
		_users = users;
	}

	/// <summary>One person in the list: the name they chose, and roughly what they are doing.</summary>
	public sealed record OnlinePlayer(string Handle, string Activity);

	/// <summary>
	/// Everybody connected who has both chosen a handle and asked to be listed.
	///
	/// Silent about anybody who has not: no count of hidden players, no "3 others" — a person who
	/// opted out should leave no trace at all, or opting out only hides their name.
	/// </summary>
	[HttpGet("online")]
	public async Task<ActionResult<object>> GetOnline(CancellationToken ct)
	{
		if (SessionPrincipal.UserId(User) is not { Length: > 0 })
		{
			// A member-only list, not a secret one: 401 rather than an empty array, so the client
			// can offer to sign in instead of showing an empty room.
			return Unauthorized();
		}

		var listed = new List<OnlinePlayer>();
		foreach (var userId in _presence.OnlineUserIds())
		{
			var user = await _users.GetUserAsync(userId, ct);
			if (user is null || !user.ListedPublicly || user.Handle is not { Length: > 0 } handle) continue;
			listed.Add(new OnlinePlayer(handle, ActivityOf(userId).ToString()));
		}

		listed.Sort((a, b) => string.Compare(a.Handle, b.Handle, StringComparison.OrdinalIgnoreCase));
		return new { Players = listed };
	}

	/// <summary>
	/// What somebody is doing, from what the server already knows — nobody reports their own
	/// status, so nobody can lie about it.
	///
	/// The busiest of their connections wins: with the board open in one tab and the lobby in
	/// another, a person is playing. Deliberately coarse, and deliberately silent about WHICH game:
	/// the point is "can I interrupt?", not "where can I find you".
	/// </summary>
	private PresenceRegistry.Activity ActivityOf(string userId)
	{
		var activity = PresenceRegistry.Activity.InLobby;
		foreach (var connectionId in _presence.ConnectionsOf(userId))
		{
			if (!_sessions.TryLocateConnection(connectionId, out var gameId, out var onBoard)) continue;
			var here = onBoard && _sessions.IsMatchRunning(gameId)
				? PresenceRegistry.Activity.Playing
				: PresenceRegistry.Activity.AtTable;
			if (here > activity) activity = here;
		}
		return activity;
	}
}
