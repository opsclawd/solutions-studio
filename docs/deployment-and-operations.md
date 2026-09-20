# Solutions Studio: Deployment, Observability & Pilot Hardening Runbook

## 1. Executive Summary & Runtime Topology

Solutions Studio operates as a requirements control plane that compiles messy enterprise evidence into canonical, immutable baselines, projects them into verified prototypes and schemas, and exports ready user stories to external backlog trackers.

For production and pilot deployments, Solutions Studio provides a self-contained runtime topology that requires **zero paid cloud infrastructure** (e.g. Azure). The reference identity provider is an open-source Keycloak 24 instance pre-configured with the `solutions-studio` realm.

```
                      ┌─────────────────────────────────────────┐
                      │              User Browser               │
                      └────────────────────┬────────────────────┘
                                           │
                        ┌──────────────────┴──────────────────┐
                        │ HTTP 3000                           │ OIDC PKCE
                        ▼                                     ▼
             ┌─────────────────────┐               ┌─────────────────────┐
             │    Web Frontend     │               │    Keycloak IdP     │
             │   (Next.js 14 App)  │               │   (Port 8080)       │
             └──────────┬──────────┘               └──────────┬──────────┘
                        │ HTTP 4000 (Bearer Token)            │
                        ▼                                     │ JWKS / OIDC
             ┌────────────────────────────────────────┐       │ Discovery
             │       Orchestrator Control Plane       │ ◄─────┘
             │           (Fastify 5 API)              │
             └──────────┬──────────────────┬──────────┘
                        │                  │
                        ▼                  ▼
             ┌─────────────────────┐  ┌───────────────────────────────┐
             │   PostgreSQL 16     │  │ Filesystem Object Storage     │
             │   (Port 5432)       │  │ (Docker Volume: /data/blobs)  │
             └─────────────────────┘  └───────────────────────────────┘
```

### Component Breakdown

| Service            | Image / Tech                     | Port     | Role                                                             | Persistent Storage        |
| :----------------- | :------------------------------- | :------- | :--------------------------------------------------------------- | :------------------------ |
| **`web`**          | Node 22 / Next.js 14             | `3000`   | User review workspace, prototype sandbox                         | Ephemeral                 |
| **`orchestrator`** | Node 22 / Fastify 5              | `4000`   | Core control plane, validation, persistence, export              | Local volumes             |
| **`postgres`**     | `postgres:16-alpine`             | `5432`   | Relational store for immutable baselines, stories, audit records | `solutions_studio_pgdata` |
| **`object-store`** | `FilesystemObjectStore`          | Internal | Durable blob store for large source documents and projections    | `solutions_studio_blobs`  |
| **`keycloak`**     | `quay.io/keycloak/keycloak:24.0` | `8080`   | Reference OIDC identity provider with pre-imported realm         | Ephemeral/Volume          |

---

## 2. Quickstart Pilot Deployment

### Prerequisites

- Docker Engine 24+ and Docker Compose v2+
- At least 4GB of available RAM and 10GB of disk space
- Host ports `3000`, `4000`, `5432`, and `8080` available

### 1. Launching the Pilot Stack

Run the automated deployment script from the repository root:

```bash
./scripts/pilot-up.sh
```

The script builds container images, initializes database schemas, imports Keycloak realm definitions, and waits for all container healthchecks to turn green.

Alternatively, use Docker Compose directly:

```bash
docker compose -f infra/pilot/docker-compose.yml up -d --build
```

### 2. Validating Services

```bash
# Verify container health
docker compose -f infra/pilot/docker-compose.yml ps

# Verify Orchestrator Readiness Probe
curl -s http://localhost:4000/api/health/ready | jq .

# Verify Web UI Health
curl -s http://localhost:3000/api/health | jq .
```

### 3. Access URLs & Test Credentials

- **Web UI**: [http://localhost:3000](http://localhost:3000)
- **Orchestrator API**: [http://localhost:4000](http://localhost:4000)
- **Prometheus Metrics**: [http://localhost:4000/api/metrics](http://localhost:4000/api/metrics)
- **Keycloak Admin**: [http://localhost:8080/admin](http://localhost:8080/admin) (admin / admin)

**Pre-Seeded Test Personas** (Password: `solutions-studio-dev`):

- `reviewer.alice`: Requirements Reviewer (`requirements:reconcile`, `candidate:approve`)
- `architect.bob`: Lead Architect (`engineering-decision:author`, `engineering-decision:approve`, `baseline:create`, `policy-constraint:author`)
- `admin.carol`: Platform Administrator (`operator:admin`)
- `viewer.dave`: Read-only viewer

### 4. Stopping the Stack

```bash
./scripts/pilot-down.sh

# To remove persistent data volumes:
./scripts/pilot-down.sh --volumes
```

---

## 3. Configuration & Secrets Management Conventions

Solutions Studio enforces strict separation between public client configurations and confidential backend secrets.

### Environment Variable Matrix

| Variable                       | Service      | Pilot Default                                                                | Production / Entra ID Delta                                         |
| :----------------------------- | :----------- | :--------------------------------------------------------------------------- | :------------------------------------------------------------------ |
| `PORT`                         | Orchestrator | `4000`                                                                       | Container port (e.g. `4000` or `8080`)                              |
| `HOST`                         | Orchestrator | `0.0.0.0`                                                                    | `0.0.0.0`                                                           |
| `NODE_ENV`                     | Both         | `production`                                                                 | `production`                                                        |
| `CORS_ORIGINS`                 | Orchestrator | `http://localhost:3000`                                                      | `https://solutions-studio.enterprise.com`                           |
| `STORAGE_TYPE`                 | Orchestrator | `postgres`                                                                   | `postgres`                                                          |
| `DATABASE_URL`                 | Orchestrator | `postgresql://solutions_user:solutions_pass@postgres:5432/solutions_studio`  | Managed DB connection string with SSL                               |
| `STORAGE_BACKEND`              | Orchestrator | `filesystem`                                                                 | `filesystem` or `azure`                                             |
| `REQUIREMENTS_STORE_DIR`       | Orchestrator | `/data/blobs`                                                                | Persistent mount path                                               |
| `AUTH_PROVIDER`                | Orchestrator | `oidc`                                                                       | `oidc`                                                              |
| `OIDC_ISSUER`                  | Orchestrator | `http://keycloak:8080/realms/solutions-studio`                               | `https://login.microsoftonline.com/<TENANT_ID>/v2.0`                |
| `OIDC_AUDIENCE`                | Orchestrator | `solutions-studio-api`                                                       | `api://solutions-studio`                                            |
| `OIDC_JWKS_URI`                | Orchestrator | `http://keycloak:8080/realms/solutions-studio/protocol/openid-connect/certs` | `https://login.microsoftonline.com/<TENANT_ID>/discovery/v2.0/keys` |
| `GENERATION_PROVIDER`          | Orchestrator | `fake`                                                                       | Private model seam / CLI adapter                                    |
| `ALLOW_REAL_BACKLOG_MUTATION`  | Orchestrator | `false`                                                                      | `true` (when connected to target tracker)                           |
| `GITHUB_TOKEN`                 | Orchestrator | (none)                                                                       | Secret tracker token                                                |
| `NEXT_PUBLIC_ORCHESTRATOR_URL` | Web          | `http://localhost:4000`                                                      | Public API URL                                                      |
| `NEXT_PUBLIC_OIDC_ISSUER`      | Web          | `http://localhost:8080/realms/solutions-studio`                              | Public IdP issuer for PKCE                                          |
| `NEXT_PUBLIC_OIDC_CLIENT_ID`   | Web          | `solutions-studio-web`                                                       | Client ID registered in IdP                                         |

### Container Secrets & the `_FILE` Convention

In enterprise orchestrated environments (Docker Swarm, Kubernetes, HashiCorp Vault), secrets should be mounted as read-only files on disk rather than passed as raw environment variables.

Solutions Studio supports the `_FILE` convention across all secret settings:

- `DATABASE_URL_FILE=/run/secrets/database_url`
- `GITHUB_TOKEN_FILE=/run/secrets/github_token`

When a variable ending with `_FILE` is detected, the server automatically reads the secret from the referenced disk path at startup.

### Strict Redaction Invariant

- Fastify logging unconditionally redacts `req.headers.authorization` and `req.headers.Authorization`.
- Telemetry event records reject keys named `token`, `accessToken`, `password`, `secret`, `clientSecret`.
- Source evidence Markdown, legacy schemas, and interview notes are stripped and replaced with safe surrogates (`sourceRevisionId`, `locator`, `contentHash`, `byteLength`).

---

## 4. Health Checks & Observability Guide

### 4.1 Health Endpoints

#### Liveness Probe (`GET /api/health/live`)

- **Status Code**: `200 OK`
- **Response**: `{"status": "ok", "uptime": 124.5, "timestamp": "2026-09-20T12:00:00.000Z"}`
- **Purpose**: Fastify process event loop health; if this times out, container orchestrators restart the container.

#### Readiness Probe (`GET /api/health/ready`)

- **Status Code**: `200 OK` (healthy / degraded) or `503 Service Unavailable` (unhealthy).
- **Checks Performed**:
  1. **Relational Database**: Executes `SELECT 1` and verifies schema migration level.
  2. **Object Storage**: Verifies blob read/write accessibility.
  3. **Identity Provider (OIDC)**: Lightweight probe against OIDC Discovery / JWKS URI.
  4. **Generation Engine**: Validates provider configuration.
  5. **Backlog Tracker**: Validates external tracker configuration.
- **Example Healthy Response**:
  ```json
  {
    "status": "healthy",
    "timestamp": "2026-09-20T12:00:00.000Z",
    "uptime": 124.5,
    "version": "0.1.0",
    "dependencies": {
      "database": {
        "status": "healthy",
        "dialect": "postgresql",
        "currentMigration": 5,
        "latencyMs": 2
      },
      "objectStore": {
        "status": "healthy",
        "backend": "filesystem",
        "latencyMs": 1
      },
      "identity": {
        "status": "healthy",
        "provider": "oidc",
        "issuer": "http://keycloak:8080/realms/solutions-studio",
        "reachable": true,
        "latencyMs": 4
      },
      "generation": {
        "status": "healthy",
        "provider": "fake",
        "available": true
      },
      "backlog": {
        "status": "healthy",
        "provider": "github-issues",
        "reachable": true
      }
    }
  }
  ```

### 4.2 Metrics & Telemetry Scraping

#### Prometheus Endpoint (`GET /api/metrics`)

Formatted according to standard Prometheus text exposition (`text/plain; version=0.0.4`):

```text
# HELP solutions_studio_http_requests_total Total incoming API requests by status code
# TYPE solutions_studio_http_requests_total counter
solutions_studio_http_requests_total{method="GET",route="/api/health/ready",status_code="200"} 42
solutions_studio_http_requests_total{method="POST",route="/api/baselines",status_code="201"} 3

# HELP solutions_studio_http_request_duration_ms Request duration distribution in milliseconds
# TYPE solutions_studio_http_request_duration_ms histogram
solutions_studio_http_request_duration_ms_bucket{method="POST",route="/api/baselines",le="100"} 2
solutions_studio_http_request_duration_ms_sum{method="POST",route="/api/baselines"} 140
solutions_studio_http_request_duration_ms_count{method="POST",route="/api/baselines"} 3

# HELP solutions_studio_auth_failures_total Authentication failures by reason
# TYPE solutions_studio_auth_failures_total counter
solutions_studio_auth_failures_total{reason="TOKEN_EXPIRED"} 1

# HELP solutions_studio_backlog_exports_total Backlog export outcomes by provider and outcome
# TYPE solutions_studio_backlog_exports_total counter
solutions_studio_backlog_exports_total{outcome="created",provider="github-issues"} 12
```

#### JSON Summary Endpoint (`GET /api/telemetry/summary`)

Returns real-time structured counters, gauges, and histograms for automated test harnesses and operational dashboards.

### 4.3 Correlation Tracing Across 8 Touchpoints

Every request carries or generates an `X-Correlation-ID` header. Structured operational events are logged as JSON objects:

1. `http.request.completed` — API ingress / egress
2. `identity.actor.authenticated` — Authenticated actor context (id, actorType, capabilitiesCount)
3. `command.executed` — Application use case dispatch
4. `generation.call.completed` — LLM generation and repair attempt outcomes
5. `validation.executed` — Mermaid, SQL, OpenAPI, Gherkin validation results
6. `persistence.operation.completed` — Relational and blob storage operations
7. `backlog.export.completed` — Backlog sync outcomes (created, updated, unchanged, failed)
8. `governance.approval.recorded` — Candidate promotion GO / REVOKED decisions

---

## 5. Degraded Provider & Incident Triage Runbook

### 5.1 Identity Provider (OIDC / Keycloak / Entra) Outage

- **Symptom**: `/api/health/ready` returns `HTTP 503` with `dependencies.identity.status: "unhealthy"`. Unauthenticated requests to API routes fail.
- **Fail-Closed Invariant**:
  - In-flight tokens signed with keys not yet cached in `JwksCache` cannot be verified.
  - The request hook immediately terminates the request with `HTTP 401 UNAUTHENTICATED`.
  - **Zero Fallback**: The server **never** falls back to `TestAuthenticator` or anonymous mode in production.
  - **Zero Caller-Supplied Identity**: Route handlers **never** trust user-supplied `createdBy` or `actorId` fields in request bodies.
- **Remediation**:
  1. Inspect Keycloak container logs: `docker compose -f infra/pilot/docker-compose.yml logs keycloak`.
  2. Verify network connectivity from orchestrator to Keycloak: `docker compose -f infra/pilot/docker-compose.yml exec orchestrator wget -qO- http://keycloak:8080/health/ready`.
  3. Restart Keycloak: `docker compose -f infra/pilot/docker-compose.yml restart keycloak`.

### 5.2 LLM Generation Engine Degradation

- **Symptom**: `POST /api/baselines/.../projections` returns `HTTP 502 ARTIFACT_GENERATION_FAILED`.
- **System State Safety**:
  - Canonical requirements, baselines, and engineering decisions are immutable and cannot be corrupted by generation failures.
  - Transient errors trigger deterministic repair retry loops. If retries are exhausted, `generation_repairs_total` and `generation_calls_total{status="failed"}` are incremented.
- **Remediation**:
  1. Check generation provider configuration: `GENERATION_PROVIDER`.
  2. Inspect CLI binary availability (`agy` / `opencode`) if using local CLI subprocesses.

### 5.3 External Backlog Tracker (GitHub Issues) Rate Limiting & 5xx

- **Symptom**: Backlog export operations fail with `PROVIDER_RATE_LIMIT_ERROR` or retryable failure.
- **Idempotency & Lost Acknowledgement Safety**:
  - On `HTTP 429` / `403 secondary`, the adapter parses `Retry-After` or `x-ratelimit-reset` and executes exponential backoff with jitter.
  - On `HTTP 5xx`, the adapter **never** blindly retries issue creation. It queries the target container by deterministic provenance title and comment before re-attempting, guaranteeing zero duplicate issues.
- **Remediation**:
  1. Check tracker token quota and rate-limit headers.
  2. Retry sync: exports are strictly idempotent and can be safely re-run at any time.

### 5.4 Database Connectivity Failure

- **Symptom**: `/api/health/ready` returns `HTTP 503`. Mutations fail fast.
- **Remediation**:
  1. Check PostgreSQL container logs: `docker compose -f infra/pilot/docker-compose.yml logs postgres`.
  2. Restart PostgreSQL: `docker compose -f infra/pilot/docker-compose.yml restart postgres`.
  3. Orchestrator automatically reconnects when the database becomes healthy.

---

## 6. Disaster Recovery: Backup, Tamper Detection & Restore

### 6.1 Database & Blob Backup

Run the backup script to create a cryptographically attested backup snapshot:

```bash
pnpm --filter @solutions-studio/orchestrator exec tsx scripts/run-db-backup.ts /path/to/backups/snapshot-01
```

The backup creates:

- JSON table dumps for Class A, B, C, and E tables.
- Associated blob files from `IObjectStore`.
- `manifest.json` containing table row counts, SHA-256 hashes of every table file and blob, and a root checksum attestation.

### 6.2 Tamper Verification & Restore Drill

To restore from a backup:

```bash
pnpm --filter @solutions-studio/orchestrator exec tsx scripts/run-db-restore.ts /path/to/backups/snapshot-01
```

**Tamper-Evident Safety Invariant**:

- The restore tool re-calculates SHA-256 hashes for all table dumps and blob files and compares them against `manifest.json`.
- If any file has been modified, corrupted, or truncated, the restore **aborts immediately** with `BackupChecksumMismatchError` before modifying the target database.
- Target tables are truncated and restored in strict foreign-key dependency order.

---

## 7. Rollback Procedures

### 7.1 Application Rollback

Solutions Studio services are designed for zero-downtime rolling updates and deterministic rollbacks using explicit immutable image tags:

1. **Automated Rollback Script**:
   Execute `scripts/pilot-rollback.sh` providing the target image tag (or git commit SHA):

   ```bash
   ./scripts/pilot-rollback.sh v1.0.0
   ```

   Or via environment variables:

   ```bash
   IMAGE_TAG=v1.0.0 ./scripts/pilot-rollback.sh
   ```

2. **Manual Compose Redeployment**:
   Override the image tags and redeploy without stopping external dependencies:

   ```bash
   IMAGE_TAG=v1.0.0 docker compose -f infra/pilot/docker-compose.yml up -d --no-deps orchestrator web
   ```

3. **Rollback Verification**:
   The rollback script automatically probes:
   - Live probe: `curl -f http://localhost:4000/api/health/live` (status: `ok`)
   - Ready probe: `curl -f http://localhost:4000/api/health/ready` (status: `ok` or `degraded`)
   - Telemetry endpoint: `curl -f http://localhost:4000/api/metrics`

### 7.2 Database Schema Compatibility & Downgrade Safety

- All PostgreSQL migrations in `src/infrastructure/persistence/postgres/migrations/` follow additive expansion patterns.
- Destructive table or column drops are prohibited during standard upgrades.
- Rollback of application containers does not require rolling back database schema unless a migration introduced incompatible constraints.
- Pre-rollback schema compatibility check: `scripts/pilot-rollback.sh` verifies PostgreSQL connectivity and schema state before cycling application containers to prevent split-brain states.

---

## 8. Operational Retention Pruning (#93)

To comply with enterprise retention policies without endangering immutable Class A baselines:

- **Horizon 1 (14 days)**: Large raw fixture blobs and intermediate evaluation result payloads are pruned.
- **Horizon 2 (90 days)**: Evaluation run summary rows are pruned, unconditionally preserving the last 10 runs.
- **Tier 1 Class A Inviolability**: Baselines, source revisions, requirement revisions, and reconciliation records are Tier 1 immutable data and are **never** pruned (`verifyRetentionSafety()`).

### Maintenance Execution

1. **Automated Docker Compose Scheduler (`maintenance-scheduler`)**:
   `infra/pilot/docker-compose.yml` includes a dedicated `maintenance-scheduler` service driven by `infra/pilot/crontab`:

   ```cron
   # Daily maintenance: Class B transient artifact pruning at 03:00 UTC
   0 3 * * * node /app/apps/orchestrator/dist/scripts/run-retention-cleanup.js >> /var/log/retention.log 2>&1
   ```

   This service mounts `/etc/crontabs/root` and executes daily at 03:00 UTC without operator intervention.

2. **Administrative API Endpoint**:

   ```bash
   curl -X POST http://localhost:4000/api/admin/maintenance/retention \
     -H "Authorization: Bearer <ADMIN_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"dryRun": false, "maxRawFixtureAgeDays": 14, "maxSummaryAgeDays": 90, "keepLast": 10}'
   ```

3. **Host-Level Scheduled CLI Cron**:
   Alternatively, add to `/etc/cron.d/solutions-studio-retention`:
   ```cron
   0 3 * * * solutions_user cd /opt/solutions-studio && pnpm --filter @solutions-studio/orchestrator exec tsx scripts/run-retention-cleanup.ts >> /var/log/solutions-studio-retention.log 2>&1
   ```

---

## 9. Enterprise Identity Transition: Keycloak to Microsoft Entra ID

Solutions Studio enforces provider neutrality: **Zero application or domain code changes are required to transition from the reference Keycloak IdP to Microsoft Entra ID.**

### Configuration Delta

| Configuration Parameter      | Reference Pilot (Keycloak)                                                 | Enterprise Production (Microsoft Entra ID)                          |
| :--------------------------- | :------------------------------------------------------------------------- | :------------------------------------------------------------------ |
| `AUTH_PROVIDER`              | `oidc`                                                                     | `oidc`                                                              |
| `OIDC_ISSUER`                | `http://<host>:8080/realms/solutions-studio`                               | `https://login.microsoftonline.com/<TENANT_ID>/v2.0`                |
| `OIDC_AUDIENCE`              | `solutions-studio-api`                                                     | `api://solutions-studio` (Application ID URI)                       |
| `OIDC_JWKS_URI`              | `http://<host>:8080/realms/solutions-studio/protocol/openid-connect/certs` | `https://login.microsoftonline.com/<TENANT_ID>/discovery/v2.0/keys` |
| `NEXT_PUBLIC_OIDC_ISSUER`    | `http://<host>:8080/realms/solutions-studio`                               | `https://login.microsoftonline.com/<TENANT_ID>/v2.0`                |
| `NEXT_PUBLIC_OIDC_CLIENT_ID` | `solutions-studio-web`                                                     | `<WEB_APP_CLIENT_ID>`                                               |

### Claim & Role Mapping

The built-in `ConfigurableClaimMapper` automatically translates Microsoft Entra ID token claims:

- **User Identifier**: Extracted from `preferred_username`, `upn`, `oid`, or `sub`.
- **App Roles**: Entra ID delivers assigned App Roles in the `roles` token claim. `ConfigurableClaimMapper` maps:
  - `SolutionsStudio.Reviewer` ➔ `requirements:reconcile`, `candidate:approve`
  - `SolutionsStudio.Architect` ➔ `engineering-decision:author`, `engineering-decision:approve`, `baseline:create`, `policy-constraint:author`
  - `SolutionsStudio.Admin` ➔ `operator:admin`
  - `SolutionsStudio.Exporter` ➔ `backlog:export`
  - `SolutionsStudio.Viewer` ➔ (Read-only)

---

## 10. CI/CD Pre-Deploy Validation & Exit Gate Checklist

All Phase 1–3 exit gate verifications are preserved and must pass before deploying to pilot or production:

1. `pnpm boundaries` — Architectural boundary check across domain, contracts, application, and infrastructure layers.
2. `pnpm typecheck` — Strict TypeScript compiler verification.
3. `pnpm lint` — ESLint rules.
4. `pnpm format` — Prettier formatting validation.
5. `pnpm --filter @solutions-studio/orchestrator exit-gate:phase1` — Requirements kernel & evaluation harness.
6. `pnpm --filter @solutions-studio/orchestrator exit-gate:phase2` — Projections, sandboxes & cross-validation.
7. `pnpm --filter @solutions-studio/orchestrator exit-gate:phase3` — Story readiness, dependency graph & handoff bundles.
