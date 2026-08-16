# TaskBoard Specification v0.9.2

Status: ACTIVE

## Product intent

TaskBoard manages **work**, not a collection of long AI chats. It keeps Task facts and lifecycle outside Executor sessions, gives each system position an explicit Capability Contract, lets Root create bounded Work Units, reuses methods through Skills, and certifies durable knowledge before publication/persistence.

## Governance / knowledge placement

The active runtime semantics flow from:

1. Product Constitution — five system principles.
2. Capability Map / Capability Contracts — active ownership and positive capability model.
3. Runtime / API / Executor surfaces — mechanical realization of those capabilities.
4. Current Task / Work Unit — concrete goal, inputs and capability request.
5. Selected external Skill method — reusable work experience applied only when relevant.

ADR is sidecar engineering decision memory, not a runtime authority layer. Agent heuristics live only inside the authority/evidence boundary above. There is no active `Analysis Rules` runtime layer.

## Capability Contract shape

Every current role/component contract defines at least:

- Identity
- Purpose
- Owns
- Capabilities
- Produces
- Handoff

An action not represented by `Owns` / `Capabilities` is not silently granted. Out-of-scope work follows `Handoff`.

## Task lifecycle

Visible states:

- `READY / 需执行`
- `RUNNING / 进行中`
- `WAITING_HUMAN / 等待你`
- `COMPLETED / 已完成`

Scheduler uniquely owns lifecycle transitions. A Task enters RUNNING only after a real Root execution start is reported. If unfinished work only waits for resource and no actual execution remains, the Task returns to READY with resource-wait context.

Completed Tasks are immutable as historical results; later Tasks may reference them without mutating them.

## Root

Root owns:

- Task understanding and plan;
- Work Unit creation, dependency and priority;
- whether an independent objective becomes a delegated Work Unit;
- Skill selection and Project Scope access request for delegated Work Units;
- synthesis of certified local results;
- Gap convergence and final candidate;
- whether a true user-owned information blocker exists as an intent candidate.

Root does not own Task lifecycle, certification or History persistence. An ordinary Root Turn also cannot self-start from Current Certified State: Task start, a new Subagent result, a resolved Human Gateway, or a technical resume supplies the trigger. Validator/planning/control repair may continue only as a bounded subloop under that same trigger.

Root may perform only the minimal local inspection needed for Task-level planning/synthesis. Once the need becomes an independent evidence-acquisition objective, Root expresses it as a delegated Work Unit. The current runtime does not claim first-class Root-owned Work Unit or Root-local Skill execution.

## Work Unit

Each newly authored delegated Work Unit requires `id`, `title`, `goal`, `expectedOutput`, `stopCondition`, `projectAccess` (`none` / `read` / `write`), `networkAccess`, `inputRefs`, `dependsOn`, and optional `skillId`. `inputRefs` selects only the Task inputs needed by that Work Unit from stable refs such as `task:instruction`, `project:<index>`, `attachment:<id>` and `reference:<task-id>`. `projectAccess=write` is an explicit request for bounded Project Scope mutation, not an authorization fact. Effective write access exists only when `GovernanceCompiler` derives an `AuthorizedGrant` that preserves it after intersecting the machine Role capability, certified `TaskContract` Project authority, selected Project scope and the Work Unit request; `taskMode` does not grant write access.

Runtime derives a missing Task Authority candidate only after Root has authored a concrete Work Unit and all authority-independent plan checks have passed. Project presence does not imply write demand, and omitted network authority does not imply a request for network access. Validator certifies only the missing capabilities demanded by that accepted plan; Task Core persists supported semantics, `GovernanceCompiler` recompiles the grant, and only then may the same Work Unit reach a Subagent.

Runtime rejects missing boundaries rather than inventing them. Semantic duplicate work under a fresh id is rejected so a Root cannot accidentally turn repeated prompts into fake progress. A certified Gap marked `blocking` prevents unsafe completion or convergence while its required fact/decision remains unresolved, but the marker itself does not revoke an otherwise-governed evidence-acquisition Work Unit. Root may create bounded acquisition work that independently satisfies the Work Unit Contract and `AuthorizedGrant`; that Work Unit returns evidence/local findings and does not close the Gap. Gap resolution still requires certified supporting evidence, while Human Gateway is reserved for information or decisions genuinely owned by the user or unavailable to the system. For Codex Subagents, `stopCondition` is additionally backed by a technical execution lease: Runtime steers the same Turn toward convergence before a final interrupt boundary. The lease bounds execution; it does not certify business completion.

## Subagent

A Subagent receives one Work Unit, only the Task inputs selected by that Work Unit, its dependency results, current role Contract and, when supplied by an external Skill library, the selected method. Runtime exposes only the operation surface granted to that Work Unit. It returns source-near Evidence, local Findings, blocker information and Discoveries. Task-level Claims, Gaps, Recommendations, completion and next-work decisions are produced only by Root. `projectAccess=none` requests no Project input, `read` requests a selected Project read surface, and `write` requests bounded mutation; the effective Project surface is always the `AuthorizedGrant` derived by GovernanceCompiler and may narrow any request. Network is independently explicit and defaults off; TaskBoard-managed scratch remains the only default writable area.

A completed Work Unit result passes only deterministic source-trace normalization before being delivered to Root as local execution input. It does not launch a second semantic Validator agent and does not become Task knowledge by itself. Independent siblings continue running. If Root later reaches a certified completion/Human-Gateway decision while only unnecessary read-only Work Units remain, Runtime may stop those no-side-effect investigations instead of forcing a tail wait; write-capable Work Units must first reach a safe boundary.

## Validator

Validator owns certification of Root Candidate Deltas and decides whether certified Root knowledge forms a new valuable History boundary. Subagent Evidence/Findings may be source-trace normalized mechanically, but Validator does not take over a Work Unit or independently re-investigate it.

Deterministic source/structure checks run first. Model semantic proof is used only for a narrow Root proof obligation that deterministic tracing cannot establish: explicitly semantic raw material (for example exact visual/pixel evidence) or a Gateway-derived Human Claim/Gap resolution whose meaning must be checked against the exact certified question and answer. The semantic turn receives only that proof obligation and exact resolvable source input; ordinary text/code synthesis does not trigger a second-model review merely because wording differs, multiple sources are cited or the relation crosses systems.

First unresolved Root certification may request one targeted correction from Root. A still-unresolved Root candidate is narrowed to certifiable content plus explicit Gap. Validator does not create work or decide lifecycle.

## Analysis publication

Analysis output is structured as:

- Evidence
- Claims (`confirmed` / `supported` as appropriate)
- Gaps
- Recommendations
- ordered Steps

Only Evidence, Claims and Gaps are durable cognition. A Claim is the structured Fact proposition; Recommendations and Steps are current presentation/decision projection and do not accumulate as learned truth. Final user-visible analysis is rendered from the final Current Certified State plus the current projection. Free `finalResult` text cannot bypass certification.

DIRECT requirement Evidence proves what the requirement says. It does not prove implementation exists. Cross-system implementation Claims still require explicit implementation/hop support. Search output is a locator; a DIRECT project fact must land on the real project file/source anchor.

A malformed or untraceable DIRECT source does not become a fact. If a candidate has no publishable fact/gap/recommendation after repair, it remains invalid rather than fabricating content.

## History

History records future-useful Task-level knowledge, not Agent process. Root-authored `progressCommits` are ignored. Validator derives a concise commit candidate from new certified Root-level Claims/Gaps; Task Core persists it atomically. In-memory/UI History advances only after persistence succeeds.

Subagent-only certification is not History. A Root turn can produce History while unrelated sibling Work Units remain active.

## Skill

TaskBoard core defines the Skill role and accepts an injected method library; it does not ship concrete Skill assets. A method declares Purpose, Applicable Work, Method, Contract, Capability Requirements and Stop Condition. Root may select an optional `skillId` for a delegated Work Unit; only the resolved selected method is added to that Work Unit executor context.

Experience mining, Skill distillation, Skill package ownership/versioning and personal Skill-library management belong to a separate extension branch/package. They are intentionally outside this core runtime.

## Execution certification boundary

Subagent Work Unit output is local execution material: deterministic source-trace normalization may constrain its Evidence/Findings, then Root decides the Task-level Candidate Delta. Root Candidate Deltas pass through Validator before they can change Current Certified State or final publication. TaskBoard does **not** claim a generic proof system that independently verifies arbitrary external side effects. Strong source-grounded certification is first-class for analysis knowledge; execution side effects rely on a governed `AuthorizedGrant` for any Project mutation, bounded Work Units, task-specific tests/tool results and side-effect safety. A future generic execution-proof contract must be added explicitly rather than treating pass-through as semantic certification.

## Project inputs and truth

Task inputs can include Project Scope, attachments, immutable referenced completed Results and resolved Human Gateway answers. These are not a formal Project Knowledge subsystem.

Root control/synthesis Turns receive TaskBoard-managed scratch and logical Task-input references, but no Project Scope filesystem path, attachment local path or network capability. Project read/write and network access exist only inside a delegated Work Unit that explicitly requests them and are limited by its `AuthorizedGrant`; Project write requires certified `TaskContract` authority plus the selected Project scope and Work Unit request, not an execution-mode label.

## Retry and capacity

Retryable faults have at most five total attempts per cycle; there is no sixth automatic attempt. Deterministic/nonretryable faults may suspend immediately. Manual retry starts a new cycle. Automatic retry delay is jittered to prevent synchronized re-entry after a shared transport failure.

Normal execution-capacity shortage is not a failure attempt and is represented as `WAITING_RESOURCE`. A real execution that failed and is waiting for its next automatic attempt is `RETRY_WAIT`; it must not be presented as resource shortage. Root-candidate Validator capacity shortage never causes already-completed Root/Subagent investigation to rerun. Requirement Authority Validator capacity shortage retains the accepted Root plan and exact semantic candidates without persisting a capacity shortage as an Authority verdict.

## Resource configuration

Exactly two user-facing fields, each 1–5:

- Task concurrency
- Per-Task Subagent limit (per Root Subagent ceiling; Root/Validator not counted)

No global Subagent pool, pre-reservation or preemption is introduced. Explicit compatible Executor limits may reduce the effective ceiling; unknown limits are not guessed.

## Model routing

Capability discovery and model routing are separate. Catalog refresh is cached/background capability work; an individual Root/Subagent/Validator route consumes the snapshot and does not own refresh. When provider metadata supplies meaningful model descriptions, TaskBoard chooses the minimum-sufficient capability tier for the actual work rather than assigning a model by role name or model id. Finite read-only Work Units prefer efficient capability, ordinary analysis/Validator work balanced capability, and complex/open-ended Root work frontier capability. Unknown or insufficient metadata falls back to the configured model. Automatic reasoning remains limited to `low/medium/high`.

Passing an explicit model does not give TaskBoard control over Codex's own internal model-manager refresh. Remaining `thread/start` stalls caused inside Codex are therefore observed rather than falsely reported as fixed.

## Current Progress

Current Progress exposes semantic work topics with execution owner labels (`Root`, `Subagent`, `Validator`, `未分配`) and states such as running/completed/dependency wait/resource wait/retry wait/suspended. While a Task remains open, completed Work Units stay visible even after their Stage is cleared. Current Root/Validator activity is rendered alongside Work Units rather than being hidden by them. A WAITING_HUMAN Task preserves its last runtime snapshot until the user replies.

This runtime view is not durable History and never becomes certified knowledge merely because work completed. User-facing durable knowledge is labeled `已确认结论`; it is still backed by Validator-certified History boundaries.

## Human Gateway

Human Gateway carries only information the system cannot obtain and that genuinely requires the user. Root may propose the need; Scheduler owns WAITING_HUMAN. Each Gateway must bind to exactly one currently certified blocking Gap and repeat that Gap's certified question; context/options may explain the choice but cannot silently change its meaning. When that Gateway is resolved, Runtime—not Root—creates the system-owned DIRECT Human Evidence and automatically proposes proof of the transition for that exact bound Gap. Root therefore cannot lose a valid user decision merely by omitting `evidence[]` or `gapResolutions[]`. Gateway→targetGapId ownership is deterministic; one Gateway cannot close another Gap. Validator still owns semantic sufficiency: the exact question/answer must actually support closure. Subagent and Validator cannot directly enter Human Gateway.

## Cleanup, time and UI

- Eligible completed data is physically cleaned on local day 91, with locked/referenced completed Results protected.
- Daily cleanup targets local 01:00, max five attempts/day, with success persisted only after a full no-error run.
- Today timestamps show `HH:mm:ss`; same-year non-today `MM-DD HH:mm:ss`; other-year full date.
- Completed cards show creation time plus completed-phase time.

## Integration

Codex remains the first Executor. Task Core does not manage login, provider or API keys. On first connection, current model identity is read through lightweight config; full model catalog discovery is enhancement work and may run in the background or via the AI-info refresh action. Refresh failure never replaces the previous model snapshot. Without any known model record, execution explicitly uses Executor Default fallback. The optional Windows Codex Desktop surface uses loopback CDP and does not change Task authority.
