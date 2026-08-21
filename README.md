# TaskBoard v0.9.2

TaskBoard is a local-first governed AI Task runtime. It owns durable Task facts, Root/Subagent orchestration, deterministic validation, Completion evaluation, Scheduler lifecycle and the generic Extension Host.

**TaskBoard contains no concrete Extension implementation.** Every first-party, test/demo and third-party concrete Extension — including product UI — is owned and versioned in `masquermax/TaskBoard-Ecosystem`.

## Run

Prerequisite: Node.js 16.6+.

1. Start `TaskBoard.vbs` or run `npm start`.
2. TaskBoard reads direct child Extensions under `<TaskBoard>/data/extensions`; optional additional roots may be listed in `TASKBOARD_EXTENSION_DIRS`.
3. Open `http://127.0.0.1:4317`.
4. If no usable product UI is selected, the minimal recovery shell opens so Extensions can be inspected/imported and one UI can be selected.
5. A usable Executor Extension is still required before Tasks can execute.

TaskBoard never scans the machine for Extensions. Adding/removing a directory under a configured system Extension root is a real startup plug/unplug operation; manual imports remain explicit registry entries.

## Extension boundary

TaskBoard owns only generic Extension contracts, public author API, deterministic discovery/loading/persistence, generic connection transport, UI recovery and Surface management. Provider/API/model/transport/desktop integration, product UI and every other concrete implementation stay in TaskBoard-Ecosystem. See `docs/EXTENSIONS.md` and `docs/UI_EXTENSIONS.md`.

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
- `docs/UI_EXTENSIONS.md` — product UI Extension and recovery-shell boundary.
- `docs/ADR.md` — durable design rationale.
- `docs/VERIFICATION.md` — exact-tree verification status.
