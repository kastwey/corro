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

## When somebody makes a second account by accident

The rule above has one genuinely surprising consequence: sign in with Google, then later with
Microsoft using the same address, and you have **two accounts**. People meet that as "where did my
tables go?", which is the worst possible way to learn it.

So the server notices, names both services (it can: it just found the other account) and explains
the way out — which is four steps from where they already are: open *Your account*, press *Add
Google*, accept on Google's page, and the two become one.

That last step is a **merge**, and it does not weaken the rule above. What authorises it is exactly
what authorises linking: being signed into one account AND completing a login that opens the other.
Holding both is what proves one person owns both, and nothing here is ever reached by asserting an
email address. `LinkIdentityAsync` still refuses to move a login for everyone else — that refusal
is for the case where nobody has shown they own the account being taken from.

### What a merge does, in order

The **older** account survives, because the newer one is almost always the one made seconds ago by
the login that started this, and the older is the one whose id other things already point at.

1. **Seats move first** (`ReassignSeatsAsync`). Only the owner changes — the player id, the secret
   and the re-entry code are untouched, so nobody at the table sees anything and a browser mid-game
   carries on.
2. **Then the logins are re-pointed** at the survivor, one at a time. A provider the survivor
   already has is dropped rather than adopted: an account holds at most one login per provider.
3. **The empty account is deleted last.**

That order is chosen so a failure part-way through loses nothing. Interrupted after (1), the
survivor has gained tables and the loser still has its login. Interrupted during (2), the moved
logins open the survivor and the rest still open the loser. Interrupted before (3), an account with
no logins is unreachable but holds nothing. The reverse order would strand tables under an account
nobody can sign into, which is the one outcome worth engineering against.

`ShouldSuggestLinkingAsync` says when, and each of its three conditions is a refusal to guess:

- **the account was created by this sign-in.** After the first time the player has been told;
  repeating it at every sign-in would be nagging about a decision they have made.
- **the provider verified the address** (`email_verified`). This is the load-bearing one. A
  work/school Microsoft address is a directory attribute a tenant admin sets to anything they like,
  so acting on an unverified one would let a stranger with their own tenant ask this service
  whether *you* have an account here. Answering that is account enumeration, and it is the one way
  a helpful notice could become a leak.
- **another account actually holds it.**

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

## Saying who you are (every host fills this in)

Storing an email address makes whoever runs the deployment a **data controller**, and naming
themselves is a legal obligation rather than a nicety. That is a fact about the person running the
server, not about Corro, so it cannot ship with the code — **you fill in your own**:

```jsonc
// server/appsettings.json — or, better, your deployment's own configuration
"Privacy": {
  "ControllerName": "Your name or your organisation",
  "Jurisdiction": "Your city, your country",
  "Contact": "an address you actually read",
  "PolicyUrl": ""
}
```

| Field | Why it is asked for |
| --- | --- |
| `ControllerName` | The name somebody would write to, or sue. A pseudonym does not satisfy the obligation. |
| `Jurisdiction` | Where you are established, which decides whose data-protection law applies and which supervisory authority hears a complaint. "Dublin, Ireland", not "the EU". |
| `Contact` | Usually an email address. The right of access carries a one-month deadline, so it must be one you read. |
| `PolicyUrl` | Optional. A host who already publishes their own policy points at it, and the built-in notice is replaced by a link. |

The section is validated as **all or nothing** at startup: either all three are set or none are. A
half-filled notice is the worst outcome — it looks like an answer and reaches nobody.

**Leaving it empty is a supported configuration**, and it is what a fresh clone has: the footer
shows no privacy link and, since no provider is configured either, nothing asks for an address. A
server that collects nothing owes no notice about it.

### The notice itself

The TEXT ships with the app, in [`server/Legal/privacy.en.md`](../server/Legal/privacy.en.md)
and its Spanish twin, because what Corro does with data is the same wherever it runs. Only the
identity changes, and it is substituted into the `{{controller}}`, `{{jurisdiction}}` and
`{{contact}}` placeholders when the notice is served.

It lives in `server/Legal/` rather than under `wwwroot` for two reasons, and both are traps worth
naming. `wwwroot` is **generated** — the frontend build wipes it and re-mirrors it from
`frontend/dist` on every build, so anything else put there disappears at the next compile. And the
file is a **template**: served as a static asset it would show a reader `{{controller}}` instead of
your name. It travels in the publish artifact the same way the board packages do, and CI asserts
both languages are in there, because a missing notice makes a configured deployment report having
none — which also switches sign-in off.

If you change what your deployment stores — another provider, an analytics script, anything — edit
that markdown. The notice is a description of reality and stops being worth anything the moment it
stops matching.

It is rendered into the same reading dialog as the board guide (`documentMode`), so a screen
reader meets it in browse mode as an ordinary document rather than a widget.

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
