using System.Collections.Concurrent;
using CorroServer.Models;

namespace CorroServer.Services.Accounts;

/// <summary>
/// Process-local account store. Mirrors <see cref="InMemoryGameRepository"/>: it is what a
/// clone-and-run or offline session gets when no Cosmos connection string is configured (accounts
/// then last only as long as the process), and what the unit tests exercise the sign-in policy
/// against without an emulator.
/// </summary>
public class InMemoryUserRepository : IUserRepository
{
	private readonly ConcurrentDictionary<string, UserDocument> _users = new();
	private readonly ConcurrentDictionary<string, IdentityLinkDocument> _identities = new();
	private readonly ConcurrentDictionary<string, HandleClaimDocument> _handles = new();
	private readonly ConcurrentDictionary<string, FriendshipDocument> _friendships = new();

	public Task<UserDocument?> GetUserAsync(string userId, CancellationToken ct = default) =>
		Task.FromResult(_users.GetValueOrDefault(userId));

	public Task<IdentityLinkDocument?> GetIdentityLinkAsync(string identityKey, CancellationToken ct = default) =>
		Task.FromResult(_identities.GetValueOrDefault(identityKey));

	/// <summary>GetOrAdd gives exactly the semantics the interface asks for: the first writer wins
	/// and every later caller receives that same stored document.</summary>
	public Task<IdentityLinkDocument> CreateOrGetIdentityLinkAsync(
		IdentityLinkDocument link,
		CancellationToken ct = default) =>
		Task.FromResult(_identities.GetOrAdd(link.IdentityKey, link));

	public Task<IReadOnlyList<string>> OtherAccountProvidersForEmailAsync(
		string email, string exceptUserId, CancellationToken ct = default)
		=> Task.FromResult<IReadOnlyList<string>>(_users.Values
			.Where(u => u.UserId != exceptUserId
				&& !string.IsNullOrWhiteSpace(u.Email)
				&& string.Equals(u.Email, email, StringComparison.OrdinalIgnoreCase))
			.SelectMany(u => u.Identities.Select(i => i.Issuer))
			.Distinct(StringComparer.OrdinalIgnoreCase)
			.ToList());

	public Task<UserDocument> UpsertUserAsync(UserDocument user, CancellationToken ct = default)
	{
		_users[user.UserId] = user;
		return Task.FromResult(user);
	}

	public Task DeleteUserAsync(string userId, CancellationToken ct = default)
	{
		_users.TryRemove(userId, out _);
		return Task.CompletedTask;
	}

	public Task DeleteIdentityLinkAsync(string identityKey, CancellationToken ct = default)
	{
		_identities.TryRemove(identityKey, out _);
		return Task.CompletedTask;
	}

	public Task<HandleClaimDocument?> GetHandleClaimAsync(
		string normalizedHandle, CancellationToken ct = default) =>
		Task.FromResult(_handles.GetValueOrDefault(normalizedHandle));

	/// <summary>Same semantics as the identity link: the first writer wins and everybody else is
	/// handed the stored claim, which is what tells them they lost.</summary>
	public Task<HandleClaimDocument> CreateOrGetHandleClaimAsync(
		HandleClaimDocument claim, CancellationToken ct = default) =>
		Task.FromResult(_handles.GetOrAdd(claim.Handle, claim));

	public Task<HandleClaimDocument> ReplaceHandleClaimAsync(
		HandleClaimDocument claim, CancellationToken ct = default)
	{
		_handles[claim.Handle] = claim;
		return Task.FromResult(claim);
	}

	public Task<FriendshipDocument?> GetFriendshipAsync(string pairId, CancellationToken ct = default) =>
		Task.FromResult(_friendships.GetValueOrDefault(pairId));

	/// <summary>Same first-writer-wins semantics as the identity link and the handle claim.</summary>
	public Task<FriendshipDocument> CreateOrGetFriendshipAsync(
		FriendshipDocument friendship, CancellationToken ct = default) =>
		Task.FromResult(_friendships.GetOrAdd(friendship.PairId, friendship));

	public Task<FriendshipDocument> ReplaceFriendshipAsync(
		FriendshipDocument friendship, CancellationToken ct = default)
	{
		_friendships[friendship.PairId] = friendship;
		return Task.FromResult(friendship);
	}

	public Task DeleteFriendshipAsync(string pairId, CancellationToken ct = default)
	{
		_friendships.TryRemove(pairId, out _);
		return Task.CompletedTask;
	}

	public Task<IReadOnlyList<FriendshipDocument>> FriendshipsOfAsync(
		string userId, CancellationToken ct = default) =>
		Task.FromResult<IReadOnlyList<FriendshipDocument>>(_friendships.Values
			.Where(f => f.UserA == userId || f.UserB == userId)
			.ToList());
}