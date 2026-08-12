# v0.8.4 Release Verification

Status: VERIFIED IN LOCAL TEST ENVIRONMENT — WINDOWS OA PENDING

v0.8.4 is a subtraction release. It reduces durable analysis cognition to Evidence, Claim(Fact) and Gap; keeps Recommendation/Steps as current projection; separates requirement truth from implementation truth; and bounds automatic reasoning to TaskBoard-owned `low/medium/high` bands.

## Logic audit

Reviewed through the project diagnostic chain:

`Contract → Owner → Runtime Enforcement → Context Exposure → Test / Eval`

### Contract / Owner

- Subagent owns one bounded Work Unit and returns source-traced Evidence plus local Findings/Discovery/Blocker.
- Root owns Task-level judgment and proposes Candidate Deltas.
- Validator certifies Root Candidate Deltas; it does not execute/search Work Units.
- Task Core is the only owner that mutates durable Current Certified State.
- Durable cognition is `Evidence + Claim(Fact) + Gap`. Recommendation/Steps are not durable truth.
- Scheduler/Root own orchestration; automatic Codex reasoning routing therefore never selects an effort whose semantics introduce another automatic delegation owner.

### Runtime

- DIRECT requirement Evidence may certify what a requirement says without pretending implementation hops exist.
- Cross-system implementation Claims still require explicit implementation/hop Evidence.
- Search locates Evidence; DIRECT project facts land on actual project-file/source anchors.
- Root may cite a Work Unit Evidence id without copying the source payload.
- Same-turn evidence-backed Gap resolution is considered before a `complete` control decision is certified; the actual mutation still occurs only in Task Core.
- Recommendation/Steps are discarded from normalized durable state and recomputed for current publication.
- Final summary and final body derive from one final state projection.
- Reasoning auto-routing uses semantic minimum-sufficient `low/medium/high`; `xhigh`, `max`, `ultra` are never auto-selected; cross-model routing remains disabled.
- Codex runtime diagnostics correlate app-server generation/PID, capability discovery/cache state, monitored RPCs, turn route/duration/tool calls and model-refresh errors.

### Eval gates

- Requirement facts remain confirmed when the attachment directly states them.
- An implementation Claim cannot borrow proof from requirement Evidence.
- Advice does not accumulate across Turns as learned truth.
- Current six-level Codex reasoning catalogs cannot silently escalate TaskBoard into `xhigh/max/ultra`.
- Release identity is consistent across package, executable constant and current release docs.
- Human Gateway completion may close the blocking Gap in the same evidence-backed candidate without an infinite Root handoff loop.

## Automated verification

Run:

```text
npm run verify
```

Current local result:

```text
Syntax check passed.
224 tests
224 pass
0 fail
```

Fresh-unpack verification result:

```text
package version: 0.8.4
APP_VERSION: 0.8.4
224 tests
224 pass
0 fail
```

The real Windows + Codex + OA run remains the external release gate.

## Verification boundary

Local verification proves deterministic state transitions, contracts, routing bounds, persistence and fake-app-server integration. It does not claim a fresh real Windows + Codex + OA accuracy/runtime pass. The Windows release gate must additionally inspect the new `[codex-runtime]` diagnostics and confirm actual reasoning, model-refresh correlation, bounded Work Units and stable OA fact classification.