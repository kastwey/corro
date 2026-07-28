# Player accounts and external sign-in

Accounts are **optional and additive**. Creating a game, joining one and playing it all work
exactly as they did before this feature existed, with no account and no sign-in. Nothing in the
gameplay path may ever become conditional on being signed in — an account only adds durable,
cross-device extras on top.

A deployment that configures no provider gets no account UI at all, which is a fully supported
configuration rather than a degraded one.

## Why a provider only appears at the moment of login

Corro never asks Google or Microsoft "is this person still valid?" on a per-request basis. The
provider is consulted exactly once, when the player signs in; from then on the session is
**ours**.

The framework does the whole OAuth/OIDC dance (`Microsoft.AspNetCore.Authentication.Google`,
`…MicrosoftAccount`), deposits its result into a short-lived **external** cookie, and hands
control back to `AuthController.Complete`. That endpoint resolves the account and issues the app's
own **session** cookie. Nothing afterwards touches the provider.

The wiring lives in [`server/Extensions/AuthenticationExtensions.cs`](../server/Extensions/AuthenticationExtensions.cs).

## Identity is (issuer, subject) — never the email address

This is the single most important rule in the feature, and the one most likely to be "simplified"
into a security hole.

An account is matched **only** on the pair of *which provider asserted this* and *that provider's
immutable id for the person* (the OIDC `sub`). Email addresses are stored for display and nothing
else.

Matching on the address instead would be an account-takeover route: providers hand out addresses
they never verified, addresses get reassigned, and two providers reporting the same address are not
evidence of the same person. So signing in to Google and to Microsoft with the same address
deliberately produces **two separate accounts**.

`UserAccountService` is where this policy lives, and
[`server.tests/UserAccountServiceTests.cs`](../server.tests/UserAccountServiceTests.cs) is where it
is pinned.

## Linking a second provider

Two providers only ever share an account because the player **explicitly linked them from inside an
authenticated session**, proving they hold both logins. Sign-in never infers it.

The same refusal applies from the other direction: a login another account already owns is **not
moved**. Taking a provider away from whoever currently holds it is the same takeover, approached
backwards, so `LinkIdentityAsync` returns `ClaimedByAnotherAccount` and changes nothing.

An account holds **at most one login per provider**. That is a deliberate simplification: it lets
the settings screen show a single row per provider and lets "remove Google" mean exactly one thing.
Linking a second Google login to an account that already has one is refused.

Because a provider round-trip is a full page navigation, the outcome has nowhere to live but the
URL. The server appends `linkResult` and `linkProvider` markers to the return destination; the lobby
turns them into a translated sentence, reopens the settings dialog where the player started, and
strips the markers so a reload cannot replay a stale outcome.

### Removing a provider, and the guard that matters

`UnlinkIdentityAsync` refuses to remove the **last remaining** sign-in method. Without that guard
the account would still exist with all its data and simply have no way in, ever — a silent,
unrecoverable loss. Erasing the account is the deliberate way to get rid of it.

The client honours the same rule, and honours it the way this project requires: the control is never
given the `disabled` attribute. It stays focusable, carries `aria-disabled="true"` and an
`aria-describedby` pointing at the reason, and explains itself when activated. A screen-reader user
reaches it and learns why, instead of meeting a control that silently does nothing.

Order matters in the write: the account document drops the identity **first**, then the mapping is
deleted. If the second step fails, sign-in finds a mapping the account no longer lists and re-records
it, which is recoverable. The reverse order would leave the account advertising a provider that can
no longer resolve to it.

## Storage: two containers, because two different keys

Accounts live in the same `CorroGame` Cosmos database as the games, in two containers of their own:

| Container | Partition key | Answers |
| --- | --- | --- |
| `Users` | `/userId` | "What is this account?" — every read from an established session. |
| `Identities` | `/identityKey` | "Which account is this provider login?" — the sign-in path. |

The split exists because sign-in arrives with an (issuer, subject) pair, which is *not* the account
id. Resolving it inside `Users` would mean a cross-partition query on the hottest path. Giving the
mapping its own container, partitioned by the composite key itself, keeps both lookups point reads.

`Identities` also serves as the **concurrency guard** for first sign-in: the mapping is claimed
before the account document is written, and Cosmos rejects a duplicate id, so two simultaneous
first logins converge on one account instead of racing to create two.

### The identity key, and a Cosmos trap worth knowing

`IdentityKey.For(issuer, subject)` builds `"{issuer}:{subject}"`. Its only job is injectivity —
distinct pairs must never collide.

- The **issuer** is restricted to a lowercase slug, so it cannot contain the `:` delimiter and no
  split is ambiguous.
- The **subject** is kept byte for byte when it uses the safe alphabet (`A–Z a–z 0–9 . _ -`), which
  every real provider subject already does: Google's are decimal, Microsoft's and Apple's are
  base64url. Keeping them readable is worth a lot when reading the database by eye.
- Anything outside that alphabet is replaced wholesale by a SHA-256 hash marked with `~`.

That last rule is not fussiness. The obvious alternative — percent-escaping the characters Cosmos
forbids in an item id — **is a trap**: Cosmos accepts an id containing `%` on write and then cannot
read the item back by it. The integration test against the emulator caught exactly that, which is
why `CosmosUserRepositoryIntegrationTests` exists.

Subjects are opaque and **case-sensitive**; nothing normalizes them. Lower-casing one could merge
two different people onto a single account.

## The session credential, and why a browser gets a cookie

The session is an `HttpOnly`, `SameSite=Lax` cookie that the server issues and validates.

`HttpOnly` is a guarantee no JavaScript-readable token can offer: `frontend/src/account.ts` cannot
read the session even in principle, so no script on the page — injected or otherwise — can steal
it. The only way the client learns whether somebody is signed in is to ask `/api/auth/me`.

`SameSite=Lax` is load-bearing rather than incidental. It means a cross-site request can never carry
the cookie on a POST, which is what protects every state-changing endpoint from CSRF. **The
corollary is a rule for this codebase: an endpoint that changes account state must never be a GET.**
`/api/auth/signout` is a POST and `/api/auth/me` deletion is a DELETE for that reason, not for REST
tidiness.

The principal carries **only** the account id. Everything else — display name, address, linked
providers — is read from the account document per request, so a renamed account is correct
immediately instead of after the session expires.

### The seam for a future mobile app

A native app wants the opposite trade from a browser: no XSS surface, but a real secure keystore
(iOS Keychain, Android Keystore). It will therefore get **bearer tokens**, not this cookie — a short
JWT access token plus a rotating, revocable refresh token.

Nothing about that requires rewriting what is here. The mapping between an account and a signed-in
caller lives in `SessionPrincipal`, deliberately independent of how the principal is carried, so a
second transport means **adding a scheme beside the cookie**, not replacing it. Two things will be
new work when that day comes: the refresh-token store, and a revocation check — the natural place
for the latter is the hub's `OnConnectedAsync`, because a SignalR connection is long-lived and that
is the moment revocation actually has an effect.

## Configuration

Providers are configured under `Authentication`, and each one is either **untouched or complete** —
a half-filled section fails startup rather than shipping a sign-in button whose only possible
outcome is a provider error page. This mirrors how the optional voice relay is configured.

```bash
dotnet user-secrets --project server set "Authentication:Google:ClientId" "<id>"
dotnet user-secrets --project server set "Authentication:Google:ClientSecret" "<secret>"
```

Register the redirect URI with each provider as `<origin>/signin-google` and
`<origin>/signin-microsoft` (the handlers' default callback paths) — for local development,
`http://localhost:5000/signin-google`.

With no secrets set, the server starts normally, `/api/auth/providers` returns an empty list, and
the lobby renders no account UI.

### Before this ships to production

**Data Protection keys.** The session cookie is encrypted with ASP.NET Core Data Protection. On
Azure App Service the keys land in the persistent `$HOME` directory automatically, so they survive
restarts and deployments on the current single-App-Service deployment. If Corro ever moves to
containers or an environment without that persistent home, the keys must be persisted explicitly
(Blob Storage, optionally protected with Key Vault) — otherwise every restart silently signs
everybody out.

**Erasure.** `DELETE /api/auth/me` erases the account and every provider mapping pointing at it, and
the account settings dialog exposes it behind an inline confirmation whose default answer is keeping
the account. Erasure is real rather than a flag: signing in afterwards with the same provider login
starts a genuinely new account.

A privacy policy is still owed before this serves real users — storing an email address makes that a
legal obligation, not a nicety.

## Testing

| Layer | Where | Covers |
| --- | --- | --- |
| Unit | `server.tests/IdentityKeyTests.cs` | Key injectivity, the safe alphabet, issuer validation. |
| Unit | `server.tests/UserAccountServiceTests.cs` | The sign-in policy, including the two-providers-one-address rule and the concurrency guard. |
| Unit | `server.tests/AuthenticationConfigurationTests.cs` | The principal seam, provider configuration, the catalog. |
| Integration | `server.tests/CosmosUserRepositoryIntegrationTests.cs` | The real store: the duplicate-id race guard and awkward subjects. Skips without the emulator. |
| Frontend | `frontend/test/account.test.ts` | Defensive parsing, the rendered states, links-not-buttons, language switching, and the name cap matching the server's. |
| Frontend | `frontend/test/accountSettings.test.ts` | The settings dialog: the last-method refusal, renaming, the erase confirmation, the stable live region. |
| E2E | `e2e/tests/account.spec.ts` | The real client flow and the Axe audit of every account state. |

The E2E suite signs in through a **stand-in provider** registered only under
`ASPNETCORE_ENVIRONMENT=E2E`. It replaces the trip to a real provider's consent screen and nothing
else — the route, the account resolution and the session cookie are all the production ones, so the
accessibility audit sees the real UI.
