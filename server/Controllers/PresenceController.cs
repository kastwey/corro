using CorroServer.Hubs;
using CorroServer.Models;
using CorroServer.Services.Accounts;
using Microsoft.AspNetCore.Mvc;

namespace CorroServer.Controllers;

/// <summary>
/// Who is around right now.
///
/// Three rules shape every answer, and all three are about what one player is allowed to learn
/// about another.
///
/// Only the HANDLE is published — never the display name, which is seeded from the provider
/// profile and is usually somebody's real name. A handle is chosen to be public; a name imported
/// from Google was not, and publishing it because somebody signed in would be publishing a
/// decision they never made.
///
/// Who appears is the player's own choice, in three steps: nobody, only their friends, or everyone
/// (<see cref="PresenceVisibility"/>). It is checked here, per reader, so "only friends" means only
/// the people that reader actually is one of.
///
/// And everybody else present is COUNTED. This is a deliberate reversal of an earlier promise that
/// hiding left no trace at all, and it is the one place here where somebody hidden is not entirely
/// invisible: with few people connected, a count narrows down who is about. It was chosen anyway,
/// because a room that reports nobody when it is full reads as a broken feature, and this
/// deployment already publishes the total connected in its footer. A count, never a hint of who —
/// no names, no activity, no way to tell one hidden player from another.
///
/// The list needs a session to read. Not because the data is secret from members, but because an
/// open endpoint listing everybody online is a census anybody can harvest on a timer. Sending a
/// friend request needs an account anyway, so requiring one to see the list costs nothing.
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class PresenceController : ControllerBase
{
	private readonly PresenceRegistry _presence;
	private readonly GameSessionRegistry _sessions;
	private readonly IUserRepository _users;
	private readonly FriendshipService _friendships;

	public PresenceController(
		PresenceRegistry presence,
		GameSessionRegistry sessions,
		IUserRepository users,
		FriendshipService friendships)
	{
		_presence = presence;
		_sessions = sessions;
		_users = users;
		_friendships = friendships;
	}

	/// <summary>
	/// One person in the list: the name they chose, roughly what they are doing, and what they
	/// already are to the reader — which is what decides the action their row offers. It travels
	/// with the row because the alternative is one request per person on screen.
	/// </summary>
	public sealed record OnlinePlayer(string Handle, string Activity, string Relationship);

	/// <summary>
	/// Everybody connected this reader is allowed to see, plus a count of everybody else and the
	/// reader's own setting — so the view can say who can currently see THEM rather than leaving
	/// them to work it out from their own absence.
	/// </summary>
	[HttpGet("online")]
	public async Task<ActionResult<object>> GetOnline(CancellationToken ct)
	{
		if (SessionPrincipal.UserId(User) is not { Length: > 0 } readerId)
		{
			// A member-only list, not a secret one: 401 rather than an empty array, so the client
			// can offer to sign in instead of showing an empty room.
			return Unauthorized();
		}

		// One read of the reader's own relationships answers every row, rather than a lookup per
		// person on screen.
		var relationships = await _friendships.RelationshipsForAsync(readerId, ct);
		var reader = await _users.GetUserAsync(readerId, ct);

		var listed = new List<OnlinePlayer>();
		var anonymous = 0;
		foreach (var userId in _presence.OnlineUserIds())
		{
			var user = await _users.GetUserAsync(userId, ct);
			if (user is null)
			{
				continue;
			}

			// The reader sees THEMSELVES in the room, marked and offering nothing to do — whatever
			// their own setting says, since hiding from others is not hiding from yourself. It is
			// the only way somebody can confirm their choice took effect, and for a player who
			// cannot glance at anything, a room they are told about but never appear in is a room
			// they have to take on faith.
			var relationship = userId == readerId
				? FriendshipService.Relationship.Self
				: relationships.GetValueOrDefault(userId, FriendshipService.Relationship.None);

			if (relationship != FriendshipService.Relationship.Self
				&& !ReachRules.IsVisibleTo(user, relationship))
			{
				// Present, and not for this reader to see. Counted rather than named — see the
				// summary at the top of this file for what that does and does not give away.
				anonymous++;
				continue;
			}

			// Somebody visible who never chose a public name cannot be named, so they are one of the
			// anonymous rather than a blank row.
			if (user.Handle is not { Length: > 0 } handle)
			{
				if (userId != readerId)
				{
					anonymous++;
				}

				continue;
			}

			listed.Add(new OnlinePlayer(handle, ActivityOf(userId).ToString(), relationship.ToString()));
		}

		listed.Sort((a, b) => string.Compare(a.Handle, b.Handle, StringComparison.OrdinalIgnoreCase));
		return new
		{
			Players = listed,
			// How many people are here that this reader cannot see. A number, never a hint of who.
			Anonymous = anonymous,
			// The reader's own setting, so the view can say who can currently see them instead of
			// leaving them to infer it from their own absence.
			Visibility = (reader?.EffectiveVisibility ?? PresenceVisibility.Nobody).ToString(),
			// Whether they could be listed at all. Without a public name there is nothing to show,
			// whatever the setting says, and that is a different thing to fix.
			HasHandle = reader?.Handle is { Length: > 0 },
		};
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
			if (!_sessions.TryLocateConnection(connectionId, out var gameId, out var onBoard))
			{
				continue;
			}

			var here = onBoard && _sessions.IsMatchRunning(gameId)
				? PresenceRegistry.Activity.Playing
				: PresenceRegistry.Activity.AtTable;
			if (here > activity)
			{
				activity = here;
			}
		}
		return activity;
	}
}
