# Backend on a small Ubuntu VM (DigitalOcean)

This guide moves the FastAPI backend from Railway to a small always-on Ubuntu VM. It is
the alternative to [Azure Container Apps](DEPLOY_CONTAINER_APPS.md) when you have a VM
or would rather pay for one; the steps use a **DigitalOcean droplet** as the example.
Only the backend moves:

```text
Students ─▶ Vercel (Next.js, unchanged) ─▶ https://<name>.duckdns.org
                                              │  Caddy: HTTPS (Let's Encrypt)
                                              ▼
                                           backend container (FastAPI, migrations at start)
                                              │  /data volume: uploaded PDFs
                                              ▼
                                           Neon PostgreSQL (unchanged)
```

Files: [`deploy/vm/`](../deploy/vm) (Compose, Caddyfile, settings template, `setup.sh`,
`deploy.sh`) and [`.github/workflows/deploy-vm.yml`](../.github/workflows/deploy-vm.yml).
They work on any Ubuntu 24.04 VM, x64 or Arm; see [Other providers](#other-providers).

**What to expect**

- A droplet with 2 GB costs about USD 12 a month (1 GB about USD 6), billed to a card
  or PayPal. The GitHub Student Pack's DigitalOcean credit ended on 31 July 2026.
- The backend runs without the optional ML stack (`INSTALL_EMBEDDINGS=0`): login,
  courses, PDFs, question bank, import, practice and past papers all work; AI
  generation and semantic search stay disabled, as on Railway.
- A deploy restarts the container, so the API is unavailable for roughly half a
  minute while migrations run.
- You maintain the VM: automatic security updates are enabled by `setup.sh`, but
  reboots and backups are yours.

Commands below in `bash` blocks run on your own computer unless the text says
**on the VM**. `ssh`, `scp` and `ssh-keygen` also work in Windows PowerShell.

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

Keep these values for step 8; never paste them into issues, chats or Git.

## 2. Create the DigitalOcean account

Sign up at <https://www.digitalocean.com> and add a card or PayPal. Optionally set a
**billing alert** under **Billing**, so you are e-mailed if spending is higher than
expected.

## 3. Create an SSH key and the droplet

On your computer, create a key for logging in to the droplet (press Enter for no
passphrase, or set one):

```bash
ssh-keygen -t ed25519 -C "examprep-droplet" -f ~/.ssh/examprep_droplet
```

DigitalOcean → **Create** → **Droplets**:

| Setting | Value |
| --- | --- |
| Region | Closest to the database. The Neon host name shows its region, e.g. `…eu-central-1.aws.neon.tech` is Frankfurt, so pick **Frankfurt (FRA1)**; Amsterdam is also close |
| Image | **Ubuntu 24.04 (LTS) x64** |
| Size | **Basic** → **Regular** → **USD 12/mo: 2 GB / 1 CPU** (USD 6/mo with 1 GB also works, with slower builds) |
| Authentication | **SSH Key** → **New SSH Key** → paste the contents of `~/.ssh/examprep_droplet.pub` |
| Hostname | `examprep-vm` |
| Backups | Optional (extra cost); see [Operations](#operations) for PDF backups |

When the droplet is running, copy its **ipv4** address. The public IP stays with the
droplet for as long as it exists.

## 4. Give the VM a DNS name

Let's Encrypt needs a host name, and DigitalOcean does not provide one. A free
[DuckDNS](https://www.duckdns.org) subdomain works:

1. Sign in on duckdns.org (for example with GitHub).
2. Add a subdomain, e.g. `examprep-api`, set **current ip** to the droplet's IP and
   press **update ip**.
3. Check it:
   ```bash
   nslookup examprep-api.duckdns.org
   ```

If you ever recreate the droplet, update the IP on DuckDNS. A domain of your own works
the same way with an `A` record.

## 5. Create the admin user

A new droplet only has `root`, and `setup.sh` runs as a normal user with `sudo`. Log
in with the DNS name, not the IP, so your computer records the host key under the name
GitHub Actions will use in step 12:

```bash
ssh -i ~/.ssh/examprep_droplet root@examprep-api.duckdns.org
```

**On the VM**, as root, create the user `examprep` with your SSH key and password-less
`sudo` (it has no password; logins use the key):

```bash
adduser --disabled-password --gecos "" examprep
usermod -aG sudo examprep
echo 'examprep ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/examprep && chmod 440 /etc/sudoers.d/examprep
install -d -m 700 -o examprep -g examprep /home/examprep/.ssh
install -m 600 -o examprep -g examprep ~/.ssh/authorized_keys /home/examprep/.ssh/authorized_keys
exit
```

## 6. Prepare the server

From your local clone of the repository (the repository is private, so the VM cannot
download the script before it has a deploy key):

```bash
scp -i ~/.ssh/examprep_droplet deploy/vm/setup.sh examprep@examprep-api.duckdns.org:~
```

```bash
ssh -i ~/.ssh/examprep_droplet examprep@examprep-api.duckdns.org
```

**On the VM:**

```bash
bash setup.sh
```

It installs updates, Docker and the Compose plugin, a 2 GB swap file and a firewall
(`ufw`: 22, 80, 443), creates a **read-only deploy key** and prints it. Add it in
GitHub → repository → **Settings** → **Deploy keys** → **Add deploy key**, leave
*Allow write access* unticked, then press Enter on the VM. The script prints GitHub's
host key fingerprint; compare it with
[GitHub's published fingerprints](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints).
It then clones the repository into `/opt/examprep` and creates `deploy/vm/.env`.

Log out and back in so the `docker` group applies:

```bash
exit
```

## 7. Check the firewall

`setup.sh` enabled `ufw`, which allows only SSH, HTTP and HTTPS. If you also add a
DigitalOcean **Cloud Firewall** later, it must allow inbound TCP 22, 80 and 443 (and
UDP 443 for HTTP/3). SSH (22) has to stay reachable from GitHub Actions for automatic
deploys; password login is off because the droplet was created with an SSH key, and
step 12 limits the deploy key to one command.

## 8. Fill in the settings

**On the VM:**

```bash
nano /opt/examprep/deploy/vm/.env
```

| Setting | Value |
| --- | --- |
| `SITE_ADDRESS` | the DNS name from step 4 |
| `ACME_EMAIL` | your e-mail (Let's Encrypt notices) |
| `FRONTEND_URL` | the Vercel origin, e.g. `https://exam-prep-tool-gamma.vercel.app` |
| `DATABASE_URL` | the new Neon string from step 1 |
| `SESSION_SECRET` | the new secret from step 1 |
| others | keep the template values |

The backend refuses to start with unsafe hosted values (no HTTPS frontend, short
secret, missing `sslmode`), and the error appears in the logs in step 9.

## 9. First start

**On the VM:**

```bash
/opt/examprep/deploy/vm/deploy.sh origin/main
```

The first build takes a few minutes. The script waits for the health check and prints
the last log lines if the backend does not become healthy. Then, from anywhere:

```bash
curl https://examprep-api.duckdns.org/health/db
```

It should answer HTTP 200 with `"status":"ok"` over a valid HTTPS certificate; a 503
means the backend runs but cannot reach Neon (check `DATABASE_URL`). Caddy obtains the
certificate within a minute of the first request once ports 80 and 443 are open.

## 10. Uploaded PDFs

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

## 11. Point Vercel at the new backend

Vercel → project `exam-prep-tool` → **Settings** → **Environment Variables** → set
`NEXT_PUBLIC_API_URL` (Production) to `https://<your DNS name>` → **Deployments** →
redeploy the latest production deployment (the value is built into the frontend).

Check on the student site: log in (everyone is logged out after the secret change),
open a course, start and submit a short practice session, and open a past paper.

## 12. Automatic deploys from GitHub (optional)

After this step every push to `main` that passes **Checks** is deployed.

1. Create a key used only by GitHub Actions, on your computer:
   ```bash
   ssh-keygen -t ed25519 -N "" -C "examprep-actions" -f examprep-actions
   ```
2. **On the VM**, as `examprep`, allow that key to run nothing but the deploy script.
   Append one line to `~/.ssh/authorized_keys`, replacing the last part with the
   contents of `examprep-actions.pub`:
   ```text
   command="/opt/examprep/deploy/vm/deploy.sh",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty ssh-ed25519 AAAA... examprep-actions
   ```
3. Print the VM's host key as your computer recorded it in step 5:
   ```bash
   ssh-keygen -F examprep-api.duckdns.org
   ```
   Copy the line(s) that are not comments.
4. GitHub → repository → **Settings** → **Secrets and variables** → **Actions**:
   - Secrets: `VM_HOST` (the DNS name), `VM_USER` (`examprep`), `VM_SSH_KEY` (the
     whole private file `examprep-actions`), `VM_KNOWN_HOSTS` (the line from step 3).
   - Variables: `VM_DEPLOY_ENABLED` = `true`.
5. Delete the local `examprep-actions` private key once it is saved in GitHub.
6. **Actions** → **Deploy backend (VM)** → **Run workflow** to test it.

The workflow passes only a validated commit SHA or branch name, and the restricted key
cannot open a shell. To stop automatic deploys, set `VM_DEPLOY_ENABLED` to anything
else.

## 13. Switch off Railway

When the student site has worked on the new backend for a day, delete the Railway
service (and its volume) so the leaked variables are no longer stored anywhere.

## Operations

All **on the VM**, as `examprep`, in `/opt/examprep/deploy/vm`:

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
PDFs are only on the droplet's disk, so copy a materials archive off the VM after
uploads that matter, or enable droplet backups.

## Other providers

The same files work on any Ubuntu 24.04 VM with at least 1 GB RAM, a public IP and a
DNS name: create the VM, open TCP 80 and 443 in the provider's network firewall, then
follow steps 4 to 13 (skip step 5 if the image already logs you in as a normal user
with `sudo`, e.g. `ubuntu` or `azureuser`).

- **Oracle Cloud Always Free:** the login user is `ubuntu`. Add ingress rules for TCP
  80 and 443 to the subnet's security list. Oracle's Ubuntu images keep their own
  `iptables` rules in `/etc/iptables/rules.v4`; `setup.sh` detects them and opens 80
  and 443 there instead of installing `ufw`.
- **Azure for Students:** first check that a free B-series size is offered in a region
  your subscription allows. When they are all `NotAvailableForSubscription`, the
  remaining small sizes cost around USD 50 a month, more than the yearly student
  credit.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `curl` cannot connect | Ports 80/443 closed: check `sudo ufw status` and any DigitalOcean Cloud Firewall (step 7) |
| Certificate error | `SITE_ADDRESS` differs from the DNS name, DuckDNS points at an old IP, or port 80 is closed; read `docker compose logs caddy` |
| 502 from Caddy | Backend not running or unhealthy; read `docker compose logs backend` |
| Backend exits at start with a settings error | A value in `.env` fails the hosted checks; the message names it |
| Login works but the session is lost | `FRONTEND_URL` must equal the Vercel origin exactly, with `SESSION_COOKIE_SECURE=true` and `SESSION_COOKIE_SAMESITE=none` |
| Build killed or very slow | Not enough memory; check `swapon --show`, and keep `INSTALL_EMBEDDINGS=0` |
| `setup.sh` says to run as a normal user | You are logged in as `root`; do step 5 and log in as `examprep` |
| Windows `ssh`: *UNPROTECTED PRIVATE KEY FILE* | Restrict the key file to your user in PowerShell: `icacls <key file> /inheritance:r /grant:r "$($env:USERNAME):(R)"` |
| Actions deploy fails on SSH | Check the four secrets, that the VM host key matches `VM_KNOWN_HOSTS`, and that the `authorized_keys` line is on one line |
