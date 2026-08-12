# v0.8.3 Release Verification

Status: VERIFIED IN LOCAL TEST ENVIRONMENT

v0.8.3 is a focused authority-boundary correction after the real v0.8.2 OA regression. It does not add a governance layer, durable process-history subsystem, Experience runtime or Skill-distillation runtime.

## Logic audit

The correction was reviewed through the project diagnostic chain:

`Contract → Owner → Runtime Enforcement → Context Exposure → Test / Eval`

### Contract / Owner

- Subagent owns execution of one bounded Work Unit and produces source-near Evidence + local Findings/Discovery/Blocker.
- Root owns Task-level Claims, Gaps, Recommendations, next-work decisions, completion candidates and synthesis.
- Validator owns certification of Root Candidate Deltas and History-value decisions for certified Root knowledge.
- Concrete Skills remain outside Core; the injected Skill-library port is unchanged.

### Runtime

- Worker schema no longer exposes Task-level `claims`, `gaps` or `recommendations`; it exposes `evidence`, `findings`, `discoveries`, `blocker`, `uncertainty`.
- Worker execution is one bounded model turn. The previous worker-level semantic Validator/rework path is removed.
- Worker output receives deterministic source-trace normalization only, then returns to Root.
- Root Candidate Delta remains the only semantic Task-knowledge candidate passed to Validator.
- Validator model execution uses TaskBoard-managed scratch, not Project Scope, with network disabled.
- A visual embedded in a DOCX/PDF does not launch semantic Validator unless the exact cited pixels are available as an image input; otherwise that visual evidence remains indirect/pending.

### Context

- Subagent receives only Work Unit-selected Task inputs.
- Validator receives only the narrow Root proof obligation and exact resolvable semantic source input; it is not given a project browsing working directory.
- Current Certified State remains Root input and cannot be changed by Subagent output directly.

## Regression tests

The suite explicitly checks that:

- Subagent schema has local Findings and no Task-level Claims/Gaps/Recommendations authority.
- source-traced worker output reaches Root without semantic Validator takeover while sibling work may continue.
- worker execution is one bounded turn; semantic proof is deferred to Root Candidate certification.
- Root-level Validator capacity wait preserves the Root candidate without rerunning completed work.
- semantic Validator is selected only when deterministic tracing marks exact source input `needsSemantic`.
- embedded visual evidence inside a document does not trigger semantic Validator without exact image input.
- Codex Validator is read-only/network-disabled, outside Project Scope, and sees only cited image inputs.
- certified analysis facts and Turn state continue to satisfy the v0.8.1/v0.8.2 persistence, carry-forward, no-forget, revision and UI progress tests.

## Automated verification

Run:

```text
npm run verify
```

Expected release result:

```text
Syntax check passed.
216 tests
216 pass
0 fail
```

## Verification boundary

This verification proves local logic, schemas, runtime flow and automated regression behavior. It does **not** claim that v0.8.3 has already passed a fresh real Windows + Codex Desktop + OA end-to-end accuracy/runtime run. That is the next release gate and should specifically verify:

- attachment-confirmed facts remain confirmed after project investigation;
- code-existence facts are not downgraded merely because target binding remains unknown;
- Subagent Work Units stay bounded and return promptly to Root;
- Validator does not appear as the owner/executor of a Work Unit;
- end-to-end runtime materially improves from the v0.8.2 regression.
