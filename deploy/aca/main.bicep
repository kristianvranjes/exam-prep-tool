// The ExamPrep backend on Azure Container Apps: one always-on replica of the image from
// GitHub Container Registry, uploaded PDFs on an Azure Files share, and a managed
// identity that GitHub Actions uses to roll out new images. The database stays on Neon
// and the frontend on Vercel. Deploy from Azure Cloud Shell; see
// docs/DEPLOY_CONTAINER_APPS.md. Running it again is safe and creates a new revision
// only when something changed.

@description('Azure region; defaults to the resource group location.')
param location string = resourceGroup().location

@description('Backend image to run; GitHub Actions later replaces it with a tag per commit.')
param image string = 'ghcr.io/kristianvranjes/exam-prep-tool/backend:main'

@description('GitHub user that owns the package token below.')
param ghcrUsername string

@secure()
@description('GitHub classic token with only the read:packages scope, used to pull the private image.')
param ghcrToken string

@description('The Vercel site: exactly one HTTPS origin without a trailing slash.')
param frontendUrl string

@secure()
@description('Neon connection string, connection pooling off, ending in sslmode=require.')
param databaseUrl string

@secure()
@description('Session signing secret of at least 32 random characters.')
param sessionSecret string

// The repository uses GitHub's immutable OIDC subjects, which carry the owner and
// repository IDs: `gh api repos/OWNER/REPO/actions/oidc/customization/sub` prints it
// as sub_claim_prefix (or `repo:OWNER/REPO` when use_immutable_subject is false).
@description('Subject prefix of the GitHub repository whose main branch may deploy.')
param githubSubjectPrefix string = 'repo:kristianvranjes@150933585/exam-prep-tool@1368863694'

@description('standard (0.5 vCPU, 1 GiB) leaves room for PDF imports; small (0.25 vCPU, 0.5 GiB) costs about half.')
@allowed([
  'small'
  'standard'
])
param replicaSize string = 'standard'

var appName = 'examprep-api'
var environmentName = 'examprep-env'
var shareName = 'materials'
var sizes = {
  small: {
    cpu: '0.25'
    memory: '0.5Gi'
  }
  standard: {
    cpu: '0.5'
    memory: '1Gi'
  }
}
var contributorRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b24988ac-6180-42a0-ab88-20f7382dd24c')
var readerRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'acdd72a7-3385-48ef-bd42-f606fba81ae7')

// --- Uploaded PDFs ---------------------------------------------------------------

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'examprep${uniqueString(resourceGroup().id)}'
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
  }
}

resource fileService 'Microsoft.Storage/storageAccounts/fileServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource share 'Microsoft.Storage/storageAccounts/fileServices/shares@2023-05-01' = {
  parent: fileService
  name: shareName
  properties: {
    shareQuota: 5
  }
}

// --- Container Apps --------------------------------------------------------------

// A workload profiles environment, set explicitly: newer API versions can otherwise
// create an "Express" environment, which cannot mount Azure Files. No Log Analytics
// workspace, which would add cost; console and system logs can still be streamed with
// `az containerapp logs show`.
resource environment 'Microsoft.App/managedEnvironments@2026-07-01' = {
  name: environmentName
  location: location
  properties: {
    environmentMode: 'WorkloadProfiles'
    workloadProfiles: [
      {
        name: 'Consumption'
        workloadProfileType: 'Consumption'
      }
    ]
  }
}

resource environmentStorage 'Microsoft.App/managedEnvironments/storages@2026-07-01' = {
  parent: environment
  name: shareName
  properties: {
    azureFile: {
      accountName: storage.name
      accountKey: storage.listKeys().keys[0].value
      shareName: share.name
      accessMode: 'ReadWrite'
    }
  }
}

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
  location: location
  properties: {
    environmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      // A new revision takes traffic only once it is ready, so deploys have no downtime.
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 8000
        transport: 'auto'
        allowInsecure: false
      }
      registries: [
        {
          server: 'ghcr.io'
          username: ghcrUsername
          passwordSecretRef: 'ghcr-token'
        }
      ]
      secrets: [
        {
          name: 'ghcr-token'
          value: ghcrToken
        }
        {
          name: 'database-url'
          value: databaseUrl
        }
        {
          name: 'session-secret'
          value: sessionSecret
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'backend'
          image: image
          resources: {
            cpu: json(sizes[replicaSize].cpu)
            memory: sizes[replicaSize].memory
          }
          env: [
            {
              name: 'APP_ENV'
              value: 'production'
            }
            {
              name: 'FRONTEND_URL'
              value: frontendUrl
            }
            {
              name: 'DATABASE_URL'
              secretRef: 'database-url'
            }
            {
              name: 'SESSION_SECRET'
              secretRef: 'session-secret'
            }
            {
              name: 'SESSION_COOKIE_SECURE'
              value: 'true'
            }
            {
              // Vercel and Azure are different sites, so cookies must be SameSite=None.
              name: 'SESSION_COOKIE_SAMESITE'
              value: 'none'
            }
            {
              name: 'SESSION_COOKIE_NAME'
              value: 'examprep_session'
            }
            {
              // 4 h lifetime; requests after 2 h renew it, so idle gaps up to 2 h are always safe (see docs/API.md).
              name: 'SESSION_MAX_AGE_SECONDS'
              value: '14400'
            }
            {
              // The image is built without the optional ML stack; question import works without AI.
              name: 'AI_PROVIDER'
              value: 'disabled'
            }
            {
              name: 'AI_REQUEST_TIMEOUT_SECONDS'
              value: '120'
            }
            {
              name: 'MATERIAL_STORAGE_DIR'
              value: '/data/materials'
            }
            {
              name: 'PORT'
              value: '8000'
            }
          ]
          volumeMounts: [
            {
              volumeName: 'materials'
              mountPath: '/data'
            }
          ]
          // /health does not touch the database, so a Neon hiccup does not restart the replica.
          probes: [
            {
              // The image runs `alembic upgrade head` before the server starts: allow ~2.5 minutes.
              type: 'Startup'
              httpGet: {
                path: '/health'
                port: 8000
              }
              initialDelaySeconds: 10
              periodSeconds: 15
              timeoutSeconds: 5
              failureThreshold: 10
            }
            {
              type: 'Liveness'
              httpGet: {
                path: '/health'
                port: 8000
              }
              periodSeconds: 30
              timeoutSeconds: 5
              failureThreshold: 3
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/health'
                port: 8000
              }
              periodSeconds: 10
              timeoutSeconds: 5
              failureThreshold: 3
            }
          ]
        }
      ]
      // Exactly one replica: always warm, and migrations never run twice at once.
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
      volumes: [
        {
          name: 'materials'
          storageType: 'AzureFile'
          storageName: environmentStorage.name
        }
      ]
    }
  }
}

// --- Deploys from GitHub Actions -------------------------------------------------

// GitHub signs in as this identity through OIDC, so no Azure password is stored in
// GitHub. Only workflow runs on the main branch of that repository are accepted.
resource deployIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'examprep-github-deploy'
  location: location
}

resource githubMain 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials@2023-01-31' = {
  parent: deployIdentity
  name: 'github-main'
  properties: {
    issuer: 'https://token.actions.githubusercontent.com'
    subject: '${githubSubjectPrefix}:ref:refs/heads/main'
    audiences: [
      'api://AzureADTokenExchange'
    ]
  }
}

// It may change the container app (including reading its secrets) and only read the
// rest of the resource group, so it cannot reach the storage account keys.
resource deployCanUpdateApp 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(app.id, deployIdentity.id, contributorRole)
  scope: app
  properties: {
    roleDefinitionId: contributorRole
    principalId: deployIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource deployCanReadGroup 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, deployIdentity.id, readerRole)
  properties: {
    roleDefinitionId: readerRole
    principalId: deployIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

output url string = 'https://${app.properties.configuration.ingress.fqdn}'
output storageAccount string = storage.name
output azureClientId string = deployIdentity.properties.clientId
output azureTenantId string = tenant().tenantId
output azureSubscriptionId string = subscription().subscriptionId
