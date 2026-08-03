using System.Text.Json.Serialization;

namespace CorroServer.Models;

/// <summary>
/// A registered player account. Accounts are entirely OPTIONAL: creating and joining games
/// without one keeps working exactly as before (seat ownership is still the per-seat
/// <c>PlayerSecretId</c> plus the re-entry code). An account only adds durable, cross-device
/// extras on top — saved game history, unlock codes and friends.
///
/// Persisted in the <c>Users</c> container partitioned by <c>/userId</c>, so every read that
/// starts from a signed-in session is a point read.
/// </summary>
public record UserDocument
{
	[JsonPropertyName("id")]
	public required string Id { get; init; } // Cosmos DB requires the lowercase "id" field.

	/// <summary>The account's stable primary key. Never derived from an email or a provider
	/// subject, so neither can change it or collide with it.</summary>
	[JsonPropertyName("userId")]
	public required string UserId { get; init; }

	/// <summary>Name shown to other players. Seeded from the provider profile on first sign-in
	/// and editable afterwards, so it is never treated as a credential. NULL when the provider
	/// supplied no name: the stored document stays neutral and the CLIENT renders a localized
	/// placeholder, rather than freezing an English word into the database.</summary>
	[JsonPropertyName("displayName")]
	public string? DisplayName { get; init; }

	/// <summary>
	/// The public name this player chose to be found by ("kastwey"), stored as they typed it.
	/// NULL until they pick one: a handle is needed to be FOUND, never to play, so nothing asks
	/// for it at sign-in. Unique case-insensitively, which <see cref="HandleClaimDocument"/>
	/// enforces — this field is the display copy, not the lock.
	/// </summary>
	[JsonPropertyName("handle")]
	public string? Handle { get; init; }

	/// <summary>When the handle last changed, so the thirty-day interval can be enforced. NULL
	/// while the player has never set one.</summary>
	[JsonPropertyName("handleChangedAtUtc")]
	public DateTime? HandleChangedAtUtc { get; init; }

	/// <summary>
	/// Whether this player appears in the list of who is connected.
	///
	/// Only the HANDLE is ever published there — never <see cref="DisplayName"/>, which is seeded
	/// from the provider profile and is usually somebody's real name. A handle is chosen to be
	/// public; a name imported from Google was not.
	/// </summary>
	[JsonPropertyName("listedPublicly")]
	public bool ListedPublicly { get; init; }

	/// <summary>Contact address, for display only. Deliberately NOT an identity key: providers
	/// hand out unverified and reassignable addresses, so matching accounts on it would be an
	/// account-takeover vector. See <see cref="LinkedIdentity"/>.</summary>
	[JsonPropertyName("email")]
	public string? Email { get; init; }

	/// <summary>Every external login that resolves to this account. More than one entry means
	/// the player explicitly linked a second provider while already signed in.</summary>
	[JsonPropertyName("identities")]
	public List<LinkedIdentity> Identities { get; init; } = new();

	[JsonPropertyName("createdAtUtc")]
	public DateTime CreatedAtUtc { get; init; }

	[JsonPropertyName("lastSignInUtc")]
	public DateTime LastSignInUtc { get; init; }
}

/// <summary>
/// One external login bound to a <see cref="UserDocument"/>. The identity is the
/// (issuer, subject) pair the provider asserts — never the email address.
/// </summary>
public record LinkedIdentity
{
	/// <summary>The provider key ("google", "microsoft"): which authority asserted the subject.</summary>
	[JsonPropertyName("issuer")]
	public required string Issuer { get; init; }

	/// <summary>The provider's immutable identifier for this person (the OIDC <c>sub</c> claim).
	/// Opaque and CASE-SENSITIVE — never normalize it.</summary>
	[JsonPropertyName("subject")]
	public required string Subject { get; init; }

	/// <summary>The address this provider reported, kept per-identity so the player can see which
	/// account they linked. Display only.</summary>
	[JsonPropertyName("email")]
	public string? Email { get; init; }

	[JsonPropertyName("linkedAtUtc")]
	public DateTime LinkedAtUtc { get; init; }
}

/// <summary>
/// The lookup that turns a provider login into an account. Sign-in reads by (issuer, subject),
/// which is NOT the user partition key, so the mapping lives in its own <c>Identities</c>
/// container partitioned by the composite key itself — making the hot sign-in path a point read
/// instead of a cross-partition query.
///
/// It is also the concurrency guard for first sign-in: the container rejects a duplicate id, so
/// two simultaneous logins for the same identity cannot create two accounts.
/// </summary>
public record IdentityLinkDocument
{
	[JsonPropertyName("id")]
	public required string Id { get; init; } // Equals IdentityKey; also the partition key.

	/// <summary>The composite key built by <c>IdentityKey.For</c> ("google:1234567890").</summary>
	[JsonPropertyName("identityKey")]
	public required string IdentityKey { get; init; }

	[JsonPropertyName("userId")]
	public required string UserId { get; init; }

	[JsonPropertyName("createdAtUtc")]
	public DateTime CreatedAtUtc { get; init; }
}

/// <summary>
/// One handle, held by one account. Lives in its own container partitioned by the normalized
/// handle, for the same two reasons the identity link does: the lookup is a point read, and the
/// container's duplicate-id rejection IS the concurrency guard — two players claiming "@ana" at
/// once cannot both win.
///
/// A handle given up is not deleted. It keeps its claim with <see cref="ReleasedAtUtc"/> set, so
/// it stays untakeable for a cooldown: a name released today and grabbed this afternoon would let
/// a stranger wear it in front of everyone who learned it yesterday.
/// </summary>
public record HandleClaimDocument
{
	[JsonPropertyName("id")]
	public required string Id { get; init; } // The normalized handle; also the partition key.

	/// <summary>Lower-cased handle: what uniqueness is decided on.</summary>
	[JsonPropertyName("handle")]
	public required string Handle { get; init; }

	/// <summary>The account holding it — or the one that last held it, once released.</summary>
	[JsonPropertyName("userId")]
	public required string UserId { get; init; }

	[JsonPropertyName("claimedAtUtc")]
	public DateTime ClaimedAtUtc { get; init; }

	/// <summary>Set when the handle was given up (changed, or the account deleted). NULL while
	/// it is actually in use.</summary>
	[JsonPropertyName("releasedAtUtc")]
	public DateTime? ReleasedAtUtc { get; init; }
}
