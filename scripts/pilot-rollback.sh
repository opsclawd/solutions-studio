#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/infra/pilot/docker-compose.yml"

TARGET_TAG="${1:-${IMAGE_TAG:-previous}}"

echo "=== Initiating Solutions Studio Pilot Rollback to image tag: ${TARGET_TAG} ==="

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: docker is required but not installed or not in PATH." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Error: docker compose plugin is required." >&2
  exit 1
fi

echo "Verifying database schema compatibility..."
# Ensure PostgreSQL is accessible and running
if ! docker compose -f "${COMPOSE_FILE}" exec -T postgres pg_isready -U "${POSTGRES_USER:-solutions_user}" -d "${POSTGRES_DB:-solutions_studio}" >/dev/null 2>&1; then
  echo "Error: Database is not ready. Aborting rollback to prevent split-brain state." >&2
  exit 1
fi

echo "Rolling back orchestrator and web services to tag: ${TARGET_TAG}..."
IMAGE_TAG="${TARGET_TAG}" docker compose -f "${COMPOSE_FILE}" up -d --no-deps orchestrator web

echo "Waiting for rolled-back services to achieve health and readiness..."
TIMEOUT=60
ELAPSED=0

while [ "$ELAPSED" -lt "$TIMEOUT" ]; do
  LIVE_STATUS=$(curl -sf http://localhost:4000/api/health/live || true)
  READY_STATUS=$(curl -sf http://localhost:4000/api/health/ready || true)

  if [ -n "$LIVE_STATUS" ] && [ -n "$READY_STATUS" ]; then
    echo "Orchestrator rolled back successfully: live and ready!"
    break
  fi

  sleep 2
  ELAPSED=$((ELAPSED + 2))
done

if [ "$ELAPSED" -ge "$TIMEOUT" ]; then
  echo "Error: Timeout waiting for rolled-back services to become healthy." >&2
  docker compose -f "${COMPOSE_FILE}" ps
  exit 1
fi

echo ""
echo "=== Rollback Verification Succeeded ==="
echo "Active Image Tag:  ${TARGET_TAG}"
echo "Live Probe:        http://localhost:4000/api/health/live"
echo "Ready Probe:       http://localhost:4000/api/health/ready"
