# TaskBoard Specification v0.9.2

Status: ACTIVE

## Product intent

TaskBoard manages work rather than long AI chats. Task facts/lifecycle stay outside model sessions; Root decides, Subagent executes, Validator checks provenance, Scheduler owns lifecycle, and Task Core persists the minimum durable state.

## Runtime contract

```text
Task/Human/technical trigger
          ↓
         Root
   judge / delegate
          ↓
      Work Unit(s)
          ↓
      Subagent(s)
          ↓
 result + Evidence + blocker
          ↓
         Root
  judge meaning / next action
          ↓
      Validator
   provenance ledger
          ↓
 Certified State / complete / next Work / Human Gateway
```

Runtime does not create another semantic owner around this chain.

## Task lifecycle

Visible states:

- `READY / 需执行`
- `RUNNING / 进行中`
- `WAITING_HUMAN / 等待你`
- `COMPLETED / 已完成`

Scheduler uniquely owns lifecycle transitions. READY→RUNNING requires a real Executor admission event. Resource waiting is not execution and does not consume retry failure budget.

## Root

Root is the sole Task-level judgment owner. It owns:

- Task interpretation and current goal;
- whether/how to split work;
- Work Unit dependency/parallel structure;
- what Subagent output means and whether it is sufficient;
- Claims, Gaps, Recommendations and presentation Steps;
- whether Human input is genuinely required;
- completion judgment and explicit `Claim.obligationRefs[]` mapping.

Root has no Project filesystem/network execution capability. It receives the Task input catalog, current Claims/Gaps/unresolved obligations, fresh Work Unit results and the current Human trigger only.

Current Certified State is context, not a self-trigger. A new Root turn requires Task start, a completed Work batch, a resolved Human Gateway or a technical resume.

## Work Unit

Every Work Unit requires:

- `id`, `title`
- `goal`
- `expectedOutput`
- `stopCondition`
- `projectAccess` (`none/read/write`)
- `networkAccess`
- `inputRefs`
- `dependsOn`
- optional `skillId`

The Work Unit is a bounded order, not a mini Task. Missing boundaries are rejected, not invented. Semantically duplicate work is rejected.

`projectAccess`/`networkAccess` are requests. `GovernanceCompiler` intersects the request with the Root-authored Work Unit, selected Task inputs, machine role ceiling and certified Task authority to produce the executable `AuthorizedGrant`.

## Subagent

Subagent executes exactly one Work Unit and stops at its bounded output/stop condition.

It returns only:

- `result`
- source-near `evidence[]`
- optional `blocker`
- narrow effect-recovery closure metadata only when Runtime safety requires it.

It does not own Findings as Task semantics, Claims, Gaps, Recommendations, confidence/uncertainty classification, Discoveries, next work, completion or Human Gateway.

Dependencies are resolved inside the current Stage. Independent siblings may execute concurrently. Root consumes the Stage batch after all issued siblings reach the Stage boundary; it is not awakened once per sibling.

## Validator

Validator is deterministic Runtime enforcement, not an Executor/model role.

It may:

- verify that a source/locator exists inside the governed boundary;
- verify DIRECT text/code observation at the cited anchor;
- downgrade a real but mechanically unverifiable source to INDIRECT;
- reject missing/fabricated/mismatched sources;
- reject references to missing Evidence/Claims;
- reject CONFIRMED claims that depend on INDIRECT evidence;
- require admitted DIRECT evidence for an explicit Gap resolution.

It may not:

- re-investigate the Task;
- interpret business meaning;
- decide whether Root's reasoning is reasonable;
- create/repair Root conclusions or Gaps;
- decide the next Work Unit;
- use a model turn.

Validator PASS means the source ledger is valid, not that Validator independently agrees with the conclusion.

## Certified State and publication

Durable cognition is only:

- Evidence
- Claim
- Gap

A Root delta enters Certified State only after provenance/ledger checks. Certified State is monotonic by omission: later turns cannot erase old knowledge by forgetting to repeat it. Evidence ids are immutable; revising an existing Claim/Gap requires new Evidence.

Recommendations and Steps are current presentation, not learned state. Final analysis is rendered from Current Certified State plus the current Root presentation projection; free analysis `finalResult` cannot bypass this boundary.

A `CONFIRMED` Claim may satisfy a governed obligation only through Root's explicit `obligationRefs[]`. CompletionEvaluator checks that relation deterministically and does not perform a second proof/reasoning turn.

There is no active `stageResult`, semantic History writer, Validator repair state or parallel cognition channel. Legacy progress rows may remain readable for old data/UI compatibility but are not written or replayed by current Runtime.

## Human Gateway

Human Gateway is thin transport for information/choices genuinely owned by the user.

A Root `human_gateway` decision must bind the current blocking Gap and exact certified question. Scheduler persists and exposes the question. When answered, the resolved answer becomes the next Human trigger supplied to Root.

Runtime does not automatically generate Evidence or Gap resolution from the answer. Root decides what the answer establishes; Validator only checks any source relation Root later cites.

## Authority and TaskContract

Human requirements may establish Task-level capability authority only through the deterministic TaskContract fidelity boundary. Project presence or Task wording alone does not grant write/network access. Unknown/ambiguous capability demand fails closed.

Only Root and Subagent are executable model roles. Validator, Scheduler, Task Core and Human Gateway do not receive Executor model grants.

## Retry, timing and recovery

Retryable execution faults have at most five attempts per retry cycle. Capacity shortage is `WAITING_RESOURCE`, not a failed attempt. Manual retry starts a new cycle.

Timing follows ownership: Work Unit retry changes Work Unit/attempt state, not the Task's semantic start. Runtime snapshots distinguish issuance, first execution start, last activity and completion.

Side-effect recovery is a safety boundary, not another reasoning role. If transport/process loss occurs after a mutation may have started, Runtime preserves the unresolved effect fact, prevents competing fresh mutation and permits only minimum safe observation until independent evidence closes the old mutator. Unknown is never converted into failure just to enable replay.

## Resource configuration

User-facing execution ceilings remain:

- Task concurrency;
- per-Task Subagent concurrency.

They are maxima, not targets. Work Unit count is not a concurrency count. Root and Validator are not Subagents; Validator has no model resource lifecycle.

## Diagnostics

Diagnostics may record operational facts such as route, model, timestamps, tool type, duration, result bytes and Work Unit identity. Diagnostics cannot create business Evidence/Claims/Gaps, decide convergence or wrap RootRuntime with a second semantic execution layer.

## Skill

TaskBoard Core defines only an injected Skill-method boundary. Concrete Skill assets live outside Core. Root may select a Skill for a Work Unit; Subagent receives only that selected method. Skill never grants Authority.

## Extension boundary

An Extension may provide Executor, Capability Provider, connection settings, presentation metadata, Surface Host and continuation integration. TaskBoard currently admits TaskBoard-owned orchestration only:

```text
Root → Work Unit → TaskBoard Subagent
```

A runtime-native internal agent tree requires a distinct future contract. It is not implicitly counted as TaskBoard Subagents or converted into WorkReceipts/Claims.

Codex is the stock Executor implementation, not a Task Core dependency. Provider/auth/settings semantics stay extension-local.

## Cleanup and UI

- Completed-data retention cleanup remains deterministic and protects locked/referenced completed results.
- UI projects Scheduler/Task Core/Runtime state; it does not infer business truth from visual state.
- Current Work activity is Runtime state, not durable cognition.
- User-facing durable analysis is labeled `已确认结论` and comes from Certified State.

## Explicitly absent

Current Runtime intentionally contains no:

- Validator model/semantic proof/rework loop;
- planning-repair/completion-repair model loop;
- semantic History decision owner;
- `stageResult` replay channel;
- runtime telemetry wrapper/convergence heuristic;
- Root Project/network execution;
- automatic Human-answer interpretation;
- formal Project Knowledge subsystem;
- replayable generic Project Search/Runtime evidence store;
- runtime-native Agent-tree orchestration.
