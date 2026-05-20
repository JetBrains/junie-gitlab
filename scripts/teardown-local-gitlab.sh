#!/usr/bin/env bash
# Tear down the local GitLab + Runner test stack and remove generated state.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.test.yml}"
ENV_FILE="${ENV_FILE:-.env.local-gitlab}"

echo "[teardown] docker compose -f ${COMPOSE_FILE} down -v"
docker compose -f "$COMPOSE_FILE" down -v --remove-orphans || true

if [[ -f "$ENV_FILE" ]]; then
    rm -f "$ENV_FILE"
    echo "[teardown] Removed ${ENV_FILE}"
fi

echo "[teardown] Done."
