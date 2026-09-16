# Web Application — Phase 0 Spike B Findings & Technical Specification

## Objective & Executive Summary

This directory contains the production-intent implementation of **Phase 0 Spike B: Sandboxed React/Tailwind Runtime via Babel** ([Issue #2](https://github.com/opsclawd/solutions-studio/issues/2)).

The primary goal of this spike was to establish and de-risk the architectural seam for secure, client-side rendering of AI-generated interactive prototypes in Solutions Studio:
1. Compile untrusted React/TSX code client-side using `@babel/standalone` on the host.
2. Execute the compiled component strictly inside an isolated `sandbox="allow-scripts"` iframe (strictly **without** `allow-same-origin`).
3. Enforce air-gapped security via Content Security Policy (`connect-src 'none'`, `form-action 'none'`) and pre-bundled offline Tailwind CSS.
4. Trap compile and runtime errors deterministically without crashing or polluting the host application.
5. Provide a development harness (`/dev/sandbox`) and automated Playwright browser test suite covering state transitions, PRD business rules, and security isolation.
6. Establish reusable code directly in production locations (`apps/web/src/features/prototype-sandbox/...`) so that subsequent phases can use it immediately without relocation.

---

## Architectural Seam Design

```
apps/web/
  src/
    features/
      prototype-sandbox/
        SandboxFrame.tsx            <-- Host React component managing iframe lifecycle, messages, and timeouts
        SandboxCompiler.ts          <-- Client-side @babel/standalone transpiler with error line/col extraction
        SandboxProtocol.ts          <-- Typed message contracts, guards, and executionId tracking
        SandboxRuntime.ts           <-- srcDoc HTML generator (CSP, React 18 UMD, Tailwind CSS, ErrorBoundary)
        SandboxCsp.ts               <-- Strict CSP generator (connect-src 'none', form-action 'none', etc.)
        runtime-assets/
          react-bundles.ts          <-- Inlined React 18 UMD & ReactDOM UMD libraries
          tailwind-styles.ts        <-- Inlined offline Tailwind utility stylesheet
    app/
      dev/
        sandbox/
          page.tsx                  <-- Dev sandbox harness with fixture selector & live code editor
  test/
    fixtures/
      prototype-sandbox/            <-- Counter, Valve Inspection (PRD 450-850 PSI), Compile/Runtime Errors, Security Tests
    unit/
      SandboxCompiler.test.ts       <-- Unit tests for TSX transpilation & error reporting
      SandboxCsp.test.ts            <-- Unit tests for CSP directive builder
      SandboxProtocol.test.ts       <-- Unit tests for typed message validation
    browser/
      prototype-sandbox.spec.ts     <-- Playwright browser test suite (8/8 passing)
```

### Core Seam Invariants

- **Host-Driven Transpilation:** Babel transpilation occurs on the host application before touching the iframe. Syntax errors are caught early and presented as structured diagnostics (`line`, `column`, `message`) without constructing invalid iframe DOM states.
- **Strict Iframe Sandbox Boundary:** The iframe has `sandbox="allow-scripts"` and strictly **omits** `allow-same-origin`. As a result, the iframe origin evaluates to the opaque origin (`"null"`), rendering parent cookies, host `localStorage`/`sessionStorage`, and parent DOM completely inaccessible at the browser engine level.
- **Air-Gapped CSP:** The embedded `meta` CSP tag enforces `connect-src 'none'`. Even if untrusted code invokes `fetch()` or `XMLHttpRequest`, the browser blocks outbound network traffic at the networking layer.
- **Controlled Runtime Imports:** A minimal CommonJS `require` shim restricts imports exclusively to `react`, `react-dom`, and `react/jsx-runtime`. Any unauthorized import throws an immediate, descriptive error.
- **Asynchronous Execution Epochs:** Each code change increments an `executionId` epoch. In-flight messages (`SANDBOX_READY`, `SANDBOX_RENDERED`, `SANDBOX_RUNTIME_ERROR`) from superseded iframe runs are automatically discarded to prevent race conditions from masking compile errors.
- **Fault-Tolerant ErrorBoundary:** An embedded React `ErrorBoundary` and `RenderNotifier` mount hook intercept runtime exceptions and report them over `postMessage`, preserving host stability.

---

## The 5 Core Spike Architectural Questions

### 1. Host vs. Iframe Transpilation
**Decision: Host-side transpilation using `@babel/standalone`.**

* **Why not transpile inside the iframe?**
  Transpiling inside the sandboxed iframe would require either:
  1. Inlining `@babel/standalone` (~2.5 MB) inside every `srcDoc` HTML payload, drastically increasing DOM memory usage and execution latency.
  2. Permitting network requests (`connect-src` / `script-src`) to fetch Babel from a CDN or host endpoint, which directly breaks the air-gapped security invariant (`connect-src 'none'`).
* **Benefits of host-side transpilation:**
  - Fast execution: Only the minimal runtime (~React 18 + Tailwind stylesheet) is injected into the iframe.
  - Fail-fast validation: Malformed code never reaches the iframe; structured compile errors with exact line and column numbers are surfaced to the user interface immediately.
  - Predictable profiling: Transpilation CPU cycles remain on the host and can be monitored or memoized.

### 2. Module Import Restrictions & Approved Runtime Surface
**Decision: Strict whitelist limited to `['react', 'react-dom', 'react/jsx-runtime']`.**

* Untrusted prototype code may attempt to import external modules (`import axios from 'axios'`, `require('fs')`, etc.).
* Inside the iframe runner, a custom `require()` shim evaluates all module requests against an approved whitelist. Any unauthorized module throws:
  ```
  Prohibited module import: '<modName>'. Sandbox runtime only allows ['react', 'react-dom'].
  ```
* Interop with Babel: Babel transforms ES module imports into CommonJS property lookups (e.g. `_react.default`). The runtime bootstraps:
  ```javascript
  window.React.default = window.React;
  window.ReactDOM.default = window.ReactDOM;
  ```
  This guarantees full compatibility with both default and named imports.

### 3. Tailwind CSS Air-Gapped Utility Inlining Strategy
**Decision: Pre-compiled offline Tailwind stylesheet inlined directly into `srcDoc`.**

* Standard Tailwind CDN scripts (`https://cdn.tailwindcss.com`) require dynamic network fetches and inline script evaluation that violate strict CSP policies (`connect-src 'none'`).
* Instead, a comprehensive utility stylesheet (`TAILWIND_SANDBOX_CSS`) containing core layout, flexbox, grid, color, spacing, typography, borders, and interaction utilities is inlined into `<style>` in the iframe `<head>`.
* Benefits:
  - Zero external network dependencies.
  - Sub-millisecond CSS parse time.
  - Completely air-gapped and reproducible across environments.

### 4. Iframe Recreation & Timeout Strategy
**Decision: Key-based DOM recreation (`iframeKey`) combined with an execution timeout timer and epoch tracking.**

* **Why is DOM recreation necessary?**
  If user-supplied code enters an infinite loop (e.g. `while(true) {}`) or corrupts global window state, JavaScript single-threading freezes the iframe's event loop. Normal `postMessage` communication ceases to function.
* **Mechanism:**
  1. Whenever new code is submitted, `SandboxFrame` arms a timeout timer (`timeoutMs = 4000ms`).
  2. If `SANDBOX_RENDERED` or `SANDBOX_RUNTIME_ERROR` is not received within the timeout window, the host marks the status as `TIMEOUT`.
  3. The host forces the browser to discard the unresponsive iframe and create a clean browsing context by incrementing `iframeKey` (`key={iframeKey}`).
  4. Execution epochs (`executionId`) guarantee that if an older iframe eventually emits a delayed message, the host safely ignores it.

### 5. TSX Controllability vs. Declarative UI Schemas
**Evaluation & PRD Alignment:**

* **Declarative UI Schemas (JSON/AST):**
  - *Pros:* Fully constrained schema; zero risk of arbitrary JavaScript execution.
  - *Cons:* Severely limited expressiveness; difficult for LLMs to generate dynamic business logic, custom calculations, or complex state interactions.
* **Direct TSX Generation:**
  - *Pros:* Unlocks the full power of React state hooks (`useState`, `useEffect`, `useMemo`), interactive form handling, conditional rendering, and complex business logic (e.g. the PRD synthetic rule for safe valve pressure `[450.0 - 850.0] PSI`).
  - *Cons:* Higher potential for syntax errors, invalid imports, and runtime exceptions.
* **Conclusion:** With the layered security boundaries established in Spike B (host Babel transpiler + opaque iframe origin + CSP + ErrorBoundary + timeout recovery), direct TSX generation achieves security and controllability without sacrificing React expressiveness.

---

## Security Boundary Summary

| Boundary Layer | Mechanism | Protection |
| :--- | :--- | :--- |
| **Iframe Sandbox** | `sandbox="allow-scripts"` (strictly NO `allow-same-origin`) | Origin is `"null"`. Host cookies, `localStorage`, `sessionStorage`, and parent DOM (`window.parent.document`) access blocked by browser engine. |
| **Network CSP** | `connect-src 'none'; form-action 'none'` | Blocks outbound `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, and `<form>` navigation. |
| **Execution Isolation** | Host Babel transpilation + module whitelist | Syntactically invalid code is rejected before iframe execution; foreign package imports blocked. |
| **Runtime Resilience** | React `ErrorBoundary` + unhandled window error trap | Render exceptions caught gracefully; host application never crashes. |
| **Hang Protection** | Configurable timeout timer + `iframeKey` teardown | Infinite loops in untrusted code cleanly terminated and recovered. |

---

## Commands & Verification

### 1. Build TypeScript and Next.js
```bash
pnpm --filter @solutions-studio/web build
```

### 2. Run Deterministic Unit Tests (11 tests)
```bash
pnpm --filter @solutions-studio/web test
```

### 3. Run Automated Playwright Browser Tests (8 tests)
```bash
pnpm --filter @solutions-studio/web test:browser
```

### 4. Run Monorepo Test Suite (36 unit tests)
```bash
pnpm test
```

### 5. Launch Development Harness
```bash
pnpm --filter @solutions-studio/web dev
# Open http://localhost:3000/dev/sandbox
```

---

## Browser Test Coverage Matrix

The Playwright browser suite (`apps/web/test/browser/prototype-sandbox.spec.ts`) verifies all required operational and security constraints:

| Test Case | Scenario Verified | Result |
| :--- | :--- | :--- |
| `1. Compiles TSX client-side` | Client-side transpilation and rendering inside `sandbox="allow-scripts"` iframe | **PASS** |
| `2. Updates local React state` | Interactive button clicks, `useState` hook increments and reset | **PASS** |
| `3. Renders PRD business rule` | Valve inspection form with pressure range [450.0 - 850.0] PSI validation | **PASS** |
| `4. Captures compile errors` | Syntax error detection, structured line/col extraction, host responsiveness | **PASS** |
| `5. Captures runtime errors` | React ErrorBoundary catches exceptions without corrupting host | **PASS** |
| `6. Parent DOM isolation` | Sandboxed code attempting `window.parent.document` access blocked (`SecurityError`) | **PASS** |
| `7. Host storage isolation` | Sandboxed code attempting `localStorage` or `document.cookie` access blocked | **PASS** |
| `8. Network isolation` | Outbound `fetch()` blocked by CSP `connect-src 'none'` | **PASS** |

---

## Exit Gate Evaluation

| Criterion | Requirement | Result |
| :--- | :--- | :--- |
| **Client-Side Transpilation** | Fast TSX compilation via `@babel/standalone` on the host | **PASS** |
| **Isolated Execution** | Execution strictly within `sandbox="allow-scripts"` (origin `"null"`) | **PASS** |
| **Air-Gapped Security** | Strict CSP (`connect-src 'none'`) and pre-bundled offline Tailwind CSS | **PASS** |
| **Error Handling** | Structured compile error diagnostics and runtime ErrorBoundary capture | **PASS** |
| **Automated Test Coverage** | 100% pass rate across unit tests and real browser Playwright suite | **PASS** (11 unit, 8 browser) |
| **Architectural Zero-Relocation** | Code placed directly in target Phase 1 locations (`apps/web/src/features/...`) | **PASS** |

### Exit Gate Verdict: **GO**
The sandboxed React/Tailwind runtime is validated, robust, and production-ready. Phase 2 (Interactive Prototype Generation) can promote this runtime directly without relocation or re-architecture.
