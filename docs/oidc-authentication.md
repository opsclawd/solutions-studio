# Provider-Neutral OIDC Authentication & Authorization

This document outlines the authentication and authorization architecture in Solutions Studio, including the local Keycloak reference setup, Microsoft Entra ID production integration, claim-to-capability mappings, and the Agent Isolation invariant.

---

## Architecture Overview

Solutions Studio adopts a provider-neutral OIDC (OpenID Connect) authentication model with capability-based authorization.

```
┌─────────────────┐       1. Authenticate (OIDC / PKCE)       ┌────────────────────────┐
│  Browser / SPA  │ ─────────────────────────────────────────> │ Identity Provider      │
│   (Next.js Web) │ <───────────────────────────────────────── │ (Keycloak / Entra ID)  │
└────────┬────────┘       2. JWT Access Token (RS256)          └────────────────────────┘
         │
         │ 3. API Request with Bearer Token (`Authorization: Bearer <jwt>`)
         ▼
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ Solutions Studio Orchestrator (Fastify API)                                          │
│                                                                                      │
│ ┌────────────────────────────────┐       ┌─────────────────────────────────────────┐ │
│ │  GenericOidcAuthenticator      │ ----> │ JWKS Cache (Public Key Retrieval)       │ │
│ │  - Validates RS256 signature   │       │ - In-memory key caching with refresh    │ │
│ │  - Validates iss, aud, exp,    │       └─────────────────────────────────────────┘ │
│ │    nbf, sub                    │                                                   │
│ └────────────────┬───────────────┘                                                   │
│                  ▼                                                                   │
│ ┌────────────────────────────────┐                                                   │
│ │  ConfigurableClaimMapper       │                                                   │
│ │  - Maps realm/app roles to     │                                                   │
│ │    ApplicationCapability set   │                                                   │
│ │  - Enforces Agent Isolation    │                                                   │
│ └────────────────┬───────────────┘                                                   │
│                  ▼                                                                   │
│ ┌────────────────────────────────┐                                                   │
│ │  DefaultAuthorizationPolicy    │                                                   │
│ │  - Validates actor capability  │                                                   │
│ │    against route requirements  │                                                   │
│ └────────────────────────────────┘                                                   │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### Core Tenets

1. **Provider Neutrality**: The orchestrator authenticates standard OIDC RS256-signed JWTs against any compliant identity provider (`GenericOidcAuthenticator`).
2. **Capability-Based Access Control**: Route handlers require explicit `ApplicationCapability` tokens rather than hardcoded role names or tenant IDs.
3. **Agent Isolation Invariant**: Automated systems and AI agents cannot hold human approval capabilities (`requirements:reconcile`, `candidate:approve`, `engineering-decision:approve`, `baseline:create`), even if an IdP administrator erroneously assigns those roles to a service principal.
4. **Zero Domain Pollution**: All authentication contracts, JWKS logic, and HTTP hooks reside in the application/infrastructure layers. The core `packages/domain` layer has zero external dependencies.
5. **Credential Confidentiality**: Fastify request logging unconditionally redacts `req.headers.authorization`.

---

## Application Capabilities & Roles

Solutions Studio defines fine-grained capabilities:

| Capability                     | Description                                               | Permitted Actor Types |
| :----------------------------- | :-------------------------------------------------------- | :-------------------- |
| `requirements:reconcile`       | Reconcile and link findings/discoveries to requirements   | Human only            |
| `candidate:approve`            | Approve/reject candidate findings into baseline proposals | Human only            |
| `engineering-decision:author`  | Create and author engineering decision drafts             | Human, Agent, System  |
| `engineering-decision:approve` | Formally approve engineering decisions                    | Human only            |
| `policy-constraint:author`     | Author architectural policy constraint revisions          | Human, Agent, System  |
| `baseline:create`              | Create frozen requirements baseline snapshots             | Human only            |
| `projection:generate`          | Generate user story projections and backlog items         | Human, Agent, System  |
| `backlog:export`               | Export baselined handoff artifacts (e.g. Jira/Markdown)   | Human, Agent, System  |
| `operator:admin`               | Administrative and runtime operations                     | Human only            |

---

## Local Development: Keycloak Reference

Solutions Studio provides an out-of-the-box local Keycloak instance pre-configured with realm settings, clients, roles, and test users.

### 1. Starting Keycloak

Run the following command from the repository root:

```bash
docker compose -f infra/keycloak/docker-compose.yml up -d
```

Keycloak will start on port `8080` and automatically import the realm configuration from `infra/keycloak/realm-export.json`.
Wait until the container is healthy:

```bash
docker compose -f infra/keycloak/docker-compose.yml ps
```

### 2. Pre-Configured Realm Details

- **Realm Name**: `solutions-studio`
- **Issuer URL**: `http://localhost:8080/realms/solutions-studio`
- **JWKS URI**: `http://localhost:8080/realms/solutions-studio/protocol/openid-connect/certs`
- **Clients**:
  - `solutions-studio-web`: Public client (PKCE enabled) for the frontend web application.
  - `solutions-studio-api`: Bearer-only client for the orchestrator backend.

### 3. Seeded Test Users

All seeded users have the password: **`solutions-studio-dev`**

| Username         | Email                                   | Realm Role                | Assigned Capabilities                                                                                        |
| :--------------- | :-------------------------------------- | :------------------------ | :----------------------------------------------------------------------------------------------------------- |
| `reviewer.alice` | `alice.reviewer@solutions-studio.local` | `requirements-reviewer`   | `requirements:reconcile`, `candidate:approve`                                                                |
| `architect.bob`  | `bob.architect@solutions-studio.local`  | `lead-architect`          | `engineering-decision:author`, `engineering-decision:approve`, `baseline:create`, `policy-constraint:author` |
| `admin.carol`    | `carol.admin@solutions-studio.local`    | `solutions-studio-admin`  | `operator:admin`                                                                                             |
| `viewer.dave`    | `dave.viewer@solutions-studio.local`    | `solutions-studio-viewer` | (Read-only / No mutation capabilities)                                                                       |

### 4. Running Orchestrator with Local Keycloak

Set the following environment variables in `apps/orchestrator/.env`:

```env
AUTH_PROVIDER=oidc
OIDC_ISSUER=http://localhost:8080/realms/solutions-studio
# Note: OIDC_ISSUER_URL is supported as a backwards-compatible alias for OIDC_ISSUER
OIDC_AUDIENCE=solutions-studio-api
OIDC_JWKS_URI=http://localhost:8080/realms/solutions-studio/protocol/openid-connect/certs
```

### 5. Obtaining a Test Token via CLI

You can fetch a token for `reviewer.alice` using direct grant (Resource Owner Password Credentials):

```bash
curl -s -X POST "http://localhost:8080/realms/solutions-studio/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=solutions-studio-web" \
  -d "grant_type=password" \
  -d "username=reviewer.alice" \
  -d "password=solutions-studio-dev" | jq -r .access_token
```

Verify your identity against the orchestrator:

```bash
curl -H "Authorization: Bearer <token>" http://localhost:3001/api/auth/me
```

---

## Microsoft Entra ID Integration Guide

Microsoft Entra ID (formerly Azure Active Directory) is fully supported without code changes. Compatibility is achieved via standard JWT validation and configurable claim mapping.

### 1. App Registrations in Entra ID

1. **Orchestrator API Registration**:
   - Register an application in Microsoft Entra admin center named `Solutions Studio API`.
   - Expose an API: Set Application ID URI to `api://solutions-studio` (or `api://<app-id>`).
   - Define App Roles under **App roles**:
     - `SolutionsStudio.Reviewer` (Allowed member types: Users/Groups)
     - `SolutionsStudio.Architect` (Allowed member types: Users/Groups)
     - `SolutionsStudio.Admin` (Allowed member types: Users/Groups)
     - `SolutionsStudio.Exporter` (Allowed member types: Users/Groups)
     - `SolutionsStudio.Viewer` (Allowed member types: Users/Groups)

2. **Web Application Registration**:
   - Register an application named `Solutions Studio Web`.
   - Under **Authentication**, add a Single-page application (SPA) platform with redirect URI `http://localhost:3000/auth/callback` (or your production origin).
   - Under **API permissions**, add permission to `Solutions Studio API` (e.g. `access_as_user`).

3. **Assign Users and Groups**:
   - In **Enterprise applications** > `Solutions Studio API` > **Users and groups**, assign your target users or security groups to their appropriate App Roles.

### 2. Orchestrator Configuration for Entra ID

Set the orchestrator environment variables:

```env
AUTH_PROVIDER=oidc
OIDC_ISSUER=https://login.microsoftonline.com/<TENANT_ID>/v2.0
# Note: OIDC_ISSUER_URL is supported as a backwards-compatible alias for OIDC_ISSUER
OIDC_AUDIENCE=api://solutions-studio
OIDC_JWKS_URI=https://login.microsoftonline.com/<TENANT_ID>/discovery/v2.0/keys
```

### 3. Entra ID Claim Mapping

The `ConfigurableClaimMapper` automatically handles Entra ID token claims:

- **Identifier (`id`)**: Extracted from `preferred_username` or `upn`, falling back to `oid` (Object ID) or `sub`.
- **Name**: Extracted from `name` or `preferred_username`.
- **Email**: Extracted from `email` or `upn`.
- **Roles**: Extracted from the `roles` array claim populated by Entra App Role assignments.
  - `SolutionsStudio.Reviewer` ➔ `requirements:reconcile`, `candidate:approve`
  - `SolutionsStudio.Architect` ➔ `engineering-decision:approve`, `engineering-decision:author`, `baseline:create`, `policy-constraint:author`
  - `SolutionsStudio.Admin` ➔ `operator:admin`
  - `SolutionsStudio.Exporter` ➔ `backlog:export`
  - `SolutionsStudio.Viewer` ➔ Read-only

---

## Agent Isolation & Non-Human Identity Policy

Solutions Studio enforces strict boundaries between human operators and automated agents (e.g. LLM agents, CI bots, automated worker pipelines):

1. **Non-Human Detection**:
   - Any token where `sub` starts with `agent:` or `system:`, or where client credentials flow (`azp === sub` without user claims) is detected, is classified as `actorType: 'agent'` or `actorType: 'system'`.
2. **Capability Stripping**:
   - Even if an IdP administrator or misconfigured role assigns approval roles to an agent service principal, `ConfigurableClaimMapper` deterministically strips:
     - `requirements:reconcile`
     - `candidate:approve`
     - `engineering-decision:approve`
     - `baseline:create`
     - `operator:admin`
3. **Payload Spoof Prevention**:
   - Route handlers derive the author/creator identity directly from `request.actor.id`. Any user-supplied `createdBy` or `actorId` fields in HTTP request bodies are strictly ignored or overridden when authenticated.
