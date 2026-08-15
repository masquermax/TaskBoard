# TaskBoard Codex v0.9.1

TaskBoard is a local-first AI work board. TaskBoard owns durable Task facts and governed work orchestration; Codex is the first Executor extension.

The product is driven by explicit semantic ownership rather than an expanding prompt rule stack:

```text
Product Constitution
→ Capability Map / Contracts
→ Task / Work Unit
→ Runtime Enforcement
→ Context Exposure
→ Test / Eval
```

## Run on Windows

Prerequisites:

- Node.js 16.6+; Node 24 is used by release verification.
- A usable Codex runtime, or allow TaskBoard's Codex extension to prepare the supported standalone runtime on Windows.

Daily use:

1. Double-click `TaskBoard.vbs`.
2. Open `http://127.0.0.1:4317` if it is not opened automatically.
3. Wait for the Executor indicator to settle.
4. Create Tasks; Scheduler owns admission and lifecycle.
5. Use `退出 TaskBoard` to stop the service.

`Start-TaskBoard-Debug.cmd` shows startup diagnostics. `TaskBoard-in-Codex.vbs` optionally embeds the UI into Codex Desktop through a loopback-only Surface Host; that presentation path does not own Task execution or lifecycle.

## Core ownership

- **Scheduler** — Task lifecycle, admission, cancellation lifecycle and Task concurrency.
- **Root** — Task-level reasoning, planning, bounded Work Unit creation/dependencies, synthesis and convergence.
- **Work Unit** — finite work boundary: goal, expected output, stop condition, selected inputs and capability requests.
- **Subagent** — executes one bounded Work Unit and returns source-near Evidence/local Findings.
- **Validator** — certifies Root Candidate Deltas and owns the History-value decision for certified Task knowledge.
- **Task Core** — durable business facts and atomic persistence.
- **Skill** — reusable method only; no Task authority.
- **Executor** — concrete operations and runtime availability only.
- **Human Gateway** — transport for genuinely human-owned information/choices.
- **UI / Surface** — display and user intent only.

A field being visible or computable does not make its holder the owner of the higher-level semantic decision. Project write, Task completion, History and lifecycle each remain derived by their canonical owner.

## Work and authority

A delegated Work Unit explicitly declares `projectAccess`, `networkAccess`, `inputRefs`, dependencies and an optional `skillId`. These are requests/boundaries, not self-authorizing facts.

For Project Scope, `GovernanceCompiler` derives the effective `AuthorizedGrant` by intersecting the machine Role capability, certified `TaskContract` authority, selected Project scope and Work Unit request. `taskMode`, role prose, UI state and Executor defaults cannot create write authority.

A certified blocking Gap blocks only work/convergence that truly depends on the unresolved fact. It does not by itself revoke separately governed evidence acquisition. Human Gateway is reserved for information or choices genuinely owned by the user or unavailable through an authorized system path.

## Codex connection

Task Core does **not** own Codex login, billing or provider semantics. The Codex extension supports two connection modes for the child app-server that TaskBoard itself launches:

- **Codex current account** — use the user's existing Codex account/runtime configuration.
- **Custom API** — store a TaskBoard-local base URL, optional default model and API key for that child app-server only.

Custom settings are extension-local. They do not rewrite the user's global Codex configuration. The API key is excluded from public state and command-line arguments; it is projected only into the child process environment. Reconfiguration is rejected while active turns exist, restarts the child runtime, invalidates capability state and rolls back the saved configuration if the new connection cannot become usable.

See `docs/CODEX_INTEGRATION.md` for the integration contract.

## Durable cognition and recovery

Durable Task cognition is intentionally small: `Evidence + Claim + Gap`. Recommendations and ordered steps are current projections and are recomputed rather than accumulated as learned truth.

Recovery does not restore an Agent cursor. Runtime reconstructs from durable Task facts, certified state/history and current real project state. Communication loss is not proof that an external effect failed or stopped; side-effecting recovery must reconcile reality before unsafe replay.

## Development

```bash
npm install
npm run verify
npm start
```

The release gate requires syntax/tests, release-identity consistency and fresh-unpack verification. Git history is the archive for superseded implementation/process detail; the current tree should contain only current product semantics, runtime and proof surfaces.

## Canonical documents

- `docs/PRODUCT_CONSTITUTION.md` — first principles.
- `docs/CAPABILITY_MAP.md` — current semantic owners and enforcement map.
- `docs/CAPABILITY_CONTRACTS.md` — human-readable role/capability projections; not Runtime Authority.
- `docs/SPECIFICATION.md` — current product semantics.
- `docs/ARCHITECTURE.md` — current architecture/runtime model.
- `docs/CODEX_INTEGRATION.md` — Codex extension/runtime integration.
- `docs/ADR.md` — why durable design choices exist; history does not override current contracts.
- `docs/VERIFICATION.md` — current verification status.
