using CorroServer.Models;

namespace CorroServer.Services.Accounts;

/// <summary>
/// Durable storage for player accounts. Deliberately plain CRUD plus ONE concurrency primitive
/// (<see cref="CreateOrGetIdentityLinkAsync"/>): the sign-in policy — create on first login, link a
/// second provider, heal a half-written account — lives in <see cref="UserAccountService"/> so it can
/// be unit tested against the in-memory implementation.
/// </summary>
public interface IUserRepository
{
	/// <summary>The account, or null when it does not exist.</summary>
	Task<UserDocument?> GetUserAsync(string userId, CancellationToken ct = default);

	/// <summary>The account bound to an external login, or null when that login is unknown.</summary>
	Task<IdentityLinkDocument?> GetIdentityLinkAsync(string identityKey, CancellationToken ct = default);

	/// <summary>
	/// Stores the identity → account mapping, and is the race guard for first sign-in: when the
	/// mapping already exists the STORED one is returned untouched, so two simultaneous logins for the
	/// same identity converge on a single account instead of creating two. Callers must treat a
	/// returned document whose <c>UserId</c> differs from the one they submitted as "somebody else won".
	/// </summary>
	Task<IdentityLinkDocument> CreateOrGetIdentityLinkAsync(IdentityLinkDocument link, CancellationToken ct = default);

	/// <summary>
	/// The providers some OTHER account with this address signs in with, or empty when there is no
	/// such account. Used for one thing only: telling somebody who has just made a second account
	/// that their first one exists — and WHICH service opens it, because "the one you used last
	/// time" is exactly what a person in that situation cannot remember.
	///
	/// NEVER used to match accounts. The matching rule is (issuer, subject), and reading an address
	/// as identity would be the takeover route the whole design avoids.
	/// </summary>
	Task<IReadOnlyList<string>> OtherAccountProvidersForEmailAsync(
		string email, string exceptUserId, CancellationToken ct = default);

	/// <summary>Creates or replaces the account document.</summary>
	Task<UserDocument> UpsertUserAsync(UserDocument user, CancellationToken ct = default);

	/// <summary>Removes the account. Missing is success — deletion must be idempotent so the
	/// erasure path can be retried.</summary>
	Task DeleteUserAsync(string userId, CancellationToken ct = default);

	/// <summary>Removes one identity mapping. Missing is success.</summary>
	Task DeleteIdentityLinkAsync(string identityKey, CancellationToken ct = default);

	/// <summary>The claim on a normalized handle, or null when nobody has ever held it.</summary>
	Task<HandleClaimDocument?> GetHandleClaimAsync(string normalizedHandle, CancellationToken ct = default);

	/// <summary>
	/// Claims a handle, and is the race guard for it — exactly as
	/// <see cref="CreateOrGetIdentityLinkAsync"/> is for first sign-in: when the handle is already
	/// claimed the STORED claim comes back untouched, so two players asking for "@ana" at the same
	/// moment cannot both be told yes. Callers must treat a returned claim whose <c>UserId</c>
	/// differs from theirs as "somebody else won".
	/// </summary>
	Task<HandleClaimDocument> CreateOrGetHandleClaimAsync(
		HandleClaimDocument claim, CancellationToken ct = default);

	/// <summary>
	/// Overwrites a claim this caller already owns: taking a released handle back, or marking one
	/// as released. Never used to take somebody else's — that decision belongs to the service.
	/// </summary>
	Task<HandleClaimDocument> ReplaceHandleClaimAsync(
		HandleClaimDocument claim, CancellationToken ct = default);

	/// <summary>What two accounts are to each other, or null when neither has ever asked.</summary>
	Task<FriendshipDocument?> GetFriendshipAsync(string pairId, CancellationToken ct = default);

	/// <summary>
	/// Records a first request, and is the race guard for it — the third use of the same pattern
	/// as sign-in and handles. Two people who ask each other at the same instant get ONE request
	/// (the stored one comes back), never two mirrored ones that would each wait for the other.
	/// </summary>
	Task<FriendshipDocument> CreateOrGetFriendshipAsync(
		FriendshipDocument friendship, CancellationToken ct = default);

	/// <summary>Overwrites an existing relationship: answering a request, or asking again after
	/// having refused one.</summary>
	Task<FriendshipDocument> ReplaceFriendshipAsync(
		FriendshipDocument friendship, CancellationToken ct = default);

	/// <summary>Ends a relationship outright. Missing is success.</summary>
	Task DeleteFriendshipAsync(string pairId, CancellationToken ct = default);

	/// <summary>
	/// Every relationship one account is part of, in any state. A cross-partition read of a small
	/// container, run when somebody opens their friends list — never on a hot path. The alternative,
	/// mirroring each friendship onto both sides, buys a point read with two documents that can
	/// drift apart, and a friendship that disagrees with itself is worse than a slower query.
	/// </summary>
	Task<IReadOnlyList<FriendshipDocument>> FriendshipsOfAsync(
		string userId, CancellationToken ct = default);
}
