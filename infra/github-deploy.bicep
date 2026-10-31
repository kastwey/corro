targetScope = 'resourceGroup'

@description('Azure region for the user-assigned deployment identity.')
param location string = 'northeurope'

@description('Name of the user-assigned identity used only by GitHub Actions deployments.')
param identityName string = 'imperio-github-deploy'

@description('Existing Azure App Service that receives the application ZIP.')
param webAppName string = 'Imperio'

@description('GitHub repository owner trusted by the federated credential.')
param githubOwner string = 'kastwey'

@description('GitHub repository name trusted by the federated credential.')
param githubRepository string = 'corro'

@description('Effective OIDC subject prefix returned by the repository OIDC customization endpoint.')
param githubSubjectPrefix string = 'repo:kastwey@7586708/corro@1305386218'

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
    subject: '${githubSubjectPrefix}:environment:${githubEnvironment}'
    audiences: [
      'api://AzureADTokenExchange'
    ]
  }
}

resource webApp 'Microsoft.Web/sites@2024-11-01' existing = {
  name: webAppName
}

var websiteContributorRoleId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  'de139f84-1756-47ae-9be6-808fbbe84772'
)

// Scope deployment rights to this one web app, not the resource group or subscription. The hidden
// packages come from a private GitHub repository, so the identity needs nothing in storage.
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

output clientId string = deploymentIdentity.properties.clientId
output principalId string = deploymentIdentity.properties.principalId
output tenantId string = deploymentIdentity.properties.tenantId
output trustedSubject string = githubCredential.properties.subject
