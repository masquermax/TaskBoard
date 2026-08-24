# Capability Map

Status: ACTIVE

TaskBoard 的 Runtime 骨架只有一条：**Scheduler 管生命周期，Root 判断，Subagent 执行，Validator 核来源，Task Core 持久化。** Work Unit 是 Root→Subagent 的有限工作单，不是新的 Authority。

```text
User / UI
   │ intent / human answer
   ▼
Scheduler ── lifecycle / admission
   │
   ▼
Root ── judgment / plan / next action
   │
   ├─ complete ───────────────────────────────► Task Core
   ├─ human_gateway ─► Human Gateway ─────────► Root
   └─ Work Unit ─► Subagent ─► result/source ─► Root
                                      │
                                      ▼
                                  Validator
                               provenance ledger
                                      │
                                      ▼
                                  Task Core
```

## One owner per critical capability

| Capability | Owner | Runtime / Source of Truth | Enforcement |
| --- | --- | --- | --- |
| Task lifecycle / admission | Scheduler | `src/core/scheduler.js` | Scheduler alone moves READY/RUNNING/WAITING_HUMAN/COMPLETED |
| Task reasoning / planning / convergence | Root | `src/core/root-runtime.js` + Root output schema | Root alone creates Work Units, Claims/Gaps, completion relation and next action |
| Work Unit boundary | Root → Subagent contract | Root delegation schema + `validateDelegationPlan()` | explicit goal/output/stop/input/dependency/capability boundary |
| One Work Unit execution | Subagent | `src/core/subagent-runtime.js` | returns execution output/source/blocker only |
| Project/network capability request | Root | Work Unit request | GovernanceCompiler narrows request to certified authority + selected inputs |
| Source/provenance ledger | Validator | `src/governance/validator-runtime.js` + `source-trace-verifier.js` | deterministic locator/source/reference checks; no model turn or semantic repair |
| Task / Project / Gateway / Certified State / Result persistence | Task Core | `src/core/task-service.js` + `src/core/json-repository.js` | atomic repository transactions |
| Human question/answer transport | Human Gateway | Scheduler + Repository + UI/API | answer is a Root trigger; transport does not interpret it |
| Skill method | Skill | injected Skill library | selected method only; no Authority |
| Model/file/command/network operation | Executor Extension | `src/extensions/public-api.js` contract + external `TaskBoard-Ecosystem` implementation | realizes AuthorizedGrant; no Task judgment |
| UI presentation / user intent | UI / Surface | `src/ui/*`, `src/server/*` | projection only; durable truth remains Core/Scheduler |
| Task concurrency | Scheduler | `src/core/runtime-settings.js` | configured ceiling, no preemption |
| Per-Task Subagent concurrency | Root Runtime | `src/core/runtime-settings.js` | limits active Work Units, not Work Unit count |

## Necessary mechanisms that are not authorities

`JsonTaskRepository`, `AttachmentStore`, `TaskService`, `DailyCleanupController`, `RuntimeSettingsStore`, `RetryPolicy`, `ModelRouter`, `CapabilityProvider`, extension connection gates and transport/server modules implement the owners above. They do not gain decision authority merely by existing.

Effect recovery is also not a new role: it is a fail-closed safety boundary for an already-started side effect whose Reality outcome is unknown. It may block a new mutation, but it does not interpret Task meaning.

## Explicit absences

- Project Knowledge subsystem：未实现。
- Replayable PROJECT_SEARCH / generic Runtime source record：未实现；Agent 自述执行过程不能冒充 DIRECT Evidence。
- Validator model / semantic proof / repair loop：不存在。
- Runtime telemetry wrapper / semantic observability owner：不存在；诊断只记录事实，不能进入业务判断。
- Root-owned Project/network execution：不存在；实际操作进入 Subagent Work Unit。

## Architecture audit

- 两个 Owner → **Authority Conflict**。
- 没有 Owner → **Authority Vacuum**；保持 Gap/Handoff，不让模型补位。
- Contract 未授予但 Runtime 暴露 → **Authority Leak**。
- Contract 正确但代码未执行 → **Runtime Drift**。
- 职责外信息进入角色上下文 → **Context Leak**。
- 漂移未被测试发现 → **Eval Gap**。

新增机制前只问一件事：**它是否是上述角色链完成职责所必需？** 不是，就不进入 Runtime 骨架。
