# Current State

Status: RELEASE
Release: v0.9.2

v0.9.2 is the recomposed current product tree: it preserves the verified Gate B semantic/runtime baseline, restores only still-valid product value from the legacy v0.9.2 line, and removes obsolete branch/process residue instead of merging historical Runtime wholesale.

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
- Codex connection configuration is extension-local: the user chooses account/custom settings; the Codex extension validates, persists and projects them into its own child app-server. Task Core does not own provider/authentication semantics.

## Migration-only names

Legacy runtime/config names are accepted only at explicit load, error-compatibility or migration boundaries. They do not define current roles, lifecycle, authority or product vocabulary and must not spread back into ordinary Runtime/docs.

## Explicit current absences

- Formal Project Knowledge subsystem.
- Replayable Project Search evidence record.
- Generic independent proof system for arbitrary execution side effects.
- Root-owned first-class Work Unit execution.

## Verification boundary

The v0.9.2 identity tree at `d381395e22d515a3b908adb1ab8c27116a6c8f1d` passed Ubuntu + Windows full verification and tracked-files fresh-unpack verification in GitHub Actions run `31905538674`.

This release-state update changes documentation only and is itself required to pass the same generic Verify workflow before promotion to `main`. Product Git/Runtime evidence remains authoritative over this document if they ever diverge.
