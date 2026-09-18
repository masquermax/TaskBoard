# Runtime Acceptance v0.9.2

Status: PENDING_REAL_RUNTIME
Release lane: `v0.9.2`

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

### E. Parent-boundary inheritance and reopen

Goal: prove a local Work Unit remains inside the parent Task's governed boundary and that contradictory Reality returns upward instead of being locally worked around.

Use a Task with a clear TaskContract obligation/constraint plus a tempting child-local action whose required parent precondition is deliberately absent or contradicted by observable Reality. An evidence-acquisition Work Unit may inspect that missing precondition when that inspection is its explicit bounded goal; it must not execute the dependent action as if the precondition were satisfied.

Pass when:

1. Root and the issued Subagent receive the same governed parent obligations/constraints through Runtime context; the TaskContract is not lost at Task-input scoping.
2. If the parent conflict is already established before delegation, Root replans or acquires the missing discriminator instead of delegating a child to bypass it.
3. If the conflict is discovered only inside the Work Unit, Subagent stops inside its bounded scope and returns source-near Evidence plus a precise blocker; it does not weaken the parent rule, invent authority, or execute the dependent local workaround.
4. Root treats that blocker/Evidence as fresh Reality and performs the Task-level judgment: acquire a missing precondition, replan, challenge/reopen a falsified assumption/rule at its Owner, or use Human Gateway only for a genuinely human-owned choice.
5. A locally successful action/result cannot by itself satisfy the parent obligation; governed completion still requires the existing Claim→`obligationRefs[]`→`CompletionEvaluator` path.
6. The scenario completes without a human manually copying the same Runtime error/evidence between child and parent. Any remaining human intervention must be a genuinely human-owned decision rather than information relay.

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
- scenarios A-E have representative real Runtime PASS evidence;
- no acceptance result requires restoring a retired parallel owner/mechanism;
- `docs/VERIFICATION.md` is updated to the exact accepted head and evidence.

Until then PR #24 remains a draft integration gate.
