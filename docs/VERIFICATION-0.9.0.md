# v0.9.0 Release Verification

Status: RELEASE CANDIDATE — LOCAL VERIFIED, WINDOWS OA PENDING

## Goal

Simplify TaskBoard so one concept has one current name, one capability has one owner, and one function has one current runtime entry. Compatibility may survive only at migration/load or external-error boundaries; role limits must be enforced by Runtime/Context surfaces rather than negative Prompt instructions.

## Verified simplification

- Project terminology is canonical across current UI/API/runtime; `UNREGISTERED` is the current non-listed-project filter state.
- Root / Subagent / Validator are the only current Agent role identities; Lead/Worker runtime aliases and duplicate executor adapter naming are removed.
- Runtime snapshots use canonical `actor.owner`; Work Units use canonical `owner`; `WAITING_RESOURCE` is the current resource-wait reason.
- Work Units explicitly declare `projectAccess`, `networkAccess` and `inputRefs`; omitted capabilities fail closed.
- Root receives no Project filesystem path/local attachment handle/network capability from TaskBoard; Subagent Task context is allow-list constructed from its declared Work Unit inputs.
- Subagent output is runtime allow-listed. Root cannot self-author Project/Attachment Evidence; those sources enter Root certification through completed Subagent evidence.
- Analysis Root Candidates require ValidatorRuntime and cannot use a missing-Validator pass-through.
- RootRuntime has one ValidatorRuntime dependency; CapabilityProvider has one discovery surface; ADR is not loaded into ordinary runtime role context.
- UI shows Work Unit project/network capability and projects progress from canonical actor ownership.
- Static architecture regression tests reject removed current-domain entries outside explicit migration/external compatibility files.

## Compatibility boundaries intentionally retained

- Runtime settings migration accepts historical `taskMaxThreads` / `workerConcurrency` and normalizes to `taskMaxSubagents`; current settings update API rejects the legacy fields.
- Repository/database migration normalizes historical `RESOURCE_WAIT`, `root`, `ownerType` and `ownerLabel` into current state.
- Retry classification recognizes external error wording containing `worker`; this is external-text compatibility, not a TaskBoard role identity.

## Verification gates

Release verification requires:

1. syntax check;
2. complete automated test suite;
3. static current-domain duplicate/removed-entry audit;
4. package integrity and release-identity check;
5. fresh-unpack verification from the produced ZIP.

The final numerical results and ZIP SHA-256 are recorded by the release handoff after the frozen package is built. Windows OA remains the external acceptance gate.
