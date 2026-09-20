#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/infra/pilot/docker-compose.yml"

echo "=== Stopping Solutions Studio Pilot Environment ==="

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: docker is required." >&2
  exit 1
fi

ARGS=()
if [[ "${1:-}" == "-v" || "${1:-}" == "--volumes" ]]; then
  echo "Stopping and deleting persistent volumes..."
  ARGS+=("-v")
fi

docker compose -f "${COMPOSE_FILE}" down "${ARGS[@]}"
echo "=== Pilot Environment Successfully Stopped ==="
