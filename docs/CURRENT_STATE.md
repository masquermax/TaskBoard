# Current State

Status: RUNTIME_HARDENING
Release lane: `v0.9.2`

This file is a continuation checkpoint, not a second architecture definition. `docs/ARCHITECTURE.md`, `docs/SPECIFICATION.md`, the current code and newly verified Runtime evidence outrank stale wording here.

## Current Runtime truth

The active owner chain is singular:

```text
Scheduler
  ↓ lifecycle / admission
Root
  ↓ judgment / minimum Work Unit batch
Subagent(s)
  ↓ execution result + source-near Evidence + blocker
Root
  ↓ Task meaning / next action / explicit obligation relation
Validator
  ↓ deterministic provenance ledger only
Certified State / Task Core
  ↓
next Work / Human Gateway / completion
```

- **Root is the only Task-level reasoning owner.** It decides decomposition, meaning, sufficiency, Claims/Gaps, next work, Human Gateway and completion intent.
- **Subagent executes one bounded Work Unit only.** It does not create Task judgment, confidence, recommendations, next work or completion.
- **Validator is a deterministic accountant.** It checks source/locator/reference/trust relations and has no model lifecycle, semantic proof turn, repair loop, re-investigation authority or History-value authority.
- **Scheduler alone owns Task lifecycle/admission/concurrency.**
- **Task Core owns durable facts and atomic persistence.**
- **Human Gateway transports a human-owned answer only.** The answer returns to Root as a fresh trigger; Runtime does not interpret it automatically.
- **Executor realizes operations inside `AuthorizedGrant`; it owns no Task semantics.**

## Current convergence model

Root advances by incremental semantic closure rather than replaying the Task history.

```text
current Claims / Gaps / unresolved obligations
+ fresh Work/Human delta
        ↓
Root pushes relevant old×old / new×old / new×new relations to a fixed point
        ↓
goal satisfied → complete
remaining discriminator → minimum Work Unit batch
human-owned blocker → Human Gateway
```

A Stage is a strict Root↔Subagent batch boundary. Independent siblings may run concurrently, dependencies are local to the current batch, and partial sibling completion does not wake Root. Root receives the completed batch once and continues from the resulting delta.

Root context is intentionally compact: old Work receipts, raw historical Evidence and full analysis history are not replayed into each turn. Current Certified State is context, not a trigger.

## Removed parallel chains

The current Runtime no longer contains or relies on:

- `stageResult` / `last_stage_result` cognition;
- semantic History writer/value owner;
- Validator model / semantic proof / semantic repair;
- Validator resource-resume lifecycle;
- planning-repair / completion-repair / authority-handoff model loops;
- Runtime telemetry wrapper / convergence-steer / saturation heuristics;
- Root Project filesystem/network execution;
- automatic Human-answer → Evidence/Gap-resolution interpretation.

Legacy progress rows may remain readable for old data/UI compatibility, but current Runtime does not write or replay them as cognition.

## Necessary non-thinking enforcement

These remain because the owner chain cannot safely realize the requirement without them:

- Work Unit structural validation and semantic-duplicate rejection;
- deterministic Task authority fidelity and `AuthorizedGrant` narrowing;
- source/provenance ledger checks;
- monotonic Certified State merge;
- deterministic CompletionEvaluator over Root-owned `claim.obligationRefs[]`;
- retry/capacity lifecycle;
- WorkReceipt persistence for restart/resume;
- fail-closed effect recovery when an already-started mutation has unknown Reality outcome;
- minimal operational diagnostics/timing facts.

None of these mechanisms may become a second Task reasoning owner.

## Remaining acceptance work

The architecture slimming is not itself Runtime acceptance. Representative real runs still need to prove that the current skeleton actually converges efficiently:

- Root wakes only on legal Task/Human/technical/full-stage triggers;
- one completed sibling batch causes one Root synthesis turn;
- Subagent stops at the Work Unit boundary without Task-level reasoning;
- Validator performs no model turn and checks only the current source ledger;
- Root input does not regrow through historical replay;
- retry changes the smallest owned Work Unit/attempt state without redefining Task-level timing;
- effect recovery never replays an uncertain mutation without independent Reality closure;
- final completion follows explicit certified obligation mappings;
- wall time, Root/Subagent turn counts, Work Unit duration, critical path and final tail can be measured from operational diagnostics.

Exact token/billing usage is not an acceptance dependency when the provider does not expose it.

## Continuation rule

Continue on `v0.9.2` and inspect the current code/evidence before acting. Do not restore a removed mechanism merely because an old test, document or historical trace names it. A residual reference must either be compatibility-only or be deleted/rewritten to the current owner skeleton.

Before a release-ready claim, require current exact-head Test/CI proof plus representative real Runtime acceptance. Real Git / Runtime / Reality evidence always outranks this checkpoint.
