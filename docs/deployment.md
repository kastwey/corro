# Production deployment

Corro is deployed to the existing Linux Azure App Service **Imperio** in resource group
**Imperio**, exposed at <https://imperio.kastwey.org>. Delivery is the final job in
[the CI workflow](../.github/workflows/ci.yml).

## Delivery flow

A push to `main` starts all three CI layers in parallel:

1. The frontend build and Node test suites.
2. The .NET build and xUnit suites.
3. The Playwright E2E suite, including the automatic Axe audit.

The `deploy-production` job runs only after all three succeed. It:

1. skips itself if its commit is no longer the head of `main`;
2. obtains a short-lived Azure token through GitHub OIDC;
3. downloads the private package bundle directly from Blob Storage;
4. validates every package now on disk and refuses to publish if any fails;
5. publishes the frontend and server together without uploading the combined artifact to
   GitHub;
6. deploys a clean ZIP to the existing Web App;
7. verifies that the exact commit SHA and the shipped-package API are live at the custom
   production hostname.

Deployments are serialized and never interrupted halfway through. There is no separate
deployment workflow, so two successful jobs cannot race to overwrite one another.

## The build stamp

Corro ships continuously, so there is no release train and no semantic version to bump. Instead
the publish step stamps the release with the day it was made and that day's ordinal —
`20260823-001` — written by [`tools/build-version.ps1`](../tools/build-version.ps1) into a
`buildinfo.json` beside the published application. The lobby footer shows it, and the dialog
behind it states when the build went live and links to the commit on GitHub.

Both halves come from the repository itself: the UTC day of the commit, and how many of that
day's commits it is built on top of. The same commit therefore always produces the same stamp,
and the deploy job checks out with `fetch-depth: 0` because a shallow clone could only ever
report `-001` — the script refuses to stamp one rather than repeat a version.

A build that was never stamped has no `buildinfo.json`, and then the lobby shows no version at
all: a clone run from source has nothing true to say, and an invented number would be worse than
silence. The same applies to a stamp that arrives malformed. For local work the values can be
supplied as ordinary configuration instead (`Build__Version`, `Build__Commit`,
`Build__RepositoryUrl`, `Build__DeployedAt`), which is how the E2E suite exercises the footer.

## Authentication and private packages

[The deployment infrastructure](../infra/README.md) defines a dedicated user-assigned
identity, its passwordless federated credential, narrowly scoped roles and a private Blob
container. The GitHub `production` environment is restricted to `main`. No publish
profile, client secret, storage key or Cosmos credential is stored in GitHub.

Private package folders are deliberately ignored by Git. Their encrypted-at-rest Blob
bundle must exist before the first deployment and must be republished after any private
package change:

```powershell
pwsh ./tools/publish-private-packages.ps1
```

CI has read-only access to that one container. A missing or unreadable bundle fails the
deployment instead of silently removing private games from production. A bundle that
unzips to nothing fails it too: the job counts the packages on disk against the committed
ones and refuses to publish when the restore added none.

The restored bundle is the only content in the repository that no test job has seen — the
frontend, server and e2e jobs run on a checkout where the private boards do not exist, so
`KeyIntegrityTests` iterates the committed packages alone. The deploy job therefore
validates every package between the restore and the publish, with the same validator an
upload goes through plus the dangling-key tests. A private board that the current engine
would reject stops the deployment instead of reaching players.

Because the upload overwrites one fixed blob name, the account keeps blob versions and soft
delete, so a mistaken publish is a restore rather than a loss — see
[the infrastructure README](../infra/README.md) for the recovery commands.

## Operational notes

- The workflow changes application files and idempotently enforces App Service `Always On` for
  the daily retention worker. It does not overwrite application settings, custom domains,
  certificates or connection strings.
- Deployment is direct to the production slot. It restarts the worker and drops active
  SignalR connections. A staging-slot swap would not preserve process-local sessions.
- Production already has the `CosmosDB` and `PackageBlobs` App Service connection strings
  configured for durable games and uploaded packages. The deployment changes application
  files only and leaves both connection strings untouched.
- **The app provisions its own Cosmos containers**, on every startup and in every environment
  (`InitializeCosmosDbAsync`). Nothing external needs to create them, and the call is
  idempotent. This is not how it began: the provisioning ran in Development only, on the
  assumption that infrastructure created the production containers, and nothing did — the
  production database held `Games` alone, so accounts could not work there and nobody could
  tell, because Cosmos reports a missing container only when something writes to one.
  `ServiceCollectionExtensions.CosmosContainers` is the single list, checked against the
  repositories by `CosmosContainerProvisioningTests`; do not keep a copy of it anywhere.
  A `Created` line in the startup log outside a fresh environment means a container had been
  missing and whatever reads it had been failing.
- The host identity comes from the `SiteBranding` section in `server/appsettings.json`. App
  Service settings override it with ASP.NET Core's double-underscore convention:
  `SiteBranding__Title`, `SiteBranding__Taglines__en`, `SiteBranding__Taglines__es`,
  `SiteBranding__Tagline`, `SiteBranding__LogoUrl`,
  `SiteBranding__LogoDarkUrl`, `SiteBranding__FaviconUrl` and
  `SiteBranding__FaviconDarkUrl`. The localized map follows the active UI language; the singular
  `Tagline`, when set, overrides every locale. Logo and favicon values accept same-site paths or
  HTTPS URLs; omit both theme variants to render the title as text and use no host favicon. These
  values are public by design and are returned by `/api/config/branding`; never place secrets in
  this section. Branding does not alter the mandatory **Powered by Corro** source attribution.
- Voice chat is optional and uses a separately operated LiveKit VPS; its deployment template
  is documented in [the LiveKit infrastructure guide](../infra/livekit/README.md). Configure
  App Service settings `LiveKit__Url`, `LiveKit__ApiUrl`, `LiveKit__ApiKey`,
  `LiveKit__ApiSecret` and (optionally) `LiveKit__TokenLifetimeMinutes`. Keep the API secret in
  an Azure Key Vault reference rather than source or GitHub. The workflow deliberately does
  not overwrite app settings. With no complete LiveKit section, voice is cleanly unavailable.
- Durable-game retention runs inside the existing App Service rather than a separate Function
  App, so it can coordinate with live SignalR sessions and reuse the canonical game-deletion
  path. The S1 plan's `Always On` setting is enforced by deployment, so it catches up on every
  restart and then runs daily. Defaults are 30 inactive days,
  03:00 UTC and at most 500 game deletions per pass. They can be overridden with App Service
  settings `GameRetention__Enabled`, `GameRetention__InactivityDays`,
  `GameRetention__RunAtUtcHour`, `GameRetention__RunOnStartup` and
  `GameRetention__MaxGamesPerRun`.
- The production environment has no approval rule because every successful push to `main`
  is intended to deploy automatically.
- To roll back, revert the offending commit on `main`. The revert passes the same full CI
  gate and becomes a new, auditable release.
