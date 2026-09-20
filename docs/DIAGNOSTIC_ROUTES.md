# TaskBoard — Diagnostic Routes

Status: ACTIVE MAINTAINER METHOD — project-local, not AI-Context cognition.

Use these as routing shortcuts, not as substitutes for current Runtime/code verification. Start from current TaskBoard Reality and the owning Contract/Owner/source.

## Runtime is slow / multi-Agent did not feel faster

1. Start from the **actual Runtime trace**, not the intended design flow.
2. If comparing against prior runs, use the relevant owned Runtime/evaluation Evidence only.
3. Reconstruct ordered Root/Subagent/Validator/control transitions with timestamps and overlap.
4. Separate:
   - true parallel Work Unit time;
   - critical-path serial Root/Validator/control time;
   - resource/capacity waiting;
   - connection/RPC/tool friction.
5. Compare per-Turn input/output size, model, duration, tool calls and measured token usage.
6. For long Work Units, do not infer “model failed to converge” from duration alone. Check operation repetition, evidence gain, last-new-evidence time, stopCondition progress and steer effect when telemetry exists.
7. Verify current implementation before proposing a Runtime fix.

## Work Unit is waiting for resource

Trace in this order:

1. configured Task/Subagent concurrency;
2. capability-derived effective concurrency ceiling;
3. current running/pending Work Units;
4. actual Codex `activeTurnCount` / Executor availability;
5. connection reconfiguration gate or app-server health;
6. retry/capacity classification.

Do not equate “max 3 Subagents” with “this Work Unit must start immediately”; dependency, pending-start and Executor/capability conditions can consume/withhold effective slots.

## Authority / role appears to exceed its boundary

Use the project-owned architecture review chain:

`Requirement -> governed Contract -> Owner -> GovernanceCompiler/AuthorizedGrant -> Runtime execution surface -> Context exposed to the model -> regression test`

Find the first broken/mis-owned link. Avoid fixing only the UI/prompt symptom.

Typical places to reverify include GovernanceCompiler, role capability contracts, RootRuntime ownership boundaries, Codex execution-surface projection and Gate/authority tests.

## Validator appears slow or behaves like an Agent

Separate three questions:

1. deterministic validation: code-only checks, expected to be cheap;
2. semantic proof: bounded Validator model Turn, potentially expensive;
3. completion assessment/evaluation: separate completion proof path.

Measure the actual candidate/input size and invocation count. Do not classify all `Validator` time as one mechanism, and do not assume model use automatically means the Validator owns an Agent lifecycle or Completion Authority.

## Completion loops / non-convergence

Reconstruct the actual sequence around:

- Root completion candidate;
- semantic Validator/CompletionAssessment invocation;
- certified facts/proof material;
- CompletionEvaluator result;
- unsatisfied obligation IDs/reasons;
- next Root turn and its trigger.

If Root/Validator repeats, compare what materially changed between turns. A repeated turn with mostly repeated context is a different problem from a new proof obligation.

## Suspend -> later execution resumes

Do not infer the resume actor from timing alone.

Look for a durable control-transition event that identifies:

- previous lifecycle state;
- next lifecycle state;
- actor/source (`user`, Scheduler, recovery, API, retry policy, etc.);
- reason/error classification;
- correlation to the prior execution occurrence.

If the trace only shows `suspended` followed by a later Root turn, mark resume provenance `Unknown`.

For write/effecting Work Units, separately check Work Receipt/recovery state before allowing retry; uncertain side effects must not be treated like harmless read retries.

## Context/token growth

Measure before theorizing:

- first comparable Root input;
- later Root inputs;
- Validator inputs;
- repeated Task/certified/work-receipt/result payload contribution;
- token/cache telemetry if available.

`inputBytes` is not exact token usage. `usage=null` is an observability gap, not zero usage.

## Provider / Codex connection anomaly

Check:

1. extension-owned connection settings/profile;
2. app-server spawn/ready/exit and connection generation;
3. model/provider capability discovery;
4. active Turn count while reconfiguration is attempted;
5. requested/resolved model;
6. Runtime roots/permission profile returned by the app-server.

Do not let provider-specific state leak into Core ownership conclusions.

## Boundary

This file owns only TaskBoard-specific diagnostic routing. Architecture meaning remains in `ARCHITECTURE.md`, `CAPABILITY_MAP.md`, `CAPABILITY_CONTRACTS.md` and `ARCHITECTURE_REVIEW.md`; live behavior remains with current Runtime/source; cross-project reasoning HOW, if genuinely broader, must be promoted separately rather than copied from here.
