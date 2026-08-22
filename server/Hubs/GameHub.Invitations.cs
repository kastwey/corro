using CorroServer.Models;
using CorroServer.Services.Accounts;
using Microsoft.AspNetCore.SignalR;

namespace CorroServer.Hubs;

/// <summary>
/// Getting somebody to your table, in both directions: asking them, and being asked.
///
/// Both are stored ON the table (see <see cref="GameDocument.Invitations"/>), which is what makes
/// them survive a reload, reach somebody who was away, and expire on their own — a table that fills,
/// starts or is deleted takes them with it, and nothing has to sweep up.
///
/// Who may ask whom reuses the message policy rather than inventing a second one. An invitation IS
/// an interruption: somebody who accepts messages only from friends should not be reachable by a
/// stranger's invitation either, and having two settings that mean nearly the same thing is a way to
/// be quietly wrong about one of them.
///
/// And, as everywhere else in this corner of the app, a refusal says one thing whatever the reason.
/// </summary>
public partial class GameHub
{
	/// <summary>Enough to fill any table several times over; a bound, not a limit anybody meets.</summary>
	private const int MaxPendingPerTable = 40;

	public record TableInviteRequest
	{
		public required string GameId { get; init; }
		/// <summary>The public name of whoever is being asked.</summary>
		public required string Handle { get; init; }
	}

	public record TableAnswerRequest
	{
		public required string GameId { get; init; }
		/// <summary>Whose request is being answered; ignored when answering your own invitation.</summary>
		public string? Handle { get; init; }
	}

	/// <summary>What happened, in words the client turns into one sentence.</summary>
	public record TableInviteResult
	{
		public required string Outcome { get; init; }
		/// <summary>Set only when somebody was actually admitted, so their client can be sent there.</summary>
		public string? GameId { get; init; }

		/// <summary>
		/// The table's invite code, sent ONLY to somebody who has just been admitted. It lets their
		/// client walk the ordinary join — pick a piece, take a seat, mint the credentials — instead
		/// of this path growing a second way into a table that would have to be kept in step with it.
		/// </summary>
		public string? InviteCode { get; init; }
	}

	private static TableInviteResult Outcome(
		string outcome, string? gameId = null, string? inviteCode = null)
		=> new() { Outcome = outcome, GameId = gameId, InviteCode = inviteCode };

	/// <summary>One table waiting on this player's answer, as they need to see it.</summary>
	public record PendingInvitation
	{
		public required string GameId { get; init; }
		/// <summary>Who asked, by public name.</summary>
		public required string InvitedBy { get; init; }
		/// <summary>Which shipped board it is, so the client can name it in the player's own
		/// language rather than being handed a name in somebody else's.</summary>
		public string? BoardId { get; init; }
		/// <summary>True when this player ASKED to be let in rather than being invited: the same
		/// list, and a different sentence.</summary>
		public bool Asked { get; init; }
	}

	/// <summary>
	/// Every table waiting on this player — invitations to answer, and doors they knocked on.
	/// Read when the lobby opens, which is the only moment somebody needs the whole list; a new one
	/// arriving while they are here is pushed instead.
	/// </summary>
	public async Task<IReadOnlyList<PendingInvitation>> GetMyTableInvitations()
	{
		if (SignedInUserId() is not { Length: > 0 } userId) return Array.Empty<PendingInvitation>();

		var tables = await _gameRepository.GetTablesInvitingUserAsync(userId, 20);
		return tables
			// A table that filled or started since is not an answer anybody can act on.
			.Where(game => game.HasRoom)
			.Select(game => new PendingInvitation
			{
				GameId = game.GameId,
				InvitedBy = game.Invitations.FirstOrDefault(i => i.UserId == userId)?.InvitedBy
					?? string.Empty,
				BoardId = game.ShippedBoardId,
				Asked = game.JoinRequests.Any(r => r.UserId == userId),
			})
			.ToList();
	}

	/// <summary>
	/// Who could be asked to this table right now: connected, visible to the caller, willing to be
	/// invited by them, and not already here or already asked.
	///
	/// It exists so inviting is not a memory test. Typing a public name still works and reaches
	/// people this never lists — somebody who is here but hidden — so the two ways answer different
	/// questions: "I know who I want" and "who is about?".
	///
	/// This is the one place a message policy becomes observable without an attempt, and that was
	/// weighed rather than overlooked. For somebody the caller can ALREADY see in the room, the
	/// policy is deducible today with one invitation: away and unknown-name are both ruled out by
	/// their being visibly present, so a refusal can only be the policy. What changes is the cost —
	/// this can be read on a timer without the target ever being asked. It was chosen anyway,
	/// because a picker of people who cannot be picked is not a feature, and the only thing learned
	/// about somebody already visible is that they did not choose "anyone". Nobody hidden from the
	/// caller appears here for any reason: the presence setting still decides that, first.
	/// </summary>
	public async Task<List<string>> GetInvitablePlayers(string gameId)
	{
		var empty = new List<string>();
		if (_users is null || _presence is null) return empty;
		if (SignedInUserId() is not { Length: > 0 } callerId) return empty;

		var game = await _gameRepository.LoadGameAsync(gameId ?? string.Empty);
		if (game is null) return empty;
		// The same seat check InviteToTable makes. Without it this would answer "who is around and
		// reachable by me" for any table id somebody cared to guess.
		if (!game.Players.Any(p => p.UserId == callerId)) return empty;
		if (!game.HasRoom) return empty;

		var caller = await _users.GetUserAsync(callerId);
		// Somebody with no public name cannot invite at all (InviteToTable says NEEDS_PUBLIC_NAME),
		// so there is nobody to offer them.
		if (caller?.Handle is not { Length: > 0 }) return empty;

		var relationships = _friendships is null
			? new Dictionary<string, FriendshipService.Relationship>()
			: (Dictionary<string, FriendshipService.Relationship>)
				await _friendships.RelationshipsForAsync(callerId);

		var seated = game.Players
			.Select(p => p.UserId)
			.Where(id => id is { Length: > 0 })
			.ToHashSet();
		var invited = game.Invitations.Select(i => i.UserId).ToHashSet();

		var candidates = new List<string>();
		foreach (var userId in _presence.OnlineUserIds())
		{
			if (userId == callerId || seated.Contains(userId) || invited.Contains(userId)) continue;

			var user = await _users.GetUserAsync(userId);
			if (user?.Handle is not { Length: > 0 } handle) continue;

			var relationship = relationships.GetValueOrDefault(
				userId, FriendshipService.Relationship.None);
			// Seeing comes first and on its own: somebody hidden from this caller is not offered,
			// whatever their message policy says.
			if (!ReachRules.IsVisibleTo(user, relationship)) continue;
			if (!ReachRules.AcceptsFrom(user, relationship)) continue;

			candidates.Add(handle);
		}

		candidates.Sort(StringComparer.OrdinalIgnoreCase);
		return candidates;
	}

	/// <summary>
	/// Asks somebody to this table. The caller must hold a seat here — an invitation to a table you
	/// are not at is somebody else's invitation to make.
	/// </summary>
	public async Task<TableInviteResult> InviteToTable(TableInviteRequest request)
	{
		if (_users is null || SignedInUserId() is not { Length: > 0 } inviterId) return Outcome("REFUSED");

		var game = await _gameRepository.LoadGameAsync(request?.GameId ?? string.Empty);
		if (game is null) return Outcome("REFUSED");
		if (!game.Players.Any(p => p.UserId == inviterId)) return Outcome("REFUSED");
		if (!game.HasRoom) return Outcome("TABLE_FULL");

		var inviter = await _users.GetUserAsync(inviterId);
		if (inviter?.Handle is not { Length: > 0 } inviterHandle) return Outcome("NEEDS_PUBLIC_NAME");

		var target = await ReachableAccountAsync(request!.Handle, inviterId);
		if (target is null) return Outcome("REFUSED");
		if (game.Players.Any(p => p.UserId == target.UserId)) return Outcome("ALREADY_HERE");
		if (game.Invitations.Any(i => i.UserId == target.UserId)) return Outcome("INVITED");
		if (game.Invitations.Count >= MaxPendingPerTable) return Outcome("REFUSED");

		var invitation = new TableInvitation
		{
			UserId = target.UserId,
			Handle = target.Handle!,
			InvitedBy = inviterHandle,
			InvitedAtUtc = DateTime.UtcNow,
		};

		var saved = await _registry.MutateDocumentAsync(game.GameId, doc =>
			doc.Invitations.Any(i => i.UserId == target.UserId)
				? null
				: doc with { Invitations = [.. doc.Invitations, invitation] });
		if (saved is null) return Outcome("INVITED");

		await NotifyAsync(target.UserId, "TableInvitation", new
		{
			gameId = game.GameId,
			handle = invitation.Handle,
			invitedBy = inviterHandle,
		});
		await BroadcastLobbyAsync(saved);
		return Outcome("INVITED", game.GameId);
	}

	/// <summary>
	/// Asks a friend's table to let this player in. Friends only: the table is theirs, and knowing
	/// it exists at all is something only a friend is told (see the presence rules).
	/// </summary>
	public async Task<TableInviteResult> RequestToJoinTable(TableAnswerRequest request)
	{
		if (_users is null || SignedInUserId() is not { Length: > 0 } askerId) return Outcome("REFUSED");

		var game = await _gameRepository.LoadGameAsync(request?.GameId ?? string.Empty);
		if (game is null) return Outcome("REFUSED");
		if (!game.HasRoom) return Outcome("TABLE_FULL");
		if (game.Players.Any(p => p.UserId == askerId)) return Outcome("ALREADY_HERE");

		var asker = await _users.GetUserAsync(askerId);
		if (asker?.Handle is not { Length: > 0 } askerHandle) return Outcome("NEEDS_PUBLIC_NAME");

		// A friend must actually be sitting here. Otherwise this would be a way to knock on any
		// table whose id somebody guessed.
		if (!await AnyFriendIsSeatedAsync(game, askerId)) return Outcome("REFUSED");
		if (game.JoinRequests.Any(r => r.UserId == askerId)) return Outcome("ASKED");
		if (game.JoinRequests.Count >= MaxPendingPerTable) return Outcome("REFUSED");

		var ask = new TableJoinRequest
		{
			UserId = askerId,
			Handle = askerHandle,
			RequestedAtUtc = DateTime.UtcNow,
		};

		var saved = await _registry.MutateDocumentAsync(game.GameId, doc =>
			doc.JoinRequests.Any(r => r.UserId == askerId)
				? null
				: doc with { JoinRequests = [.. doc.JoinRequests, ask] });
		if (saved is null) return Outcome("ASKED");

		await BroadcastLobbyAsync(saved);
		return Outcome("ASKED", game.GameId);
	}

	/// <summary>
	/// Takes an invitation up. Answers with the table so the client can go there; the seat itself is
	/// taken through the ordinary join, which is what mints the credentials.
	/// </summary>
	public async Task<TableInviteResult> AcceptTableInvitation(TableAnswerRequest request)
	{
		if (SignedInUserId() is not { Length: > 0 } userId) return Outcome("REFUSED");

		var game = await _gameRepository.LoadGameAsync(request?.GameId ?? string.Empty);
		if (game is null) return Outcome("GONE");
		if (!game.Invitations.Any(i => i.UserId == userId)) return Outcome("GONE");
		// The table filling up between the invitation and the answer is the ordinary case, not an
		// error: it is said plainly, and the invitation is cleared so it stops offering something
		// that is no longer there.
		var full = !game.HasRoom;

		var saved = await _registry.MutateDocumentAsync(game.GameId, doc => doc with
		{
			Invitations = doc.Invitations.Where(i => i.UserId != userId).ToList(),
		});
		if (saved is not null) await BroadcastLobbyAsync(saved);

		return full ? Outcome("TABLE_FULL") : Outcome("JOINING", game.GameId, game.InviteCode);
	}

	/// <summary>Turns an invitation down. Nothing is reported to the table beyond it disappearing.</summary>
	public async Task<TableInviteResult> DeclineTableInvitation(TableAnswerRequest request)
	{
		if (SignedInUserId() is not { Length: > 0 } userId) return Outcome("REFUSED");

		var saved = await _registry.MutateDocumentAsync(request?.GameId ?? string.Empty, doc =>
			doc.Invitations.Any(i => i.UserId == userId)
				? doc with { Invitations = doc.Invitations.Where(i => i.UserId != userId).ToList() }
				: null);
		if (saved is not null) await BroadcastLobbyAsync(saved);
		return Outcome("DECLINED");
	}

	/// <summary>
	/// Lets somebody in who asked. Answered by anybody holding a seat here, and it admits them
	/// directly rather than turning into an invitation they would have to accept as well: they said
	/// what they wanted when they asked.
	/// </summary>
	public async Task<TableInviteResult> AnswerJoinRequest(TableAnswerRequest request, bool accept)
	{
		if (_users is null || SignedInUserId() is not { Length: > 0 } hostId) return Outcome("REFUSED");

		var game = await _gameRepository.LoadGameAsync(request?.GameId ?? string.Empty);
		if (game is null) return Outcome("GONE");
		if (!game.Players.Any(p => p.UserId == hostId)) return Outcome("REFUSED");

		var normalized = PlayerHandle.Normalize(request!.Handle ?? string.Empty);
		var ask = game.JoinRequests.FirstOrDefault(
			r => PlayerHandle.Normalize(r.Handle) == normalized);
		if (ask?.UserId is not { Length: > 0 } askerId) return Outcome("GONE");

		var saved = await _registry.MutateDocumentAsync(game.GameId, doc => doc with
		{
			JoinRequests = doc.JoinRequests.Where(r => r.UserId != askerId).ToList(),
			// Accepting turns the request into an invitation the asker's client acts on at once.
			// It is stored rather than only pushed so somebody whose connection blinked still finds
			// the door open when they come back.
			Invitations = accept && doc.HasRoom
				? [.. doc.Invitations, new TableInvitation
				{
					UserId = askerId,
					Handle = ask.Handle,
					InvitedBy = ask.Handle,
					InvitedAtUtc = DateTime.UtcNow,
				}]
				: doc.Invitations,
		});
		if (saved is not null) await BroadcastLobbyAsync(saved);

		if (!accept) return Outcome("DECLINED");
		if (!game.HasRoom) return Outcome("TABLE_FULL");

		// The code goes to the person admitted, never to the table: it is their way in, not news.
		await NotifyAsync(askerId, "JoinRequestAccepted", new
		{
			gameId = game.GameId,
			inviteCode = game.InviteCode,
			handle = ask.Handle,
		});
		return Outcome("ADMITTED", game.GameId);
	}

	/// <summary>
	/// The account behind a public name, if this caller may reach them at all — the same policy that
	/// decides who may write to them, because an invitation is an interruption too.
	/// </summary>
	private async Task<UserDocument?> ReachableAccountAsync(string handle, string fromUserId)
	{
		var normalized = PlayerHandle.Normalize(handle ?? string.Empty);
		if (normalized.Length == 0) return null;

		var claim = await _users!.GetHandleClaimAsync(normalized);
		if (claim is null || claim.ReleasedAtUtc is not null) return null;

		var user = await _users.GetUserAsync(claim.UserId);
		if (user?.Handle is not { Length: > 0 } stored) return null;
		if (PlayerHandle.Normalize(stored) != normalized) return null;
		if (user.UserId == fromUserId) return null;

		var relationship = _friendships is null
			? FriendshipService.Relationship.None
			: (await _friendships.RelationshipsForAsync(fromUserId))
				.GetValueOrDefault(user.UserId, FriendshipService.Relationship.None);

		return ReachRules.AcceptsFrom(user, relationship) ? user : null;
	}

	/// <summary>Whether anybody seated here is a friend of the asker.</summary>
	private async Task<bool> AnyFriendIsSeatedAsync(GameDocument game, string askerId)
	{
		if (_friendships is null) return false;
		var relationships = await _friendships.RelationshipsForAsync(askerId);
		return game.Players.Any(p => p.UserId is { Length: > 0 } seated
			&& relationships.GetValueOrDefault(seated, FriendshipService.Relationship.None)
				== FriendshipService.Relationship.Friends);
	}

	/// <summary>Push something to every connection one account has open. Silent when they are away —
	/// what was stored on the table is what they find when they come back.</summary>
	private async Task NotifyAsync(string userId, string method, object payload)
	{
		if (_presence is null) return;
		var connections = _presence.ConnectionsOf(userId).ToList();
		if (connections.Count == 0) return;
		await Clients.Clients(connections).SendAsync(method, payload);
	}

	/// <summary>Tell the table itself, so its own list of who has been asked stays current.</summary>
	private async Task BroadcastLobbyAsync(GameDocument saved)
	{
		await Clients.Group(saved.GameId).SendAsync("LobbyUpdated", saved.Sanitized());
		await Clients.Group($"lobby_{saved.GameId}").SendAsync("LobbyUpdated", saved.Sanitized());
	}
}
