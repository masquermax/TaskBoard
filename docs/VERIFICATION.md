# Verification v0.9.1

Status: RECOMPOSITION CANDIDATE — PENDING

This file records the verification status of the current candidate tree. Git history is the archive for prior release reports and migration/debug process.

## Verified inherited baseline

The candidate starts from the current Gate B / Provider Connection semantic tree represented by `main @ e286529c184631077fa9e171f7134b5d491509eb`.

That baseline was verified on Ubuntu and Windows with **355 / 355 PASS** before recomposition.

The baseline already contains the durable owner/boundary corrections that must not regress:

- `GovernanceCompiler` is the single Task-specific Project Authority derivation owner; `taskMode`, role prose, blocking Gap and Executor defaults cannot create write authority.
- `CompletionEvaluator` is the Goal Satisfaction derivation owner; work occurrence, receipts, UI state and local runtime signals do not become Completion truth.
- Validator owns Root Candidate certification and the semantic-value decision for History; Task Core owns durable commit.
- blocking Gaps constrain only their real dependency radius and do not globally revoke separately governed evidence acquisition.
- Codex connection configuration is rebuilt as extension-local configuration rather than legacy v0.9.2 Runtime ownership.

## Candidate recomposition delta

This candidate intentionally changes product-tree structure rather than replaying historical commits:

- replaces the branch-specific `goal-regression.yml` construction residue with one generic cross-platform Verify workflow plus fresh-unpack proof;
- restores the old v0.9.2 UI overflow/spacing safety because it is independent product value;
- keeps current main's newer Completion/UI semantics while adding that layout protection;
- aligns the documented Codex connection Owner with the extension-owned runtime implementation;
- reduces README duplication by pointing detailed semantics to canonical Contract/Architecture documents.

Legacy v0.9.2 runtime behavior that conflicts with the current Owner/Authority model is **not** reintroduced. In particular, execution mode does not grant Project authority, blocking Gap does not mean global investigative freeze, and the old stateful first-Root-turn model-routing heuristic is not restored without new evidence.

## Candidate proof required

Before this tree may replace `main` or claim v0.9.2 release status:

1. syntax check passes;
2. full automated tests pass on Ubuntu and Windows;
3. fresh-unpack verification passes from a tracked-files archive;
4. release identity remains internally consistent;
5. the final v0.9.2 identity change is applied only after the recomposed semantic tree is GREEN.

Until those checks complete, this document does not claim the recomposed candidate is verified.

## Slimming rule

Slimming removes obsolete/duplicate current-tree responsibility, not proof merely because it looks old. Regression tests that protect canonical Owner boundaries remain valuable even when their originating bug is historical. Temporary migration scripts, branch-specific CI, superseded runtime paths and duplicated prose should not remain in the current tree once their durable semantic consequence has a proper owner and proof surface.
