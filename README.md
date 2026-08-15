# TaskBoard Codex v0.9.1

TaskBoard is a local-first AI work board. TaskBoard owns durable Task facts and governed work orchestration; Codex is the first Executor extension.

The current product boundary is driven by explicit ownership:

```text
Product Constitution
→ Capability Map / Contracts
→ Runtime Enforcement
→ Context Exposure
→ Test / Eval
```

## Run on Windows

Prerequisites: Node.js 16.6+ and a usable Codex runtime. On Windows, the Codex extension may prepare the supported standalone runtime when none is usable.

1. Double-click `TaskBoard.vbs`.
2. Open `http://127.0.0.1:4317` if needed.
3. Wait for the Executor indicator to settle.
4. Create Tasks; Scheduler owns admission and lifecycle.
5. Use `退出 TaskBoard` to stop the service.

`Start-TaskBoard-Debug.cmd` exposes startup diagnostics. `TaskBoard-in-Codex.vbs` optionally embeds the UI into Codex Desktop through a loopback-only Surface Host; presentation never owns Task execution or lifecycle.

## Semantic owners

- **Scheduler** — Task lifecycle and admission.
- **Root** — Task reasoning, planning, bounded Work Unit creation and synthesis.
- **Subagent** — one bounded Work Unit execution.
- **Validator** — Root Candidate certification and History semantic-value decision.
- **Task Core** — durable business facts and atomic persistence.
- **Skill** — reusable method only.
- **Executor** — concrete operations and runtime facts.
- **Human Gateway** — genuinely human-owned information/choice transport.
- **UI / Surface** — presentation and user intent.

Project-specific authority is derived only by `GovernanceCompiler` into `AuthorizedGrant` from the machine Role capability, certified `TaskContract` authority, selected Project scope and Work Unit request. Goal Satisfaction is derived only by `CompletionEvaluator`. Other components consume or project those results rather than independently re-deriving them.

A certified blocking Gap constrains only work/convergence that truly depends on the unresolved fact. Independent governed evidence acquisition remains possible when its own authority and safety boundary is satisfied.

## Codex connection

Task Core does not own Codex provider/authentication semantics. The Codex extension supports the user's current Codex account or a TaskBoard-local custom API profile for the child app-server that TaskBoard itself launches.

The extension owns validation, local persistence and launch projection of that connection configuration. Secrets stay out of public state and command-line arguments. Reconfiguration is blocked while active turns exist and rolls back if the replacement connection cannot become usable.

See `docs/CODEX_INTEGRATION.md` for the integration contract.

## Development

```bash
npm install
npm run verify
npm start
```

The release gate requires syntax/tests, release-identity consistency and fresh-unpack verification. Git history stores superseded process detail; the current tree should contain only current product semantics, runtime and proof surfaces.

## Canonical documents

- `docs/PRODUCT_CONSTITUTION.md` — first principles.
- `docs/CAPABILITY_MAP.md` — semantic owners and enforcement map.
- `docs/CAPABILITY_CONTRACTS.md` — human-readable role/capability projections.
- `docs/SPECIFICATION.md` — current product semantics.
- `docs/ARCHITECTURE.md` — architecture/runtime model.
- `docs/CODEX_INTEGRATION.md` — Codex extension/runtime integration.
- `docs/ADR.md` — durable design rationale.
- `docs/VERIFICATION.md` — current verification status.
