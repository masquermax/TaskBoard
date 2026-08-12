# Current State

Status: RELEASE CANDIDATE — LOCAL VERIFIED, WINDOWS OA PENDING
Release: v0.9.0
Base architecture: v0.8 capability realignment

## Stable direction

No new governance layer was added. Runtime behavior continues to derive from the existing five-item Product Constitution and positive Capability ownership.

Two implementation consequences are explicit:

1. **Capability follows ownership.** Runtime surfaces come from the owning Capability Contract; absence of ownership means absence of that capability. Do not replace missing Runtime enforcement with repeated negative Prompt rules.
2. **Knowledge advances by certified delta.** Root proposes this Turn's change; Validator certifies it; Task Core commits the certified change as a Turn Node. Omission cannot erase committed knowledge, and revision requires new evidence.

## Implemented through v0.9.0

- Current domain terminology is singular: Project, Root, Subagent and Validator are the only current names. `SystemFilter`, `OUTSIDE`, Lead/Worker runtime aliases and thread-style Subagent settings are removed from current Runtime/UI/API surfaces; legacy keys exist only at explicit migration boundaries.
- Runtime actor identity is singular: snapshots use `actor.owner`; Work Units use one `owner`; `WAITING_RESOURCE` is the current resource-wait reason. Old `root/ownerType/ownerLabel/RESOURCE_WAIT` snapshots normalize at repository/database boundaries and do not continue into current state.
- Work Unit capability is explicit and fail-closed: `projectAccess=none|read|write`, `networkAccess`, and `inputRefs`. Missing/invalid capability fields grant no Project access and no network. Root receives logical Task-input references rather than Project paths/local attachment handles; Subagent context is allow-list constructed from its Work Unit.
- Role outputs are runtime-enforced, not only schema-described. Subagent results are allow-listed; Root cannot manufacture Project/Attachment Evidence and must consume source evidence collected by Subagents. Analysis Candidates fail closed if ValidatorRuntime is absent.
- Runtime entry ownership is reduced: RootRuntime has one ValidatorRuntime dependency; Executor no longer proxies CapabilityProvider discovery; ordinary Governance Runtime loads the active Constitution/Capability contracts while ADR remains engineering decision memory.
- UI projects canonical runtime facts directly: Project filtering uses Project terminology, Subagent Work Unit cards expose project/network capability, and progress copy follows the current `actor.owner` rather than mixed role labels.
- Analysis durable cognition is reduced to `Evidence + Claim(Fact) + Gap`; Recommendations/Steps are current projection only and old persisted advice is discarded on normalization.
- Requirement truth and implementation truth no longer share the same cross-system proof burden. DIRECT requirement Evidence can certify what the requirement says; implementation chain Claims still require implementation/hop proof.
- Work Unit Evidence can be cited by Root by id and is injected from the source-traced subagent result; Root no longer needs to copy source payloads.
- Same-turn evidence-backed Gap resolutions are evaluated as the candidate post-transition view before completion is certified, while Task Core remains the only state mutation owner.
- Final analysis body and summary are both projected from the same final Current Certified State.
- Model routing is `Work Requirement → provider-described capability → minimum sufficient model`; model ids are never used as capability evidence. Finite read-only Subagents prefer an efficient tier, ordinary analysis/Validator work a balanced tier, and truly complex/open-ended Root work a frontier tier when catalog metadata proves such options exist. Unknown metadata falls back to the configured model. Automatic reasoning remains limited to `low/medium/high` and never enters `xhigh`, `max` or `ultra`.
- Codex runtime diagnostics now record app-server generation/PID, capability cache invalidation/discovery, monitored RPC timing, requested model/reasoning, turn duration/tool-call count and any model-refresh error with active RPC methods.
- Release identity is checked so package/app/current-doc version cannot silently diverge.
- Codex startup no longer blocks on `model/list`: lightweight `config/read` establishes the configured model, while one full catalog refresh runs in the background. A small refresh button beside AI information both triggers manual refresh and reports the real refresh state: green success, gray startup-refresh failure, yellow manual-refresh failure, spinning while refreshing. Failure preserves the pre-refresh model record, and no-record state remains explicit Executor Default fallback.
- A configured model obtained from Codex config is passed explicitly into `thread/start`; model catalog metadata is used only to select a safe `low/medium/high` reasoning effort. Cross-model ranking remains disabled.
- `WAITING_RESOURCE` and `RETRY_WAIT` are separate runtime states. Shared transport failures use jittered retry delay rather than synchronized fixed re-entry.
- Codex Turn diagnostics are symmetric: `turn-started / turn-failed / turn-completed / turn-released` include global `activeTurnCount`. Executor owns that execution fact; Scheduler remains the owner of admission/resource decisions. No separate Executor Resource Manager exists.
- Executor probes a small environment capability snapshot once and gives it to Subagents so known-missing `rg`, document conversion dependencies and desktop binaries are not repeatedly rediscovered.
- Root execution now has an explicit causal boundary: Current Certified State is context, not a synthetic trigger. New ordinary Root work requires Task start, a new Subagent result, a resolved Human Gateway or a technical resume; same-trigger Validator/planning/control repair is bounded.
- Human Gateway is bound to exactly one currently certified blocking Gap. Gateway-derived Human evidence persists only system-owned `gatewayId + targetGapId` provenance; raw historical answers are not replayed into ordinary Root context. Claims and Gap resolutions that depend on Human wording receive narrow semantic proof against the exact Gateway question/answer.
- A resolved Human Gateway is now a system-owned causal transition input: Runtime synthesizes its DIRECT Human Evidence and the proof candidate for the Gateway-bound Gap even when Root omits both. Deterministic provenance prevents one Gateway from closing another Gap; Validator owns only semantic sufficiency of the exact answer for the exact bound question.
- Subagent lease boundary waits are control-loop wakeups, not Codex event failures. Runtime distinguishes an intentional lease deadline from a real app-server event timeout so the soft steer/hard interrupt path cannot randomly degrade into a retryable transport-style timeout at the millisecond boundary.
- A Gap can close only with current certified DIRECT Evidence. Any certified blocking Gap forbids further investigative delegation; Root must either establish that it is no longer blocking or request the bound Human Gateway.
- Codex Subagent `stopCondition` is backed by a runtime execution lease: a soft convergence `turn/steer` occurs before a hard `turn/interrupt` boundary. Hitting the hard boundary is nonretryable for that attempt and is not mislabeled as a deterministic code error.
- Explicit model selection does not suppress Codex's internal model-manager refresh. v0.8.7 reduces unnecessary thread starts by removing causeless Root loops and wrong-scope Subagents, but the remaining Codex-internal refresh latency stays an external runtime limitation.

- Durable `Current Certified State` for analysis Tasks on SQLite and JSON.
- Certified Turn Node accumulation with monotonically increasing state versions.
- Later Root Turns receive committed state, including after process/runtime restart.
- Final analysis renders from accumulated committed state instead of the last Root message.
- Evidence-backed Gap resolution lets unknown space shrink explicitly.
- History is derived from committed Turn deltas and can be persisted atomically with certified state.
- Internal analysis state is not exposed through TaskService/UI APIs.
- Ordinary Root/Subagent/Validator contexts no longer repeat the full Product Constitution or ADR stack; they receive their owned Capability Contract plus current work inputs.
- New Work Units select minimal Task inputs through `inputRefs`; unselected Project Scope, attachments and referenced Results are not passed into the Subagent execution/validation context. A write Work Unit must explicitly select at least one Project Scope.
- Core ships no concrete Skill content. Only the injected Skill-library boundary remains. Concrete/distilled Skills are user-owned assets in a separate extension package/branch.
- `docs/ARCHITECTURE_REVIEW.md` records the maintainer diagnosis method (`Contract → Owner → Runtime → Context → Test/Eval`) without creating another runtime Rule layer.
- Runtime progress visibility now preserves completed Work Units for the lifetime of an open Task, keeps Root/Validator activity visible beside Work Units, and preserves the last runtime snapshot during `WAITING_HUMAN`.
- User-facing `历史进展` wording is corrected to `已确认进展`; completed process work remains runtime-only and does not become certified History.
- Subagent authority is reduced to one bounded Work Unit: it returns source-near Evidence + local Findings/Discovery/Blocker, while Task-level Claims/Gaps/Recommendations/completion/next work remain Root-owned.
- Subagent results no longer launch a semantic Validator Agent or semantic rework loop. Only deterministic source-trace normalization occurs before Root receives local work.
- Narrow semantic Validator turns apply only to Root Candidate proof obligations with exact resolvable raw semantic input. Validator runs outside Project Scope; unresolved visuals embedded inside DOCX/PDF remain indirect/pending instead of causing document re-investigation.

## Explicit boundaries

- No cross-Task Experience → Skill distillation runtime exists in Core.
- No formal Project Knowledge subsystem exists.
- No generic proof system independently certifies arbitrary external side effects.
- No Root-owned first-class Work Unit executor exists.
- v0.8.2 real Windows OA regression exposed role-boundary/runtime drift. v0.8.3 corrected those ownership causes. v0.8.4 reduced durable cognition and exposed runtime/model-refresh evidence. v0.8.5 separated retry from capacity and made capability refresh non-blocking. v0.8.6 made refresh outcomes/active Turn facts visible. v0.8.7 followed the Windows OA long-run failure down to causal state transitions. The v0.8.7 rerun then exposed one remaining ownership hole: Root could receive a resolved Gateway answer yet omit the corresponding Gap-resolution candidate, leaving the same blocking Gap open and causing the same Gateway to be asked again. v0.8.8 moves that deterministic Gateway→Gap transition proposal into Runtime while leaving semantic sufficiency with Validator. v0.9.0 then removes duplicate names, role aliases, hidden capability defaults and second runtime entry points so those ownership rules have one current expression. A fresh Windows OA rerun remains the external gate; no global safe Codex Turn ceiling is guessed from one incident.
