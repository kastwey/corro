using CorroServer.Models;

namespace CorroServer.Services.Accounts;

/// <summary>
/// Who is friends with whom, and what happens when somebody asks.
///
/// Two rules shape everything here, and both are about the person being asked rather than the
/// person asking:
///
/// A refusal is REMEMBERED. Declining deletes nothing; it writes "no" into the pair's document, and
/// a later request from the same person is accepted by the API and quietly changes nothing. Without
/// that, "no" would mean "not this evening" — anyone could ask again every day, and the only way out
/// would be for the refuser to stop being listed at all.
///
/// And a refusal is NOT REPORTED. The person who asked keeps seeing that they asked, because that is
/// the true part they are entitled to: what they did. Whether it was read, ignored or refused is the
/// other person's business, and telling them turns a quiet "no" into something to react to.
///
/// The one thing a refusal does not do is bind the refuser. They can ask the other person later,
/// which flips the same document round with themselves as the asker.
/// </summary>
public class FriendshipService
{
	private readonly IUserRepository _repository;

	public FriendshipService(IUserRepository repository)
	{
		_repository = repository;
	}

	/// <summary>What one player is to another, from the asking player's side. Exactly what the
	/// online list needs to know to offer the right action.</summary>
	public enum Relationship
	{
		/// <summary>Nothing between them: the row offers "ask to be friends".</summary>
		None,

		/// <summary>This player asked. Also what a refused player keeps seeing — see the class
		/// summary; they are shown what they did, not what came of it.</summary>
		RequestSent,

		/// <summary>The other player asked, and this one has not answered.</summary>
		RequestReceived,

		/// <summary>Agreed, on both sides.</summary>
		Friends,

		/// <summary>The reader themselves. Not a relationship at all — it is how the online list
		/// marks the row that is you, which offers nothing to do.</summary>
		Self,
	}

	public enum RequestOutcome
	{
		/// <summary>Stored, or deliberately treated as if it had been — see the class summary.</summary>
		Sent,

		/// <summary>They had already asked this player, so asking back simply agrees.</summary>
		AcceptedTheirs,

		/// <summary>Nothing to do: they are already friends, or the request already stood.</summary>
		Unchanged,

		/// <summary>No account holds that handle, or its holder is not listed. One outcome for both
		/// on purpose: distinguishing them would turn this endpoint into a way to test whether a
		/// handle exists.</summary>
		NoSuchPlayer,

		/// <summary>A player asking themselves.</summary>
		Self,
	}

	public enum RespondOutcome
	{
		Accepted,
		Declined,

		/// <summary>There is no unanswered request from that player to answer.</summary>
		NoRequest,
	}

	/// <summary>One relationship as the player asking about it sees it.</summary>
	public readonly record struct FriendView(string Handle, Relationship Relationship);

	/// <summary>
	/// Asks to be friends. The target is named by HANDLE because that is what the asker can see; it
	/// must belong to a listed account, so the endpoint cannot be used to discover whether a handle
	/// exists for somebody who chose not to be found.
	/// </summary>
	public async Task<RequestOutcome> RequestAsync(
		string fromUserId,
		string targetHandle,
		DateTime utcNow,
		CancellationToken ct = default)
	{
		var target = await ListedAccountByHandleAsync(targetHandle, ct);
		if (target is null)
		{
			return RequestOutcome.NoSuchPlayer;
		}

		return await RequestBetweenAsync(fromUserId, target, utcNow, ct);
	}

	/// <summary>
	/// Asks somebody sharing a table, addressed by ACCOUNT rather than by name — the caller never
	/// learns their handle, and does not need to.
	///
	/// Visibility is deliberately not consulted. It governs who finds you in a list of strangers;
	/// somebody you are sitting at a table with has already found you, and refusing here would mean
	/// a player who keeps to themselves online could never be asked by the people they actually
	/// play with, which is the case this exists for. Their answer is still entirely theirs.
	///
	/// A public name is still required, because a friendship with nobody to name is one that could
	/// never appear on either list.
	/// </summary>
	public async Task<RequestOutcome> RequestFromTableAsync(
		string fromUserId,
		string targetUserId,
		DateTime utcNow,
		CancellationToken ct = default)
	{
		if (targetUserId == fromUserId)
		{
			return RequestOutcome.Self;
		}

		var target = await _repository.GetUserAsync(targetUserId, ct);
		if (target?.Handle is not { Length: > 0 })
		{
			return RequestOutcome.NoSuchPlayer;
		}

		return await RequestBetweenAsync(fromUserId, target, utcNow, ct);
	}

	/// <summary>The request itself, once the two accounts are known. Both routes in end here, so
	/// the refusal rules cannot differ between them.</summary>
	private async Task<RequestOutcome> RequestBetweenAsync(
		string fromUserId,
		UserDocument target,
		DateTime utcNow,
		CancellationToken ct)
	{
		if (target.UserId == fromUserId)
		{
			return RequestOutcome.Self;
		}

		var (low, high) = FriendshipKey.Order(fromUserId, target.UserId);
		var pairId = FriendshipKey.For(fromUserId, target.UserId);
		var proposed = new FriendshipDocument
		{
			Id = pairId,
			PairId = pairId,
			UserA = low,
			UserB = high,
			RequestedBy = fromUserId,
			State = FriendshipState.Pending,
			RequestedAtUtc = utcNow,
		};

		// Create-or-get rather than read-then-write: two people who ask each other in the same
		// second must end up with one request, not two that each wait for the other to answer.
		//
		// What comes back is the stored document either way, and it alone decides the answer —
		// nothing here asks "did I create it?", which round-tripping through a database makes
		// surprisingly hard to know and which the outcome does not actually depend on.
		var stored = await _repository.CreateOrGetFriendshipAsync(proposed, ct);

		return stored.State switch
		{
			// This player's request, whether stored a moment ago or last week.
			FriendshipState.Pending when stored.RequestedBy == fromUserId => RequestOutcome.Sent,

			// They asked first — including the race above, where this player's request lost. Asking
			// somebody who has already asked you is agreeing with them.
			FriendshipState.Pending => await AcceptAsync(stored, utcNow, ct),

			FriendshipState.Accepted => RequestOutcome.Unchanged,

			// Refused. Whose refusal it was decides what asking again means.
			FriendshipState.Declined when stored.RequestedBy == fromUserId
				// They were told no and are asking again. Answered as if it had been sent, and
				// nothing is written: the refusal holds without ever being reported.
				=> RequestOutcome.Sent,

			// This player refused THEM, and has changed their mind. That is allowed, and turns the
			// same document round with the roles swapped.
			FriendshipState.Declined => await ResendAsync(stored, fromUserId, utcNow, ct),

			_ => RequestOutcome.Unchanged,
		};
	}

	/// <summary>Answers a request addressed to this player. Anything else — no request, or one this
	/// player sent themselves — is <see cref="RespondOutcome.NoRequest"/>.</summary>
	public async Task<RespondOutcome> RespondAsync(
		string userId,
		string otherHandle,
		bool accept,
		DateTime utcNow,
		CancellationToken ct = default)
	{
		var other = await AccountByHandleAsync(otherHandle, ct);
		if (other is null)
		{
			return RespondOutcome.NoRequest;
		}

		var stored = await _repository.GetFriendshipAsync(FriendshipKey.For(userId, other.UserId), ct);
		if (stored is null || stored.State != FriendshipState.Pending)
		{
			return RespondOutcome.NoRequest;
		}
		// Answering your own request is not answering anything.
		if (stored.RequestedBy == userId)
		{
			return RespondOutcome.NoRequest;
		}

		await _repository.ReplaceFriendshipAsync(stored with
		{
			State = accept ? FriendshipState.Accepted : FriendshipState.Declined,
			RespondedAtUtc = utcNow,
		}, ct);

		return accept ? RespondOutcome.Accepted : RespondOutcome.Declined;
	}

	/// <summary>
	/// Ends a friendship, from either side. Both are free afterwards: the document is erased, so
	/// either may ask again one day.
	///
	/// It ends FRIENDSHIPS only — a request that is out there cannot be taken back. That is not an
	/// omission. Cancelling would have to fail on a request that had been refused (or the refusal
	/// would be erasable, and "no" would mean "not tonight"), and a cancel button that quietly stops
	/// working is exactly how the asker would learn the answer the refusal is meant to keep private.
	/// A request is a thing you send, like a message, not a thing you keep hold of.
	/// </summary>
	public async Task<bool> RemoveFriendAsync(
		string userId,
		string otherHandle,
		CancellationToken ct = default)
	{
		var other = await AccountByHandleAsync(otherHandle, ct);
		if (other is null)
		{
			return false;
		}

		var stored = await _repository.GetFriendshipAsync(FriendshipKey.For(userId, other.UserId), ct);
		if (stored is null || stored.State != FriendshipState.Accepted)
		{
			return false;
		}

		if (stored.UserA != userId && stored.UserB != userId)
		{
			return false;
		}

		await _repository.DeleteFriendshipAsync(stored.PairId, ct);
		return true;
	}

	/// <summary>
	/// Everything this player is part of, resolved to handles and ordered so a screen reader meets
	/// the same list in the same order every time. A relationship whose other side no longer has an
	/// account, or has given up their handle, is simply absent: there is nothing to name it with.
	/// </summary>
	public async Task<IReadOnlyList<FriendView>> ListAsync(
		string userId,
		CancellationToken ct = default)
	{
		var friendships = await _repository.FriendshipsOfAsync(userId, ct);
		var views = new List<FriendView>();

		foreach (var friendship in friendships)
		{
			var relationship = RelationshipFor(friendship, userId);
			// A refusal is not a relationship anybody lists. The refuser sees nothing; the refused
			// player keeps seeing "asked", which RelationshipFor already reports.
			if (relationship == Relationship.None)
			{
				continue;
			}

			var otherId = FriendshipKey.Other(friendship.UserA, friendship.UserB, userId);
			if (otherId is null)
			{
				continue;
			}

			var other = await _repository.GetUserAsync(otherId, ct);
			if (other?.Handle is not { Length: > 0 } handle)
			{
				continue;
			}

			views.Add(new FriendView(handle, relationship));
		}

		return views
			.OrderBy(view => view.Handle, StringComparer.OrdinalIgnoreCase)
			.ToList();
	}

	/// <summary>
	/// What this player is to each of a set of other accounts, keyed by account id. One read of the
	/// player's own relationships answers the whole online list, rather than one lookup per row.
	/// </summary>
	public async Task<IReadOnlyDictionary<string, Relationship>> RelationshipsForAsync(
		string userId,
		CancellationToken ct = default)
	{
		var friendships = await _repository.FriendshipsOfAsync(userId, ct);
		var byOther = new Dictionary<string, Relationship>(StringComparer.Ordinal);

		foreach (var friendship in friendships)
		{
			var otherId = FriendshipKey.Other(friendship.UserA, friendship.UserB, userId);
			if (otherId is null)
			{
				continue;
			}

			byOther[otherId] = RelationshipFor(friendship, userId);
		}

		return byOther;
	}

	/// <summary>
	/// Erases every relationship an account is part of. Called when the account is deleted: a
	/// friendship is a fact about two people, so leaving half of one behind would keep naming
	/// somebody who asked to be gone.
	/// </summary>
	public async Task ForgetAllAsync(string userId, CancellationToken ct = default)
	{
		foreach (var friendship in await _repository.FriendshipsOfAsync(userId, ct))
		{
			await _repository.DeleteFriendshipAsync(friendship.PairId, ct);
		}
	}

	/// <summary>
	/// How one side sees a stored relationship. The Declined case is the design in one line: for
	/// the refuser it is nothing, and for the person refused it still reads as the request they
	/// sent.
	/// </summary>
	public static Relationship RelationshipFor(FriendshipDocument friendship, string forUserId) =>
		friendship.State switch
		{
			FriendshipState.Accepted => Relationship.Friends,
			FriendshipState.Pending when friendship.RequestedBy == forUserId => Relationship.RequestSent,
			FriendshipState.Pending => Relationship.RequestReceived,
			FriendshipState.Declined when friendship.RequestedBy == forUserId => Relationship.RequestSent,
			_ => Relationship.None,
		};

	private async Task<RequestOutcome> AcceptAsync(
		FriendshipDocument stored, DateTime utcNow, CancellationToken ct)
	{
		await _repository.ReplaceFriendshipAsync(stored with
		{
			State = FriendshipState.Accepted,
			RespondedAtUtc = utcNow,
		}, ct);
		return RequestOutcome.AcceptedTheirs;
	}

	private async Task<RequestOutcome> ResendAsync(
		FriendshipDocument stored, string fromUserId, DateTime utcNow, CancellationToken ct)
	{
		await _repository.ReplaceFriendshipAsync(stored with
		{
			RequestedBy = fromUserId,
			State = FriendshipState.Pending,
			RequestedAtUtc = utcNow,
			RespondedAtUtc = null,
		}, ct);
		return RequestOutcome.Sent;
	}

	/// <summary>The account holding a handle, whoever they are. Used to answer or withdraw, where
	/// the two already know about each other.</summary>
	private async Task<UserDocument?> AccountByHandleAsync(string handle, CancellationToken ct)
	{
		var normalized = PlayerHandle.Normalize(handle ?? string.Empty);
		if (normalized.Length == 0)
		{
			return null;
		}

		var claim = await _repository.GetHandleClaimAsync(normalized, ct);
		// A released handle names nobody: its last holder gave it up.
		if (claim is null || claim.ReleasedAtUtc is not null)
		{
			return null;
		}

		var user = await _repository.GetUserAsync(claim.UserId, ct);
		// The claim is the lock, but the account is the truth: a claim whose holder no longer wears
		// that handle names nobody. Compared in normalized form on both sides, so what the caller
		// typed — spacing, capitals — never decides whether two identical names match.
		return user?.Handle is { Length: > 0 } stored && PlayerHandle.Normalize(stored) == normalized
			? user
			: null;
	}

	/// <summary>
	/// The same, but only if they agreed to be found by strangers. The gate on a FIRST approach by
	/// name: somebody who hides from everyone, or shows only to friends they have not accepted yet,
	/// cannot be reached this way. Sharing a table is the other route, and it does not go through
	/// a handle at all.
	/// </summary>
	private async Task<UserDocument?> ListedAccountByHandleAsync(string handle, CancellationToken ct)
	{
		var user = await AccountByHandleAsync(handle, ct);
		return user?.EffectiveVisibility == PresenceVisibility.Everyone ? user : null;
	}
}
