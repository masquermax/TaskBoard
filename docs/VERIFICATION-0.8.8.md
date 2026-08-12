# v0.8.8 Release Verification

Status: VERIFIED IN LOCAL TEST ENVIRONMENT — WINDOWS OA PENDING

v0.8.8 is a narrow ownership correction found by rerunning the real OA scope-conflict scenario on v0.8.7. The user answered the same Gateway more than once—including an explicit option selecting the attachment/EAM scope—yet the same question appeared again. The old state-only Root loop from v0.8.6 did not reappear; instead, the resolved Human trigger reached Root but Root could omit the `gapResolutions[]` candidate. Validator can certify only a candidate that exists, so the certified blocking Gap remained open and Runtime legally requested it again.

## Root cause and ownership correction

- **Gateway resolution is system-owned input** — Scheduler/Repository already know the exact resolved Gateway, its answer and `targetGapId`. Root is no longer responsible for preserving that relation.
- **Automatic Human Evidence** — Runtime synthesizes one system-owned DIRECT Human Evidence record for each resolved Gateway trigger even when Root emits no Human `evidence[]`.
- **Automatic bound-Gap proof candidate** — if the Gateway targets a currently open Gap, Runtime submits that exact Gap for certification even when Root omits `gapResolutions[]`.
- **Validator remains semantic owner** — automatic proposal is not automatic closure. Validator still checks whether the exact answer semantically resolves the exact certified question. An ambiguous answer may therefore cause one more precise Gateway.
- **No cross-Gap reuse** — deterministic provenance rejects a Gateway answer used to close a different Gap before any semantic-model call.
- **Bounded control repair** — after certification changes the state, Root may receive the existing one bounded control handoff; a closed Gap cannot reopen the same Gateway without new certified cause.
- **Lease-boundary wakeup is not an event timeout** — fresh-unpack stress exposed a millisecond-edge race where the intentional short wait used to wake the Worker lease control loop could be misclassified as `Timed out waiting for Codex event`. Runtime now distinguishes a lease wakeup timer from a real Codex event/connection timeout; real non-timeout errors are no longer swallowed at the boundary.

## Exact regression reproduced

The regression suite contains the real interaction shape rather than only a one-step unit test:

1. existing blocking `G-SCOPE`;
2. first Human answer: `根据OA现状继续分析` — Validator may judge this ambiguous, leaving the Gap open and allowing one more precise Gateway;
3. second Human answer: explicit first option selecting the attachment/EAM scope;
4. Root deliberately emits no Human Evidence and no `gapResolutions[]`;
5. Runtime must still submit the bound proof, Validator supports it, Task Core closes `G-SCOPE`;
6. the same Gateway cannot be emitted a third time.

A separate regression proves that a Gateway bound to `G-A` cannot close `G-B`, and the semantic model is not called for that ownership mismatch.

## Observability

New task-runtime diagnostics make this causal chain inspectable without exposing answer content:

- `human-gateway-created`: task id, Gateway id, target Gap id, option count;
- `human-gateway-resolved`: task id, Gateway id, target Gap id, answer byte count;
- `human-gap-proof-result`: task id, Gateway id, target Gap id, whether proof was attempted, whether the Gap closed, and whether it remains open.

No Human answer text is written to runtime diagnostics.

## Explicit non-claims

- v0.8.8 does not add a maximum “ask N times” counter. Repetition is prevented by making a valid Human decision produce the legal state transition; genuinely ambiguous answers may still require clarification.
- v0.8.8 does not claim to eliminate Codex internal `models_manager` refresh latency.
- v0.8.8 does not invent a global safe Codex Turn ceiling.
- The separate broad-search/large-output efficiency behavior seen in the v0.8.7 run remains a distinct Work Unit execution-strategy topic; it is not treated as the cause of this Gateway loop.
- The initial fresh-unpack stress run exposed the lease-timer race above (258/259); after correcting Runtime rather than loosening the test, the lease test and full release verification must remain repeatably green.

## Automated verification

Before version freeze, the working tree completed:

```text
npm run verify
Syntax check passed.
259 tests
259 pass
0 fail
```

Release identity and a fresh-unpack verification are mandatory after the v0.8.8 version/doc freeze.

## External gate

The Windows OA rerun should confirm the exact causal sequence through the new diagnostics: a resolved explicit choice must produce `human-gateway-resolved`, then `human-gap-proof-result` with `resolved=true`, and no third `human-gateway-created` for the same still-closed Gap.
