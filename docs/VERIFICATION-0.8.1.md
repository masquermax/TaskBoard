# v0.8.1 Release Verification

## Release decision

v0.8.1 is the core-convergence release after v0.8.0 capability realignment. It adds certified incremental Task learning, removes repeated system-wide governance from ordinary role context, separates concrete Skill assets from Core, and closes the remaining Work Unit input-context mismatch with explicit `inputRefs`.

Release gates:

1. **Logic / architecture review — PASS.** Reviewed by `Contract → Owner → Runtime Enforcement → Context Exposure → Test/Eval`.
2. **Whole-code review — PASS.** Active source, runtime authority surfaces, prompts, persistence, lifecycle/resource behavior, external Skill boundary, docs and release data were checked for contradiction and stale authority claims.
3. **Executable verification — PASS.** Syntax and 212 automated tests pass; coverage, module-import, JSON/SQLite persistence/recovery smoke and data cleanliness checks pass.
4. **Environment boundary — LIMITED.** Linux verification does not claim a real Windows Codex Desktop OA end-to-end regression. Windows integration behavior remains covered by automated contract tests; the real OA accuracy/time regression still requires the user's Windows environment.

## Core truths realized in Runtime

No new governance layer was added. v0.8.1 realizes two consequences of the existing Constitution/Capability model:

- **Capability follows ownership.** Capability Contracts define the positive surface; missing ownership is not replaced by repeated negative Prompt rules.
- **Knowledge advances by certified delta.** Root proposes this Turn's change, Validator certifies it, Task Core commits the certified change. Omission cannot erase committed knowledge; revision requires new evidence.

The analysis learning path is:

```text
Task Baseline + Current Certified State + New Evidence
                         ↓
                     Root Turn
                         ↓
                  Candidate Delta
                         ↓
                     Validator
                         ↓
                   Certified Delta
                         ↓
                 Task Core Commit
                         ↓
                    Turn Node
                         ↓
              Current State vN+1
```

A control-only Root turn with no new certified knowledge does not create a fake knowledge Turn Node.

## Five-question architecture audit

### Contract

- Product Constitution remains exactly five principles.
- Capability Map/Contracts remain the positive authority model.
- Work Unit now carries `inputRefs` as the concrete realization of its already-declared responsibility to carry only the inputs needed for that work.
- No new Analysis Rules layer, Experience runtime, Project Knowledge contract or Skill-distillation contract was added to Core.

### Owner

- Root owns Task reasoning, Work Unit authoring and Candidate Delta.
- Validator owns certification and History-value decision.
- Task Core owns durable Current Certified State / Turn Node / History persistence.
- Scheduler remains the only Task lifecycle owner.
- Concrete Skill content has no Core owner; it is an external user-owned reusable-experience asset. Core owns only the Skill-library boundary.

### Runtime Enforcement

- `certified-state.js` merges only certified deltas into Current State.
- Evidence IDs are immutable; changing committed Claims/Gaps/Recommendations requires newly cited evidence.
- Gap resolution must cite existing certified evidence.
- Root final analysis is rendered from accumulated certified state, not the final model message.
- SQLite/JSON persist certified analysis state and History atomically at the Task Core boundary.
- New Work Units select Task inputs by `inputRefs`; Subagent execution and its Validator certification receive the same scoped Task inputs.
- A write Work Unit must explicitly select at least one Project Scope, and write authority remains limited to execution-mode Work Units.
- Pre-v0.8.1 persisted Work Units without `inputRefs` retain compatibility behavior so upgrade recovery does not strand already-created work.

### Context Exposure

- Ordinary Root/Subagent/Validator role prompts no longer repeat Product Constitution, ADR or superseded Analysis Rules.
- Root receives its Capability Contract, current Task inputs, Current Certified State, active work and new certified worker results.
- New Subagent Work Units receive only selected Project Scope / attachments / referenced Results plus dependency results and optional selected external Skill method.
- Validator semantic model turns receive only the current proof obligation and cited visual inputs.
- Internal `analysisState` is available to Runtime/Repository recovery but is not exposed by TaskService/UI APIs.

### Test / Eval

Automated coverage includes:

- positive Capability ownership and role projection;
- absence of concrete Skill content from Core and external Skill-library injection boundary;
- Work Unit `inputRefs` catalog/selection, invalid-ref rejection and selected write-root enforcement;
- scoped Task inputs are identical at Subagent execution and Validator certification boundaries;
- Turn learning: learn, carry forward, omission-does-not-forget, evidence-required revision, Gap resolution, restart recovery and UI non-exposure;
- Validator bounded rework/narrowing and semantic-proof selection;
- local Work Unit delivery, sibling parallelism and resource-wait behavior;
- lifecycle, retry, cleanup, repository parity, HTTP, CDP and Windows launcher contracts.

## Concrete issues found during release audit

The release audit found two inconsistencies before packaging and fixed both:

1. **Stale documentation hierarchy/context wording.** `ARCHITECTURE.md`, `SPECIFICATION.md` and the current verification pointer still described ADR as an active chain layer and/or full Constitution as ordinary role context. They now match actual Runtime: ADR is sidecar decision memory and ordinary roles receive role projections.
2. **Work Unit Context Drift.** The Work Unit Contract already said it carries minimal required context, but Codex Worker still received all Project Scope and attachments. `inputRefs` now makes the boundary explicit and Runtime scopes both execution and certification to the selected Task inputs.

## Automated verification

```text
npm run verify
Syntax check passed.
212 tests
212 pass
0 fail
0 skipped
```

## Coverage

`node --test --experimental-test-coverage`:

```text
All files
Line coverage:     95.56%
Branch coverage:   76.05%
Function coverage: 88.49%
```

## Independent module import audit

Non-entry/non-browser source/script modules imported independently:

```text
54 imported
0 failed
```

## JSON / SQLite learning and recovery smoke

Both backends passed the same clean-runtime scenario with the built-in Mock Executor:

- version = `0.8.1`;
- analysis Task reaches `COMPLETED`;
- Current Certified State reaches version 1;
- one certified Turn Node is persisted;
- one durable History boundary is persisted;
- `analysisState` is absent from TaskService-visible Task data;
- after closing/reopening persistence, the same state version and Turn Node restore correctly.

Results:

```text
JSON   PASS — COMPLETED / stateVersion=1 / turns=1 / history=1
SQLite PASS — COMPLETED / stateVersion=1 / turns=1 / history=1
```

## Source / release cleanliness

- `src/`: 54 JavaScript files.
- `scripts/`: 7 JavaScript/MJS files.
- active production/script source: 7,207 lines.
- Product Constitution principles: exactly 5.
- concrete `skills/*` assets in Core: none; only `src/skills/skill-library-port.js` exists.
- active source TODO/FIXME/HACK/XXX markers: none.
- active docs contain no stale claim that ordinary Root/Subagent/Validator receive the full Constitution or ADR stack.
- release `data/` contains only `attachments/.gitkeep` and `runtime/.gitkeep`.

## Explicitly not implemented / not claimed

- Cross-Task Experience → Skill distillation in Core.
- Personal Skill package ownership/versioning runtime in Core.
- Formal Project Knowledge subsystem.
- Generic semantic proof of arbitrary external side effects.
- Root-owned first-class Work Unit executor.
- Real Windows Codex Desktop OA end-to-end verification in this Linux environment.

## Final packaged-artifact verification

A candidate archive was extracted into a brand-new directory and passed `npm run verify` (212/212) plus JSON/SQLite learning smoke. After this verification document was finalized, the exact release ZIP was rebuilt and the final archive was fresh-extracted and retested again with the same 212/212 result and clean storage smoke.
