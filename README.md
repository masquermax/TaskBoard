# TaskBoard Codex v0.9.0

Local-first AI Task Board. TaskBoard manages **work and durable Task facts**; Codex is the first Executor extension.

v0.8 realigns the system around explicit capabilities instead of growing Prompt rules:

```text
Constitution → Capability Map / Contracts → Task/Work Unit → Runtime
```

Ordinary Agent turns receive the current role Capability Contract plus the current Task/Work Unit context; an external selected method may be added for the Work Unit. Constitution and ADR stay outside ordinary role prompts: Constitution defines the system, ADR records why the architecture exists, and Runtime enforces their consequences.

v0.9.0 is a system-simplification release built on the verified v0.8.8 Human-Gateway fix. It removes duplicate current terminology, role aliases, hidden capability defaults and duplicate runtime ownership surfaces. Current runtime vocabulary is Project / Root / Subagent / Validator; Work Units explicitly declare project and network capability; old names survive only at migration or external-error compatibility boundaries. The release adds no new governance layer.

## Windows use

Prerequisites:

- Node.js 16.6+; Node 18+ recommended for development/tests.
- Codex configured in the way you already use it. TaskBoard does not manage login, API keys, provider or billing configuration.

Daily use:

1. Double-click `TaskBoard.vbs`.
2. TaskBoard opens `http://127.0.0.1:4317`.
3. Wait for the lower-left Executor indicator to settle.
4. Create Tasks; Scheduler handles execution automatically.
5. Use `退出 TaskBoard` to stop the service.

`Start-TaskBoard-Debug.cmd` shows startup diagnostics. `Create-Desktop-Shortcut.vbs` creates an optional desktop shortcut.

On Windows, if no usable Codex CLI runtime can be resolved, the Codex Execution Adapter may prepare the official standalone runtime in the background. This is an Executor concern and never becomes Task Core authentication/provider management. Set `TASKBOARD_CODEX_AUTO_INSTALL=0` to disable this repair path.

## What owns what

- **Scheduler** — Task lifecycle, admission, Task concurrency, cancellation lifecycle.
- **Root Agent** — Task reasoning, planning, bounded Work Unit creation/dependencies, delegated Skill selection, synthesis and convergence.
- **Work Unit** — a finite work order: `goal + expectedOutput + stopCondition + projectAccess + networkAccess + inputRefs + dependsOn + optional skillId`.
- **Subagent** — executes one delegated Work Unit and returns source-traced Evidence plus local Findings/discoveries.
- **Validator** — certifies Root Candidate Deltas, narrows overreach to evidence, produces explicit Gaps, and decides whether certified Root knowledge is worth History. Subagent output gets deterministic source-trace normalization only.
- **Task Core / Repository** — durable state and atomic persistence only.
- **Skill** — reusable method only; no Task authority.
- **Tool / Executor** — concrete operations only.
- **Human Gateway** — human-information transport only.
- **UI / Surface** — display and user intent only.

A critical capability with two owners is an Authority Conflict; no owner is an Authority Vacuum; code exposing an undeclared business capability is an Authority Leak.

See `docs/CAPABILITY_MAP.md`, `docs/CAPABILITY_CONTRACTS.md`, and `docs/CAPABILITY_IMPLEMENTATION_MAP.md`. Maintainer diagnosis uses `docs/ARCHITECTURE_REVIEW.md`; it is a review method, not another runtime Rule layer.

## Task lifecycle

Visible states are exactly:

- `需执行 / READY`
- `进行中 / RUNNING`
- `等待你 / WAITING_HUMAN`
- `已完成 / COMPLETED`

Scheduler is the only lifecycle owner. RUNNING requires a real execution start. WAITING_HUMAN requires execution to be quiescent and a real user-owned information blocker.

Completed results are immutable. Later Tasks may reference them without modifying them.

## Work Units and local delivery

A delegated Work Unit is not a mini Task. Root must provide its finite goal, expected output, stop condition, Project Scope access (`none` / `read` / `write`) plus network access and the Task inputs required by that Work Unit (`inputRefs`); Runtime does not invent missing semantics. New discoveries outside that boundary return to Root instead of letting the Subagent silently expand its mission. For Codex Subagents, `stopCondition` is also backed by a technical execution lease: Runtime first steers the same Turn back toward the original stop condition and later interrupts it if it still fails to converge. The hard lease is a safety boundary, not proof that the business work is complete. New Work Units receive only the selected Task inputs; missing capability/input fields fail closed during upgrade recovery rather than silently expanding the Work Unit.

When one Work Unit completes and passes deterministic source-trace normalization, Root can consume it immediately while unrelated siblings continue:

```text
A → source trace → Root
B ───────────── still running
C ───────────── waiting / running
```

There is no whole-Stage barrier before Root can think again. If Root reaches a certified convergence decision while only read-only no-side-effect siblings remain, those obsolete investigations can be stopped instead of delaying completion; write-capable Work Units first reach a safe boundary. Re-issuing semantically identical work under a new id is rejected as a planning-contract violation.

## Skill

Skill remains a core concept but concrete Skill content is not bundled with TaskBoard core. Core understands only the method-library boundary: Root may select an optional `skillId` for a bounded Work Unit, and an injected Skill library may provide that selected method to the executor.

Concrete/distilled Skills are user-owned reusable experience assets and live in independent packages/branches. This core tree therefore ships no `skills/*` content and performs no cross-Task Skill distillation.

The current method shape is:

- Purpose
- Applicable Work
- Method
- Contract
- Capability Requirements
- Stop Condition


## Validator and evidence

Validator is a peer certification role, not a second Root. Normal certification is deterministic: trace source addresses, check source-near observations and enforce evidence/scope relationships.

A model-backed Validator turn is used only for a narrow proof relation that deterministic tracing cannot certify mechanically. This includes explicitly semantic raw evidence such as exact visual/pixel material and Gateway-derived Human Claims/Gap resolutions whose meaning must be checked against the exact question and answer. Normal code/text paraphrase, multi-source synthesis or cross-system analysis does **not** automatically trigger another model review.

First unresolved certification may request one targeted correction. If it still cannot certify the whole candidate, the certifiable subset is preserved and the remainder becomes an explicit Gap. Validator does not re-plan or re-search the Task.

## Certified state and History

Durable analysis cognition is intentionally small: `Evidence + Claim + Gap`. A Claim is the structured fact proposition that can be `confirmed` or `supported`. Recommendations and ordered Steps are current presentation/decision output; they are recomputed and are not learned state.

Task Core is the only owner that applies certified state transitions. Agent output is a proposal. Omission keeps prior certified knowledge; revisions require new Evidence; a Gap closes only through an evidence-backed resolution.

A Root Turn also requires a real trigger. Task creation, a new Subagent result, a resolved Human Gateway, or a technical resume may trigger work; Current Certified State is context and cannot trigger another Root Turn by itself. Same-trigger Validator/planning/control repair is bounded. A Human Gateway is bound to one currently certified blocking Gap, and Human evidence keeps system-owned Gateway/Gap provenance so a later Turn cannot reinterpret ‘continue with current information’ as an unrelated scope change.

### History

History is durable Task knowledge, not activity logging.

Root-authored `progressCommits` are not authoritative. After any Root-level candidate is certified, Validator decides whether it introduces new future-useful Claims/Gaps. Task Core persists that boundary atomically; only successful persistence makes it visible.

Subagent certification alone never creates History. Shell commands, file counts, temporary directories and other reproducible process details are not History.

## Analysis output

Analysis-mode publication is rendered from certified structured data:

- Evidence
- confirmed/supported Claims
- Gaps / 待确认
- Recommendations / 建议
- ordered implementation Steps

DIRECT Evidence requires explicit source type, coverage, locator and source-near observation. Unknown remains unknown; scope or relationship gaps are not filled by model plausibility. Free `finalResult` text cannot bypass the structured certification boundary.

A formal Project Knowledge subsystem is **not** implemented yet. Project Scope, attachments, referenced completed Results and Human Gateway answers are Task inputs, not a project truth store.

## Current Progress

Task detail exposes semantic work topics and the actual current owner label:

- `Root Agent`
- `Subagent`
- `Validator`
- `未分配`

Work states include running, completed, dependency wait, resource wait, retry wait and suspended. Current Progress is runtime state; it is separate from durable History. While a Task is still open, completed Work Units remain visible even after their Stage is cleared; current Root/Validator activity is shown beside Work Units instead of replacing them. When a Task waits for Human Gateway, the last runtime snapshot remains visible until the user replies.

The UI labels durable knowledge as **已确认进展** rather than implying that every runtime/Turn node belongs to History.

## Resource model

The user configures exactly two ceilings, both 1–5:

1. `任务并发数` — maximum concurrently active Tasks.
2. `每任务 Subagent 上限` — maximum simultaneous Subagents **per Root**. Root and Validator are not counted.

No global Subagent pool or resource pre-allocation exists. Work is created only on demand and becomes RUNNING only after real execution starts. Capacity shortage is `WAITING_RESOURCE`; a failed execution waiting for automatic retry is `RETRY_WAIT`. They are different runtime facts. Capacity shortage does not consume the failure retry budget. Lowering a ceiling never kills active work; replenishment stops until natural convergence reaches the new ceiling.

Validator is not one global serialized Agent; independent certification can proceed concurrently. Temporary Validator capacity shortage preserves the candidate and resumes certification without rerunning completed investigation.

## Retry and recovery

Retryable failures have at most five total attempts per cycle. First failure is `1/5`; `>=5` suspends and there is no sixth automatic attempt. Automatic retry delays use jitter so a shared transport fault does not recreate a synchronized request wave. Manual retry starts a fresh cycle. Deterministic/nonretryable errors may suspend immediately.

Restart does not restore an Agent cursor. Scheduler reconciles stale durable RUNNING Tasks, and Root reconstructs work from durable Task facts, certified History and current real project state. Side-effecting operations must inspect real state/idempotency before retry.

## Cancel, delete and lock

- READY: Delete.
- RUNNING: Cancel intent; Scheduler waits for quiescence before `COMPLETED / 已取消`.
- WAITING_HUMAN: Cancel; normally already quiescent.
- COMPLETED: Delete + Lock/Unlock. Locked completed Tasks cannot be deleted.

Delete is not silently converted into Cancel after a race into RUNNING.

## Attachments, cleanup and time

Attachments are durable Task inputs under `data/attachments/`; they do not enter Project Registry or expand Project Scope. Root receives logical Task-input references and TaskBoard-managed scratch, but no Project Scope filesystem path, attachment local path or network capability. Project read/write access exists only inside a delegated Work Unit that explicitly selects the Project input and declares `projectAccess=read|write`; write is accepted only for execution-mode Tasks.

Automatic cleanup physically removes only eligible COMPLETED data on local day 91. Locked Tasks and completed Results referenced by later Tasks are protected. Daily cleanup targets local 01:00 and has a shared hard five-attempt daily retry ceiling.

UI keeps full timestamps and renders:

- today: `HH:mm:ss`
- same year: `MM-DD HH:mm:ss`
- another year: `YYYY-MM-DD HH:mm:ss`

Completed-list cards show both creation and completed-phase time.

## Integration architecture

External integrations remain independent axes:

- **Execution Adapter** — performs Root/Subagent/Validator model work.
- **Capability Provider** — read-only Executor capability discovery.
- **Surface Host** — optional desktop/IDE embedding.

Codex is the first implementation, not a Task Core dependency. Startup reads the configured model through lightweight `config/read`; the full model catalog refresh runs once in the background. The AI information line has a small manual refresh action whose button is also the refresh-state indicator: green = latest refresh succeeded, gray = startup refresh failed, yellow = manual refresh failed, spinning = refresh in progress. A failed refresh is atomic: the current model record is preserved; if no model record exists, TaskBoard explicitly falls back to Executor Default. When catalog metadata is available, routing uses provider-described capability to select the minimum-sufficient model for the actual work and chooses only `low/medium/high` reasoning; it never infers capability from a model id. If metadata cannot prove an alternate model is sufficient, routing falls back to the configured model. Codex's own internal model-manager refresh can still delay `thread/start`; TaskBoard does not claim to control that internal refresh.

### TaskBoard inside Codex Desktop

`TaskBoard-in-Codex.vbs` can start/reuse TaskBoard and attach an optional loopback CDP Surface to Codex Desktop. CDP affects only presentation. The TaskBoard service, Task Core, Scheduler and Codex Execution Adapter remain independent.

If Codex is already running without the required CDP endpoint, the launcher asks before restarting it. CDP is bound to `127.0.0.1`; the embedded surface uses a narrow local host-RPC bridge for normalized `/api/*` calls.

## Development

```bash
npm install
npm run verify
npm start
```

Architecture sources of truth:

- `docs/PRODUCT_CONSTITUTION.md`
- `docs/ADR.md`
- `docs/CAPABILITY_MAP.md`
- `docs/CAPABILITY_CONTRACTS.md`
- `docs/CAPABILITY_IMPLEMENTATION_MAP.md`
- `docs/RULE_REALIGNMENT.md`
- `docs/SPECIFICATION.md`
- `docs/ARCHITECTURE.md`
