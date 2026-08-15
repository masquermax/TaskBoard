# Current State

Status: RECOMPOSITION CANDIDATE
Release: v0.9.1

The executable/package identity remains v0.9.1 until the recomposed tree is independently GREEN. This file describes the candidate semantics, not a completed v0.9.2 release claim.

## Current truths

- Runtime vocabulary is **Project / Root / Subagent / Validator / Executor**; legacy names survive only at explicit compatibility boundaries.
- Scheduler uniquely owns Task lifecycle/admission. Root owns Task reasoning/planning. Subagent executes one bounded Work Unit. Validator certifies Root Candidate Deltas and owns History semantic-value decisions. Task Core owns durable facts/atomic persistence. Executor owns operations, not business truth.
- Task-specific Project Authority is derived only by `GovernanceCompiler` into `AuthorizedGrant`; Work Unit requests, `taskMode`, role prose, UI state and Executor defaults cannot create write authority.
- Goal Satisfaction is derived by `CompletionEvaluator`; execution occurrence, receipts and projections cannot independently create Completion truth.
- Blocking Gaps constrain only the real dependency radius of the unresolved fact. They do not globally revoke independent governed evidence acquisition.
- Analysis cognition advances through certified `Evidence + Claim + Gap`. Recommendations/Steps are recomputed projections.
- Root/Subagent/Validator contexts are allow-list constructed. Root does not receive Project Scope filesystem paths or network capability merely because those inputs exist.
- Persistence has one current implementation: JSON. Legacy runtime/config names are accepted only at explicit migration/error-compatibility boundaries.
- Concrete Skill content remains outside core; core exposes only the selected-method library boundary.
- Current Progress is runtime projection, not durable History.
- Model routing consumes provider-described capability when available and otherwise falls back to the configured/default Executor model.
- Codex connection configuration is extension-local: the user chooses account/custom settings; the Codex extension validates/persists/projects them into its own child app-server. Task Core does not own provider/authentication semantics.

## Explicit current absences

- Formal Project Knowledge subsystem.
- Replayable Project Search evidence record.
- Generic independent proof system for arbitrary execution side effects.
- Root-owned first-class Work Unit execution.

## Release promotion rule

The candidate may become v0.9.2 only after:

1. cross-platform full verification passes;
2. fresh-unpack verification passes;
3. release identity is changed atomically across package/app/release documents;
4. no legacy v0.9.2 Runtime semantic is reintroduced merely to preserve old branch history;
5. current-tree slimming removes obsolete process scaffolding without deleting regression proof that protects canonical Owner boundaries.
