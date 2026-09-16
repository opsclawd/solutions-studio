# Orchestrator — Phase 0 Spike A Findings & Technical Specification

## Objective & Executive Summary

This directory contains the production-intent implementation of **Phase 0 Spike A: Provider-Agnostic Generation Gateway + Closed-Loop Mermaid Repair**.

The goal of this spike was to establish and de-risk the architectural seam for artifact generation in Solutions Studio:

1. Prove that interchangeable generation CLIs (`agy` and `opencode`) can be abstracted cleanly behind a provider-agnostic port (`IGenerationGateway`).
2. Implement deterministic syntax validation and automated repair orchestration (`GenerateArtifactUseCase`) that owns the retry loop without depending on model-specific features.
3. Establish reusable code directly in production locations (`apps/orchestrator/src/...`) so that Phase 1 can promote it immediately without relocation.

---

## Architectural Seam Design

The orchestrator adheres to Clean Architecture and the Hexagonal (Ports & Adapters) pattern:

```
apps/orchestrator/
  src/
    application/
      ports/
        generation/
          IGenerationGateway.ts     <-- Agnostic text generation port
          GenerationErrors.ts       <-- Normalized typed gateway failure hierarchy
        validation/
          IMermaidLinterGateway.ts  <-- Deterministic diagram validator port
      use-cases/
        GenerateArtifactUseCase.ts  <-- Closed-loop validation & repair loop (max 2 attempts)
        RepairErrors.ts             <-- Application orchestration failure (RepairRetryExhaustionError)
    infrastructure/
      generation/
        AntigravityCliAdapter.ts    <-- agy CLI adapter
        OpenCodeCliAdapter.ts       <-- opencode CLI adapter
        GatewayFactory.ts           <-- Configuration-driven provider resolver
      validation/
        MermaidCliLinterAdapter.ts  <-- Headless mmdc syntax validator
  test/
    fakes/
      FakeGenerationGateway.ts      <-- Deterministic test double for fast unit tests
      FakeMermaidLinterGateway.ts   <-- In-memory linter double
    fixtures/
      mermaid/                      <-- Synthetic valid & invalid diagram fixtures
    unit/                           <-- Comprehensive unit test suites
    integration/                    <-- Real CLI verification with synthetic fixtures
  scripts/
    run-tracer.ts                   <-- Standalone executable tracer harness
```

### Core Seam Invariants

- **Port Agnosticism:** `IGenerationGateway` exposes only `generate(request: GenerationRequest): Promise<GenerationResult>`. It does not expose `repairSyntax`, Mermaid concepts, or provider-specific flags.
- **Application-Owned Repair:** The retry loop, repair prompt formulation, candidate extraction, and exhaustion policy (`maxRepairAttempts = 2`) belong exclusively to `GenerateArtifactUseCase`.
- **Decoupled Error Classification:**
  - **Gateway Failures (`application/ports/generation/GenerationErrors.ts`):** Normalizes provider- and process-level failures:
    - `ExecutableNotFoundError`
    - `AuthenticationOrConfigError`
    - `CliExecutionTimeoutError`
    - `NonZeroExitError`
    - `MalformedOutputError`
  - **Application Failures (`application/use-cases/RepairErrors.ts`):** Represents domain/workflow level failures:
    - `RepairRetryExhaustionError`: Raised when valid syntax cannot be produced within the retry budget.

---

## Commands & Verification

### 1. Build TypeScript

```bash
pnpm --filter @solutions-studio/orchestrator build
```

### 2. Run Deterministic Unit Tests (25 tests)

```bash
pnpm --filter @solutions-studio/orchestrator test
```

### 3. Run Real CLI Integration Suite (Synthetic Fixtures)

```bash
pnpm --filter @solutions-studio/orchestrator test:integration
```

### 4. Run Standalone Tracer Harness

```bash
# Deterministic fake provider
pnpm --filter @solutions-studio/orchestrator tracer --provider fake

# Real Antigravity CLI (agy)
pnpm --filter @solutions-studio/orchestrator tracer --provider agy

# Real OpenCode CLI (opencode)
pnpm --filter @solutions-studio/orchestrator tracer --provider opencode
```

---

## CLI Execution Contracts & Observed Findings

### 1. Antigravity CLI (`agy`)

- **Invocation Command:** `agy --output-format json --dangerously-skip-permissions -p "<prompt>"`
- **Observed Behavior:**
  - `agy` outputs structured JSON on stdout: `{"conversation_id": "...", "status": "SUCCESS", "response": "..."}`.
  - Headless non-interactive execution requires `--dangerously-skip-permissions`; without it, any prompt that triggers internal agent command tools will be blocked by headless permission prompts.
  - In `AntigravityCliAdapter`, child process `stdin` must be closed immediately (`child.stdin?.end()`) to prevent hanging on interactive terminal checks.
- **Normalization:**
  - Exit code `ENOENT` maps to `ExecutableNotFoundError`.
  - JSON parse errors map to `MalformedOutputError`.
  - Auth keywords (`auth`, `unauthorized`, `login`, `token`) map to `AuthenticationOrConfigError`.

### 2. OpenCode CLI (`opencode`)

- **Invocation Command:** `opencode run --format json --pure "<prompt>"`
- **Observed Behavior:**
  - `opencode run --format json` streams newline-delimited JSON (NDJSON) events (`step_start`, `text`, `step_finish`).
  - Generated output can include `<think>...</think>` reasoning tokens and diagnostic stderr lines (`[oc-crofai] ...`).
  - `OpenCodeCliAdapter` parses NDJSON line-by-line, accumulates text parts, and strips internal `<think>` blocks.
  - If structured NDJSON events are detected but no `text` event is present, the adapter strictly raises `MalformedOutputError` rather than falling back to unparsed stdout.
  - Closing `child.stdin?.end()` immediately after process spawn prevents stdin pipe blocking.

### 3. Headless Mermaid Linter (`@mermaid-js/mermaid-cli`)

- **Invocation Command:** `mmdc -i <input.mmd> -o <output.svg> -e svg`
- **Observed Behavior:**
  - Headless Puppeteer execution takes ~1.2s to 1.5s per validation run.
  - Mermaid leniently parses multiline edges (`A -->\n B`), but strictly fails on misplaced tokens (e.g. dangling arrows followed by semicolons: `A --> ;`).
  - `MermaidCliLinterAdapter` captures parser errors from stderr/stdout while stripping Puppeteer stack traces and formatting notices, yielding clean diagnostic messages for repair prompts.

---

## Security Constraints

> [!WARNING]
> **CLI Tool Execution Security Boundary:**
> A prompt instructing an agent CLI not to use tools (e.g., `"Output ONLY raw text without running commands"`) **is not a security boundary**.
>
> In `AntigravityCliAdapter`, passing `--dangerously-skip-permissions` bypasses interactive permission confirmation to enable headless non-interactive execution. While acceptable for the Phase 0 synthetic tracer spike, **this must not become the production execution contract** without proper sandboxing. Production promotion in Phase 1 requires:
>
> 1. Process/container isolation (e.g., isolated container execution or restrictive seccomp/cgroups).
> 2. Filesystem isolation (read-only mount or ephemeral scratchpad).
> 3. Disabling tool capabilities at the agent/CLI configuration level rather than relying on prompt steering.

---

## Exit Gate Evaluation

| Criterion                         | Requirement                                                                                                                     | Result                            |
| :-------------------------------- | :------------------------------------------------------------------------------------------------------------------------------ | :-------------------------------- |
| **Provider Interoperability**     | Both `agy` and `opencode` participate in the identical validation & repair orchestration without application code modifications | **PASS**                          |
| **Deterministic Validation**      | Headless validation catches syntax errors and re-verifies repaired candidates                                                   | **PASS**                          |
| **Typed Failure Normalization**   | Exit codes, timeouts, malformed output, and retry exhaustion mapped to typed domain/gateway errors                              | **PASS**                          |
| **Automated Test Coverage**       | 100% pass rate across unit suites and real CLI integration tests with synthetic fixtures                                        | **PASS** (25 unit, 3 integration) |
| **Architectural Zero-Relocation** | Code is placed directly in target Phase 1 locations (`apps/orchestrator/src/...`)                                               | **PASS**                          |

### Exit Gate Verdict: **GO**

The architectural seam is validated and stable. Phase 1 (Vertical Slice 1 — The Visual Process Canvas) can proceed directly using the existing generation gateway and Mermaid validation adapters.
