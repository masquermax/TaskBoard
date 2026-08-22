# TaskBoard v0.9.2

TaskBoard is a local-first governed AI Task runtime. It owns durable Task facts, Root/Subagent orchestration, deterministic validation, Completion evaluation, Scheduler lifecycle and the generic Extension Host.

**TaskBoard contains no concrete Extension implementation.** Every first-party, test/demo and third-party concrete Extension is owned and versioned in `masquermax/TaskBoard-Ecosystem`. A stock TaskBoard process may start in management mode until an Executor Extension is explicitly imported and selected.

## Run

Prerequisite: Node.js 16.6+.

1. Start `TaskBoard.vbs` or run `npm start`.
2. Open `http://127.0.0.1:4317`.
3. Import an API-compatible Executor directory from TaskBoard-Ecosystem and select it in Extension management.
4. Restart when requested, then create Tasks.

## Extension boundary

TaskBoard owns only generic Extension contracts, public author API, registry/loading/persistence, generic connection presentation and Surface management. Provider/API/model/transport/desktop integration and every other concrete implementation stay in TaskBoard-Ecosystem. See `docs/EXTENSIONS.md`.

## Development

```bash
npm install
npm run verify
npm start
```

## Canonical documents

- `docs/PRODUCT_CONSTITUTION.md` — first principles and non-negotiable repository boundary.
- `docs/CAPABILITY_MAP.md` — semantic owners and enforcement map.
- `docs/CAPABILITY_CONTRACTS.md` — role/capability projections.
- `docs/SPECIFICATION.md` — current product semantics.
- `docs/ARCHITECTURE.md` — architecture/runtime model.
- `docs/EXTENSIONS.md` — generic Extension Host contract and Ecosystem ownership rule.
- `docs/ADR.md` — durable design rationale.
- `docs/VERIFICATION.md` — exact-tree verification status.
