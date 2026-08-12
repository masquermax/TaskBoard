# v0.7.0 Release Verification

## Release gates

v0.7.0 is released only after all three gates pass:

1. **Architecture / logic review — PASS.** Scheduler remains lifecycle authority; Root owns analysis/organization; Subagent owns concrete execution; Validator is a peer system certification authority. Validator does not become a serialized global Agent or consume the per-Root Subagent ceiling. Worker certification is local, Root synthesis/final results use the same gate, rejected content is reworked once then preserved as a safe subset + explicit Gap, and History is authorized only from certified Root-level valuable state.
2. **Whole-code review — PASS.** Active Governance documents, runtime authority boundaries, source trace, semantic proof, resource continuity, UI ownership labels/timestamps, persistence parity, and stale/removed governance APIs were reviewed. No active whole-result grounding pass remains.
3. **Executable verification — PASS.** Syntax, 200 automated tests, coverage, independent module imports, JSON/SQLite fresh-unpack smoke tests, Windows launcher text constraints, and final fresh-ZIP verification passed.

## Architecture / logic review

The active execution path is:

```text
Subagent Result -> Validator -> Root
Root Result / Checkpoint / Final -> Validator -> Task Core -> History / Final
```

Key verified invariants:

- Validator is a **system role parallel to Root**, not one resident serialized Agent.
- Deterministic certification is preferred; a model turn is used only for a narrow high-risk semantic proof obligation.
- Validator semantic work does not count against `任务最大线程数`; independent validation may proceed concurrently.
- A Validator capacity shortage preserves the already-produced Root/Subagent candidate. Recovery resumes certification rather than rerunning completed investigation.
- If one targeted rework is required and capacity is temporarily unavailable, the Validator feedback is preserved; the retry does not restart attempt one.
- Subagent certification does not directly create History. It only decides whether the result is safe input for Root.
- Root results that still cannot be fully certified after one targeted rework retain the certifiable subset and convert the unresolved part into an explicit Gap/待确认 rather than disappearing.
- Validator decides whether a certified Root boundary has durable future value; Task Core performs the atomic persistence. History is visible only after persistence succeeds.
- Current Progress is derived from live Work Runtime and can show `Root Agent`, `Subagent`, `Validator`, or `未分配` without exposing raw shell activity.
- Work-unit validation is local and does not block unrelated Subagents.
- Task/worker resource limits retain the resource-backed, non-preemptive natural-convergence model.

## Evidence certification review

DIRECT Evidence must keep a traceable original-source address. v0.7.0 verifies:

- project-file evidence resolves only inside the authorized Project Scope;
- attachment-text evidence resolves only to the Task's actual attachment;
- HUMAN evidence resolves to Task instruction / resolved Human Gateway material;
- REFERENCE evidence resolves to immutable referenced Results;
- a supplied line-range locator must contain the cited observation; the same text elsewhere in a file is not enough;
- semantic Validator candidates receive **system-resolved source path/context**, not Agent-authored `basis` prose as proof;
- only cited visual attachments are supplied to a Validator semantic turn;
- project-search/runtime prose is not accepted as DIRECT truth until TaskBoard owns a replayable raw record.

Source-near direct facts remain model-free. Claims that rewrite source meaning, join evidence, depend on visual semantics, or cross system boundaries receive a narrow semantic proof check. The removed v0.6.0 whole-result grounding pass remains removed.

## Regression coverage

The automated suite specifically covers:

- v0.6.0 accuracy/performance regression removal;
- attachment requirement facts are not downgraded by a post-hoc partial-evidence reviewer;
- no second whole-result grounding model turn;
- Validator peer certification for Worker and Root results;
- Root semantic overreach -> one targeted rework -> supported + explicit Gap on second failure;
- traceable source line/address enforcement;
- cited-only source context/visual input for semantic Validator;
- Validator resource wait/resume without rerunning Root/Subagent;
- Validator does not consume per-Root Subagent slots;
- sibling Subagents continue while another Work Unit is being certified;
- real Current Progress owner labels;
- Validator-certified Root checkpoints can persist History before final completion;
- completed-list cards show both `创建` time and completed-phase time;
- task concurrency/per-Root Subagent limits and natural convergence;
- Task Core JSON/SQLite persistence parity and atomic History + stage-result commit;
- Windows CDP/blob surface contract and VBS launcher constraints.

## Automated verification

```text
npm run verify
Syntax check: PASS
Tests: 200 / 200 PASS
Failures: 0
Skipped: 0
```

Coverage (`node --experimental-test-coverage --test`):

```text
Lines:      95.20%
Branches:   76.89%
Functions:  89.10%
```

Production source module import audit:

```text
47 / 47 non-entry/non-browser src modules imported independently: PASS
```

Production/script JavaScript inventory:

```text
57 JS/MJS files under src/ + scripts/
Syntax: PASS
```

Windows launcher text contract:

```text
Create-Desktop-Shortcut.vbs  ASCII + CRLF PASS
Stop-TaskBoard.vbs           ASCII + CRLF PASS
TaskBoard-in-Codex.vbs       ASCII + CRLF PASS
TaskBoard.vbs                ASCII + CRLF PASS
```

## Fresh-package verification

The final ZIP was extracted into a clean directory and verified again:

```text
npm run verify -> 200 / 200 PASS
```

Fresh-unpack service/API smoke was run with both JSON and SQLite persistence:

- `/api/live` reports TaskBoard `0.7.0`;
- `/api/health` responds successfully;
- default settings are `taskConcurrency=2`, `taskMaxThreads=3`;
- settings updates persist across process restart;
- project creation and Task/project association succeed;
- Task Core History commit persists History and `last_stage_result` together;
- safe local shutdown succeeds.

The release package contains no test database/settings/log/runtime residue; `data/` contains only the intended `.gitkeep` placeholders.

## Environment limitation

This verification environment is Linux. Windows host behavior is covered by static/contracts/mocks and by the previously proven CDP/blob architecture, but **this document does not claim a real Windows Codex Desktop v0.7.0 run**. A user-side Windows OA regression remains the authoritative check for real Codex timing, actual delegation/Validator visibility, and whether Root produces useful intermediate certified boundaries early enough for History to appear during a long task.
