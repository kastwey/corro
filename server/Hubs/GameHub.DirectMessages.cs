using CorroServer.Models;
using CorroServer.Services.Accounts;
using Microsoft.AspNetCore.SignalR;

namespace CorroServer.Hubs;

/// <summary>
/// Private messages between players, addressed by public name.
///
/// Nothing is stored. A message is handed to whatever connections the recipient has open and then
/// forgotten — the server keeps no mailbox, no history and no record that two people ever wrote to
/// each other. Somebody who is not connected simply does not receive it, and the sender is told so
/// at once rather than being left to assume it arrived.
///
/// That is a deliberate limit, not an unfinished one. A stored conversation would need retention, a
/// way to erase it, a section of the privacy notice explaining who can read it and an answer for
/// what happens on a shared computer. None of that is worth building until somebody actually wants
/// to write to a friend who is asleep.
///
/// Two rules about what a refusal may say. Every reason one fails — no such name, not connected,
/// their policy refuses this sender — reports the SAME thing, because telling them apart would turn
/// this into a way to learn who exists, who is around, and who has quietly shut somebody out. And
/// nothing is ever reported to the recipient: a message that was not delivered did not happen.
/// </summary>
public partial class GameHub
{
	/// <summary>Long enough for anything worth saying to somebody, short enough to bound a frame.</summary>
	private const int DirectMessageMaxLength = 1000;

	/// <summary>Enough people to answer a group at a table, far short of a broadcast.</summary>
	private const int DirectMessageMaxRecipients = 10;

	public record SendDirectMessageRequest
	{
		/// <summary>Public names, as the sender typed them. Resolved and checked here.</summary>
		public required IReadOnlyList<string> Handles { get; init; }
		public required string Text { get; init; }
	}

	/// <summary>One message as it reaches somebody: who wrote it, and who else it went to.</summary>
	public record DirectMessage
	{
		public required string From { get; init; }
		/// <summary>Everybody it was addressed to, so a reply can reach the same group. Includes
		/// the reader, and only the recipients it was actually delivered to.</summary>
		public required IReadOnlyList<string> To { get; init; }
		public required string Text { get; init; }
		public required DateTime SentAtUtc { get; init; }
	}

	/// <summary>What became of one message, per recipient, for the sender alone.</summary>
	public record DirectMessageResult
	{
		public required IReadOnlyList<string> Delivered { get; init; }
		/// <summary>Names that reached nobody, for whatever reason — the reasons are deliberately
		/// not told apart.</summary>
		public required IReadOnlyList<string> Unreachable { get; init; }
	}

	/// <summary>
	/// Sends a private message to one or more players by public name.
	///
	/// The sender must be signed in, because a message from nobody in particular could not be
	/// replied to, and because the recipient's policy is written in terms of who the sender is.
	/// </summary>
	public async Task<DirectMessageResult> SendDirectMessage(SendDirectMessageRequest request)
	{
		var empty = new DirectMessageResult
		{
			Delivered = Array.Empty<string>(),
			Unreachable = Array.Empty<string>(),
		};

		if (_users is null || _presence is null) return empty;
		if (SignedInUserId() is not { Length: > 0 } senderId) return empty;

		var sender = await _users.GetUserAsync(senderId);
		// Somebody with no public name cannot be written back to, so they may not write. It is the
		// same rule the friends list makes: a conversation needs two nameable ends.
		if (sender?.Handle is not { Length: > 0 } senderHandle) return empty;

		var text = (request?.Text ?? string.Empty).Trim();
		if (text.Length == 0) return empty;
		if (text.Length > DirectMessageMaxLength) text = text[..DirectMessageMaxLength];

		var wanted = (request?.Handles ?? Array.Empty<string>())
			.Where(handle => !string.IsNullOrWhiteSpace(handle))
			.Select(PlayerHandle.Normalize)
			.Where(handle => handle.Length > 0)
			.Distinct(StringComparer.Ordinal)
			.Take(DirectMessageMaxRecipients)
			.ToList();
		if (wanted.Count == 0) return empty;

		var friendships = _friendships is null
			? new Dictionary<string, FriendshipService.Relationship>()
			: (Dictionary<string, FriendshipService.Relationship>)await ResolveRelationshipsAsync(senderId);

		var reachable = new List<(UserDocument User, string Handle)>();
		var unreachable = new List<string>();
		foreach (var handle in wanted)
		{
			var recipient = await RecipientForAsync(handle, senderId, friendships);
			if (recipient is null) unreachable.Add(handle);
			else reachable.Add((recipient, recipient.Handle!));
		}

		if (reachable.Count == 0)
		{
			return new DirectMessageResult
			{
				Delivered = Array.Empty<string>(),
				Unreachable = unreachable,
			};
		}

		// Everybody it reached, plus the sender: a reply addressed to this list reaches the same
		// conversation, and each recipient can see who else is in it.
		var audience = reachable.Select(r => r.Handle).ToList();
		var message = new DirectMessage
		{
			From = senderHandle,
			To = audience,
			Text = text,
			SentAtUtc = DateTime.UtcNow,
		};

		foreach (var (user, _) in reachable)
		{
			var connections = _presence.ConnectionsOf(user.UserId).ToList();
			if (connections.Count == 0) continue;
			await Clients.Clients(connections).SendAsync("DirectMessage", message);
		}

		// The sender's own other tabs see it too, so the conversation reads the same everywhere.
		var ownConnections = _presence.ConnectionsOf(senderId)
			.Where(id => id != Context.ConnectionId)
			.ToList();
		if (ownConnections.Count > 0)
		{
			await Clients.Clients(ownConnections).SendAsync("DirectMessage", message);
		}

		return new DirectMessageResult { Delivered = audience, Unreachable = unreachable };
	}

	/// <summary>
	/// Tell the room that somebody arrived or left, and hand everyone the new head count.
	///
	/// Sent only to people who could see them anyway: the presence setting decides who this player
	/// is visible to, and an arrival notice that ignored it would announce somebody who chose to be
	/// hidden. Whether it is SAID at all is the reader's own choice, made on their own device.
	///
	/// The count goes to everybody, because it is the same number the footer already publishes.
	/// </summary>
	private async Task AnnouncePresenceAsync(string userId, bool arriving)
	{
		if (_users is null || _presence is null) return;

		// The count first: it is for everyone and does not depend on who arrived.
		await Clients.All.SendAsync("PresenceCount", new
		{
			players = _presence.OnlineCount,
			tables = _registry.CountActiveTables(),
		});

		var user = await _users.GetUserAsync(userId);
		if (user?.Handle is not { Length: > 0 } handle) return;
		if (user.EffectiveVisibility == PresenceVisibility.Nobody) return;

		var friendIds = _friendships is null
			? new Dictionary<string, FriendshipService.Relationship>()
			: (Dictionary<string, FriendshipService.Relationship>)
				await _friendships.RelationshipsForAsync(userId);

		foreach (var readerId in _presence.OnlineUserIds())
		{
			if (readerId == userId) continue;
			var isFriend = friendIds.GetValueOrDefault(readerId, FriendshipService.Relationship.None)
				== FriendshipService.Relationship.Friends;
			// "Only friends" means exactly that, here as everywhere else.
			if (user.EffectiveVisibility == PresenceVisibility.Friends && !isFriend) continue;

			var connections = _presence.ConnectionsOf(readerId).ToList();
			if (connections.Count == 0) continue;
			await Clients.Clients(connections).SendAsync("PresenceChanged", new
			{
				handle,
				isFriend,
				arriving,
			});
		}
	}

	private async Task<IReadOnlyDictionary<string, FriendshipService.Relationship>>
		ResolveRelationshipsAsync(string senderId)
		=> _friendships is null
			? new Dictionary<string, FriendshipService.Relationship>()
			: await _friendships.RelationshipsForAsync(senderId);

	/// <summary>
	/// The account behind a public name, if it may be written to by this sender AND is connected.
	/// Null for every other case, and deliberately for the same null: an unknown name, somebody
	/// asleep, and somebody who has shut this sender out must be impossible to tell apart.
	/// </summary>
	private async Task<UserDocument?> RecipientForAsync(
		string normalizedHandle,
		string senderId,
		IReadOnlyDictionary<string, FriendshipService.Relationship> friendships)
	{
		var claim = await _users!.GetHandleClaimAsync(normalizedHandle);
		if (claim is null || claim.ReleasedAtUtc is not null) return null;

		var user = await _users.GetUserAsync(claim.UserId);
		if (user?.Handle is not { Length: > 0 } stored) return null;
		if (PlayerHandle.Normalize(stored) != normalizedHandle) return null;
		if (user.UserId == senderId) return null;

		var relationship = friendships.GetValueOrDefault(
			user.UserId, FriendshipService.Relationship.None);
		var allowed = user.EffectiveMessagePolicy switch
		{
			MessagePolicy.Anyone => true,
			MessagePolicy.Friends => relationship == FriendshipService.Relationship.Friends,
			_ => false,
		};
		if (!allowed) return null;

		// Nothing is stored, so somebody who is not here cannot be reached. Reported as one
		// outcome with all the others.
		return _presence!.IsOnline(user.UserId) ? user : null;
	}
}
