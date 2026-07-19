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

- The workflow changes application files only. It does not overwrite App Service settings,
  custom domains, certificates or connection strings.
- Deployment is direct to the production slot. It restarts the worker and drops active
  SignalR connections. A staging-slot swap would not preserve process-local sessions.
- Production already has the `CosmosDB` and `PackageBlobs` App Service connection strings
  configured for durable games and uploaded packages. The deployment changes application
  files only and leaves both connection strings untouched.
- The production environment has no approval rule because every successful push to `main`
  is intended to deploy automatically.
- To roll back, revert the offending commit on `main`. The revert passes the same full CI
  gate and becomes a new, auditable release.
