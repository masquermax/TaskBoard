# v0.8.0 Release Verification

## Release decision

v0.8.0 passes the local release gates for the capability realignment:

1. **Architecture / authority review — PASS.** The implicit role model was made explicit as a Capability Map plus six-field Capability Contracts, and the active Analysis Rules layer was removed. Critical decisions were checked for a single owner, missing owners, and hidden authority in helper modules.
2. **Whole-code review — PASS.** Production/script JavaScript, role schemas, repository mutation call sites, Runtime/Prompt surfaces, Skill loading, persistence, cleanup, resource semantics and UI contracts were reviewed against the active capability architecture.
3. **Executable verification — PASS.** Syntax, 201 automated tests, coverage, independent module imports, JSON/SQLite service smoke tests, analysis-History smoke, Windows launcher text constraints and a final fresh-unpack verification all passed for the packaged artifact.

The build environment is Linux. These checks **do not claim a real Windows Codex Desktop run or a real OA end-to-end result**. Windows launcher/CDP contracts are covered by automated tests; actual Codex Desktop behavior, OA answer quality and wall-clock time still require the user's Windows regression run.

## Architecture realignment

The active authority stack is now:

```text
Constitution       = system first principles
ADR                = engineering decision memory
Capability Map     = global ownership topology
Capability Contract= one position's positive authority boundary
Task / Work Unit   = current concrete work
Skill              = reusable method inside that work boundary
Runtime / API      = mechanical enforcement surface
```

Ordinary Agent runtime context is intentionally role-scoped:

- Root receives Constitution + ROOT Contract + current Task + Skill catalog.
- Subagent receives Constitution + SUBAGENT Contract + one Work Unit + selected Skill.
- Validator receives Constitution + VALIDATOR Contract + the exact certification obligation.
- ADRs remain engineering memory and are not injected wholesale into ordinary Task execution.
- `docs/ANALYSIS_RULES.md` is superseded; AR-001 through AR-004 were rehomed into Constitution, Capability Contracts, Skill and deterministic Runtime invariants.

For the same minimal analysis task, the governance-context portion fell from the v0.7 global context of about **7,738 characters per role** to approximately **2,145 Root / 2,956 Subagent / 1,778 Validator characters** in v0.8. This is not a wall-clock performance claim; it verifies that the architecture no longer depends on a common mega-prompt.

## Capability ownership audit

The active map gives one owner to each critical decision:

- Scheduler — Task lifecycle/admission/status.
- Root — Task reasoning, planning, Work Unit creation/dependencies, Work Unit access request, Skill selection, synthesis and convergence.
- Subagent — execution of one delegated Work Unit.
- Validator — certification and History-value decision.
- Task Core — durable facts and atomic persistence.
- Human Gateway — human-information transport.
- Skill — reusable work method.
- Tool / Executor — concrete operations.
- UI / Surface — presentation and user-intent capture.

The audit explicitly distinguishes implementation modules from authority roles. Repository/Database/TaskService/AttachmentStore, cleanup controller, settings store, retry policy, model router/capability provider and CDP/surface code do not gain new business authority merely because they contain code or state.

Static ownership tests now check that owner-sensitive repository mutations remain on the declared surfaces, including lifecycle/touch/gateway operations in Scheduler, Task/project durable creation in TaskService, maintenance/physical cleanup in CleanupController, and History/stage writes only through the Scheduler → Task Core persistence path.

## Concrete defects found and fixed during the realignment

### 1. Root/Subagent Project Scope capability mismatch

Previous behavior allowed Root execution turns a writable project surface while delegated Subagents were effectively read-only. This contradicted the declared authority model.

v0.8 makes Work Unit access explicit with `projectAccess: read | write`:

- Root control turns keep Project Scope read-only and can write only TaskBoard scratch.
- read Work Units keep Project Scope read-only and get per-Work-Unit scratch.
- write Work Units can mutate declared Project Scope only for an **explicit execution Task**.
- an `auto`/ambiguous Task cannot silently acquire write authority.

### 2. Work Unit whole-stage delivery barrier

Previous Stage execution could wait for all sibling Work Units before Root regained control.

v0.8 delivers each certified Work Unit result to Root immediately while unrelated sibling Work Units continue. Free Subagent slots are filled before Root receives control. Dependent work waits only on its declared dependency.

### 3. Convergence tail barrier

A certified Root completion decision could still wait on obsolete read-only sibling investigation.

v0.8 lets Root's certified Task convergence stop unfinished read-only/no-side-effect investigation. A write-capable Work Unit is never aborted by that convergence shortcut and first reaches a safe boundary. Resource-limit lowering remains non-preemptive and is unaffected by this rule.

### 4. Validator became a second analysis role

v0.7 semantic review selection was too broad and could re-interpret ordinary text/code synthesis, causing extra model turns and false downgrades.

v0.8 restores the boundary:

- deterministic source tracing first;
- ordinary code/text paraphrase, multi-source synthesis and cross-system Root reasoning do not automatically invoke another model;
- a semantic Validator turn exists only when the deterministic source verifier explicitly marks the cited raw source as requiring semantic interpretation, currently mainly visual/pixel evidence;
- the semantic turn sees only the specific proof obligation and cited source, has no Task planning authority, no writable project surface and no network.

### 5. Validator failure became a dead end / whole-result downgrade

v0.8 preserves certifiable content. One targeted correction is allowed; if the remaining part still cannot be certified, the safe subset remains and the unresolved part becomes an explicit Gap. If narrowed content changes the required Task control decision, Validator hands the certified state back to Root instead of choosing completion/delegation/Human Gateway itself.

### 6. History authority remained implicit

Root no longer owns `checkpoint` or `progressCommits` as a control path. Every certified Root-level knowledge boundary is considered by Validator; only future-useful unseen Claims/Gaps produce a commit candidate. Task Core persists it atomically, and in-memory/UI state advances only after persistence succeeds. Subagent certification alone is not History.

A final audit also found and fixed a generic formatting defect where a generated Gap could produce `待确认：待确认：...` in History. History now normalizes the pending prefix exactly once.

### 7. Work method was mixed with orchestration/governance

v0.8 introduces the minimal file-based Skill layer. The first Skill, `source-investigation`, owns only the reusable method for one bounded evidence-acquisition Work Unit: targeted source first, source-near Evidence, explicit requirement qualifiers preserved, out-of-scope discoveries handed to Root, and stop immediately when the question closes or converges to a Gap.

There is no Skill marketplace, installer, Skill persistence or user Skill configuration in this release.

## Explicitly not claimed / not implemented

The audit intentionally keeps these boundaries visible instead of filling them with implicit behavior:

- **Project Knowledge subsystem:** not implemented. Project Scope, attachments, referenced completed Results and Human Gateway answers are Task inputs, not a certified reusable project truth store.
- **Generic execution side-effect proof:** not implemented as a first-class certification contract. Execution safety relies on explicit Work Unit write capability, real tool/test results, retry/side-effect rules and the execution adapter; non-analysis Validator pass-through must not be described as universal external correctness proof.
- **Root-owned first-class Work Unit execution:** not implemented. Root may do only local Task-level inspection needed for planning/synthesis; an independent evidence-acquisition or mutation objective is a delegated Work Unit.
- **Replayable Project Search evidence record:** not implemented. Agent-authored search/runtime prose cannot remain DIRECT Evidence unless TaskBoard owns a replayable original record.

## Whole-code audit

Final source inventory:

- `src/`: **52 JavaScript files**.
- `scripts/`: **7 JavaScript/MJS files**.
- Production/script total: **59 files / 6,894 lines**.
- Independent non-entry/non-browser module imports: **49 / 49 PASS**.
- Syntax check: **PASS**.
- Active Analysis Rules runtime layer: **absent**.
- Root schema `checkpoint`: **absent**.
- Root/Worker schema `progressCommits`: **absent**.
- Unfinished implementation-marker audit in active source/docs: **none**.

Historical ADR and old release verification files are retained as decision/release evidence; superseded behavior in those historical sections is not runtime authority.

## Automated tests

Final source verification before packaging:

```text
npm run verify
Syntax check passed.
201 tests
201 pass
0 fail
0 skipped
```

Important v0.8 coverage includes:

- all ten active Capability Contracts parse with all six required fields;
- Capability Map has explicit single owners and does not pretend Project Knowledge exists;
- ordinary runtime context has no Analysis Rules layer and does not inject ADRs wholesale;
- Root/Subagent/Validator receive different role-scoped authority surfaces;
- Agent schemas expose only their owned control shapes;
- Skill is method-only and cannot acquire orchestration authority;
- write Work Unit requires an explicit execution Task; `auto` and analysis Tasks cannot gain Project Scope write capability;
- owner-sensitive durable repository mutations stay on declared owner surfaces;
- individual certified Work Unit delivery returns control to Root without waiting for unrelated siblings;
- a slow read-only sibling can be stopped after certified Root convergence;
- write-capable work is not killed by convergence;
- Validator resource waits preserve Root/Subagent candidates without rerunning completed investigation;
- normal text/code synthesis does not trigger a second model review;
- semantic review occurs only for evidence explicitly marked as requiring semantic interpretation;
- unsupported semantic content is narrowed to supported content + explicit Gap;
- direct attachment requirements are not downgraded by a post-hoc partial-evidence reviewer;
- Validator-certified Root knowledge can persist to History before delegated follow-up work finishes;
- Root-authored History hints are ignored;
- pending History wording is normalized exactly once;
- resource-backed admission, per-Root Subagent ceiling, natural convergence on lowered limits and retry/capacity semantics remain covered;
- Windows Codex package/process/CDP/launcher contracts remain covered.

## Coverage

`node --test --experimental-test-coverage`:

```text
All files
Line coverage:     95.39%
Branch coverage:   75.68%
Function coverage: 88.45%
```

The coverage run completed successfully with the same test suite.

## Service / persistence smoke tests

Clean copied trees were started with the built-in Mock Executor for both storage backends.

### JSON — PASS

- `/api/live` reports **0.8.0**.
- `/api/health` reports available Mock Executor.
- default resource settings are **2 / 3**.
- settings update to **1 / 5** succeeds.
- settings remain **1 / 5** after graceful shutdown/restart.
- Project Registry creation succeeds.
- a Task linked to that project retains its Project Scope association.
- Task reaches **COMPLETED / SUCCESS**.
- graceful API shutdown succeeds.

### SQLite — PASS

The same path passes with SQLite: version/health, **2 / 3** defaults, **1 / 5** live update and restart persistence, Project Registry, project-linked Task, **COMPLETED / SUCCESS**, and graceful shutdown.

### Analysis History smoke — PASS

A clean JSON Mock analysis run verifies the durable History path independently of UI rendering:

- Task reaches COMPLETED.
- Validator-derived Gap boundary is persisted before final read.
- `last_stage_result` equals the persisted History detail.
- pending wording is exactly `待确认：...`, not duplicated.

## Windows launcher file constraints

Direct byte/line-ending audit:

- `TaskBoard.vbs` — ASCII PASS, CRLF PASS.
- `TaskBoard-in-Codex.vbs` — ASCII PASS, CRLF PASS.
- `Stop-TaskBoard.vbs` — ASCII PASS, CRLF PASS.
- `Create-Desktop-Shortcut.vbs` — ASCII PASS, CRLF PASS.

## Release cleanliness

Before packaging, `data/` contains only:

```text
data/attachments/.gitkeep
data/runtime/.gitkeep
```

No task database/JSON, settings, instance file, logs, test attachment or scratch data is intended for the release archive.

## Final packaged-artifact verification

The release ZIP was extracted into a brand-new directory and rechecked:

```text
npm run verify
201 tests
201 pass
0 fail
```

The fresh extraction contained only the two expected `data/` `.gitkeep` files before smoke execution. Fresh-unpack JSON and SQLite service smoke tests both passed, and a fresh-unpack analysis-History smoke verified durable History/`last_stage_result` consistency.

## Environment boundary and required user regression

The final ZIP is verified on Linux with static, unit/integration and local HTTP/storage smoke tests. This is **not** equivalent to running v0.8.0 inside the user's real Windows Codex Desktop against the OA project and attachment.

The most informative Windows OA regression is therefore not merely “did it finish”. Observe:

1. whether Work Units are genuinely bounded instead of Subagents acting as mini Roots;
2. whether the first certified Work Unit returns Root control while siblings continue;
3. whether meaningful Root-level History appears during execution rather than being reconstructed at the final timestamp;
4. whether text/code facts that have direct source evidence remain confirmed instead of being falsely downgraded;
5. total wall-clock time and final factual completeness/accuracy versus the earlier 96-point baseline.
