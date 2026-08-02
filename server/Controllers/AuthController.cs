using CorroServer.Extensions;
using CorroServer.Services.Accounts;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Mvc;

namespace CorroServer.Controllers;

/// <summary>
/// Optional player accounts. Every endpoint here is additive: a player who never signs in keeps
/// creating, joining and playing games exactly as before, so nothing in this controller may become
/// a precondition for gameplay.
/// </summary>
[ApiController]
[Route("api/auth")]
public class AuthController : ControllerBase
{
	/// <summary>Carries the provider through the redirect to <see cref="Complete"/>, so the callback
	/// reads which provider it is finishing from the properties WE signed rather than from a query
	/// string the browser could have edited.</summary>
	private const string ProviderItemKey = "corro.provider";

	/// <summary>Whether the provider round-trip that is finishing was a sign-in or a link. Carried in
	/// the signed properties, never in a query string the browser could edit — a link that could be
	/// downgraded to a sign-in would hand the visitor a session on somebody else's account.</summary>
	private const string ModeItemKey = "corro.mode";
	private const string SignInMode = "signin";
	private const string LinkMode = "link";

	private readonly AuthProviderCatalog _catalog;
	private readonly UserAccountService _accounts;
	private readonly ILogger<AuthController> _logger;

	public AuthController(
		AuthProviderCatalog catalog,
		UserAccountService accounts,
		ILogger<AuthController> logger)
	{
		_catalog = catalog;
		_accounts = accounts;
		_logger = logger;
	}

	/// <summary>
	/// The sign-in options to offer. An empty list means this deployment configured no provider, and
	/// the client simply shows no account UI at all.
	/// </summary>
	[HttpGet("providers")]
	public ActionResult<object> GetProviders() =>
		Ok(new { Providers = _catalog.Providers.Select(p => p.Key) });

	/// <summary>
	/// Who the caller is. Deliberately answers 200 for anonymous callers too: not being signed in is
	/// an ordinary state here, not an error, and the client asks this on every page load.
	/// </summary>
	[HttpGet("me")]
	public async Task<ActionResult<object>> GetMe(CancellationToken ct)
	{
		var userId = SessionPrincipal.UserId(User);
		if (userId is null)
		{
			return Ok(new { SignedIn = false });
		}

		var user = await _accounts.GetAccountAsync(userId, ct);
		if (user is null)
		{
			// The account was erased while this session cookie was still alive. Drop the session so
			// the client returns to a clean signed-out state instead of looping on a dead id.
			await HttpContext.SignOutAsync(AuthenticationExtensions.SessionScheme);
			return Ok(new { SignedIn = false });
		}

		return Ok(new
		{
			SignedIn = true,
			User = new
			{
				user.UserId,
				user.DisplayName,
				user.Email,
				// Issuer plus the address that provider reported, so the settings screen can show
				// WHICH account each provider is linked to. Subjects stay server-side: they are the
				// identity itself and the client has no use for them.
				Identities = user.Identities.Select(i => new { i.Issuer, i.Email }),
			},
		});
	}

	/// <summary>
	/// Adds another provider to the account the caller is already signed into. A GET because, like
	/// sign-in, it is a top-level navigation to the provider that changes nothing by itself — the
	/// account is only touched in <see cref="Complete"/>, and only after the player has proved they
	/// hold that login too.
	/// </summary>
	[HttpGet("link/{provider}")]
	public async Task<IActionResult> Link(string provider, [FromQuery] string? returnUrl, CancellationToken ct)
	{
		var userId = SessionPrincipal.UserId(User);
		if (userId is null)
		{
			return Unauthorized();
		}

		var descriptor = _catalog.Find(provider);
		if (descriptor is null)
		{
			return NotFound(new { Error = "PROVIDER_NOT_AVAILABLE" });
		}

		var safeReturnUrl = LocalReturnUrl(returnUrl);

		if (descriptor.IsTestDouble)
		{
			var identity = E2ETestIdentity(Request.Query["subject"].FirstOrDefault());
			var result = await _accounts.LinkIdentityAsync(userId, identity, DateTime.UtcNow, ct);
			return Redirect(LinkResultUrl(safeReturnUrl, provider, result.Outcome));
		}

		var properties = new AuthenticationProperties { RedirectUri = Url.Action(nameof(Complete)) };
		properties.Items[ProviderItemKey] = provider;
		properties.Items[ModeItemKey] = LinkMode;
		properties.Items[nameof(returnUrl)] = safeReturnUrl;

		return Challenge(properties, provider);
	}

	/// <summary>
	/// Removes a provider from the account. A POST: it changes account state, and the session cookie
	/// is SameSite=Lax precisely so a cross-site request can never carry it on one.
	/// </summary>
	[HttpPost("unlink/{provider}")]
	public async Task<IActionResult> Unlink(string provider, CancellationToken ct)
	{
		var userId = SessionPrincipal.UserId(User);
		if (userId is null)
		{
			return Unauthorized();
		}

		var result = await _accounts.UnlinkIdentityAsync(userId, provider, ct);
		return result.Outcome switch
		{
			UnlinkOutcome.Unlinked => NoContent(),
			UnlinkOutcome.NotLinked => NotFound(new { Error = "PROVIDER_NOT_LINKED" }),
			// Not a client mistake to retry: it is the guard against creating an account with no way
			// back into it. The client explains it rather than offering the action at all.
			UnlinkOutcome.WouldLockAccountOut => Conflict(new { Error = "LAST_SIGN_IN_METHOD" }),
			_ => Unauthorized(),
		};
	}

	/// <summary>The name other players see.</summary>
	public sealed record RenameRequest(string? DisplayName);

	/// <summary>
	/// Renames the account. A blank name is accepted and stored as absent, so the player can go back
	/// to the client's localized placeholder rather than being stuck with a provider's version of
	/// their name.
	/// </summary>
	[HttpPatch("me")]
	public async Task<IActionResult> Rename([FromBody] RenameRequest request, CancellationToken ct)
	{
		var userId = SessionPrincipal.UserId(User);
		if (userId is null)
		{
			return Unauthorized();
		}

		if (!UserAccountService.IsValidDisplayName(request.DisplayName))
		{
			return BadRequest(new { Error = "NAME_TOO_LONG", UserAccountService.MaxDisplayNameLength });
		}

		var user = await _accounts.RenameAsync(userId, request.DisplayName, ct);
		if (user is null)
		{
			await HttpContext.SignOutAsync(AuthenticationExtensions.SessionScheme);
			return Unauthorized();
		}

		return Ok(new { user.DisplayName });
	}

	/// <summary>
	/// Starts a sign-in. A GET because it is a top-level browser navigation to the provider, and it
	/// changes nothing on its own — the account is only touched once the provider comes back.
	/// </summary>
	[HttpGet("signin/{provider}")]
	public async Task<IActionResult> SignIn(string provider, [FromQuery] string? returnUrl, CancellationToken ct)
	{
		var descriptor = _catalog.Find(provider);
		if (descriptor is null)
		{
			return NotFound(new { Error = "PROVIDER_NOT_AVAILABLE" });
		}

		var safeReturnUrl = LocalReturnUrl(returnUrl);

		// The E2E stand-in has no provider to visit: it completes the sign-in here and redirects
		// straight back, so the browser suite exercises the real client flow and the real session
		// cookie without an external dependency.
		if (descriptor.IsTestDouble)
		{
			var identity = E2ETestIdentity(Request.Query["subject"].FirstOrDefault());
			await IssueSessionAsync(identity, ct);
			return Redirect(safeReturnUrl);
		}

		var properties = new AuthenticationProperties { RedirectUri = Url.Action(nameof(Complete)) };
		properties.Items[ProviderItemKey] = provider;
		properties.Items[ModeItemKey] = SignInMode;
		properties.Items[nameof(returnUrl)] = safeReturnUrl;

		return Challenge(properties, provider);
	}

	/// <summary>
	/// Where the provider's handler lands once it has authenticated the player. Exchanges the
	/// short-lived external cookie for this app's own session and sends the browser back where it
	/// started.
	/// </summary>
	[HttpGet("complete")]
	public async Task<IActionResult> Complete(CancellationToken ct)
	{
		var result = await HttpContext.AuthenticateAsync(AuthenticationExtensions.ExternalScheme);
		if (!result.Succeeded)
		{
			_logger.LogWarning("External sign-in completed without a valid external cookie.");
			return Redirect(SignInFailureUrl());
		}

		var items = result.Properties?.Items;
		var provider = Item(items, ProviderItemKey);
		var returnUrl = LocalReturnUrl(Item(items, "returnUrl"));

		// The provider must be one this deployment actually registered. Reading it from the signed
		// properties already prevents tampering; re-checking it keeps an issuer that was switched
		// off since the challenge from reaching the account store.
		if (provider is null || _catalog.Find(provider) is null)
		{
			_logger.LogWarning("External sign-in named unknown provider {Provider}.", provider);
			return Redirect(SignInFailureUrl());
		}

		var identity = ExternalLogin.FromPrincipal(result.Principal, provider);
		if (identity is null)
		{
			_logger.LogWarning("Provider {Provider} returned no subject claim; cannot bind an account.", provider);
			return Redirect(SignInFailureUrl());
		}

		// Finishing a LINK must not be able to fall through to issuing a session. If the session
		// that started the link is gone, the safe answer is to abandon the link — signing this
		// visitor in instead would attach the provider to whoever is holding the browser now.
		if (Item(items, ModeItemKey) == LinkMode)
		{
			await HttpContext.SignOutAsync(AuthenticationExtensions.ExternalScheme);

			var userId = SessionPrincipal.UserId(User);
			if (userId is null)
			{
				_logger.LogWarning("A link from {Provider} completed with no signed-in session; abandoning it.", provider);
				return Redirect(LinkResultUrl(returnUrl, provider, LinkOutcome.AccountNotFound));
			}

			var link = await _accounts.LinkIdentityAsync(userId, identity, DateTime.UtcNow, ct);
			return Redirect(LinkResultUrl(returnUrl, provider, link.Outcome));
		}

		var existingProviders = await IssueSessionAsync(identity, ct);
		return Redirect(existingProviders.Count > 0
			? SecondAccountUrl(returnUrl, provider, existingProviders)
			: returnUrl);
	}

	/// <summary>
	/// Ends the session. A POST so the Lax session cookie cannot ride along on a cross-site
	/// navigation and sign the player out behind their back.
	/// </summary>
	[HttpPost("signout")]
	public async Task<IActionResult> SignOutSession()
	{
		await HttpContext.SignOutAsync(AuthenticationExtensions.SessionScheme);
		return NoContent();
	}

	/// <summary>
	/// Erases the account: the profile and every provider mapping pointing at it. Games the player
	/// took part in are NOT rewritten — they belong to the other players too — they simply stop
	/// being attributed to an account.
	/// </summary>
	[HttpDelete("me")]
	public async Task<IActionResult> DeleteMe(CancellationToken ct)
	{
		var userId = SessionPrincipal.UserId(User);
		if (userId is null)
		{
			return Unauthorized();
		}

		await _accounts.DeleteAccountAsync(userId, ct);
		await HttpContext.SignOutAsync(AuthenticationExtensions.SessionScheme);
		return NoContent();
	}

	/// <summary>One value the challenge stashed in the authentication properties. Items is a plain
	/// IDictionary, so it has no GetValueOrDefault of its own.</summary>
	private static string? Item(IDictionary<string, string?>? items, string key) =>
		items is not null && items.TryGetValue(key, out var value) ? value : null;

	/// <summary>Resolves the account and issues this app's session, dropping the provider's
	/// external cookie now that it has served its one purpose.</summary>
	/// <summary>Returns the providers that open the account the player ALREADY had, when this
	/// sign-in quietly made them a second one — empty otherwise. The destination names them, because
	/// "the service you used last time" is exactly what somebody in that situation cannot
	/// remember.</summary>
	private async Task<IReadOnlyList<string>> IssueSessionAsync(ExternalIdentity identity, CancellationToken ct)
	{
		var user = await _accounts.SignInAsync(identity, DateTime.UtcNow, ct);

		await HttpContext.SignInAsync(
			AuthenticationExtensions.SessionScheme,
			SessionPrincipal.For(user.UserId),
			new AuthenticationProperties { IsPersistent = true });

		await HttpContext.SignOutAsync(AuthenticationExtensions.ExternalScheme);
		return await _accounts.ExistingAccountProvidersAsync(user, identity, ct);
	}

	/// <summary>
	/// A destination that is definitely inside this site. An attacker-supplied absolute URL here
	/// would turn the sign-in route into an open redirect — a phishing lever, since the hop starts on
	/// a page the player already trusts.
	/// </summary>
	private string LocalReturnUrl(string? returnUrl) =>
		!string.IsNullOrWhiteSpace(returnUrl) && Url.IsLocalUrl(returnUrl) ? returnUrl : "/";

	/// <summary>The lobby, flagged so it can explain that signing in did not complete. Failures come
	/// back to the app rather than showing a server error page, because the player can still play
	/// without an account.</summary>
	private static string SignInFailureUrl() => "/?signInError=1";

	/// <summary>
	/// Back where the player started, flagged so the lobby can explain that this login made a NEW
	/// account rather than opening the one they already had — and how to join the two. Carried in the
	/// URL for the same reason the link outcome is: a provider round-trip is a full page navigation
	/// and leaves no response to put it in.
	/// </summary>
	private static string SecondAccountUrl(
		string returnUrl, string provider, IReadOnlyList<string> existingProviders) =>
		returnUrl
		+ (returnUrl.Contains('?') ? "&" : "?")
		+ "secondAccount=1"
		+ "&newProvider=" + Uri.EscapeDataString(provider)
		+ "&existingProviders=" + Uri.EscapeDataString(string.Join(',', existingProviders));

	/// <summary>
	/// Back where the player started, carrying what became of the link. A provider round-trip is a
	/// full page navigation, so the outcome has to survive in the URL — there is no response left to
	/// put it in. The client reports it and strips the markers.
	/// </summary>
	private static string LinkResultUrl(string returnUrl, string provider, LinkOutcome outcome)
	{
		var separator = returnUrl.Contains('?') ? '&' : '?';
		return $"{returnUrl}{separator}linkResult={LinkResultCode(outcome)}"
			+ $"&linkProvider={Uri.EscapeDataString(provider)}";
	}

	/// <summary>The outcome as a stable code the client turns into a translated sentence. Codes
	/// rather than messages: the server does not know the player's language here.</summary>
	private static string LinkResultCode(LinkOutcome outcome) => outcome switch
	{
		LinkOutcome.Linked => "linked",
		LinkOutcome.AlreadyLinked => "already_linked",
		LinkOutcome.ProviderAlreadyUsed => "provider_in_use",
		LinkOutcome.ClaimedByAnotherAccount => "claimed",
		_ => "failed",
	};

	/// <summary>A deterministic identity for the E2E stand-in. The optional subject lets one browser
	/// run sign in as several distinct accounts.</summary>
	private static ExternalIdentity E2ETestIdentity(string? subject)
	{
		var id = string.IsNullOrWhiteSpace(subject) ? "e2e-player" : subject.Trim();
		return new ExternalIdentity(
			Issuer: AuthProviders.E2E,
			Subject: id,
			DisplayName: $"E2E {id}",
			Email: $"{id}@e2e.invalid");
	}
}
