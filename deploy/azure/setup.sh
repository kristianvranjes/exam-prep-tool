#!/usr/bin/env bash
# One-time preparation of a fresh Ubuntu 24.04 VM for the ExamPrep backend.
# Run it as the VM's admin user (e.g. azureuser), not as root:
#   bash setup.sh
# It is safe to run again; finished steps are skipped. See docs/DEPLOY_AZURE.md.
set -euo pipefail

REPO="${REPO:-git@github.com:kristianvranjes/exam-prep-tool.git}"
APP_DIR="${APP_DIR:-/opt/examprep}"
DEPLOY_KEY="$HOME/.ssh/examprep_github"

if [ "$(id -u)" -eq 0 ]; then
  echo "Run this as your normal admin user; it uses sudo where needed." >&2
  exit 1
fi

step() { printf '\n==> %s\n' "$1"; }

step "System packages and automatic security updates"
sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl git ufw unattended-upgrades
echo 'unattended-upgrades unattended-upgrades/enable_auto_updates boolean true' | sudo debconf-set-selections
sudo DEBIAN_FRONTEND=noninteractive dpkg-reconfigure -f noninteractive unattended-upgrades

step "Swap file (the B1s VM has 1 GB RAM; image builds need more)"
if ! swapon --show | grep -q '/swapfile'; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
else
  echo "Swap already enabled."
fi

step "Docker Engine and the Compose plugin (official Docker apt repository)"
if ! command -v docker >/dev/null 2>&1; then
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  sudo chmod a+r /etc/apt/keyrings/docker.asc
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
else
  echo "Docker already installed."
fi
sudo usermod -aG docker "$USER"

step "Firewall: SSH, HTTP and HTTPS only"
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp
sudo ufw --force enable

step "Read-only GitHub deploy key for this VM"
mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
if [ ! -f "$DEPLOY_KEY" ]; then
  ssh-keygen -t ed25519 -N "" -C "examprep-vm-$(hostname)" -f "$DEPLOY_KEY"
fi
if ! grep -q 'examprep_github' "$HOME/.ssh/config" 2>/dev/null; then
  cat >>"$HOME/.ssh/config" <<EOF
Host github.com
  IdentityFile $DEPLOY_KEY
  IdentitiesOnly yes
EOF
  chmod 600 "$HOME/.ssh/config"
fi
if ! ssh-keygen -F github.com >/dev/null 2>&1; then
  ssh-keyscan -t ed25519 github.com >>"$HOME/.ssh/known_hosts" 2>/dev/null
fi
echo "GitHub host key on this VM (compare with the SHA256 fingerprint GitHub publishes):"
ssh-keygen -lf <(ssh-keygen -F github.com | grep -v '^#')

if [ ! -d "$APP_DIR/.git" ]; then
  echo
  echo "Add this public key to the repository as a READ-ONLY deploy key:"
  echo "GitHub -> repository -> Settings -> Deploy keys -> Add deploy key (leave 'Allow write access' unticked)."
  echo
  cat "${DEPLOY_KEY}.pub"
  echo
  read -r -p "Press Enter once the deploy key is saved on GitHub... " _

  step "Cloning the repository into $APP_DIR"
  sudo mkdir -p "$APP_DIR"
  sudo chown "$USER:$USER" "$APP_DIR"
  git clone "$REPO" "$APP_DIR"
else
  echo "Repository already cloned at $APP_DIR."
fi

step "Settings file"
ENV_FILE="$APP_DIR/deploy/azure/.env"
if [ ! -f "$ENV_FILE" ]; then
  cp "$APP_DIR/deploy/azure/.env.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "Created $ENV_FILE from the example."
else
  echo "$ENV_FILE already exists; left unchanged."
fi
chmod +x "$APP_DIR/deploy/azure/deploy.sh"

cat <<EOF

Done. Next steps (docs/DEPLOY_AZURE.md, step 5 onwards):
  1. Log out and back in so the docker group applies:  exit
  2. Fill in the settings:                             nano $ENV_FILE
  3. First start:                                      $APP_DIR/deploy/azure/deploy.sh origin/main
EOF
