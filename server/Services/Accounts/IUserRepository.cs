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

	/// <summary>Creates or replaces the account document.</summary>
	Task<UserDocument> UpsertUserAsync(UserDocument user, CancellationToken ct = default);

	/// <summary>Removes the account. Missing is success — deletion must be idempotent so the
	/// erasure path can be retried.</summary>
	Task DeleteUserAsync(string userId, CancellationToken ct = default);

	/// <summary>Removes one identity mapping. Missing is success.</summary>
	Task DeleteIdentityLinkAsync(string identityKey, CancellationToken ct = default);
}
