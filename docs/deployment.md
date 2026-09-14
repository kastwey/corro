# Production deployment

Corro is deployed to the existing Linux Azure App Service **Imperio** in resource group
**Imperio**, exposed at <https://imperio.kastwey.org>. Delivery is the final job in
[the CI workflow](../.github/workflows/ci.yml).

## Delivery flow

A push to `main` — or a push to the hidden packages' own repository, see below — starts all
three CI layers in parallel, each on a checkout that also holds the hidden packages:

1. The frontend build and Node test suites.
2. The .NET build and xUnit suites.
3. The Playwright E2E suite, including the automatic Axe audit.

The `deploy-production` job runs only after all three succeed. It:

1. skips itself if its commit is no longer the head of `main`;
2. obtains a short-lived Azure token through GitHub OIDC;
3. checks the hidden packages out of their private repository, always from its `main`;
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

## Authentication

[The deployment infrastructure](../infra/README.md) defines a dedicated user-assigned
identity, its passwordless federated credential and one narrowly scoped role. The GitHub
`production` environment is restricted to `main`. No publish profile, client secret, storage
key or Cosmos credential is stored in GitHub.

## The hidden packages

Some packages ship on the maintainer's server as hidden packages and are kept out of this
repository. They live in a **private repository**, `kastwey/corro-hidden-packages`, one
folder per package in exactly the layout of `server/Packages/<id>/`; `/server/Packages/*` is
gitignored here except for the committed packages, so a hidden package on disk never enters
this repository by accident.

[`.github/actions/hidden-packages`](../.github/actions/hidden-packages/action.yml) puts them
on disk. Every test job runs it right after the checkout, and the deploy job runs it again
before publishing. It needs one repository secret:

| Where | Secret | Access it needs |
| --- | --- | --- |
| `kastwey/corro` | `HIDDEN_PACKAGES_TOKEN` | Read the contents of `kastwey/corro-hidden-packages`. |
| `kastwey/corro-hidden-packages` | `CORRO_DISPATCH_TOKEN` | Write the contents of `kastwey/corro` (what a `repository_dispatch` requires). |

Both are fine-grained personal access tokens with only that permission on only that
repository; a single token granted `Contents: read and write` on both repositories also works,
stored under each name.

**Branch to branch.** A pull request whose head branch also exists in the private repository
is tested with that branch; anything else uses the private `main`. That is how an engine change
and the package change it needs travel together: same branch name in both repositories, and CI
proves them against each other before either merges. Production always ships the private
`main`, so merge the package branch no later than the engine one.

**Without the token** — a fork, or a repository that has not set the secret — the action does
nothing and says so, and the pipeline runs with the committed packages only, exactly as a clone
of the engine would. The deployment is the one place where that is a failure: it refuses to run
without the secret, and it counts the packages on disk against the committed ones and refuses to
publish when the restore added none, because that would be a silent downgrade of production.

**A package change deploys too.** A push to the private repository's `main` runs its
`publish.yml`, which sends `repository_dispatch` (event `hidden-packages-updated`) to this
repository. That runs the full pipeline on the current `main` with the new packages on disk,
and then the deployment. The deploy job validates every package between the restore and the
publish — the same validator an upload goes through, plus the dangling-key tests — so a hidden
board that the current engine would reject stops the deployment instead of reaching players.
`tools/tests/deployment-gate.tests.ps1` pins that order, the dispatch trigger and the fork-safe
skip.

**Locally**, clone the private repository next to this one (or point `CORRO_HIDDEN_PACKAGES`
at it); `pwsh tools/dev.ps1` links every package it holds into `server/Packages/`
(`tools/link-hidden-packages.ps1` does only that). Edit in place, commit from the private
clone. A remote Claude Code session does the same when its environment carries
`HIDDEN_PACKAGES_TOKEN`.

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
