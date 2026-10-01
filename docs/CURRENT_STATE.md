# Current State

Status: RELEASE
Release: v0.9.1

## Current truths

- Runtime roles use one vocabulary: **Root / Subagent / Validator**. **Executor** is the execution component name. Project is the only current project-domain term.
- Scheduler alone owns Task lifecycle/admission. Root owns Task-level judgment/planning. Subagent executes one bounded Work Unit. Validator certifies Root Candidate Deltas. Task Core alone persists durable facts.
- Analysis cognition advances by certified Turn delta: omission cannot erase committed knowledge; revision requires evidence.
- Human Gateway binds exactly one certified blocking Gap; resolved Human input becomes system-owned provenance before semantic sufficiency is checked.
- Work Units explicitly declare `projectAccess`, `networkAccess` and `inputRefs`; omitted legacy/custom capability fields fail closed.
- Subagent context is allow-list constructed. Subagent Result is Runtime allow-listed. Root cannot originate Project/Attachment Evidence and must consume evidence returned by bounded Subagent work.
- Persistence has one current implementation: JSON. Legacy runtime-state/config names are normalized only at explicit migration boundaries.
- Concrete Skill content remains outside core. Core only exposes an injected Skill library boundary.
- Current Progress and durable History are separate: activity is not automatically learned knowledge.
- Model routing uses provider-described capability when available; unknown capability falls back to the configured/default Executor model.

## Known external/runtime limits

- TaskBoard can guarantee which Task inputs and write/network capabilities it grants. It must not claim stronger filesystem-read isolation than the active Executor/runtime can actually enforce on the host OS.
- Project Knowledge, replayable project-search records and generic side-effect proof are not implemented capabilities; see `CAPABILITY_MAP.md`.

## Migration-only names

The following may appear only in migration/error-compatibility code and migration tests: `taskMaxThreads`, `workerConcurrency`, `RESOURCE_WAIT`, `ownerType`, `ownerLabel`, old snapshot `root`, and external error wording `worker`. They must not re-enter current UI/API/Runtime contracts.

## Release gate

A release is complete only when:

1. syntax + full automated tests pass;
2. current docs reference only current files/terms;
3. fresh-unpack verification passes;
4. release identity is consistent across package/app/docs;
5. final ZIP SHA-256 is emitted as a sibling `.sha256` artifact and reported in the handoff; it is not embedded into the ZIP it hashes;
6. local Git is clean and the final commit is preserved; GitHub sync is performed when the configured GitHub App can access the target repository.
