# Verification v0.9.2

Status: HISTORICAL SHA VERIFIED

Evidence scope: the exact named Git trees below only. This record does not certify descendant commits, branch names that later moved, provider behavior that was not exercised, or a new defect class merely because the generic suite stayed green. Every descendant requires its own exact-tree gate plus a class-specific acceptance witness for the behavior it claims.

## Verified recomposed tree

v0.9.2 was rebuilt from the verified Gate B / Provider Connection semantic tree rather than by merging legacy v0.9.2 Runtime history.

The release-identity tree `d381395e22d515a3b908adb1ab8c27116a6c8f1d` passed GitHub Actions run `31905538674`:

- Ubuntu full `npm run verify`: PASS.
- Windows full `npm run verify`: PASS.
- Fresh tracked-files unpack + `npm run verify`: PASS.
- Release identity consistency: PASS.

The preceding recomposed semantic tree `acc1b69810fee6ce558bdfddd4ab2856ceb9debe` independently passed the same three proof layers in run `31905306064` before the v0.9.2 identity promotion.

## What is preserved

- singular `GovernanceCompiler` Project Authority derivation through `AuthorizedGrant`;
- singular `CompletionEvaluator` Goal Satisfaction derivation;
- Validator ownership of Candidate certification / History semantic-value decision with Task Core durable commit;
- blocking Gap constrained to real dependency radius;
- extension-local Codex connection configuration on the current Gate B architecture;
- existing Runtime/Owner regression tests that prevent already-fixed drift from recurring.

## What changed in recomposition

- restored old v0.9.2 UI overflow/spacing safety without restoring legacy Runtime ownership;
- removed branch-specific goal-regression CI residue and replaced it with generic cross-platform/fresh-unpack verification;
- slimmed README and current integration documentation;
- aligned Codex connection documentation/Capability Map with the extension-owned Runtime implementation;
- promoted package/application/document identity to v0.9.2 only after the recomposed semantic tree was already GREEN.

A synthetic final-tree audit against the previous main confirmed no net changes to the established core Runtime paths; the remaining tree delta is release identity, documentation/CI slimming, Capability Map alignment and UI layout safety/proof.

## Slimming rule

Slimming removes obsolete or duplicate current-tree responsibility, not proof merely because it originated from an old defect. Regression tests that protect canonical Owner boundaries stay. Temporary migration scripts, branch-specific CI, superseded Runtime paths and duplicated prose do not stay once their durable semantic consequence has a proper Owner and proof surface.

This verification-record update is documentation-only and must pass the same generic Verify workflow before the commit is promoted to `main`.
