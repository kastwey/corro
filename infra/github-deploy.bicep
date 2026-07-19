targetScope = 'resourceGroup'

@description('Azure region for the user-assigned deployment identity.')
param location string = 'northeurope'

@description('Name of the user-assigned identity used only by GitHub Actions deployments.')
param identityName string = 'imperio-github-deploy'

@description('Existing Azure App Service that receives the application ZIP.')
param webAppName string = 'Imperio'

@description('Existing storage account that holds the private package bundle.')
param storageAccountName string = 'imperio'

@description('Private blob container used as the source for packages intentionally excluded from Git.')
param privatePackageContainerName string = 'deployment'

@description('GitHub repository owner trusted by the federated credential.')
param githubOwner string = 'kastwey'

@description('GitHub repository name trusted by the federated credential.')
param githubRepository string = 'corro'

@description('Protected GitHub environment trusted by the federated credential.')
param githubEnvironment string = 'production'

// No client secret is created. GitHub receives a short-lived Azure token only when a workflow
// references this protected environment. GitHub separately restricts the environment to main.
resource deploymentIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: identityName
  location: location
  tags: {
    purpose: 'github-actions-deployment'
    repository: '${githubOwner}/${githubRepository}'
  }
  properties: {
    isolationScope: 'None'
  }
}

resource githubCredential 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials@2024-11-30' = {
  parent: deploymentIdentity
  name: 'github-production'
  properties: {
    issuer: 'https://token.actions.githubusercontent.com'
    subject: 'repo:${githubOwner}/${githubRepository}:environment:${githubEnvironment}'
    audiences: [
      'api://AzureADTokenExchange'
    ]
  }
}

resource webApp 'Microsoft.Web/sites@2024-11-01' existing = {
  name: webAppName
}

resource storageAccount 'Microsoft.Storage/storageAccounts@2025-01-01' existing = {
  name: storageAccountName
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2025-01-01' existing = {
  parent: storageAccount
  name: 'default'
}

// The bundle is private and contains only package folders ignored by Git. It is downloaded with
// data-plane RBAC during the workflow and never uploaded as a GitHub artifact.
resource privatePackagesContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2025-01-01' = {
  parent: blobService
  name: privatePackageContainerName
  properties: {
    publicAccess: 'None'
    defaultEncryptionScope: '$account-encryption-key'
    denyEncryptionScopeOverride: false
  }
}

var websiteContributorRoleId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  'de139f84-1756-47ae-9be6-808fbbe84772'
)
var storageBlobDataReaderRoleId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '2a2b9908-6ea1-4ae2-8e65-a410df84e7d1'
)

// Scope deployment rights to this one web app, not the resource group or subscription.
resource webAppDeploymentRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(webApp.id, deploymentIdentity.id, websiteContributorRoleId)
  scope: webApp
  properties: {
    principalId: deploymentIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: websiteContributorRoleId
    description: 'Deploy the protected kastwey/corro production environment to Imperio.'
  }
}

// The workflow can read only this private container; it cannot write or delete package bundles.
resource privatePackagesReadRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(privatePackagesContainer.id, deploymentIdentity.id, storageBlobDataReaderRoleId)
  scope: privatePackagesContainer
  properties: {
    principalId: deploymentIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: storageBlobDataReaderRoleId
    description: 'Read the private Corro package bundle during deployment.'
  }
}

output clientId string = deploymentIdentity.properties.clientId
output principalId string = deploymentIdentity.properties.principalId
output tenantId string = deploymentIdentity.properties.tenantId
output privatePackageContainer string = privatePackagesContainer.name
output trustedSubject string = githubCredential.properties.subject
