# Current State

Status: RUNTIME_HARDENING_REQUIRED
Release lane: `v0.9.2`

`v0.9.2` remains the current integration lane. The product architecture and governance baseline are substantially formed, but real Runtime acceptance has exposed convergence, retry-continuation, execution-budget and observability defects that must be fixed before treating this lane as release-ready.

## Current truths

- Runtime vocabulary is **Project / Root / Subagent / Validator / Executor**.
- Scheduler uniquely owns Task lifecycle/admission. Root owns Task reasoning/planning. Subagent executes one bounded Work Unit. Validator certifies Root Candidate Deltas and owns History semantic-value decisions. Task Core owns durable facts/atomic persistence. Executor owns operations, not business truth.
- Project-specific authority is derived only by `GovernanceCompiler` into `AuthorizedGrant` from the machine Role capability, certified `TaskContract` authority, selected Project scope and Work Unit request.
- Goal Satisfaction is derived only by `CompletionEvaluator`; execution occurrence, receipts and projections cannot independently create Completion truth.
- Blocking Gaps constrain only their real dependency radius and do not globally revoke independent governed evidence acquisition.
- Analysis cognition advances through certified `Evidence + Claim + Gap`; Recommendations/Steps are recomputed projections.
- Root/Subagent/Validator contexts are allow-list constructed. Root does not receive Project Scope filesystem paths or network capability merely because those inputs exist.
- Persistence has one current implementation: JSON.
- Concrete Skill content remains outside core; core exposes only the selected-method library boundary.
- Current Progress is runtime projection, not durable History.
- Model routing consumes provider-described capability when available and otherwise falls back to the configured/default Executor model.
- Codex connection configuration is extension-local. Account mode and Custom Provider mode are distinct transports/configuration paths; Task Core does not own provider/authentication semantics.

## Real Runtime acceptance checkpoint

Latest user-side acceptance evidence was produced on Windows with Node 24, TaskBoard `0.9.2`, Codex account mode resolving to `account/openai`, and `codex-cli 0.147.0`.

The connection path itself was healthy enough to start and complete Root/Subagent/Validator turns. The dominant remaining defects were Runtime behavior rather than provider connectivity:

1. **Convergence defect** — after three useful read-only Subagent Work Units had completed, Root later produced `ROOT_EMPTY_DELEGATION`, suspending the whole Task instead of converting the already-known state into the smallest legal next action.
2. **Retry-continuation defect** — root-level manual retry discards the in-memory Root session and reconstructs it from durable facts. Certified State and WorkReceipts survive, but control/convergence state such as `rootTurnCount`, pending validation and repair counters does not; the UI therefore restarts from “Root 初始判断” and can repeat already-earned control work.
3. **Completion convergence defect** — the same audit later suspended with `ROOT_COMPLETION_NON_CONVERGENCE: governed obligations remain unsatisfied: OBL-T-0009-GOAL` after another Root/Validator repair cycle.
4. **Execution-budget defect** — the three parallel audit Subagents consumed roughly 80–133 tool calls each and about 13–14 minutes wall-clock per Work Unit despite a convergence steer at about 10 minutes.
5. **Context-growth defect** — Root input grew from roughly 7.5 KB to 22 KB, then 58 KB and about 80 KB across later turns, showing insufficient delta/summary compaction during continuation.
6. **Observability defect** — stock UI prominently renders `status_entered_at`, so a retry changes the visible top time to the new RUNNING phase time rather than preserving an obvious Task-total start/elapsed view.
7. **Windows sandbox test limitation observed during the audit** — several targeted tests did not reach assertions because `mkdtemp` under the current sandbox returned `EPERM`. This is an environment-execution fact, not proof that the tested semantics failed or passed.

## Runtime hardening target

Do not add unrelated product surface while this checkpoint is active. The next work should improve Runtime without weakening the existing governance invariants.

Primary acceptance target for the same class of read-only audit task:

- one continuous run without manual retry;
- no empty delegation or Root/Validator control loop;
- completed Work/Evidence is not re-investigated after retry/resume;
- bounded tool/model/context budget per Work Unit;
- explicit Task total elapsed time plus per-Root/Subagent/Validator/Wait/Retry timing;
- preserve Authority, SourceTrace, Evidence certification, CompletionEvaluator, fail-closed behavior and Extension boundaries;
- target approximately 10–20 minutes wall-clock for this audit class unless the actual evidence dependency graph justifies more.

## Branch / continuation rule

Continue Runtime hardening on the existing `v0.9.2` lane. Do not create another branch merely for the Runtime work unless a genuinely independent experiment requires isolation.

`main` remains the stable baseline until `v0.9.2` reaches real Runtime acceptance. Old experimental branch refs are historical evidence only and are not active continuation lanes.

## Verification boundary

Historical generic CI GREEN remains useful implementation evidence, but it does not override the real Runtime checkpoint above. A future release-ready claim requires both:

1. current exact-head Test/CI verification; and
2. real Runtime acceptance on representative tasks proving convergence, continuation, budget and timing behavior.

Real Git / Runtime / Reality evidence outranks this document if they ever diverge.
