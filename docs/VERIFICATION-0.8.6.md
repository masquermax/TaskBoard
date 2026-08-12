# v0.8.6 Release Verification

Status: VERIFIED IN LOCAL TEST ENVIRONMENT — WINDOWS OA PENDING

v0.8.6 is a small coherence release on top of v0.8.5. It does not add a scheduler, resource manager, concurrency setting, or model-selection layer. It makes the existing model-refresh outcome visible from one runtime-owned state and explicitly preserves Scheduler as the admission/resource Owner while Executor supplies execution facts.

## Contract / Owner audit

`Contract → Owner → Runtime Enforcement → Context Exposure → Test / Eval`

- Capability Provider owns read-only Codex capability discovery and refresh. Root/Worker do not trigger catalog refresh as part of their work.
- Startup `config/read` may establish the configured model without waiting for `model/list`.
- Full model-catalog refresh is enhancement work: one startup background attempt plus explicit manual refresh from the AI information area.
- Refresh is single-flight and atomic. Failure preserves the model/catalog record present before refresh. If no model record exists, the state remains explicit Executor Default fallback. Refresh state is explicit: success, startup failure, manual failure, or refreshing.
- ModelRouter does not rank model ids. A provider-compatible configured model is passed explicitly; reasoning override requires matching catalog metadata and is limited to `low/medium/high`.
- `WAITING_RESOURCE` means execution capacity was not obtained. `RETRY_WAIT` means an execution failed and is waiting for its next attempt. Scheduler owns the admission/resource transition; Executor only reports execution facts such as `activeTurnCount`.
- Executor owns execution facts. Real Codex turns emit started/failed/completed/released diagnostics with global `activeTurnCount`.
- Retry runtime owns recovery timing and uses jitter to avoid synchronized re-entry after shared transport failure.
- Executor owns a small cached environment capability snapshot supplied to Workers; known-missing tools are not repeatedly probed by every Work Unit.

## Eval gates

- Startup capability initialization does not call `model/list` on its blocking path.
- Repeated lightweight initialization does not cause repeated failed startup catalog refreshes.
- Manual refresh success replaces the model catalog; manual refresh failure keeps the prior model/catalog atomically.
- Config-only known model is passed explicitly to routing even when catalog metadata is unavailable.
- `xhigh`, `max`, `ultra` remain outside automatic reasoning routing.
- Transport failure becomes `RETRY_WAIT`, remains distinguishable after activity-memory loss/restart reconstruction, and does not masquerade as resource shortage.
- Capacity shortage remains `WAITING_RESOURCE` and consumes zero failure attempts.
- Turn accounting returns `activeTurnCount` to zero on success, failure, interruption, app-server exit and execution-start callback failure.
- Environment probing is cached once per Executor instance.
- Release identity must match package, executable version constant and current release docs.

## Automated verification

Pre-release working-tree verification:

```text
npm run verify
Syntax check passed.
238 tests
238 pass
0 fail
```

Fresh-unpack verification is performed after packaging and must reproduce the same result before delivery.

## External gate

Local verification does not prove the real Windows transport is fixed or establish a safe global Codex Turn ceiling. The next Windows OA run must inspect:

- startup `config/read` latency and background/manual `model/list` behavior;
- whether task turns carry an explicit configured model when available;
- `turn-started / failed / completed / released` and peak `activeTurnCount` around any transport fault;
- `RETRY_WAIT` jittered re-entry rather than synchronized retry waves;
- whether Workers stop repeating known-unavailable environment probes;
- OA requirement/implementation fact classification and total runtime/tool-call volume.

## v0.8.6 focused additions

- AI refresh button state comes from Capability Provider runtime state, not browser-local memory.
- Green = latest refresh succeeded; gray = startup refresh failed; yellow = manual refresh failed; spinning = refresh in progress.
- A manual request that joins an already-running startup refresh owns the visible result, so a user-triggered failure cannot incorrectly appear as startup-gray.
- Failed refresh never clears the prior model record. With no prior/current model identity, UI remains `Executor 默认（兜底）`.
- Documentation and regression tests reject a separate `Executor Resource Manager`; future evidence-based global admission ceilings, if any, remain Scheduler policy over Executor observations.
