#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/infra/pilot/docker-compose.yml"

echo "=== Starting Solutions Studio Pilot Environment ==="

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: docker is required but not installed or not in PATH." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Error: docker compose plugin is required." >&2
  exit 1
fi

echo "Deploying topology: postgres, keycloak, orchestrator, web..."
docker compose -f "${COMPOSE_FILE}" up -d --build

echo "Waiting for services to become healthy..."
TIMEOUT=120
ELAPSED=0

while [ "$ELAPSED" -lt "$TIMEOUT" ]; do
  if docker compose -f "${COMPOSE_FILE}" ps | grep -q "unhealthy"; then
    echo "One or more services reported unhealthy. Waiting..."
  fi

  READY_COUNT=$(docker compose -f "${COMPOSE_FILE}" ps --filter "status=running" --format "{{.Service}}" | wc -l)
  if [ "$READY_COUNT" -ge 4 ]; then
    # Test orchestrator liveness
    if curl -sf http://localhost:4000/api/health/live >/dev/null 2>&1; then
      echo "Orchestrator is live!"
      break
    fi
  fi

  sleep 3
  ELAPSED=$((ELAPSED + 3))
done

if [ "$ELAPSED" -ge "$TIMEOUT" ]; then
  echo "Warning: Timeout waiting for all containers to report ready."
  docker compose -f "${COMPOSE_FILE}" ps
  exit 1
fi

echo ""
echo "=== Solutions Studio Pilot Stack is Online ==="
echo "Web UI:             http://localhost:3000"
echo "Orchestrator API:   http://localhost:4000"
echo "Readiness Health:   http://localhost:4000/api/health/ready"
echo "Metrics Endpoint:   http://localhost:4000/api/metrics"
echo "Keycloak Realm:     http://localhost:8080/realms/solutions-studio"
echo "Admin Console:      http://localhost:8080/admin (admin / admin)"
echo ""
echo "Test Accounts (Password: solutions-studio-dev):"
echo "  Reviewer:  reviewer.alice"
echo "  Architect: architect.bob"
echo "  Admin:     admin.carol"
echo "  Viewer:    viewer.dave"
