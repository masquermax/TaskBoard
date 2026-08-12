# v0.6.2 UI / Timestamp Verification

Scope is intentionally narrow on top of the v0.6.1 hotfix. No Validator/Knowledge architecture change is included here.

## Changes

- Current Progress keeps semantic work titles and now exposes the real execution role: `Root Agent`, `Subagent`, or `未分配`. A waiting work item is not falsely presented as an existing Subagent.
- Completed-list cards add `创建 · created_at` while preserving the existing completed-phase timestamp.
- No separate Task assignment time is added to list cards. A Task may enter RUNNING multiple times after resource waits/recovery, so “assignment time” is not a unique lifecycle fact. For a currently RUNNING Task, `status_entered_at` already represents the current real execution admission.

## Verification

- `npm run check`: PASS
- `npm test`: 182 / 182 PASS
- UI contract verifies executor-role display and completed-card dual timestamps.
- Scheduler runtime contract verifies a running work item is exposed as `Subagent` while resource-waiting work remains `未分配`.
- Codex blob/CDP injection contract updated only for the v0.6.2 surface generation identifier and remains PASS.

This environment is Linux; it does not replace a real Windows Codex Desktop visual acceptance test.
