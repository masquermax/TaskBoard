# Verification v0.9.2

Status: HISTORICAL SHA VERIFIED
Release gate: CI_VERIFIED_REAL_RUNTIME_PENDING

This record separates three different proof classes:

1. exact named Git-tree CI proof;
2. historical recomposition/release-identity proof;
3. representative real Runtime acceptance.

Passing one class does not imply another.

## Current pre-closure CI proof

The pre-closure head `bea4c0e4f787967a379a3da266cf703d69bd68c1` passed GitHub Actions run `32447470428`:

- Ubuntu connection acceptance: PASS;
- Windows connection acceptance: PASS;
- Ubuntu full `npm run verify`: PASS;
- Windows full `npm run verify`: PASS;
- fresh tracked-files unpack + `npm run verify`: PASS.

This proves that exact named tree only. Documentation/acceptance descendants created after it require a new exact-head Verify run before a release-ready claim.

## Current owner truth protected by verification

The current Runtime owner chain is:

```text
Scheduler → Root → bounded Work Unit / Subagent → Root → deterministic Validator → Certified State / Task Core
```

The current semantic boundaries are:

- Root is the sole Task-level reasoning/planning/progression/completion-intent owner;
- Subagent executes one bounded Work Unit and returns execution output/source-near Evidence/blocker only;
- Validator is a deterministic source/provenance ledger checker and has no model turn, semantic proof, semantic repair or History-value authority;
- Task Core owns durable facts/atomic persistence;
- `GovernanceCompiler` produces the executable `AuthorizedGrant` from the governed machine/task/work boundary;
- `CompletionEvaluator` checks Root-owned certified `claim.obligationRefs[]` deterministically;
- fail-closed effect recovery preserves unresolved mutation Reality without inventing Task meaning;
- removed second-owner/compensation mechanisms stay absent from active source.

In particular, **Validator does not own a semantic History-value decision in the current architecture**. Any older verification wording that said so was historical and is superseded by the current code, `CURRENT_STATE.md`, `ARCHITECTURE.md` and `SPECIFICATION.md`.

## What CI does not prove

The generic suite and connection-acceptance suite do not by themselves prove representative real Runtime convergence against an actually usable Codex Runtime.

They do not authorize a claim that:

- a real Root/Subagent owner chain has converged correctly on representative Tasks;
- a no-progress Task will avoid repeated semantically equivalent investigation in real execution;
- retry behavior has been observed on a real Runtime failure;
- final completion has been observed end-to-end from real Evidence through explicit obligation mapping;
- provider behavior not exercised by the test environment is known.

Those claims require `docs/RUNTIME_ACCEPTANCE.md` evidence.

## Historical recomposed-tree proof

v0.9.2 was originally recomposed from the verified Gate B / Provider Connection semantic tree rather than by merging legacy v0.9.2 Runtime history.

The historical release-identity tree `d381395e22d515a3b908adb1ab8c27116a6c8f1d` passed GitHub Actions run `31905538674`:

- Ubuntu full `npm run verify`: PASS;
- Windows full `npm run verify`: PASS;
- fresh tracked-files unpack + `npm run verify`: PASS;
- release identity consistency: PASS.

The preceding recomposed semantic tree `acc1b69810fee6ce558bdfddd4ab2856ceb9debe` independently passed the same three proof layers in run `31905306064` before the v0.9.2 identity promotion.

These historical trees remain useful ancestry evidence but do not certify later descendants.

## Slimming rule

Slimming removes obsolete or duplicate current-tree responsibility, not proof merely because it originated from an old defect. Regression tests that protect canonical Owner boundaries stay. Temporary migration scripts, branch-specific CI, superseded Runtime paths and duplicated prose do not stay once their durable semantic consequence has a proper Owner and proof surface.

Old experimental branches must not be merged merely to recover an old mechanism. Their defect class is re-evaluated against the current architecture; current-equivalent safety is retained as regression/acceptance evidence where needed.

## Release-ready gate

PR #24 may leave draft/release-gate status only after the same current head has:

- exact-head Verify GREEN;
- representative real Runtime scenarios A-D in `docs/RUNTIME_ACCEPTANCE.md` recorded as PASS;
- no acceptance-discovered blocker requiring further code change;
- this verification record updated to that accepted exact head.

Until then the correct release gate is CI verified where applicable, real Runtime pending.
