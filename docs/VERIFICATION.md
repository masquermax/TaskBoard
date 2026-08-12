# Verification v0.9.1

Status: PASS

This is the only current verification record. Historical release reports live in Git history.

## Automated verification

- Syntax check: PASS.
- Full automated test suite: **268 / 268 PASS**, 0 failed, 0 skipped.
- Release identity test: PASS across `package.json`, executable version and current release documents.
- Candidate fresh-unpack gate: **3 consecutive full verify runs PASS**, each 268 / 268 in the release-build environment.
- Windows Node.js 24 verification after correcting the Windows file-URL test path: **3 consecutive full verify runs PASS**, 0 failed. Node.js 24 reports successful test files as aggregated items under process isolation, so the full-run item count is 266 while the VBS launcher file itself contains 3 assertions/tests and passes.

## Structural simplification audit

- Persistence has one current path: JSON. The historical SQLite implementation, migration path and dual-repository parity surface were removed.
- Runtime vocabulary has one current name per core position: Root / Subagent / Validator / Executor. Historical role aliases are not current APIs.
- Project is the single current product term. Legacy system/thread/project aliases are blocked by UI and active-document regression tests.
- Task Core has one atomic Certified Turn/History persistence path; historical fallback write paths were removed.
- Ordinary Runtime loads Constitution plus the owned Capability Contract. ADR is engineering history and has no second Runtime loader.
- Root, Subagent and Validator result surfaces are Runtime allow-lists. Unknown custom Executor fields cannot create new authority by omission from a schema.
- Root may originate only Human/Reference Evidence. Project/Attachment source investigation belongs to bounded Subagent work and remains defensively checked by Validator.
- Work Unit project/network capability is explicit and fail-closed; Subagent Task context is allow-list constructed.
- Active docs were reduced to the current architecture set; superseded ADR bodies, versioned verification reports and superseded rule documents were removed from the release tree and remain available through Git history.

## Dead-code / reachability audit

- Node production import graph: **51 / 51 Node-loaded production modules reachable** from the real service entry points.
- The remaining two production JS modules are browser-loaded UI modules: `index.html → app.js → time.js`; they are not Node import-graph dead code.
- No whole production source file is left unreachable after accounting for the browser UI entry.
- Test coverage after simplification: **96.52% line / 78.08% branch / 90.84% function** overall. Remaining low-covered functions are primarily optional extension/transport error paths rather than an alternate business runtime.

## Compatibility boundary

Legacy persisted names are accepted only at explicit migration/error-compatibility boundaries and corresponding migration tests. They are not current UI/API/Runtime terminology. Removing those migration readers would break upgrade compatibility without simplifying the current authority surface, so they remain isolated rather than being duplicated across current code.

## Archive verification

The final ZIP is built from the frozen Git commit without `.git` or runtime data. Final post-freeze fresh-unpack verification is an external release gate repeated after archive creation and reported in the delivery handoff. The archive SHA-256 is emitted as a sibling `.sha256` artifact; it is not embedded into the archive it hashes.
