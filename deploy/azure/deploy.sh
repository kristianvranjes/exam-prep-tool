#!/usr/bin/env bash
# Build and (re)start the backend at a Git revision, then wait until it is healthy.
#   deploy.sh [revision]     # default origin/main; a commit SHA in automatic deploys
# GitHub Actions calls it through a restricted SSH key, so the revision arrives in
# SSH_ORIGINAL_COMMAND and is validated before use. See docs/DEPLOY_AZURE.md.
set -euo pipefail

# Everything runs inside main(): checking out a new revision may replace this very
# file, and bash must not read the rest of it from the new version mid-run.
main() {
  local ref="${1:-${SSH_ORIGINAL_COMMAND:-origin/main}}"
  if [[ ! "$ref" =~ ^[A-Za-z0-9._/-]{1,100}$ ]] || [[ "$ref" == -* ]]; then
    echo "Refusing to deploy an unexpected revision: $ref" >&2
    exit 2
  fi

  local root
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  cd "$root"
  if [ ! -f deploy/azure/.env ]; then
    echo "Missing deploy/azure/.env; copy .env.example and fill it in first." >&2
    exit 1
  fi

  echo "==> Fetching $ref"
  git fetch --prune --quiet origin
  git -c advice.detachedHead=false checkout --quiet --detach "$ref"
  echo "==> Deploying $(git log -1 --format='%h %s')"

  cd deploy/azure
  docker compose build --pull backend
  docker compose up -d --remove-orphans

  echo "==> Waiting for the backend health check (migrations run at start)"
  local container status=starting
  container="$(docker compose ps -q backend)"
  for _ in $(seq 1 40); do
    status="$(docker inspect -f '{{.State.Health.Status}}' "$container" 2>/dev/null || echo missing)"
    [ "$status" = healthy ] && break
    sleep 5
  done
  if [ "$status" != healthy ]; then
    echo "Backend is $status after the deploy. Last log lines:" >&2
    docker compose logs --tail 80 backend >&2
    exit 1
  fi

  docker image prune -f >/dev/null
  echo "==> Healthy: $(cd "$root" && git rev-parse --short HEAD) is live"
}

main "$@"
exit
