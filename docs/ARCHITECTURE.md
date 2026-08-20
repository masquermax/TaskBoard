# TaskBoard Architecture v0.9.2

Status: ACTIVE

TaskBoard is a local-first work operating system for Agents. Its Runtime is not a separate intelligence layer: it is the concrete handoff of authority and state between a small set of owners.

## 1. Runtime skeleton

```text
Task trigger
   ↓
Root
judge → split minimum Work Units when needed
   ↓
Work Unit Stage
   ↓
Subagent(s)
execute only
   ↓
result + source-near Evidence + blocker
   ↓
Root
judge meaning / sufficiency / next action
   ↓
Validator
check source/provenance ledger only
   ↓
Certified State / complete / new Work / Human Gateway
```

Equivalent compact form:

```text
Authority → minimum input → execution → minimum output → next owner
```

No additional Runtime mechanism gains decision authority merely because it exists.

## 2. Owners

- **Scheduler** — Task lifecycle, admission and Task concurrency.
- **Root** — sole Task-level judgment, planning and progression owner.
- **Subagent** — executes exactly one bounded Work Unit.
- **Validator** — deterministic source/provenance accountant.
- **Task Core** — durable Task facts and atomic persistence.
- **Human Gateway** — transports a genuinely human-owned blocking answer.
- **Executor** — realizes model/file/command/network operations inside an AuthorizedGrant.
- **Skill** — optional external method context, never Authority.
- **UI / Surface** — projection and user intent only.

A Work Unit is a contract between Root and Subagent, not another role.

## 3. Root is the only Task brain

Root receives only what the current judgment needs:

- Task identity/instruction and input catalog;
- current Claims / Gaps / unresolved obligations;
- the current Human trigger, when present;
- fresh completed Work Unit results;
- selected Skill catalog metadata.

Root does not receive Project filesystem/network capability. It decides whether to delegate, what the returned execution facts mean, whether they are sufficient, whether a Gap remains, whether Human input is required and whether the Task is complete.

A governed completion relation is explicit: a `CONFIRMED` Claim satisfies an obligation only when Root records the obligation id in `claim.obligationRefs[]`. Completion does not invent that relation.

## 4. Work Unit and Subagent

Every Work Unit declares:

- `goal`
- `expectedOutput`
- `stopCondition`
- `projectAccess`
- `networkAccess`
- `inputRefs`
- `dependsOn`
- optional `skillId`

`GovernanceCompiler` intersects the Work Unit request with the machine role boundary, certified Task authority and selected inputs to produce the only executable `AuthorizedGrant`.

Subagent uses that boundary and returns only:

```text
result
Evidence / locator
optional blocker
```

Subagent does not create Task Claims/Gaps, confidence, recommendations, discoveries, next tasks, completion decisions or Human Gateways.

A Stage is a Root-issued batch. Dependencies are honored inside the Stage; independent Work Units run concurrently up to the configured ceiling. Root receives the Stage result after all issued siblings have reached the Stage boundary, rather than waking once per sibling.

## 5. Validator is the accountant

Validator is not an Executor/model role and has no model lifecycle.

It checks only mechanically decidable ledger relations:

- does the source/locator exist inside the governed boundary;
- for DIRECT text/code evidence, does the stated observation occur at that source anchor;
- does a Claim/Gap/Step reference an existing admitted source/Claim;
- is INDIRECT material being incorrectly upgraded to CONFIRMED;
- does a Gap resolution cite admitted DIRECT evidence.

A missing/fabricated/mismatched source is rejected. A real source that cannot be mechanically verified is at most INDIRECT. Validator does not decide what evidence means, whether a business conclusion is reasonable, whether another investigation is needed, or whether a Human answer closes a Gap. Those decisions remain Root-owned.

`Validator PASS` means the cited receipt is valid, not that Validator independently derived Root's conclusion.

## 6. Certified State is the cognition chain

Durable Task cognition is:

```text
Evidence + Claim + Gap
```

A Root turn produces a delta. Validator checks its source ledger. `CertifiedState` merges the accepted delta atomically and monotonically:

- omission does not erase prior knowledge;
- Evidence ids are immutable anchors;
- revising an existing Claim/Gap requires new Evidence;
- Recommendations and ordered Steps are presentation, not durable cognition.

There is no parallel `stageResult`, semantic History owner, Validator repair result or telemetry-derived cognition channel.

Legacy progress rows may remain readable for old UI/data compatibility, but current Runtime has no semantic History writer and does not replay them into Root.

## 7. Human Gateway

Human Gateway is transport only.

A Root `human_gateway` decision must bind the current blocking Gap and exact question. After the user answers, that answer becomes the fresh Human trigger for Root. Runtime does not automatically convert the answer into Evidence or a Gap resolution; Root decides what the answer establishes.

## 8. Lifecycle and timing ownership

User-visible Task states remain:

- READY
- RUNNING
- WAITING_HUMAN
- COMPLETED

Scheduler alone owns those transitions. RUNNING begins only after a real Executor operation reports admission.

Timing follows the smallest owning unit. Task lifecycle time is not redefined by a child retry. A Work Unit keeps its issuance identity, while `startedAt / completedAt` describe the current or successful execution attempt; entering retry clears the stale failed-attempt timing before a new attempt starts. Runtime snapshots distinguish Work issuance, current-attempt execution start, last activity and completion.

## 9. Recovery is safety, not another thinker

Effect recovery exists only because an interrupted side-effecting operation may already have changed Reality.

When an old mutator outcome is unknown, Runtime fails closed: it preserves the unresolved effect fact, blocks competing fresh mutation, and allows only the minimum safe observation needed to establish closure. This mechanism never interprets Task meaning and does not replay the old mutation just because transport failed.

Read-only failures follow the ordinary Work Unit retry/suspension path.

## 10. Diagnostics are peripheral facts

Transport/tool diagnostics may record execution facts such as turn route, timestamps, tool type, duration and result bytes. They do not wrap RootRuntime, infer semantic operation classes, create Claims/Gaps or decide convergence.

There is no Runtime telemetry owner or semantic observability layer.

## 11. Extension boundary

TaskBoard Core depends on abstract operational surfaces, not on Codex-specific product semantics.

An Extension may provide:

- Executor;
- Capability Provider;
- connection settings;
- optional Surface Host / presentation metadata;
- optional continuation surface.

`ExtensionRegistry` composes these capabilities. Current TaskBoard admits `taskboard` orchestration mode, where TaskBoard owns Root → Work Unit → Subagent flow. A future runtime-native agent tree requires a separate contract and is not implicitly counted as TaskBoard Subagents.

Codex is the stock Executor implementation, not a Task Core dependency.

## 12. Explicit absences

Current architecture intentionally has no:

- Validator model / semantic proof / repair loop;
- planning-repair or completion-repair model loop;
- parallel stage-result cognition channel;
- semantic History decision owner;
- Runtime telemetry wrapper or semantic convergence heuristic;
- Root Project/network execution capability;
- automatic Human-answer interpretation;
- replayable `PROJECT_SEARCH`/generic Runtime Evidence store;
- formal Project Knowledge subsystem;
- runtime-native agent-tree orchestration.

A new mechanism enters Runtime only when the existing owner chain cannot safely satisfy the requirement without it.
