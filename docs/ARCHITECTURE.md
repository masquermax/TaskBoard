# TaskBoard Architecture v0.9.2

Status: ACTIVE

TaskBoard is a local-first **work operating system for Agents**. It does not treat a Task as one large Prompt and it does not give every Agent the same authority. The architecture is driven from a small Governance layer into explicit Capability ownership, reusable Skills and concrete Runtime surfaces.

## Core execution model

This is not a new Rule layer. It is the Runtime consequence of the existing Constitution and Capability ownership:

- **Capability follows ownership.** Runtime exposes a capability because its Capability Contract owns it, not because every other position is told not to use it.
- **Knowledge advances by certified delta.** A later Root turn cannot erase committed knowledge by omission; changing committed knowledge requires new evidence and a newly certified delta.

```text
Task Baseline + Current Certified State + Real Trigger
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

The durable state inside that loop is deliberately small:

```text
Evidence + Claim(Fact) + Gap
```

Recommendations and ordered Steps are projections of the current decision, not durable cognition. Task Core owns the legal state transition; Root/Validator can only propose/certify input to it.

Current Certified State is context, not a clock signal. An ordinary Root Turn starts only from a real trigger: initial Task admission, a new Subagent result, a resolved Human Gateway, or a technical resume. Validator rework, delegation-plan repair and the post-certification control handoff are bounded subloops under that same trigger; they cannot manufacture a fresh Turn from `state:vN`. A control-only decision may therefore exist without a knowledge Turn Node, but it still has a causal trigger. Final analysis is rendered from accumulated Current Certified State rather than re-invented from the last model message.

## 1. Architecture stack

The active semantic/runtime chain is:

```text
Product Constitution — system first principles
        ↓
Capability Map — who owns what
        ↓
Capability Contracts — positive authority / capability boundary
        ↓
Runtime / API / Executor surfaces — make those capabilities real
        ↓
Current Task / Work Unit — concrete work boundary
        ↓
Selected external Skill method when applicable
        ↓
Execution
```

ADR is **sidecar engineering decision memory**: it records why the current architecture exists and which alternatives were rejected. It is not a runtime layer between Constitution and Capability Contracts.

Ordinary Agent runtime context is a role projection, not a repeated rule stack:

```text
current role Capability Contract
+ current Task / Work Unit inputs
+ selected external Skill method only when applicable
```

Constitution and ADR are not re-injected into ordinary Agent turns for each role to reinterpret. Their consequences are expressed by owned Runtime surfaces, schemas and certification boundaries.

## 2. Capability topology

```text
User / UI
   │ intent / facts
   ▼
Task Core ◄──────── certified durable write ─────── Validator
   │                                                 ▲
   ▼                                                 │ Root Candidate Delta
Scheduler                                            │
   │ Task lifecycle                                  │
   ▼                                                 │
Root ◄──────── Evidence / Findings ─────── Subagent
   │                                             ▲
   │ creates bounded Work Units                 │ delegated execution
   ▼                                             │
Work Unit ───────────────────────────────────────┘
   │
   ├─ Root selects Skill = method
   └─ Subagent uses Tool / Executor = operation
```

Critical ownership:

- Scheduler: Task lifecycle, admission, cancellation lifecycle and Task concurrency.
- Root: Task reasoning, planning, Work Unit creation/dependency, Skill selection, synthesis and convergence.
- Subagent: execution of one delegated Work Unit.
- Validator: certification, narrowing, Gap conversion and History-value decision for certified Root knowledge.
- Task Core: durable facts and atomic state changes. JSON Repository is the persistence implementation; deterministic completed-data retention cleanup is owned by Scheduler/cleanup Runtime rather than a second state authority.
- Skill: method only.
- Tool / Executor: operation only.
- Human Gateway: human-information transport only.
- UI: display and user intent only.

A critical capability with two owners is an Authority Conflict. A critical capability with no owner is an Authority Vacuum. Code that exposes an undeclared business capability is an Authority Leak.

## 3. Work Unit is a bounded work order

A Work Unit is not a mini Task and not a new planning layer. It must carry:

- `goal`
- `expectedOutput`
- `stopCondition`
- `projectAccess` (`none` / `read` / `write`)
- `networkAccess` (`true` / `false`)
- `inputRefs` (selected Task inputs only)
- `dependsOn`
- optional `skillId`

Runtime does not invent missing output/stop/access/input semantics. Root must define them. New Work Units select only the Task inputs they need through `inputRefs`; unselected Project Scope, attachments and referenced Results are not sent to that Subagent. `projectAccess` is a Work Unit capability request, not an authorization fact. For a selected Project, `GovernanceCompiler` intersects the machine Role capability, certified `TaskContract` Project authority, selected Project scope and Work Unit request into the effective `AuthorizedGrant`; only that grant can expose `write`, and `taskMode` is not consulted for authorization. Root control Turns themselves do not receive Project Scope filesystem access or network capability. Re-issuing semantically identical work under a fresh id is rejected as a planning-contract violation; Root should consume the existing result or define a genuinely new boundary.

A certified Gap marked `blocking` prevents unsafe completion or convergence while the required fact/decision remains unresolved. That marker does not by itself revoke an otherwise-governed evidence-acquisition Work Unit: Root may delegate bounded work that independently satisfies its Work Unit Contract and `AuthorizedGrant`, while the Work Unit returns evidence/local findings rather than closing the Gap. Gap resolution still requires certified supporting evidence. Human Gateway is reserved for information or decisions that are genuinely human-owned or unavailable to the system and remains bound to the exact certified Gap.

For the stock Codex Executor in TaskBoard-orchestrated mode, a declared `stopCondition` has a technical execution lease. At the soft lease point TaskBoard uses the same Turn's steer capability to force a convergence check against the original stop condition and existing evidence; at the hard lease point it interrupts the Turn and surfaces a nonretryable execution-boundary result. This is an Executor-specific realization of the generic bounded Work contract, not a Core dependency on Codex.

A Subagent may return source-near Evidence, local Findings, blocker information and `discoveries[]`. A Finding is local execution output, not a Task Claim/Gap/Recommendation. A Discovery does not grant permission to continue outside the Work Unit; it is handed back to Root for the next Task-level decision.

## 4. Local delivery instead of Stage barriers

Work Units are scheduled independently within the per-Root Subagent ceiling. When one Work Unit finishes and its local result has passed deterministic source-trace normalization:

```text
Work Unit A → deterministic source-trace normalization → Root input
Work Unit B ─────────────────── still running
Work Unit C ─────────────────── still running / waiting dependency
```

Root does not wait for every sibling in a Stage before consuming A. The Stage remains a runtime view of current work, not a global synchronization barrier. For UI continuity, completed Work Units are retained in the open Task's runtime snapshot even after a Stage is cleared; this runtime-only visibility does not create certified History. Current Root/Validator activity is projected alongside Work Units instead of replacing them. If a certified Root convergence decision makes remaining read-only investigations unnecessary, Runtime may stop those no-side-effect Work Units; a write-capable Work Unit is never preempted merely to shorten the tail and must first reach a safe boundary.

## 5. Validator is certification, not a second Root

Validator checks Root Candidate Delta content against traceable source boundaries. Its normal path is deterministic:

1. verify source address / source-near observation when the system can do so mechanically;
2. validate Claim/Evidence scope and structural proof relationships;
3. certify, narrow to the supported subset, or produce an explicit Gap.

A model-backed Validator turn is allowed only for a narrow proof relation that deterministic source/structure checks cannot certify: explicitly semantic raw material such as exact visual/pixel evidence, or Gateway-derived Human Claims/Gap resolutions whose meaning must be checked against the exact certified question and answer. A resolved Gateway is itself system-owned causal input: Runtime synthesizes its DIRECT Human Evidence and automatically submits proof for the Gateway's bound Gap, so Root cannot accidentally drop the user decision by forgetting a resolution field. The Gateway→targetGapId relation is deterministic ownership and is checked before any model call; Validator judges only whether the exact answer is semantically sufficient for that exact Gap. Ordinary code/text paraphrase, multi-source synthesis and cross-system reasoning remain Root analysis and do **not** automatically trigger a second model turn.

Validator may request one targeted correction of a Root candidate. If it still cannot certify the full content, it preserves the certifiable subset and converts the rest to an explicit Gap. It does not re-plan the Task, create Work Units, search the repository again or choose Task lifecycle state.

If certification changes the control implication — for example a blocking Gap remains — Validator hands the certified state back to Root for the control decision.

## 6. History authority

History is not Agent activity and Root cannot authoritatively write it.

```text
Root-level candidate
      ↓
Validator certification
      ↓
new future-valuable Task knowledge?
      ↓ yes
History commit decision
      ↓
Task Core atomic persistence
      ↓ success
History becomes visible
```

Subagent certification only makes a local result safe for Root; it does not directly create History. Each committed Turn Node can create at most one concise Task-level History boundary. Shell commands, file counts, temporary paths and other reproducible process detail are not History.

Root no longer needs a special `progressCommits` authority. Any certified Root boundary can produce History, including while sibling Work Units are still active.

## 7. Skill layer

Skill is reusable method experience, not Task runtime state. TaskBoard core keeps only the Skill capability shape and an injected library boundary. Concrete/distilled method packages are external user-owned assets.

A method package may declare:

- Purpose
- Applicable Work
- Method
- Contract
- Capability Requirements
- Stop Condition

Root selects an optional method for a concrete Work Unit. The Work Unit already defines the actual goal/output/stop/access boundary; Runtime determines the real operation surface. Core ships no concrete Skill library and performs no experience-to-Skill distillation in this branch.

## 8. Evidence boundary

Analysis-mode output distinguishes Evidence, Claims, Gaps, Recommendations and Steps, but only Evidence/Claims/Gaps are durable cognition. DIRECT Evidence must preserve an explicit source type, coverage, locator and source-near observation. Project/text sources are mechanically checked when possible. `PROJECT_SEARCH` / runtime prose is not accepted as DIRECT truth until TaskBoard owns a replayable raw search/runtime record. DIRECT requirement Evidence may certify the requirement statement itself; it does not certify the corresponding implementation chain.

Unknown remains unknown. A component-level fact cannot become system truth, an existing capability cannot become proof of current binding, and a missing relationship cannot be supplied by model plausibility.

## 9. Resource model

User-visible configuration remains only:

- Task concurrency: maximum active Tasks.
- Per-Task Subagent limit: maximum simultaneous **TaskBoard Subagents** for each Root; Root and Validator are not counted.

The ceilings are maxima, not targets. Work is created only when Root needs it and is allocated only when a real execution resource starts. `WAITING_RESOURCE` means no execution capacity was obtained; `RETRY_WAIT` means execution already failed and is waiting for a jittered retry. Capacity shortage does not consume the normal failure retry budget. Lowering a ceiling never preempts active work; the system converges naturally by stopping replenishment. No global safe Executor concurrency ceiling is guessed until Runtime capability/evidence supports one.

A future Runtime-native Agent tree is not counted as TaskBoard Subagents. It requires a distinct orchestration contract, capability accounting and observability model before admission; the current bootstrap rejects that mode rather than mixing both ceilings.

Validator work is not a global serial queue. Independent certification can proceed concurrently; a temporary Validator resource shortage preserves the candidate and resumes certification without rerunning completed investigation.

## 10. Lifecycle and recovery

User-visible Task states remain exactly:

- READY
- RUNNING
- WAITING_HUMAN
- COMPLETED

`QUIESCENT` is an internal boundary. Scheduler is the only lifecycle owner. RUNNING requires a real execution claim. WAITING_HUMAN requires quiescence and a real user-owned information blocker.

Recovery does not restore an Agent cursor. Durable Task facts, Current Certified State / Turn Nodes, certified History and current real project state are used to reconstruct work. Repeatable no-side-effect work may rerun; side-effecting operations require real-state/idempotency checks.

## 10.1 Executor model capability lifecycle

Model identity and model catalog are Executor/Capability facts, not Task Core semantics. An active Extension may expose an explicitly configured/default model immediately and discover a fuller `models[]` catalog asynchronously. `ModelRouter` consumes the normalized snapshot; it does not own catalog refresh or infer provider brands from model ids.

Per-Task/Work routing consumes the cached snapshot. When catalog metadata provides usable capability descriptions, the Router chooses the minimum-sufficient model tier for the actual work (efficient finite read-only work, balanced ordinary analysis/Validator work, frontier complex/open-ended Root work) without treating the model id as capability evidence. If metadata cannot prove an alternate choice, it falls back to the configured model/Executor default. Reasoning override stays within the values reported by the selected model capability.

The stock Codex Extension realizes this lifecycle with lightweight config discovery plus a non-blocking `model/list` refresh. Codex-specific internal model-manager refresh behavior remains an Extension/runtime observation and does not become generic Core policy.

## 11. Extension boundary and composition

TaskBoard separates removable Runtime concerns rather than treating “model integration” as one monolith:

- **Executor** — realizes Root/Subagent/optional Validator operations and reports Runtime facts.
- **Capability Provider** — discovers normalized execution/model/provider capability facts.
- **Connection Settings** — owns provider/profile validation, Secret persistence and Runtime reconfiguration/rollback when the Extension supports configurable connections.
- **Presentation** — safe declarative display metadata/settings schema; it does not create execution Authority.
- **Surface Host** — optional interaction/embedding transport; multiple hosts may coexist.

`ExtensionRegistry` is the composition boundary. Stock TaskBoard builds the builtin registry; an external distribution may inject another registry into `bootstrap()` without modifying Task Core. Public composition entry points are exported through `taskboard-codex/extensions` and `taskboard-codex/bootstrap`.

Every Extension declares `orchestrationMode`:

- `taskboard` — TaskBoard owns Root → Work Unit → TaskBoard Subagent orchestration. This is the only mode currently admitted.
- `runtime-native` — reserved for a future distinct contract in which the Executor owns an internal native-agent tree. Current bootstrap fails closed on this mode.

A Runtime-native Agent is never implicitly a TaskBoard Subagent, WorkReceipt, certified claim or TaskBoard concurrency slot. There is no implicit hybrid mode.

Codex is the stock first implementation, not a Task Core dependency. CDP is an optional loopback Surface transport only; it does not own Task execution or lifecycle. Connection settings are rendered from the active Extension's declarative descriptor rather than from Codex/OpenAI-specific UI branches. See `docs/EXTENSIONS.md`.

## 12. Explicitly not implemented

- A formal Project Knowledge subsystem. Project Scope, attachments and completed references are Task inputs, not a project truth store.
- Root-local first-class Skill invocation. The current Runtime declares Skill selection/consumption for delegated Work Units only; Root has no Project Scope filesystem or network capability, and project read/write belongs to an explicitly scoped delegated Work Unit.
- Replayable Project Search evidence records. Search/runtime summaries remain non-DIRECT until such a source-of-truth exists.
- Generic execution side-effect proof/certification. All candidates route through Validator, but first-class source-grounded proof is currently analysis-oriented; write authorization and task-specific test/tool evidence remain the execution safety mechanisms.
- Runtime-native orchestration. The mode is named only to enforce separation from TaskBoard-owned orchestration; no native-agent-tree execution path is currently admitted.
- Dynamic marketplace/plugin discovery or hot Executor switching. External distributions compose a registry explicitly; one TaskBoard process binds one active Executor Extension.

## Runtime ownership

Scheduler owns Task/work admission, lifecycle and resource-wait transitions. Executor performs concrete Runtime operations and reports execution facts such as active execution count; those facts do not create a separate resource-management Owner. Capability Provider owns model/capability discovery state, including refresh outcome. Connection Settings owns Extension-specific connection mutation and Secret handling. UI renders normalized Task state plus Extension-owned safe presentation metadata and user intent; it does not reinterpret provider/runtime semantics.
