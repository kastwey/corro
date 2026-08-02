using CorroServer.Models;

namespace CorroServer.Services.Accounts;

/// <summary>
/// What a provider asserted about the person who just signed in. The identity is
/// (<see cref="Issuer"/>, <see cref="Subject"/>) and nothing else; the name and address are
/// profile decoration.
/// </summary>
/// <param name="Issuer">Provider key ("google", "microsoft").</param>
/// <param name="Subject">The provider's immutable id for this person (OIDC <c>sub</c>).</param>
/// <param name="DisplayName">Profile name, when the provider supplied one.</param>
/// <param name="Email">Address the provider reported. Stored for display only.</param>
/// <param name="EmailVerified">
/// Whether the provider says it CHECKED that address, from the `email_verified` claim. Never used
/// to match accounts — the matching rule is (issuer, subject) and nothing else — but it decides
/// whether the address is trustworthy enough to mention out loud. A work/school Microsoft account's
/// address is a directory attribute a tenant admin sets, so it arrives unverified, and telling
/// somebody "an account already exists with this address" on that basis would answer a question
/// they had no right to ask.
/// </param>
public sealed record ExternalIdentity(
	string Issuer,
	string Subject,
	string? DisplayName,
	string? Email,
	bool EmailVerified = false);

/// <summary>Why an attempt to add a provider to an account ended the way it did.</summary>
public enum LinkOutcome
{
	Linked,
	/// <summary>This exact login already belongs to this account — nothing to do.</summary>
	AlreadyLinked,
	/// <summary>The account already has a different login from this provider. One per provider
	/// keeps "unlink Google" unambiguous.</summary>
	ProviderAlreadyUsed,
	/// <summary>Another account owns this login. Moving it would silently take a provider away
	/// from whoever holds it, so it is refused.</summary>
	ClaimedByAnotherAccount,
	AccountNotFound,
}

/// <summary>Why an attempt to remove a provider from an account ended the way it did.</summary>
public enum UnlinkOutcome
{
	Unlinked,
	NotLinked,
	/// <summary>It was the last way in. Removing it would leave an account nobody can ever sign
	/// into again — the data would still exist, permanently unreachable.</summary>
	WouldLockAccountOut,
	AccountNotFound,
}

/// <param name="Outcome">What happened.</param>
/// <param name="User">The account after the change; null unless the outcome changed something.</param>
public sealed record LinkResult(LinkOutcome Outcome, UserDocument? User);

/// <param name="Outcome">What happened.</param>
/// <param name="User">The account after the change; null unless the outcome changed something.</param>
public sealed record UnlinkResult(UnlinkOutcome Outcome, UserDocument? User);

/// <summary>
/// Turns a completed provider login into an account.
///
/// The one rule that matters here: accounts are matched ONLY on (issuer, subject). Two different
/// providers reporting the same email address produce two separate accounts, on purpose — merging
/// them automatically is the classic account-takeover route, because an address can be unverified,
/// reassigned, or simply typed into a provider that does not check it. Joining two providers into
/// one account is a deliberate action taken from inside an authenticated session, not something
/// sign-in ever infers.
/// </summary>
public sealed class UserAccountService
{
	private readonly IUserRepository _repository;
	private readonly ILogger<UserAccountService> _logger;

	public UserAccountService(IUserRepository repository, ILogger<UserAccountService> logger)
	{
		_repository = repository;
		_logger = logger;
	}

	/// <summary>
	/// The account for a completed login, creating it on first sign-in. Safe to run concurrently:
	/// the identity mapping is claimed before the account is written, so simultaneous first logins
	/// converge on one account rather than racing to create two.
	/// </summary>
	public async Task<UserDocument> SignInAsync(
		ExternalIdentity identity,
		DateTime utcNow,
		CancellationToken ct = default)
	{
		var identityKey = IdentityKey.For(identity.Issuer, identity.Subject);

		var existingLink = await _repository.GetIdentityLinkAsync(identityKey, ct);
		if (existingLink is not null)
		{
			return await ReturningSignInAsync(existingLink.UserId, identity, identityKey, utcNow, ct);
		}

		// Claim the identity FIRST. If another request claimed it in the meantime we get their
		// document back and adopt their account, so no second account is ever written.
		var intendedUserId = IdGenerator.UserId();
		var link = await _repository.CreateOrGetIdentityLinkAsync(
			new IdentityLinkDocument
			{
				Id = identityKey,
				IdentityKey = identityKey,
				UserId = intendedUserId,
				CreatedAtUtc = utcNow,
			},
			ct);

		if (link.UserId != intendedUserId)
		{
			return await ReturningSignInAsync(link.UserId, identity, identityKey, utcNow, ct);
		}

		var user = new UserDocument
		{
			Id = intendedUserId,
			UserId = intendedUserId,
			DisplayName = Clean(identity.DisplayName),
			Email = Clean(identity.Email),
			Identities = { NewIdentity(identity, utcNow) },
			CreatedAtUtc = utcNow,
			LastSignInUtc = utcNow,
		};

		_logger.LogInformation("Created account {UserId} from a first {Issuer} sign-in.", user.UserId, identity.Issuer);
		return await _repository.UpsertUserAsync(user, ct);
	}

	/// <summary>
	/// Which providers open the account the player ALREADY had, when this sign-in has just made them
	/// a second one without meaning to. Empty means there is nothing to tell them.
	///
	/// Signing in with Google and then with Microsoft using the same address gives two separate
	/// accounts, on purpose (see the class summary). That is right, and it is also the single most
	/// surprising thing about this feature — somebody meets it as "where did my tables go?". So
	/// when it happens, say so.
	///
	/// Three conditions, and each one is a refusal to guess:
	///
	///  * the account was created by THIS sign-in. Saying it every time would be nagging, and after
	///    the first time the player has already been told;
	///  * the provider VERIFIED the address. A work/school Microsoft address is a directory
	///    attribute an admin can set to anything, so acting on an unverified one would let a
	///    stranger with their own tenant ask this service whether you have an account here;
	///  * another account actually holds it.
	///
	/// Nothing is merged and nothing is changed. The player is told, and linking stays what it has
	/// always been: a deliberate act from inside a session that already holds both logins.
	/// </summary>
	/// <returns>
	/// The providers that open the OTHER account, or empty when there is nothing to say. Naming
	/// them is most of the value: "sign in with the service you used last time" is a riddle to
	/// somebody who cannot remember which one that was, and we know because we just found the
	/// account.
	/// </returns>
	public async Task<IReadOnlyList<string>> ExistingAccountProvidersAsync(
		UserDocument user,
		ExternalIdentity identity,
		CancellationToken ct = default)
	{
		if (user.CreatedAtUtc != user.LastSignInUtc)
		{
			return Array.Empty<string>(); // a returning account, not one just made
		}

		var email = Clean(identity.Email);
		if (!identity.EmailVerified || string.IsNullOrWhiteSpace(email))
		{
			return Array.Empty<string>();
		}

		return await _repository.OtherAccountProvidersForEmailAsync(email, user.UserId, ct);
	}

	/// <summary>The account behind an established session, or null when it has since been erased.</summary>
	public Task<UserDocument?> GetAccountAsync(string userId, CancellationToken ct = default) =>
		_repository.GetUserAsync(userId, ct);

	/// <summary>
	/// Adds a second provider to an account the player is ALREADY signed into. This is the only way
	/// two providers ever end up on one account — sign-in never infers it — because the player
	/// proving they hold both logins is the whole security argument.
	///
	/// A login already owned by another account is refused rather than moved. Moving it would take a
	/// provider away from whoever currently holds it, which is the takeover this design exists to
	/// prevent, just approached from the other side.
	/// </summary>
	public async Task<LinkResult> LinkIdentityAsync(
		string userId,
		ExternalIdentity identity,
		DateTime utcNow,
		CancellationToken ct = default)
	{
		var identityKey = IdentityKey.For(identity.Issuer, identity.Subject);

		var user = await _repository.GetUserAsync(userId, ct);
		if (user is null)
		{
			return new LinkResult(LinkOutcome.AccountNotFound, null);
		}

		var existingLink = await _repository.GetIdentityLinkAsync(identityKey, ct);
		if (existingLink is not null)
		{
			return existingLink.UserId == userId
				? new LinkResult(LinkOutcome.AlreadyLinked, user)
				: new LinkResult(LinkOutcome.ClaimedByAnotherAccount, null);
		}

		// One identity per issuer: it is what lets the settings screen show a single row per provider
		// and lets "unlink Google" mean exactly one thing.
		if (user.Identities.Any(i => i.Issuer == identity.Issuer))
		{
			return new LinkResult(LinkOutcome.ProviderAlreadyUsed, user);
		}

		// Claim the mapping the same way first sign-in does, so a login being linked here and signed
		// into elsewhere at the same moment cannot end up on two accounts.
		var claimed = await _repository.CreateOrGetIdentityLinkAsync(
			new IdentityLinkDocument
			{
				Id = identityKey,
				IdentityKey = identityKey,
				UserId = userId,
				CreatedAtUtc = utcNow,
			},
			ct);

		if (claimed.UserId != userId)
		{
			return new LinkResult(LinkOutcome.ClaimedByAnotherAccount, null);
		}

		var updated = await _repository.UpsertUserAsync(
			user with { Identities = user.Identities.Append(NewIdentity(identity, utcNow)).ToList() },
			ct);

		_logger.LogInformation("Linked {Issuer} to account {UserId}.", identity.Issuer, userId);
		return new LinkResult(LinkOutcome.Linked, updated);
	}

	/// <summary>
	/// Removes a provider from an account, refusing when it is the last one. That guard is not
	/// politeness: an account with no identity has no way back in, so the player would lose it
	/// silently while all their data sat there permanently unreachable. Erasing the account is the
	/// deliberate way to get rid of it.
	/// </summary>
	public async Task<UnlinkResult> UnlinkIdentityAsync(
		string userId,
		string issuer,
		CancellationToken ct = default)
	{
		var user = await _repository.GetUserAsync(userId, ct);
		if (user is null)
		{
			return new UnlinkResult(UnlinkOutcome.AccountNotFound, null);
		}

		var identity = user.Identities.FirstOrDefault(i => i.Issuer == issuer);
		if (identity is null)
		{
			return new UnlinkResult(UnlinkOutcome.NotLinked, user);
		}

		if (user.Identities.Count <= 1)
		{
			return new UnlinkResult(UnlinkOutcome.WouldLockAccountOut, user);
		}

		// The account document loses the identity FIRST. If the mapping deletion then fails, sign-in
		// finds a mapping the account no longer lists and re-records it — recoverable. The reverse
		// order would leave the account advertising a provider that can no longer resolve to it.
		var updated = await _repository.UpsertUserAsync(
			user with { Identities = user.Identities.Where(i => i.Issuer != issuer).ToList() },
			ct);
		await _repository.DeleteIdentityLinkAsync(IdentityKey.For(identity.Issuer, identity.Subject), ct);

		_logger.LogInformation("Unlinked {Issuer} from account {UserId}.", issuer, userId);
		return new UnlinkResult(UnlinkOutcome.Unlinked, updated);
	}

	/// <summary>
	/// Sets the name other players see. A blank name is stored as null rather than an empty string,
	/// so the client falls back to its localized placeholder instead of rendering nothing.
	/// Returns null when the account no longer exists.
	/// </summary>
	public async Task<UserDocument?> RenameAsync(
		string userId,
		string? displayName,
		CancellationToken ct = default)
	{
		var user = await _repository.GetUserAsync(userId, ct);
		if (user is null)
		{
			return null;
		}

		return await _repository.UpsertUserAsync(user with { DisplayName = Clean(displayName) }, ct);
	}

	/// <summary>
	/// Erases the account and every identity mapping that points at it, so the provider logins are
	/// released and a later sign-in starts a genuinely new account. Identity mappings go first: an
	/// orphaned mapping would otherwise keep resolving to an account that no longer exists.
	/// </summary>
	public async Task DeleteAccountAsync(string userId, CancellationToken ct = default)
	{
		var user = await _repository.GetUserAsync(userId, ct);
		if (user is not null)
		{
			foreach (var identity in user.Identities)
			{
				await _repository.DeleteIdentityLinkAsync(
					IdentityKey.For(identity.Issuer, identity.Subject),
					ct);
			}
		}

		await _repository.DeleteUserAsync(userId, ct);
		_logger.LogInformation("Erased account {UserId} and its identity links.", userId);
	}

	/// <summary>
	/// A login whose identity is already mapped. Refreshes the profile the provider reported and
	/// stamps the sign-in.
	///
	/// It also HEALS a half-written account: the mapping is stored before the account document, so a
	/// crash in between leaves a mapping pointing at nothing. Recreating the account under the same
	/// id is what keeps that player's identity stable instead of stranding them behind a mapping
	/// they can never get past.
	/// </summary>
	private async Task<UserDocument> ReturningSignInAsync(
		string userId,
		ExternalIdentity identity,
		string identityKey,
		DateTime utcNow,
		CancellationToken ct)
	{
		var stored = await _repository.GetUserAsync(userId, ct);
		if (stored is null)
		{
			_logger.LogWarning(
				"Identity {IdentityKey} maps to missing account {UserId}; recreating it.",
				identityKey,
				userId);

			return await _repository.UpsertUserAsync(
				new UserDocument
				{
					Id = userId,
					UserId = userId,
					DisplayName = Clean(identity.DisplayName),
					Email = Clean(identity.Email),
					Identities = { NewIdentity(identity, utcNow) },
					CreatedAtUtc = utcNow,
					LastSignInUtc = utcNow,
				},
				ct);
		}

		var identities = stored.Identities.ToList();
		var index = identities.FindIndex(i =>
			IdentityKey.For(i.Issuer, i.Subject) == identityKey);

		if (index >= 0)
		{
			// Refresh the address this provider now reports; the identity itself never changes.
			identities[index] = identities[index] with { Email = Clean(identity.Email) };
		}
		else
		{
			// The mapping resolved here but the account did not list it — a link interrupted
			// midway. Record it so the account and its mappings agree again.
			identities.Add(NewIdentity(identity, utcNow));
		}

		return await _repository.UpsertUserAsync(
			stored with
			{
				Identities = identities,
				// Keep a name the player may have edited; only fill a blank one.
				DisplayName = stored.DisplayName ?? Clean(identity.DisplayName),
				Email = stored.Email ?? Clean(identity.Email),
				LastSignInUtc = utcNow,
			},
			ct);
	}

	private static LinkedIdentity NewIdentity(ExternalIdentity identity, DateTime utcNow) => new()
	{
		Issuer = identity.Issuer,
		Subject = identity.Subject,
		Email = Clean(identity.Email),
		LinkedAtUtc = utcNow,
	};

	/// <summary>
	/// Longest name other players will see. Generous enough for a real full name from a provider
	/// profile, short enough that it cannot crowd out a player list.
	/// </summary>
	public const int MaxDisplayNameLength = 40;

	/// <summary>
	/// Whether a name a PLAYER typed is acceptable. Player input is rejected rather than truncated,
	/// because they can fix it and silently shortening what they typed is surprising. A name a
	/// PROVIDER supplied is truncated instead — the player has no way to correct that one, so
	/// refusing it would just block their sign-in.
	/// </summary>
	public static bool IsValidDisplayName(string? displayName) =>
		(displayName ?? string.Empty).Trim().Length <= MaxDisplayNameLength;

	/// <summary>Blank-as-absent: a provider sending "" or "   " must not become a name that renders
	/// as an empty label instead of the client's localized placeholder.</summary>
	private static string? Clean(string? value)
	{
		if (string.IsNullOrWhiteSpace(value))
		{
			return null;
		}

		var trimmed = value.Trim();
		return trimmed.Length <= MaxDisplayNameLength ? trimmed : trimmed[..MaxDisplayNameLength];
	}
}
