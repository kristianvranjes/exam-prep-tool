# Backend on an always-free Ubuntu VM (Oracle Cloud)

This guide moves the FastAPI backend from Railway to a small always-on Ubuntu VM on
**Oracle Cloud Always Free**. Only the backend moves:

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

- Oracle's Always Free tier includes Arm (Ampere A1) capacity of up to 4 cores and
  24 GB RAM in total, two small AMD VMs with 1 GB RAM, and 200 GB of block storage.
  Check the current terms on the [Oracle Cloud Free Tier page](https://www.oracle.com/cloud/free/)
  before relying on them; offers change.
- Sign-up asks for a credit or debit card to verify your identity. A Free Tier account
  is not charged unless you upgrade it to Pay As You Go.
- The **home region** you pick at sign-up is permanent, and Always Free VMs run only
  there.
- Oracle may stop Always Free VMs it considers idle over a week: low CPU, network
  and (on Arm) memory use. Step 3 sizes the VM so its memory use stays above that
  threshold; [Operations](#operations) covers what to do if it is stopped anyway.
- The backend runs without the optional ML stack (`INSTALL_EMBEDDINGS=0`): login,
  courses, PDFs, question bank, import, practice and past papers all work; AI
  generation and semantic search stay disabled, as on Railway.
- A deploy restarts the container, so the API is unavailable for roughly half a
  minute while migrations run.
- You maintain the VM: automatic security updates are enabled by `setup.sh`, but
  reboots and backups are yours.

Commands below in `bash` blocks run on your own computer unless the text says
**on the VM**. `ssh` and `scp` also work in Windows PowerShell.

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

Keep these values for step 7; never paste them into issues, chats or Git.

## 2. Create the Oracle Cloud account

Sign up at <https://signup.cloud.oracle.com>.

- **Home region**: the one closest to the database. The Neon host name shows its
  region, e.g. `…eu-central-1.aws.neon.tech` is Frankfurt, so pick **Germany Central
  (Frankfurt)** or a neighbour such as Netherlands Northwest (Amsterdam), Switzerland
  North (Zurich) or France Central (Paris). Busy regions sometimes run out of free Arm
  capacity (step 3 has a fallback).
- Finish the card verification. New accounts also get a 30-day trial credit; this
  guide uses only resources marked **Always Free-eligible**, which keep running after
  the trial.

## 3. Create the VM

Console → **Compute** → **Instances** → **Create instance**.

| Setting | Value |
| --- | --- |
| Name | `examprep-vm` |
| Image | **Canonical Ubuntu 24.04** (the full image, not *Minimal*) |
| Shape | **Ampere** → `VM.Standard.A1.Flex`, **1 OCPU**, **2 GB** memory (Always Free-eligible) |
| Networking | Create a new virtual cloud network and a new **public** subnet; **Automatically assign public IPv4 address** on |
| SSH keys | *Generate a key pair for me* → **Save private key**, or paste your own public key |
| Boot volume | Default size |

Two GB is enough for the backend and Caddy, and keeps memory use above the idle
threshold; you can change the shape later (stop the VM → **Edit** → shape).

If creation fails with **Out of capacity**, pick another availability domain under
*Placement*, try again later, or use the AMD shape `VM.Standard.E2.1.Micro` (1 GB, with
the x64 Ubuntu image). The rest of the guide is the same; image builds are slower
there.

When the VM is running, copy its **Public IP address** from the instance page. The
login user on Oracle's Ubuntu images is `ubuntu`.

## 4. Open HTTP and HTTPS in Oracle's network

Oracle filters traffic before it reaches the VM. On the instance page → **Networking**
(attached VNIC) → the **subnet** → **Security** → the security list
*Default Security List for …* → **Security rules** → **Add Ingress Rules**:

| Source CIDR | IP protocol | Destination port |
| --- | --- | --- |
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |
| `0.0.0.0/0` | UDP | `443` (optional, HTTP/3) |

SSH (22) is already allowed and has to stay reachable from GitHub Actions for
automatic deploys; password login is disabled on Oracle's Ubuntu images, and step 11
limits the deploy key to one command. The firewall inside the VM is opened by
`setup.sh` in step 6.

## 5. Give the VM a DNS name

Let's Encrypt needs a host name, and Oracle does not provide one. A free
[DuckDNS](https://www.duckdns.org) subdomain works:

1. Sign in on duckdns.org (for example with GitHub).
2. Add a subdomain, e.g. `examprep-api`, set **current ip** to the VM's public IP and
   press **update ip**.
3. Check it:
   ```bash
   nslookup examprep-api.duckdns.org
   ```

The public IP stays with the VM, also across stop and start; if you ever recreate the
VM, update the IP on DuckDNS. A domain of your own works the same way with an `A`
record.

## 6. Prepare the server

From your local clone of the repository (the repository is private, so the VM cannot
download the script before it has a deploy key). Use the DNS name, not the IP, so your
computer records the host key under the name GitHub Actions will use in step 11:

```bash
scp -i ~/Downloads/ssh-key-examprep.key deploy/vm/setup.sh ubuntu@examprep-api.duckdns.org:~
```

```bash
ssh -i ~/Downloads/ssh-key-examprep.key ubuntu@examprep-api.duckdns.org
```

**On the VM:**

```bash
bash setup.sh
```

It installs updates, Docker and the Compose plugin and a 2 GB swap file, opens ports
80 and 443 in the VM's firewall (Oracle's `iptables` rules; `ufw` on other images),
creates a **read-only deploy key** and prints it. Add it in GitHub → repository →
**Settings** → **Deploy keys** → **Add deploy key**, leave *Allow write access*
unticked, then press Enter on the VM. The script prints GitHub's host key fingerprint;
compare it with
[GitHub's published fingerprints](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints).
It then clones the repository into `/opt/examprep` and creates `deploy/vm/.env`.

Log out and back in so the `docker` group applies:

```bash
exit
```

## 7. Fill in the settings

**On the VM:**

```bash
nano /opt/examprep/deploy/vm/.env
```

| Setting | Value |
| --- | --- |
| `SITE_ADDRESS` | the DNS name from step 5 |
| `ACME_EMAIL` | your e-mail (Let's Encrypt notices) |
| `FRONTEND_URL` | the Vercel origin, e.g. `https://exam-prep-tool-gamma.vercel.app` |
| `DATABASE_URL` | the new Neon string from step 1 |
| `SESSION_SECRET` | the new secret from step 1 |
| others | keep the template values |

The backend refuses to start with unsafe hosted values (no HTTPS frontend, short
secret, missing `sslmode`), and the error appears in the logs in step 8.

## 8. First start

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

## 9. Uploaded PDFs

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

## 10. Point Vercel at the new backend

Vercel → project `exam-prep-tool` → **Settings** → **Environment Variables** → set
`NEXT_PUBLIC_API_URL` (Production) to `https://<your DNS name>` → **Deployments** →
redeploy the latest production deployment (the value is built into the frontend).

Check on the student site: log in (everyone is logged out after the secret change),
open a course, start and submit a short practice session, and open a past paper.

## 11. Automatic deploys from GitHub (optional)

After this step every push to `main` that passes **Checks** is deployed.

1. Create a key used only by GitHub Actions, on your computer:
   ```bash
   ssh-keygen -t ed25519 -N "" -C "examprep-actions" -f examprep-actions
   ```
2. **On the VM**, allow that key to run nothing but the deploy script. Append one line
   to `~/.ssh/authorized_keys`, replacing the last part with the contents of
   `examprep-actions.pub`:
   ```text
   command="/opt/examprep/deploy/vm/deploy.sh",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty ssh-ed25519 AAAA... examprep-actions
   ```
3. Print the VM's host key as your computer recorded it in step 6:
   ```bash
   ssh-keygen -F examprep-api.duckdns.org
   ```
   Copy the line(s) that are not comments.
4. GitHub → repository → **Settings** → **Secrets and variables** → **Actions**:
   - Secrets: `VM_HOST` (the DNS name), `VM_USER` (`ubuntu`), `VM_SSH_KEY` (the whole
     private file `examprep-actions`), `VM_KNOWN_HOSTS` (the line from step 3).
   - Variables: `VM_DEPLOY_ENABLED` = `true`.
5. Delete the local `examprep-actions` private key once it is saved in GitHub.
6. **Actions** → **Deploy backend (VM)** → **Run workflow** to test it.

The workflow passes only a validated commit SHA or branch name, and the restricted key
cannot open a shell. To stop automatic deploys, set `VM_DEPLOY_ENABLED` to anything
else.

## 12. Switch off Railway

When the student site has worked on the new backend for a day, delete the Railway
service (and its volume) so the leaked variables are no longer stored anywhere.

## Operations

All **on the VM**, in `/opt/examprep/deploy/vm`:

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

**If Oracle stops the VM as idle**, start it again on the instance page; the
containers come back on their own. If it keeps happening, either give the backend a
little more to do or upgrade the account to Pay As You Go, which keeps Always Free
resources free and is not subject to idle reclamation. Set a budget alert first
(**Billing** → **Budgets**) so any unexpected charge is visible.

## Other providers

The same files work on any Ubuntu 24.04 VM with at least 1 GB RAM, a public IP and a
DNS name: create the VM, open TCP 80 and 443 in the provider's network firewall, then
follow steps 6 to 12 with that provider's login user. On images without Oracle's
`iptables` rules, `setup.sh` configures `ufw` instead.

On Azure for Students, first check that a free B-series size is offered in a region
your subscription allows. When they are all `NotAvailableForSubscription`, the
remaining small sizes cost around USD 50 a month, more than the yearly student credit.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `curl` cannot connect | Ports 80/443 missing in the security list (step 4), or in the VM firewall: `sudo iptables -L INPUT -n --line-numbers` must list ACCEPT for 80 and 443 above the REJECT line (run `setup.sh` again if not) |
| Certificate error | `SITE_ADDRESS` differs from the DNS name, DuckDNS points at an old IP, or port 80 is closed; read `docker compose logs caddy` |
| 502 from Caddy | Backend not running or unhealthy; read `docker compose logs backend` |
| Backend exits at start with a settings error | A value in `.env` fails the hosted checks; the message names it |
| Login works but the session is lost | `FRONTEND_URL` must equal the Vercel origin exactly, with `SESSION_COOKIE_SECURE=true` and `SESSION_COOKIE_SAMESITE=none` |
| Build killed or very slow | Not enough memory; check `swapon --show`, and keep `INSTALL_EMBEDDINGS=0` |
| *Out of capacity* when creating the VM | See step 3: another availability domain, later, or `VM.Standard.E2.1.Micro` |
| Windows `ssh`: *UNPROTECTED PRIVATE KEY FILE* | Restrict the key file to your user in PowerShell: `icacls <key file> /inheritance:r /grant:r "$($env:USERNAME):(R)"` |
| Actions deploy fails on SSH | Check the four secrets, that the VM host key matches `VM_KNOWN_HOSTS`, and that the `authorized_keys` line is on one line |
