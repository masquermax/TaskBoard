# v0.8.7 Release Verification

Status: VERIFIED IN LOCAL TEST ENVIRONMENT — WINDOWS OA PENDING

v0.8.7 was debugged from the real v0.8.6 Windows OA run rather than from an isolated feature request. The observed failure combined a narrow Human answer being expanded into a scope change, a blocking Gap still permitting new investigation, a long Worker with no executable stop boundary, and repeated Root turns over essentially the same certified state. The release changes the legal Runtime transitions that allowed those behaviors; it does not encode OA/EAM-specific wording.

## Contract / Owner / Runtime closures

- **Real Root trigger** — Current Certified State is context, not a trigger. Ordinary Root execution requires Task start, a new Worker result, a resolved Human Gateway, or a technical resume. Validator rework, delegation-plan repair and post-certification control handoff are bounded same-trigger subloops.
- **Human proof boundary** — Human Gateway binds to one currently certified blocking Gap and repeats its certified question. Gateway-derived Human Evidence carries system-owned `gatewayId + targetGapId` provenance. Raw old Gateway text is not replayed into ordinary Root context; Validator rehydrates only the exact historical question/answer needed for a narrow proof obligation.
- **Claim/Gap semantic relation** — proving that a Human said a sentence does not prove every Claim inferred from it. Gateway-derived Claims and Gap resolutions receive narrow semantic proof. “Continue with current information” therefore cannot silently become an unrelated scope change unless the Human answer actually states it.
- **Evidence bounds Gap closure** — a Gap resolution requires current certified DIRECT Evidence. Indirect/degraded evidence cannot delete an unknown from Current Certified State.
- **Blocking means stop investigating** — while any certified blocking Gap exists, Root cannot create another investigative Work Unit. It must establish from certified evidence that the Gap is no longer blocking or request the bound Human Gateway.
- **Finite Work Unit is Runtime-enforced** — a Codex Worker with `stopCondition` gets a technical execution lease. Default soft convergence occurs at 10 minutes (`turn/steer` in the same Turn); default hard boundary occurs at 20 minutes (`turn/interrupt`). The hard boundary is nonretryable for the attempt. These limits prevent unbounded exploration; they are not semantic completion criteria.
- **Work-driven model routing** — Router consumes the actual Work Unit/Task. Provider-described capability metadata—not model ids—selects the minimum-sufficient tier: efficient finite read-only work, balanced ordinary analysis/Validator work, frontier complex/open-ended Root work. Unknown metadata falls back to the configured model. Automatic reasoning stays within `low/medium/high`.
- **Persistence parity** — JSON and SQLite expose the same `pendingGateway.targetGapId` shape and preserve the Gateway binding through migration/restart.

## Explicit non-claims

- v0.8.7 does **not** claim to eliminate Codex's internal `models_manager` refresh. Real v0.8.6 evidence showed that an explicit requested model can still coincide with an approximately five-second `thread/start` stall. TaskBoard keeps its own catalog refresh background/single-flight and now avoids unnecessary Root/thread creation; remaining Codex-internal refresh latency is external to TaskBoard's state machine.
- v0.8.7 does **not** invent a global safe Codex Turn ceiling. `activeTurnCount` remains an Executor observation; Scheduler remains the admission/resource owner and can consume a provider-reported semantic limit if one becomes available.
- The Worker lease does not replace `stopCondition`, evidence certification or task-specific acceptance tests. It is a safety boundary only.

## Regression gates

The suite includes specific counterexamples for:

- indirect Evidence attempting to close a Gap;
- ambiguous/spoofed Human provenance;
- a Human answer reused across later Turns;
- “continue with current information” being expanded into a scope change;
- an incorrect EAM Work Unit being emitted from that scope overreach (Executor call count must remain zero);
- any blocking Gap attempting to delegate more investigation;
- Current Certified State being used as a synthetic Root trigger;
- Human triggers surviving a transport failure until successful certification;
- soft Worker steer / hard Worker interrupt behavior;
- hard execution boundary bypassing automatic retry;
- opaque model ids proving capability-based rather than name-based routing;
- JSON/SQLite Human Gateway shape/migration parity.

## Automated verification

Pre-package working-tree verification:

```text
npm run verify
Syntax check passed.
256 tests
256 pass
0 fail
```

Release identity is also tested across `package.json`, executable version constant and current release docs.

## External gate

Fresh-unpack verification must reproduce the same result before delivery. After delivery, the real Windows OA benchmark should be rerun with the same task/attachment scenario and inspect:

- whether a narrow Human answer remains scoped to its exact Gap;
- whether a blocking Gap prevents unrelated Worker creation;
- Root Turn count and triggerRefs rather than repeated state-only turns;
- Worker elapsed time/tool-call volume and any `turn-steered` / `turn-execution-boundary` events;
- selected model/routeReason by actual Work Unit;
- remaining Codex-internal model-refresh stalls at `thread/start`;
- `activeTurnCount`, transport failures and jittered `RETRY_WAIT` behavior.

Only that Windows rerun can promote the release beyond **LOCAL VERIFIED, WINDOWS OA PENDING**.
