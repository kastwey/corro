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
4. publishes the frontend and server together without uploading the combined artifact to
   GitHub;
5. deploys a clean ZIP to the existing Web App;
6. verifies that the exact commit SHA and the shipped-package API are live at the custom
   production hostname.

Deployments are serialized and never interrupted halfway through. There is no separate
deployment workflow, so two successful jobs cannot race to overwrite one another.

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
deployment instead of silently removing private games from production.

## Operational notes

- The workflow changes application files and idempotently enforces App Service `Always On` for
  the daily retention worker. It does not overwrite application settings, custom domains,
  certificates or connection strings.
- Deployment is direct to the production slot. It restarts the worker and drops active
  SignalR connections. A staging-slot swap would not preserve process-local sessions.
- Production already has the `CosmosDB` and `PackageBlobs` App Service connection strings
  configured for durable games and uploaded packages. The deployment changes application
  files only and leaves both connection strings untouched.
- The host identity comes from the `SiteBranding` section in `server/appsettings.json`. App
  Service settings override it with ASP.NET Core's double-underscore convention:
  `SiteBranding__Title`, `SiteBranding__Tagline`, `SiteBranding__LogoUrl`,
  `SiteBranding__LogoDarkUrl`, `SiteBranding__FaviconUrl` and
  `SiteBranding__FaviconDarkUrl`. Logo and favicon values accept same-site paths or HTTPS URLs;
  omit both theme variants to render the title as text and use no host favicon. These values are
  public by design and are returned by `/api/config/branding`; never place secrets in this
  section. Branding does not alter the mandatory **Powered by Corro** source attribution.
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
