targetScope = 'resourceGroup'

@description('Azure region for the monitoring resources. Keep it with the existing App Service.')
param location string = 'northeurope'

@description('Existing Azure App Service to instrument.')
param webAppName string = 'Imperio'

@description('Dedicated Log Analytics workspace for production telemetry.')
param workspaceName string = 'imperio-logs'

@description('Workspace-based Application Insights component used by the App Service.')
param applicationInsightsName string = 'imperio-insights'

@minValue(30)
@maxValue(730)
@description('Interactive retention for application and App Service telemetry.')
param retentionInDays int = 30

@minValue(1)
@description('Safety cap for total workspace ingestion. Data collection pauses for the rest of the UTC day after this limit.')
param dailyQuotaGb int = 1

resource webApp 'Microsoft.Web/sites@2024-11-01' existing = {
  name: webAppName
}

resource logAnalyticsWorkspace 'Microsoft.OperationalInsights/workspaces@2025-07-01' = {
  name: workspaceName
  location: location
  tags: {
    environment: 'production'
    purpose: 'corro-observability'
  }
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: retentionInDays
    workspaceCapping: {
      dailyQuotaGb: dailyQuotaGb
    }
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
  }
}

resource applicationInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: applicationInsightsName
  location: location
  kind: 'web'
  tags: {
    environment: 'production'
    purpose: 'corro-observability'
    'hidden-link:${webApp.id}': 'Resource'
  }
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalyticsWorkspace.id
  }
}

// Resource-specific tables make App Service logs directly queryable as AppServiceHTTPLogs,
// AppServiceConsoleLogs, AppServicePlatformLogs, and the other supported categories.
resource appServiceDiagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'send-to-imperio-logs'
  scope: webApp
  properties: {
    workspaceId: logAnalyticsWorkspace.id
    logAnalyticsDestinationType: 'Dedicated'
    logs: [
      {
        categoryGroup: 'allLogs'
        enabled: true
      }
    ]
    metrics: [
      {
        category: 'AllMetrics'
        enabled: true
      }
    ]
  }
}

output applicationInsightsResourceId string = applicationInsights.id
output logAnalyticsWorkspaceResourceId string = logAnalyticsWorkspace.id
output logAnalyticsWorkspaceCustomerId string = logAnalyticsWorkspace.properties.customerId
