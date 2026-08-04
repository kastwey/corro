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

/// <summary>Why joining two accounts ended the way it did.</summary>
public enum MergeOutcome
{
	/// <summary>They are now one account.</summary>
	Merged,
	/// <summary>That login belongs to nobody else, so there was nothing to join.</summary>
	NothingToMerge,
	AccountNotFound,
}

/// <param name="SeatsMoved">How many table seats changed hands; reported so the player is told
/// what happened to their games rather than left to check.</param>
public sealed record MergeResult(MergeOutcome Outcome, UserDocument? User, int SeatsMoved);

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
			// Only friends, from the start. It shows them to NOBODY until they accept somebody, so
			// the safe default and the useful one are the same choice — and the moment they make a
			// friend it does what they would expect, without asking them again.
			Visibility = PresenceVisibility.Friends,
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

	/// <summary>
	/// Join two accounts that turn out to be one person, keeping the OLDER one.
	///
	/// WHAT AUTHORISES IT is the same evidence that authorises linking, which is why this is not a
	/// hole in the (issuer, subject) rule: the caller is signed into one account AND has just
	/// completed a login that opens the other. Holding both is what proves they own both. Nothing
	/// here is ever reached by asserting an email address.
	///
	/// WHICH ONE SURVIVES is the older, because the newer is almost always the one made seconds ago
	/// by the login that started this — it has nothing in it, and the account with the history is
	/// the one whose id other things already point at.
	///
	/// THE ORDER OF WRITES is chosen so a failure part-way through loses nothing:
	///
	///  1. seats move first. Interrupted here, the survivor has gained tables and the loser still
	///     has its login — untidy, and every table is reachable.
	///  2. then the loser's logins are re-pointed at the survivor, one at a time. Interrupted here,
	///     the moved ones open the survivor and the rest still open the loser.
	///  3. the empty account is deleted last. Interrupted here, nothing is lost: an account with no
	///     logins is unreachable, but it holds nothing either.
	///
	/// The reverse order would strand tables under an account nobody can sign into, which is the one
	/// outcome worth engineering against.
	/// </summary>
	public async Task<MergeResult> MergeAccountsAsync(
		string signedInUserId,
		ExternalIdentity provenIdentity,
		Func<string, string, CancellationToken, Task<int>> reassignSeats,
		DateTime utcNow,
		CancellationToken ct = default)
	{
		var provenKey = IdentityKey.For(provenIdentity.Issuer, provenIdentity.Subject);
		var provenLink = await _repository.GetIdentityLinkAsync(provenKey, ct);
		if (provenLink is null || provenLink.UserId == signedInUserId)
		{
			// Nothing to merge: that login is unclaimed (an ordinary link) or already ours.
			return new MergeResult(MergeOutcome.NothingToMerge, null, 0);
		}

		var signedIn = await _repository.GetUserAsync(signedInUserId, ct);
		var other = await _repository.GetUserAsync(provenLink.UserId, ct);
		if (signedIn is null || other is null)
		{
			return new MergeResult(MergeOutcome.AccountNotFound, null, 0);
		}

		var (survivor, absorbed) = signedIn.CreatedAtUtc <= other.CreatedAtUtc
			? (signedIn, other)
			: (other, signedIn);

		var movedSeats = await reassignSeats(absorbed.UserId, survivor.UserId, ct);

		var identities = survivor.Identities.ToList();
		foreach (var identity in absorbed.Identities)
		{
			// One login per provider is the account's own rule; a duplicate provider means the
			// survivor already has a way in through it, so the absorbed one is simply dropped.
			if (identities.Any(i => string.Equals(i.Issuer, identity.Issuer, StringComparison.OrdinalIgnoreCase)))
			{
				await _repository.DeleteIdentityLinkAsync(IdentityKey.For(identity.Issuer, identity.Subject), ct);
				continue;
			}

			identities.Add(identity);
			await _repository.CreateOrGetIdentityLinkAsync(
				new IdentityLinkDocument
				{
					Id = IdentityKey.For(identity.Issuer, identity.Subject),
					IdentityKey = IdentityKey.For(identity.Issuer, identity.Subject),
					UserId = survivor.UserId,
					CreatedAtUtc = utcNow,
				},
				ct);
		}

		var merged = await _repository.UpsertUserAsync(
			survivor with { Identities = identities, LastSignInUtc = utcNow },
			ct);

		await _repository.DeleteUserAsync(absorbed.UserId, ct);

		_logger.LogInformation(
			"Merged account {Absorbed} into {Survivor}: {Seats} seat(s) moved, {Logins} login(s) adopted.",
			absorbed.UserId, survivor.UserId, movedSeats, absorbed.Identities.Count);

		return new MergeResult(MergeOutcome.Merged, merged, movedSeats);
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
	///
	/// The time is passed in, like every other method here that stamps one. It used to read the
	/// clock itself, which made the handle's release cooldown depend on when the test happened to
	/// run: the suite compared a fixed date against a real one, and passed only while the two stayed
	/// close enough. That is a test that fails on a Tuesday for no reason anybody changed.
	/// </summary>
	public async Task DeleteAccountAsync(
		string userId, DateTime utcNow, CancellationToken ct = default)
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

		// The handle is RELEASED, not deleted: it stays untakeable for its cooldown, so nobody can
		// pick up the name somebody's friends learned last week and wear it in front of them.
		if (user?.Handle is { Length: > 0 } handle)
		{
			var normalized = PlayerHandle.Normalize(handle);
			var claim = await _repository.GetHandleClaimAsync(normalized, ct);
			if (claim is not null && claim.UserId == userId && claim.ReleasedAtUtc is null)
			{
				await _repository.ReplaceHandleClaimAsync(
					claim with { ReleasedAtUtc = utcNow }, ct);
			}
		}

		// Friendships go completely, unlike the handle: a friendship is a fact about TWO people, so
		// half of one left behind would keep naming somebody who asked to be gone — on the other
		// person's list, where they cannot reach it.
		foreach (var friendship in await _repository.FriendshipsOfAsync(userId, ct))
		{
			await _repository.DeleteFriendshipAsync(friendship.PairId, ct);
		}

		await _repository.DeleteUserAsync(userId, ct);
		_logger.LogInformation("Erased account {UserId}, its identity links and its friendships.", userId);
	}

	/// <summary>Why a handle could not be set. Each one is a different thing to tell the player.</summary>
	public enum HandleOutcome
	{
		Ok,
		Invalid,
		Taken,
		TooSoon,
		NoSuchAccount,
	}

	public readonly record struct HandleResult(
		HandleOutcome Outcome,
		UserDocument? User = null,
		PlayerHandle.Rejection Rejection = PlayerHandle.Rejection.None,
		DateTime? ChangeableAtUtc = null);

	/// <summary>
	/// Claim a handle, or change to another one.
	///
	/// The order matters and is the same order first sign-in uses: the NAME is claimed before the
	/// account is updated, so two players asking for "@ana" at once cannot both be told yes. The
	/// loser finds somebody else's id in the claim that comes back and is refused.
	/// </summary>
	public async Task<HandleResult> SetHandleAsync(
		string userId,
		string requested,
		DateTime utcNow,
		CancellationToken ct = default)
	{
		var rejection = PlayerHandle.Validate(requested);
		if (rejection != PlayerHandle.Rejection.None)
		{
			return new HandleResult(HandleOutcome.Invalid, Rejection: rejection);
		}

		var user = await _repository.GetUserAsync(userId, ct);
		if (user is null) return new HandleResult(HandleOutcome.NoSuchAccount);

		var normalized = PlayerHandle.Normalize(requested);
		var current = user.Handle is { Length: > 0 } held ? PlayerHandle.Normalize(held) : null;

		// Re-typing the same name, in any casing, is not a change: it only restyles what is shown,
		// so it must not spend the thirty days somebody may need for a real one.
		if (current == normalized)
		{
			var restyled = user with { Handle = requested.Trim() };
			return new HandleResult(HandleOutcome.Ok, await _repository.UpsertUserAsync(restyled, ct));
		}

		if (!PlayerHandle.CanChange(user.HandleChangedAtUtc, utcNow))
		{
			return new HandleResult(
				HandleOutcome.TooSoon,
				ChangeableAtUtc: user.HandleChangedAtUtc!.Value + PlayerHandle.ChangeInterval);
		}

		var claim = await _repository.CreateOrGetHandleClaimAsync(
			new HandleClaimDocument
			{
				Id = normalized,
				Handle = normalized,
				UserId = userId,
				ClaimedAtUtc = utcNow,
			},
			ct);

		if (claim.UserId != userId || claim.ReleasedAtUtc is not null)
		{
			// Somebody holds it, or held it recently. Taking it over is only allowed once a
			// released claim has cooled down — or when it was ours to begin with.
			if (!PlayerHandle.CanTakeOver(new HandleClaim(claim.UserId, claim.ReleasedAtUtc), userId, utcNow))
			{
				return new HandleResult(HandleOutcome.Taken);
			}
			await _repository.ReplaceHandleClaimAsync(
				claim with { UserId = userId, ClaimedAtUtc = utcNow, ReleasedAtUtc = null }, ct);
		}

		// Only now let the old one go, so a crash between the two leaves the player holding both
		// rather than neither.
		if (current is not null)
		{
			var previous = await _repository.GetHandleClaimAsync(current, ct);
			if (previous is not null && previous.UserId == userId)
			{
				await _repository.ReplaceHandleClaimAsync(previous with { ReleasedAtUtc = utcNow }, ct);
			}
		}

		var updated = await _repository.UpsertUserAsync(
			user with { Handle = requested.Trim(), HandleChangedAtUtc = utcNow }, ct);
		_logger.LogInformation("Account {UserId} now holds the handle {Handle}.", userId, normalized);
		return new HandleResult(HandleOutcome.Ok, updated);
	}

	/// <summary>Whether a handle could be claimed right now, for the field's own feedback. Never
	/// says WHO holds it.</summary>
	public async Task<bool> IsHandleAvailableAsync(
		string requested, string forUserId, DateTime utcNow, CancellationToken ct = default)
	{
		if (PlayerHandle.Validate(requested) != PlayerHandle.Rejection.None) return false;
		var claim = await _repository.GetHandleClaimAsync(PlayerHandle.Normalize(requested), ct);
		return claim is null
			|| PlayerHandle.CanTakeOver(new HandleClaim(claim.UserId, claim.ReleasedAtUtc), forUserId, utcNow);
	}

	/// <summary>
	/// Adds unlock codes to the account, normalized and de-duplicated, and returns the full set it
	/// holds afterwards.
	///
	/// Additive on purpose, and it is what signing in calls with whatever the browser had: somebody
	/// who unlocked a board months ago on this device should not have to find the code again to see
	/// it on their phone. Nothing is removed here — the browser keeps its own copy, so a code
	/// dropped from the account would come straight back on the next request from that device.
	///
	/// Capped, because it is a list a client can append to. The cap is far above any real use and
	/// exists so a loop cannot grow one account document without bound.
	/// </summary>
	public async Task<IReadOnlyList<string>> AddUnlockCodesAsync(
		string userId,
		IEnumerable<string> codes,
		CancellationToken ct = default)
	{
		var user = await _repository.GetUserAsync(userId, ct);
		if (user is null) return Array.Empty<string>();

		var held = new List<string>(user.UnlockCodes);
		var known = held.ToHashSet(StringComparer.Ordinal);
		foreach (var code in codes ?? Array.Empty<string>())
		{
			if (string.IsNullOrWhiteSpace(code)) continue;
			// Normalized by the SERVER, the same way the manifest codes are: what a client sends is
			// the text somebody typed, in whatever shape they typed it.
			var normalized = Services.Corro.ShippedPackageProvider.Normalize(code);
			if (normalized.Length == 0 || normalized.Length > MaxUnlockCodeLength) continue;
			if (!known.Add(normalized)) continue;
			held.Add(normalized);
			if (held.Count >= MaxUnlockCodes) break;
		}

		if (held.Count == user.UnlockCodes.Count) return user.UnlockCodes;

		var saved = await _repository.UpsertUserAsync(user with { UnlockCodes = held }, ct);
		return saved.UnlockCodes;
	}

	/// <summary>Far above any real use; a bound rather than a limit anybody will meet.</summary>
	public const int MaxUnlockCodes = 100;

	/// <summary>Long enough for any code somebody would type, short enough to bound the document.</summary>
	public const int MaxUnlockCodeLength = 64;

	/// <summary>
	/// Who may see this player in the list of who is connected. Only the handle is ever published
	/// there, so nothing here can expose a name imported from a provider.
	///
	/// The old boolean is written alongside so that a rollback to a build that only understands
	/// "listed or not" reads the closest true answer rather than silently publishing somebody:
	/// only <see cref="PresenceVisibility.Everyone"/> is "listed".
	/// </summary>
	public async Task<UserDocument?> SetVisibilityAsync(
		string userId, PresenceVisibility visibility, CancellationToken ct = default)
	{
		var user = await _repository.GetUserAsync(userId, ct);
		if (user is null) return null;
		return await _repository.UpsertUserAsync(user with
		{
			Visibility = visibility,
			ListedPublicly = visibility == PresenceVisibility.Everyone,
		}, ct);
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
