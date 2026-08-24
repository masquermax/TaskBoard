# Current State

Status: RELEASE_ACCEPTANCE
Release lane: `v0.9.2`

This file is a continuation checkpoint, not a second architecture definition. `docs/ARCHITECTURE.md`, `docs/SPECIFICATION.md`, the current code and newly verified Runtime evidence outrank stale wording here.

The Runtime-slimming implementation is now in release acceptance. Do not add another Runtime mechanism merely to make acceptance easier; a failed real run must first identify the smallest existing owner/boundary that is wrong.

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

## Release acceptance gate

The pre-closure head `bea4c0e4f787967a379a3da266cf703d69bd68c1` passed the generic cross-platform/fresh-unpack CI gate, including connection acceptance. This proves the named tree only; descendants require their own exact-head run.

The remaining release blocker is representative real Runtime acceptance. The executable gate is defined in `docs/RUNTIME_ACCEPTANCE.md` and currently requires four representative scenarios:

- normal governed analysis / owner-chain behavior;
- no-progress repeated-investigation convergence;
- smallest-owner retry;
- explicit obligation-mapped completion.

Static/unit/CI proof must not be reported as real Runtime acceptance.

## Legacy branch disposition

The old branches are not alternative current truth:

- `agent/capability-driven-extension-config` — no unique commits relative to current `v0.9.2`; absorbed, eligible for cleanup after release.
- `agent/extension-registry-management` — no unique commits relative to current `v0.9.2`; absorbed, eligible for cleanup after release.
- `agent/recovery-observation-boundary` — old implementation branch; its safety requirement is represented by current D-023 effect recovery. Do not merge the old branch into the current Runtime.
- `agent/root-goal-contribution-witness` — preserves a useful defect class (repeated work that does not advance the governed problem) but its planning-repair implementation conflicts with the current owner skeleton. Preserve the defect class as Runtime acceptance scenario B; do not merge the old implementation.
- `feature/automation-extension-point` — deferred product candidate, not a v0.9.2 release requirement. Re-evaluate against the released Extension contract on a fresh post-v0.9.2 branch rather than merging the stale implementation.

## Continuation rule

Continue on `v0.9.2` and inspect the current code/evidence before acting. Do not restore a removed mechanism merely because an old test, document or historical trace names it. A residual reference must either be compatibility-only or be deleted/rewritten to the current owner skeleton.

Before a release-ready claim, require current exact-head Test/CI proof plus representative real Runtime acceptance. Real Git / Runtime / Reality evidence always outranks this checkpoint.
