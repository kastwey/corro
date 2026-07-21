# Azure deployment infrastructure

[github-deploy.bicep](github-deploy.bicep) configures authentication and authorization
for production delivery. It does **not** recreate or modify the existing App Service,
storage account, Cosmos DB, DNS binding, certificate or connection strings.

It creates:

- a user-assigned identity with a GitHub OIDC credential restricted to the protected
  `production` environment in `kastwey/corro`;
- `Website Contributor` scoped only to the existing `Imperio` Web App;
- a private Blob container for package sources intentionally excluded from Git;
- `Storage Blob Data Reader` scoped only to that container.

`Website Contributor` also lets the production workflow idempotently enforce `Always On` on the
existing S1 Web App. This keeps the in-process daily game-retention worker scheduled without a
second Function App, identity or set of Cosmos/Blob credentials.

No client secret, publish profile, storage key or Cosmos credential is stored in GitHub.
The federated subject uses the repository's immutable owner/repository IDs, as returned by
GitHub's OIDC customization endpoint, rather than relying only on renameable display names.

## Provision or update

Validate the resource-group deployment before applying it:

```powershell
az deployment group what-if `
  --resource-group Imperio `
  --template-file infra/github-deploy.bicep

$deployment = az deployment group create `
  --name corro-github-deploy `
  --resource-group Imperio `
  --template-file infra/github-deploy.bicep `
  --query properties.outputs `
  --output json | ConvertFrom-Json
```

Create a GitHub environment that accepts deployments only from `main`, then store the
public Azure identifiers and resource names in that environment:

```powershell
$repository = 'kastwey/corro'
$environment = 'production'
$subscriptionId = az account show --query id --output tsv

@{
  deployment_branch_policy = @{
    protected_branches = $false
    custom_branch_policies = $true
  }
} | ConvertTo-Json -Depth 3 | gh api --method PUT `
  "repos/$repository/environments/$environment" --input -

$policies = gh api "repos/$repository/environments/$environment/deployment-branch-policies" |
  ConvertFrom-Json
if (-not ($policies.branch_policies | Where-Object { $_.name -eq 'main' })) {
  @{ name = 'main'; type = 'branch' } | ConvertTo-Json | gh api --method POST `
    "repos/$repository/environments/$environment/deployment-branch-policies" --input -
}

gh variable set AZURE_CLIENT_ID --repo $repository --env $environment `
  --body $deployment.clientId.value
gh variable set AZURE_TENANT_ID --repo $repository --env $environment `
  --body $deployment.tenantId.value
gh variable set AZURE_SUBSCRIPTION_ID --repo $repository --env $environment `
  --body $subscriptionId
gh variable set AZURE_RESOURCE_GROUP --repo $repository --env $environment --body 'Imperio'
gh variable set AZURE_WEBAPP_NAME --repo $repository --env $environment --body 'Imperio'
gh variable set AZURE_STORAGE_ACCOUNT --repo $repository --env $environment --body 'imperio'
gh variable set AZURE_PRIVATE_PACKAGES_CONTAINER --repo $repository --env $environment `
  --body $deployment.privatePackageContainer.value
gh variable set AZURE_PRIVATE_PACKAGES_BLOB --repo $repository --env $environment `
  --body 'private-packages.zip'
```

The environment restriction and the OIDC subject are both required: the subject names
the environment, while the branch policy ensures that only `main` can use it.

If the repository is transferred or recreated, inspect its effective prefix before applying
the template and pass the returned `sub_claim_prefix` as `githubSubjectPrefix`:

```powershell
gh api repos/kastwey/corro/actions/oidc/customization/sub
```

## Private package bundle

The public repository deliberately ignores non-distributable package folders. Publish
the bundle once during setup and again after changing any of those packages:

```powershell
pwsh ./tools/publish-private-packages.ps1
```

The script discovers ignored folders without hardcoding or printing their names, uploads
one private archive using the operator's Microsoft Entra identity, and deletes the local
temporary archive. CI later downloads it directly with read-only data-plane RBAC. The
combined application is never stored as a GitHub Actions artifact because it contains
those private packages.
