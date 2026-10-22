# Backend on an Azure for Students VM

This guide moves the FastAPI backend from Railway to a small always-on Ubuntu VM paid
for by **Azure for Students** (no credit card). Only the backend moves:

```text
Students ─▶ Vercel (Next.js, unchanged) ─▶ https://<name>.<region>.cloudapp.azure.com
                                              │  Caddy: HTTPS (Let's Encrypt)
                                              ▼
                                           backend container (FastAPI, migrations at start)
                                              │  /data volume: uploaded PDFs
                                              ▼
                                           Neon PostgreSQL (unchanged)
```

Files: [`deploy/azure/`](../deploy/azure) (Compose, Caddyfile, settings template,
`setup.sh`, `deploy.sh`) and [`.github/workflows/deploy-azure.yml`](../.github/workflows/deploy-azure.yml).

**What to expect**

- Azure for Students gives a yearly USD 100 credit and free hours of small burstable
  VMs such as B1s (1 vCPU, 1 GB RAM). Check the current terms on the
  [Azure for Students page](https://azure.microsoft.com/free/students) and in the
  portal's **Free services** list before relying on them; offers change.
- The backend runs without the optional ML stack (`INSTALL_EMBEDDINGS=0`): login,
  courses, PDFs, question bank, import, practice and past papers all work; AI
  generation and semantic search stay disabled, as on Railway.
- A deploy restarts the container, so the API is unavailable for roughly half a
  minute while migrations run.
- You maintain the VM: automatic security updates are enabled by `setup.sh`, but
  reboots, backups and the yearly student renewal are yours.

Commands below in `bash` blocks run on your own computer unless the text says
**on the VM**.

## 1. Rotate the secrets first

Railway reported on 21 October 2026 that environment variables may have been exposed.
Do not reuse any value that was stored there.

1. **Neon** → project → branch `production` → **Roles** → menu next to the role →
   **Reset password** → **Reset**. Then **Connect** → same branch/database/role,
   **Connection pooling off**, copy the string (it ends in `sslmode=require`).
2. A new session secret:
   ```bash
   python -c "import secrets; print(secrets.token_urlsafe(48))"
   ```
3. If an AI key was set on Railway, revoke it at the provider.

Keep these values for step 5; never paste them into issues, chats or Git.

## 2. Activate Azure for Students

Sign in at <https://azure.microsoft.com/free/students> with your university account
and finish the verification. In the [Azure portal](https://portal.azure.com) you
should see the subscription **Azure for Students**.

Recommended: **Cost Management** → **Budgets** → create a budget of a few dollars with
an e-mail alert, so any unexpected charge is visible early.

## 3. Create the VM

Portal → **Create a resource** → **Virtual machine**.

| Tab | Setting |
| --- | --- |
| Basics | Subscription *Azure for Students*; new resource group `examprep`; name `examprep-vm`; region **West Europe** (or another EU region that offers B1s on your subscription); image **Ubuntu Server 24.04 LTS – x64**; size **Standard_B1s**; authentication **SSH public key**, username `azureuser`, *Generate new key pair* (download the `.pem`) or paste your existing public key; inbound ports **SSH (22)** |
| Disks | OS disk type as offered free in your **Free services** list (for example Premium SSD P6, 64 GiB); delete with VM on |
| Networking | New virtual network and public IP (Standard, static); NIC security group *Basic* |
| Management | **Auto-shutdown off** |

After it is created:

1. **Public IP** → **Configuration** → **DNS name label**, e.g. `examprep-api` →
   save. Your host name is now `examprep-api.westeurope.cloudapp.azure.com`
   (shown as *DNS name*).
2. VM → **Networking** → **Add inbound port rule** twice: TCP **80** and TCP **443**
   (source *Any*). Optionally UDP 443 for HTTP/3.
3. SSH (22) has to stay reachable from GitHub Actions for automatic deploys; password
   login is disabled on Azure Ubuntu images by default, and step 9 limits the deploy
   key to one command.

## 4. Prepare the server

From your local clone of the repository (the repository is private, so the VM cannot
download the script before it has a deploy key):

```bash
scp -i ~/Downloads/examprep-vm_key.pem deploy/azure/setup.sh azureuser@examprep-api.westeurope.cloudapp.azure.com:~
```

```bash
ssh -i ~/Downloads/examprep-vm_key.pem azureuser@examprep-api.westeurope.cloudapp.azure.com
```

**On the VM:**

```bash
bash setup.sh
```

It installs updates, Docker and the Compose plugin, a 2 GB swap file and a firewall
(22, 80, 443), creates a **read-only deploy key** and prints it. Add it in GitHub →
repository → **Settings** → **Deploy keys** → **Add deploy key**, leave *Allow write
access* unticked, then press Enter on the VM. The script prints GitHub's host key
fingerprint; compare it with
[GitHub's published fingerprints](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints).
It then clones the repository into `/opt/examprep` and creates `deploy/azure/.env`.

Log out and back in so the `docker` group applies:

```bash
exit
```

## 5. Fill in the settings

**On the VM:**

```bash
nano /opt/examprep/deploy/azure/.env
```

| Setting | Value |
| --- | --- |
| `SITE_ADDRESS` | the DNS name from step 3 |
| `ACME_EMAIL` | your e-mail (Let's Encrypt notices) |
| `FRONTEND_URL` | the Vercel origin, e.g. `https://exam-prep-tool-gamma.vercel.app` |
| `DATABASE_URL` | the new Neon string from step 1 |
| `SESSION_SECRET` | the new secret from step 1 |
| others | keep the template values |

The backend refuses to start with unsafe hosted values (no HTTPS frontend, short
secret, missing `sslmode`), and the error appears in the logs in step 6.

## 6. First start

**On the VM:**

```bash
/opt/examprep/deploy/azure/deploy.sh origin/main
```

The first build takes a few minutes. The script waits for the health check and prints
the last log lines if the backend does not become healthy. Then, from anywhere:

```bash
curl https://examprep-api.westeurope.cloudapp.azure.com/health/db
```

It should answer HTTP 200 with `"status":"ok"` over a valid HTTPS certificate; a 503
means the backend runs but cannot reach Neon (check `DATABASE_URL`). Caddy obtains the certificate within a minute of the first request once
ports 80 and 443 are open.

## 7. Uploaded PDFs

The PDFs live in the `examprep_materials` Docker volume. If you can still reach the
Railway service, archive its `/data/materials` there (for example with
`railway ssh`, then `tar czf materials.tgz -C /data materials`) and copy the file to
the VM. **On the VM**, restore it into the volume:

```bash
docker run --rm -v examprep_materials:/data -v "$PWD":/backup alpine sh -c 'tar xzf /backup/materials.tgz -C /data'
```

If the Railway service is gone, the database still has all extracted text, sections,
questions and practice history; only downloading an original PDF fails until it is
uploaded again.

## 8. Point Vercel at the new backend

Vercel → project `exam-prep-tool` → **Settings** → **Environment Variables** → set
`NEXT_PUBLIC_API_URL` (Production) to `https://<your DNS name>` → **Deployments** →
redeploy the latest production deployment (the value is built into the frontend).

Check on the student site: log in (everyone is logged out after the secret change),
open a course, start and submit a short practice session, and open a past paper.

## 9. Automatic deploys from GitHub (optional)

After this step every push to `main` that passes **Checks** is deployed.

1. Create a key used only by GitHub Actions, on your computer:
   ```bash
   ssh-keygen -t ed25519 -N "" -C "examprep-actions" -f examprep-actions
   ```
2. **On the VM**, allow that key to run nothing but the deploy script. Append one line
   to `~/.ssh/authorized_keys`, replacing the last part with the contents of
   `examprep-actions.pub`:
   ```text
   command="/opt/examprep/deploy/azure/deploy.sh",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty ssh-ed25519 AAAA... examprep-actions
   ```
3. Record the VM's host key from your computer (after you have connected once and
   accepted it):
   ```bash
   ssh-keygen -F examprep-api.westeurope.cloudapp.azure.com
   ```
   Copy the line(s) that are not comments.
4. GitHub → repository → **Settings** → **Secrets and variables** → **Actions**:
   - Secrets: `AZURE_VM_HOST` (the DNS name), `AZURE_VM_USER` (`azureuser`),
     `AZURE_VM_SSH_KEY` (the whole private file `examprep-actions`),
     `AZURE_VM_KNOWN_HOSTS` (the line from step 3).
   - Variables: `AZURE_DEPLOY_ENABLED` = `true`.
5. Delete the local `examprep-actions` private key once it is saved in GitHub.
6. **Actions** → **Deploy backend (Azure VM)** → **Run workflow** to test it.

The workflow passes only a validated commit SHA or branch name, and the restricted key
cannot open a shell. To stop automatic deploys, set `AZURE_DEPLOY_ENABLED` to
anything else.

## 10. Switch off Railway

When the student site has worked on the new backend for a day, delete the Railway
service (and its volume) so the leaked variables are no longer stored anywhere.

## Operations

All **on the VM**, in `/opt/examprep/deploy/azure`:

| Task | Command |
| --- | --- |
| Status | `docker compose ps` |
| Backend logs | `docker compose logs --tail 200 -f backend` |
| Caddy logs (certificates) | `docker compose logs --tail 100 caddy` |
| Restart | `docker compose restart backend` |
| Deploy a revision by hand | `./deploy.sh <sha or origin/main>` |
| Back up PDFs | `docker run --rm -v examprep_materials:/data -v "$PWD":/backup alpine tar czf /backup/materials-$(date +%F).tgz -C /data materials`, then `scp` it off the VM |
| Disk usage | `df -h` and `docker system df` |
| Pending reboot after updates | `test -f /var/run/reboot-required && sudo reboot` |

**Backups.** Neon keeps its own restore history (check how long on your plan); the
PDFs are only on the VM disk, so copy a materials archive off the VM after uploads
that matter.

**Yearly renewal.** Azure for Students must be renewed while you are a student. If it
lapses, the subscription and VM are disabled: keep backups and this guide, and the
same steps work on any Ubuntu VM.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `curl` cannot connect | Ports 80/443 missing in the Azure network rules or `ufw`; check step 3 and `sudo ufw status` |
| Certificate error | `SITE_ADDRESS` differs from the DNS name, or port 80 is closed; read `docker compose logs caddy` |
| 502 from Caddy | Backend not running or unhealthy; read `docker compose logs backend` |
| Backend exits at start with a settings error | A value in `.env` fails the hosted checks; the message names it |
| Login works but the session is lost | `FRONTEND_URL` must equal the Vercel origin exactly, with `SESSION_COOKIE_SECURE=true` and `SESSION_COOKIE_SAMESITE=none` |
| Build killed or very slow | Not enough memory; check `swapon --show`, and keep `INSTALL_EMBEDDINGS=0` |
| Actions deploy fails on SSH | Check the four secrets, that the VM host key matches `AZURE_VM_KNOWN_HOSTS`, and that the `authorized_keys` line is on one line |
