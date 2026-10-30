# Runtime Acceptance v0.9.2

Status: PENDING_REAL_RUNTIME
Release lane: `v0.9.2`

## Cloud preflight, 2026-10-30 UTC

Result: **NOT_EXECUTED for representative A-D model scenarios**. The cloud
runtime reached a concrete environment boundary before a model turn; PR #42
must remain open and this record does not promote the release.

- Host tested: `ce0b28d5ad5e35c8681db22f39e59c39dec3a05f`
  (`fix/v0.9.2-root-repair-boundary`).
- Executor tested: Ecosystem Codex API-v2 extension at
  `33ef5ae748ad008fb75bdc2033b9ba237fb1f211`.
- Environment: cloud Linux, Node `v24.19.0`, Codex
  `0.159.0-alpha.3`; existing account login was present. No credentials were
  copied, changed or recorded.
- `npm run verify` on the named Host passed **339 tests**, including the
  changed-rejection, changed-Task-Contract and successful-repair convergence
  regressions. This is deterministic proof only.
- Actual extension probe: instantiate `createCodexExtension({rootDir})` with
  a fresh `/tmp` root, call `executor.health()`, then close the executor.
  The default account transport attempted to launch `codex app-server`, which
  exited with code 1: SQLite state initialization under `/home/agent/.codex`
  failed on the read-only filesystem. Health reported `connected=false`,
  `ready=false`, `modelCount=0`.
- A scoped temporary launch wrapper setting only
  `-c sqlite_home="/tmp/taskboard-codex-state"` removed that first database
  obstacle, but the process still exited 1 with `Read-only file system`.
  A path-only syscall trace located the remaining failure at
  `openat(..., "uid_map", O_RDWR|O_CLOEXEC) = -1 EROFS` while opening
  `/proc/self/uid_map` during process isolation setup. No permission/sandbox
  bypass, account change or security-setting change was attempted.
- The existing Ecosystem #23 harness was inspected: it requires an explicit
  custom Provider base URL, model and API key; those were not supplied for
  this run. Account login alone does not satisfy that harness's custom-mode
  preconditions. No mock replacement was labeled real acceptance.

Smallest remaining action: use a cloud execution environment in which the
existing authenticated Codex app-server can initialize writable local state
and its normal process isolation, or provide the approved custom Provider
configuration to the existing harness. First verify actual extension health,
then run the representative scenarios below against the exact intended Host
and Executor composition. Keep failures and unexecuted scenarios explicit.

This is the release gate for representative real Runtime behavior. Static/unit/CI success is necessary but is not a substitute for this evidence.

## Preflight already established

The pre-closure head `bea4c0e4f787967a379a3da266cf703d69bd68c1` passed GitHub Actions run `32447470428`:

- Ubuntu connection acceptance: PASS
- Windows connection acceptance: PASS
- Ubuntu full `npm run verify`: PASS
- Windows full `npm run verify`: PASS
- fresh tracked-files unpack + `npm run verify`: PASS

Any descendant commit still requires its own exact-head CI before release-ready status.

## Real Runtime environment

Acceptance must run in a real TaskBoard + usable Codex Runtime environment, not only mocks or command-construction tests. Record at minimum:

- exact Git HEAD;
- OS and Node version;
- TaskBoard start path;
- active Executor/connection profile identity without secrets;
- Task id for each scenario;
- relevant Runtime diagnostics and final Task state.

Do not record API keys, cookies or other credentials.

## Required scenarios

### A. Normal governed analysis

Goal: prove the current owner chain works on a representative real task.

Pass when all are observed:

1. Root judges the Task and issues only bounded Work Units needed for the current discriminator.
2. Subagent performs the Project/tool work; Root does not investigate Project sources directly.
3. Independent siblings may execute concurrently, but one completed Stage batch produces one Root synthesis continuation rather than one Root wake per sibling.
4. Subagent output is execution result/source-near Evidence/blocker only; Task-level Claims/Gaps/next-work judgment remain Root-owned.
5. Validator performs deterministic provenance/source checking only and creates no model turn.
6. Certified State changes only after the current delta passes the ledger boundary.

### B. No-progress / repeated-investigation boundary

Goal: cover the useful defect class preserved from the retired `agent/root-goal-contribution-witness` experiment without restoring its planning-repair mechanism.

Use a Task where the first bounded acquisition path returns no decision-relevant discriminator.

Pass when:

1. Root receives the negative/empty fresh Work delta.
2. Root does not buy an unbounded sequence of semantically equivalent investigations merely by renaming the method.
3. If another Work Unit is issued, its reason is tied to a materially different remaining discriminator/current governed state.
4. If no safe machine-side discriminator remains, Runtime converges to a structured suspension/Human Gateway as appropriate rather than looping.
5. No retired `planningFeedback`, planning-repair, Validator-semantic-repair or second-owner path is required.

### C. Smallest-owner retry

Goal: prove retry changes only the smallest owned execution state.

Induce one retryable read-only Work Unit failure.

Pass when:

1. retry is scoped to the failed Work Unit/attempt;
2. Task semantic identity and already certified state are preserved;
3. resource waiting does not consume failure budget;
4. successful retry resumes the current governed progression rather than replaying historical Task cognition;
5. Root input does not regrow through old Work receipts/raw analysis replay.

### D. Completion gate

Goal: prove free text cannot bypass governed completion.

Pass when:

1. Root owns the final Task judgment;
2. final satisfying Claims carry explicit `obligationRefs[]` for the governed obligations they satisfy;
3. Validator checks provenance only;
4. `CompletionEvaluator` deterministically checks the certified obligation relation;
5. Task reaches COMPLETED only after that relation is satisfied; a persuasive `finalResult` alone cannot complete the Task.

## Side-effect recovery

D-023 effect recovery already has extensive deterministic regression coverage. A destructive or business-important real mutation is **not** required merely to claim v0.9.2 acceptance.

If a safe disposable mutation environment is available, an additional real recovery run is valuable. It must preserve UNKNOWN after ambiguous transport/process loss, block competing mutation, and use independent observation/closure before fresh actuation. Never manufacture failure just to enable replay.

## Evidence record

For each executed scenario append:

```text
Scenario:
HEAD:
Environment:
Task id:
Observed owner chain:
Diagnostics / source:
Result: PASS | FAIL
Gap / follow-up:
```

## Release decision

Release-ready requires all of the following at the **same current head**:

- exact-head CI GREEN;
- scenarios A-D have representative real Runtime PASS evidence;
- no acceptance result requires restoring a retired parallel owner/mechanism;
- `docs/VERIFICATION.md` is updated to the exact accepted head and evidence.

Until then PR #24 remains a draft integration gate.
