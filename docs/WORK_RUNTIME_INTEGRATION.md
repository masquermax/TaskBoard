# Work Runtime Integration Boundary

Status: DESIGN CONTRACT / NOT YET ACTIVE RUNTIME MODE

Shared cross-surface coordination is owned externally by:

`masquermax/TaskBoard-Ecosystem/extensions/work-runtime/`

TaskBoard v0.9.x remains a local-first standalone product. This document defines the boundary for a future integration mode so implementation does not create dual authority.

## Standalone mode — unchanged

In standalone mode:
- Task Core owns durable Task facts;
- Scheduler owns local Task lifecycle/admission;
- Root creates bounded Work Units;
- Subagents execute them;
- Validator certifies Task-level deltas.

No Work Runtime dependency is required.

## Work Runtime mode — target boundary

When TaskBoard is launched as an execution client for an externally coordinated Task/Work Unit:

- Work Runtime owns public cross-surface Task identity, occurrence, Work Unit admission, claim/lease/epoch, Resume State, conflict locks, operation ledger and external close/seal/cancel coordination.
- TaskBoard Root remains the planning/reasoning surface for the admitted objective.
- TaskBoard Subagents/Executor remain bounded execution surfaces.
- TaskBoard Validator remains a local/domain certification surface where applicable.
- Project/domain Owners remain substantive truth.
- TaskBoard local JSON may cache execution-local state/receipts but must not become a second synonymous public coordination store.

## No dual lifecycle

A single logical Task may not simultaneously be lifecycle-owned by TaskBoard standalone Scheduler and Work Runtime.

Integration must choose one mode at admission time:
- `standalone` — TaskBoard owns lifecycle;
- `work-runtime-client` — Work Runtime owns cross-surface lifecycle/admission and TaskBoard receives a governed execution contract.

## Work Unit mapping

Do not mechanically map a public Work Runtime Work Unit to every TaskBoard Subagent action.

A public Work Runtime WU is a meaningful closure unit. TaskBoard Root may internally decompose it into smaller local delegated Work Units/actions, but those local units do not automatically become cross-surface claims.

The TaskBoard execution returns:
- durable local result/artifact refs;
- evidence/findings/blockers;
- resume witness when the public WU remains incomplete;
- completion candidate when the public WU stop condition is satisfied.

Work Runtime performs the public commit/fencing/close transition.

## Commit boundary

TaskBoard must not treat a successful local Executor result as permission to mutate a stale canonical Owner.

Before canonical mutation in Work Runtime mode, the external Commit Gate must still validate current:
- claim/epoch/lease;
- Task revision/generation;
- dependency/input fingerprint;
- write/resource ownership;
- authorization/capability;
- Owner/read-set version;
- side-effect safety.

## Human Gateway

A TaskBoard Human Gateway may satisfy a local/public blocking requirement, but an externally coordinated Task is not automatically globally WAITING_HUMAN if other public Work Units remain executable.

## Implementation gate

Do not change current Scheduler/Task Core authority merely by adding Work Runtime fields. A real Runtime mode requires an explicit external coordination adapter/port and tests proving:
- no duplicate public lifecycle owner;
- late-worker fencing;
- resume without replay;
- local TaskBoard restart does not fork public progress;
- cancellation/closing reconciliation;
- removal of the adapter leaves standalone TaskBoard behavior unchanged.
