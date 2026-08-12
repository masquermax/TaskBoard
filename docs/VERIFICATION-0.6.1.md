# v0.6.1 Hotfix Verification

Scope of this hotfix is intentionally narrow. It does not implement the planned peer Validator / real-time Knowledge Commit architecture yet.

## Correctness regression removed

- Removed the v0.6.0 post-hoc Source Grounding model review from the publication path.
- A directly supported attachment requirement is no longer re-evaluated from a filtered/partial Evidence subset and downgraded after Root completion.
- Regression test: `direct attachment requirement is not downgraded by a post-hoc partial-evidence reviewer`.

## Performance regression removed

- Analysis publication no longer starts the extra `verifyAnalysisGrounding` Codex turn.
- Removed the obsolete grounding hook/schema/prompt/runtime state so there is no hidden second semantic-review turn.
- Regression test: `analysis publication does not invoke a second model grounding turn`.

## Verification

`npm run verify` after the hotfix: 181 tests, 181 passed, 0 failed.

This Linux verification does not claim a real Windows Codex Desktop OA end-to-end timing result.
