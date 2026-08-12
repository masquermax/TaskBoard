# v0.8.2 Release Verification

## Release decision

v0.8.2 is a focused runtime/UI correction on top of v0.8.1. It does not add a new governance layer, Experience runtime, Skill distillation runtime or durable process-history subsystem.

Release gates:

1. **Logic / architecture review — PASS.** The fix was checked through `Contract → Owner → Runtime Enforcement → Context Exposure → Test/Eval`.
2. **Known-issue correction — PASS.** Completed Work Units no longer disappear merely because a Stage is cleared; Root/Validator activity is no longer hidden whenever Work Units exist; WAITING_HUMAN preserves the last runtime view; user-facing durable knowledge is labeled `已确认进展` instead of implying all passed runtime nodes are History.
3. **Boundary preservation — PASS.** Completed execution work remains runtime state. It does not enter Current Certified State or Task History merely because a Subagent finished.
4. **Executable verification — PASS.** Syntax and 215 automated tests pass. Coverage and release-data cleanliness pass.
5. **Environment boundary — LIMITED.** Linux verification does not claim a real Windows Codex Desktop OA end-to-end run.

## Logic audit

### Contract

The existing distinction remains unchanged:

```text
Current Progress = how the open Task is progressing now
Confirmed Progress / History = future-useful certified Task knowledge
```

No `ProcessHistory`, `ActivityHistory` or new database table was introduced.

### Owner

- RootRuntime owns the in-memory execution snapshot for the active Task.
- Scheduler owns lifecycle transitions and temporarily persists the last runtime snapshot while the Task is `WAITING_HUMAN`.
- Validator still decides certified knowledge/History value.
- Task Core still owns durable certified-state/History persistence.
- UI only projects these states; it does not create knowledge.

### Runtime Enforcement

- `RootRuntime` keeps `completedWorkUnits` as runtime-only execution visibility while the Task remains open.
- Clearing `currentStage` no longer erases already-completed work from the runtime snapshot.
- `WAITING_HUMAN` stores the last runtime snapshot in `executionState`; answering the Human Gateway clears that temporary snapshot before execution resumes.
- Current Root/Validator activity and Work Units can coexist in one UI projection.
- Completed Work Units never enter `analysisState` or `task_progress_history` through this path.

### Context Exposure

The UI now separates:

```text
正在判断        Root / Validator current activity
当前工作        active/waiting/suspended Work Units
已完成工作      completed Work Units from the open Task
已确认进展      certified durable knowledge projection
```

The internal name `History` remains valid in persistence/governance code; only the user-facing wording changed to remove the false implication that every passed Turn/Work Unit is a History node.

### Test / Eval

New regression coverage verifies:

- a completed Work Unit survives Stage clearing in the runtime snapshot;
- that runtime-only work does not mutate Current Certified State;
- WAITING_HUMAN persists the last runtime view even after in-memory activity cache loss;
- the temporary waiting snapshot is cleared when the user replies;
- completed process work does not become History;
- Root/Validator activity is visible beside Work Units;
- completed and active Work Units are projected into separate UI groups.

## Automated verification

```text
npm run verify
Syntax check passed.
215 tests
215 pass
0 fail
0 skipped
```

## Coverage

`node --test --experimental-test-coverage`:

```text
All files
Line coverage:     95.62%
Branch coverage:   76.22%
Function coverage: 88.47%
```

## Release cleanliness

- Product Constitution remains exactly five principles.
- Core still ships no concrete distilled Skill asset; only the Skill-library boundary remains.
- No active source TODO/FIXME/HACK/XXX markers were found.
- Release `data/` contains only `attachments/.gitkeep` and `runtime/.gitkeep`.
- No new durable process-history table or schema was added.

## Explicitly not claimed

- Cross-Task Experience → Skill distillation in Core.
- Formal Project Knowledge subsystem.
- Real Windows Codex Desktop OA end-to-end verification in this Linux environment.
