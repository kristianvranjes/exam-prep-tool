# Backend on Azure Container Apps (Azure for Students)

This guide moves the FastAPI backend from Railway to **Azure Container Apps**, paid from
the **Azure for Students** credit (no credit card). Only the backend moves:

```text
Students ─▶ Vercel (Next.js, unchanged) ─▶ https://examprep-api.<id>.<region>.azurecontainerapps.io
                                              │  Container Apps ingress: HTTPS
                                              ▼
                                           backend replica (FastAPI, migrations at start)
                                              │  /data: Azure Files share with the uploaded PDFs
                                              ▼
                                           Neon PostgreSQL (unchanged)
```

Files: [`deploy/aca/main.bicep`](../deploy/aca/main.bicep) (all Azure resources) and
[`.github/workflows/deploy-aca.yml`](../.github/workflows/deploy-aca.yml) (image build
and rollout). The image is the existing `backend/Dockerfile`, stored privately in
GitHub Container Registry (GHCR).

**What to expect**

- One replica runs all the time with 0.5 vCPU and 1 GiB (`standard`). After the
  monthly free grant of Container Apps this costs about **USD 10–12 a month**, so the
  USD 100 student credit lasts roughly 8–10 months; the `small` size (0.25 vCPU,
  0.5 GiB) costs about half but leaves little memory for PDF imports. Storage for the
  PDFs costs cents. Prices change: check the
  [pricing page](https://azure.microsoft.com/pricing/details/container-apps/).
- When the credit runs out or the student year ends, Azure disables the subscription
  (it does not charge you) and the backend stops until you renew. Check the balance
  at <https://www.microsoftazuresponsorships.com/balance>.
- HTTPS and the host name come with Container Apps; there is no server to patch.
- Deploys have no downtime: the old revision keeps serving until the new one has run
  its migrations and passed its health probes.
- The backend runs without the optional ML stack (`INSTALL_EMBEDDINGS=0`): login,
  courses, PDFs, question bank, import, practice and past papers all work; AI
  generation and semantic search stay disabled, as on Railway.
- There is no Log Analytics workspace (it would add cost): live logs are streamed on
  demand (see [Operations](#operations)), and older logs are not kept.

All `az` commands run in **Azure Cloud Shell** (portal → the `>_` icon at the top →
**Bash**), where you are already signed in.

## 1. Rotate the secrets first

Railway reported on 21 October 2026 that environment variables may have been exposed.
Do not reuse any value that was stored there.

1. **Neon** → project → branch `production` → **Roles** → menu next to the role →
   **Reset password** → **Reset**. Then **Connect** → same branch/database/role,
   **Connection pooling off**, copy the string (it ends in `sslmode=require`).
2. A new session secret (on your computer, or in Cloud Shell):
   ```bash
   python3 -c "import secrets; print(secrets.token_urlsafe(48))"
   ```
3. If an AI key was set on Railway, revoke it at the provider.

Keep these values for step 5; never paste them into issues, chats or Git.

## 2. Build the first image

This needs the workflow on `main`, so merge this change first.

GitHub → repository → **Actions** → **Deploy backend (Azure Container Apps)** → **Run
workflow** (branch `main`). While `ACA_DEPLOY_ENABLED` is not set, the run only builds
the image and pushes it to `ghcr.io/kristianvranjes/exam-prep-tool/backend` with the
tags `main` and the commit SHA. It appears, private, under your GitHub profile →
**Packages**.

## 3. Create a token that can only read packages

Azure needs it to pull the private image.

GitHub → your avatar → **Settings** → **Developer settings** → **Personal access
tokens** → **Tokens (classic)** → **Generate new token (classic)**:

- Note: `examprep-aca-pull`
- Expiration: 1 year (put a reminder in your calendar; [Operations](#operations) shows
  how to replace it)
- Scopes: only **read:packages**

Copy the token for step 5.

## 4. Prepare the Azure subscription

In Cloud Shell, check the subscription and register the services this setup uses
(each takes up to a few minutes the first time):

```bash
az account show --query name -o tsv
```

```bash
for ns in Microsoft.App Microsoft.Storage Microsoft.ManagedIdentity; do az provider register --namespace "$ns" --wait; done
```

The first command must print *Azure for Students*.

Recommended: portal → **Cost Management** → **Budgets** → a budget of a few dollars a
month with an e-mail alert, so you see early if the cost is higher than expected.

## 5. Create the resources

Upload `deploy/aca/main.bicep` from your local clone to Cloud Shell: toolbar →
**Manage files** → **Upload** (it lands in your home directory). Then create the
resource group in one of the regions your subscription allows (France Central here)
and deploy the template:

```bash
az group create --name examprep --location francecentral
```

```bash
az deployment group create --resource-group examprep --name examprep --template-file main.bicep --parameters ghcrUsername=kristianvranjes frontendUrl=https://exam-prep-tool-gamma.vercel.app
```

The command asks for the three secret values; input is hidden and stays out of the
shell history:

| Prompt | Value |
| --- | --- |
| `ghcrToken` | the token from step 3 |
| `databaseUrl` | the new Neon string from step 1 |
| `sessionSecret` | the new secret from step 1 |

It takes a few minutes. Add `replicaSize=small` to `--parameters` for the cheaper size.
Then print the results:

```bash
az deployment group show --resource-group examprep --name examprep --query properties.outputs
```

Note `url`, `storageAccount`, `azureClientId`, `azureTenantId` and
`azureSubscriptionId`.

## 6. Check the backend

```bash
curl https://<url without https://>/health/db
```

It should answer `"status":"ok"`; a 503 means the backend runs but cannot reach Neon
(check the database string). If the address does not answer, look at the logs:

```bash
az containerapp logs show --name examprep-api --resource-group examprep --type system --tail 50
```

```bash
az containerapp logs show --name examprep-api --resource-group examprep --type console --tail 100
```

The backend refuses to start with unsafe hosted values (no HTTPS frontend, short
secret, missing `sslmode`), and the console log names the setting.

## 7. Uploaded PDFs

The PDFs live in the Azure Files share `materials` under `materials/`. If you can still
reach the Railway service, archive its `/data/materials` there (for example with
`railway ssh`, then `tar czf materials.tgz -C /data materials`), upload the archive to
Cloud Shell (**Manage files** → **Upload**) and copy it into the share:

```bash
tar xzf materials.tgz && az storage file upload-batch --account-name <storageAccount> --destination materials --destination-path materials --source materials
```

If the Railway service is gone, the database still has all extracted text, sections,
questions and practice history; only downloading an original PDF fails until it is
uploaded again.

## 8. Point Vercel at the new backend

Vercel → project `exam-prep-tool` → **Settings** → **Environment Variables** → set
`NEXT_PUBLIC_API_URL` (Production) to the `url` from step 5 → **Deployments** →
redeploy the latest production deployment (the value is built into the frontend).

Check on the student site: log in (everyone is logged out after the secret change),
open a course, start and submit a short practice session, and open a past paper.

## 9. Automatic deploys from GitHub

After this step every push to `main` that passes **Checks** is built and rolled out.
GitHub signs in to Azure as the managed identity `examprep-github-deploy` through
OIDC, which only accepts workflow runs on `main`; no Azure password is stored in
GitHub. That identity may change the container app and only read the rest of the
resource group.

GitHub → repository → **Settings** → **Secrets and variables** → **Actions** →
**Variables** → add:

| Variable | Value |
| --- | --- |
| `AZURE_CLIENT_ID` | `azureClientId` from step 5 |
| `AZURE_TENANT_ID` | `azureTenantId` |
| `AZURE_SUBSCRIPTION_ID` | `azureSubscriptionId` |
| `ACA_DEPLOY_ENABLED` | `true` |

Then **Actions** → **Deploy backend (Azure Container Apps)** → **Run workflow** to
test it. To stop automatic deploys, set `ACA_DEPLOY_ENABLED` to anything else. If you
used other names than `examprep` / `examprep-api`, also set `ACA_RESOURCE_GROUP` and
`ACA_APP_NAME`.

## 10. Switch off Railway

When the student site has worked on the new backend for a day, delete the Railway
service (and its volume) so the leaked variables are no longer stored anywhere.

## Operations

All in Cloud Shell. To keep secret values out of the shell history, read them first
with `read -rs VALUE` and use `"$VALUE"`.

| Task | Command |
| --- | --- |
| Live logs | `az containerapp logs show -n examprep-api -g examprep --follow --tail 100` |
| Start-up and probe events | `az containerapp logs show -n examprep-api -g examprep --type system --tail 50` |
| Revisions and their state | `az containerapp revision list -n examprep-api -g examprep -o table` |
| Restart | `az containerapp revision restart -n examprep-api -g examprep --revision <name>` |
| Change a plain setting | `az containerapp update -n examprep-api -g examprep --set-env-vars FRONTEND_URL=https://...` |
| Session lifetime | The template sets `SESSION_MAX_AGE_SECONDS=14400` (4 h lifetime, renewed by any request after 2 h, so idle gaps of up to 2 h are always safe). Apply it to an app created with the older `3600` with `az containerapp update -n examprep-api -g examprep --set-env-vars SESSION_MAX_AGE_SECONDS=14400` |
| Change a secret | `az containerapp secret set -n examprep-api -g examprep --secrets session-secret="$VALUE"`, then restart the revision |
| Replace the package token | `az containerapp registry set -n examprep-api -g examprep --server ghcr.io --username kristianvranjes --password "$VALUE"` |
| Roll back to an earlier commit | `az containerapp update -n examprep-api -g examprep --image ghcr.io/kristianvranjes/exam-prep-tool/backend:<sha>` |
| Pause between semesters | `az containerapp update -n examprep-api -g examprep --min-replicas 0` (the first request after a pause waits while it starts); undo with `--min-replicas 1` |
| Back up PDFs | `az storage file download-batch --account-name <storageAccount> --source materials --destination backup`, then **Manage files** → **Download** |

Running the template again (step 5) is safe; it asks for the secrets again and keeps
the PDFs. It resets the image to the `main` tag, which is the latest build of `main`.

The GitHub deploy (step 9) only swaps the image. Settings changed in
`deploy/aca/main.bicep` reach the running app only when you run the template again or
set them with `--set-env-vars` as above.

**Backups.** Neon keeps its own restore history (check how long on your plan); copy the
PDFs off Azure after uploads that matter.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `MissingSubscriptionRegistration` | Register the providers (step 4) |
| `RequestDisallowedByPolicy` or a location error | The region is not allowed for your subscription; the error lists the allowed ones. Create the resource group in one of them |
| Revision not ready, system log shows an image pull error (`unauthorized`, `denied`) | The token lacks `read:packages` or expired, or the image was never built (step 2) |
| Revision not ready, console log shows a settings error | A value fails the hosted checks; fix it with `secret set` or `--set-env-vars` |
| Startup probe failures | Migrations or the database are slow or unreachable; read the console log |
| Login works but the session is lost | `FRONTEND_URL` must equal the Vercel origin exactly; the cookies are already `Secure` and `SameSite=None` |
| `azure/login` fails with *No matching federated identity record* | The workflow ran from a branch other than `main`, or the subject differs: the log prints the presented `subject claim`, and `githubSubjectPrefix` in the template must equal it up to `:ref:`. Fix an existing deployment with `az identity federated-credential update -g examprep --identity-name examprep-github-deploy -n github-main --issuer https://token.actions.githubusercontent.com --audiences api://AzureADTokenExchange --subject "<subject claim from the log>"` |
| Rollout fails with `AuthorizationFailed` | Role assignments can take a few minutes to apply after step 5; also check the variables in step 9 |
