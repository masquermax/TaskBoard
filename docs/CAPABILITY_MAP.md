# Capability Map

Status: ACTIVE

本文件是 TaskBoard 当前唯一的能力/Owner/实现映射。它回答三件事：**谁拥有决定、Runtime 在哪里落实、越界如何被发现。** 工作方法不放在这里；具体方法属于外部 Skill。

## Current positions

- **Scheduler**：Task 生命周期与执行准入。
- **Root**：Task 级判断、规划、综合与收敛。
- **Work Unit**：Root 创建的有限工作单，不是 Authority role。
- **Subagent**：执行一个 Work Unit。
- **Validator**：认证 Root Candidate Delta 与 History 边界。
- **Task Core**：durable business facts 与原子持久化。
- **Human Gateway**：人类信息传输。
- **Skill**：某类工作怎么做的方法，不拥有 Task 权力。
- **Executor**：模型、文件、搜索、命令等实际执行能力，不拥有业务决定权。
- **UI / Surface**：展示与用户意图传递。

```text
User / UI
   │ intent / facts
   ▼
Task Core ◄──────── certified durable write ───── Validator
   │                                               ▲
   ▼                                               │ Root Candidate Delta
Scheduler                                          │
   │ lifecycle / admission                         │
   ▼                                               │
Root ◄──── Evidence / local Findings ─────── Subagent
   │                                              ▲
   │ creates                                      │ executes
   ▼                                              │
Work Unit ────────────────────────────────────────┘
   │
   ├─ Skill = method
   └─ Executor = operation
```

## One owner per critical capability

| Capability | Owner | Runtime / Source of Truth | Enforcement |
| --- | --- | --- | --- |
| Task lifecycle / admission / READY-RUNNING-WAITING_HUMAN-COMPLETED | Scheduler | `src/core/scheduler.js` | Scheduler alone performs lifecycle transitions; RUNNING requires real execution start |
| Task reasoning / planning / Work Unit creation / convergence | Root | `src/core/root-runtime.js` + Root Executor schema | Candidate schema + delegation contract; source investigation is delegated rather than hidden Root work |
| Work Unit boundary | Work Unit | Root delegation schema + `validateDelegationPlan()` | explicit `goal/expectedOutput/stopCondition/projectAccess/networkAccess/inputRefs/dependsOn/skillId` |
| One delegated Work Unit execution | Subagent | `src/core/subagent-runtime.js` | receives only selected inputs and declared capabilities; result is Runtime allow-listed |
| Project Scope read/write request | Root | Work Unit `projectAccess` + `inputRefs` → `GovernanceCompiler.compileAuthorizedGrant()` | request is narrowed by RoleCapabilityContract, certified TaskContract authority and selected Project scope; `taskMode` does not grant Project access |
| Root Candidate certification / Gap narrowing | Validator | `src/governance/validator-runtime.js` + analysis/source/semantic verifiers | deterministic provenance first; narrow semantic proof only when required |
| Analysis History value decision | Validator | `ValidatorRuntime.deriveNewRootProgress()` | only certified, future-useful Root knowledge becomes a commit candidate |
| Durable Task facts / Current Certified State / History write | Task Core | `src/core/task-service.js` + `src/core/json-repository.js` | single JSON persistence path; atomic repository transactions |
| Project List / attachments / references | Task Core | TaskService + JSON Repository + AttachmentStore | user intent validation + path boundaries + durable facts |
| Completed-data retention cleanup | Task Core | `src/core/cleanup-controller.js` | deterministic day-91 policy; locked/referenced protection |
| Human question/answer transport | Human Gateway | Scheduler + Repository + UI/API | Gateway binds one certified blocking Gap; Runtime owns answer provenance |
| Skill discovery / selected method | Skill | `src/skills/skill-library-port.js` | concrete Skill packages are external; core injects only selected method |
| Model selection / execution capability use | Executor | `src/core/model-router.js` + capability providers | provider-described capability; unknown falls back to configured/default model |
| Model / file / command operation | Executor | `src/extensions/executors/*` + ports | Work Unit capability + Executor sandbox/protocol; no Task business authority |
| UI presentation / user intent | UI / Surface | `src/ui/*`, `src/server/*`, surface hosts | UI submits intents; durable truth comes from Core/Scheduler |
| Task concurrency configuration | User → Scheduler | `src/core/runtime-settings.js` | 1–5 configured ceiling; lowering never preempts active work |
| Per-Root Subagent ceiling | User → Root Runtime | `src/core/runtime-settings.js` | 1–5 configured ceiling; no global Subagent pool |

## Mechanisms that are not new authorities

`JsonTaskRepository`, `AttachmentStore`, `TaskService`, `DailyCleanupController`, `RuntimeSettingsStore`, `RetryPolicy`, `ModelRouter`, `CapabilityProvider`, `SurfaceManager` and transport/server modules are implementations under the owners above. A class/module does not become a new Authority merely because it exists.

## Current explicit absences

- **Project Knowledge subsystem**：未实现。Project Scope、Attachments、Referenced Results、Human answers 是 Task inputs，不是正式 Project Knowledge。
- **Replayable PROJECT_SEARCH record**：未实现。Agent 自述“搜索未命中”不能自动成为 DIRECT Evidence。
- **Generic execution side-effect proof**：未实现。analysis structured knowledge 有 first-class certification；任意代码修改/部署副作用尚无通用独立 proof contract。
- **Root-owned first-class Work Unit execution**：未实现。Root 负责 Task 级判断；独立 source work / project mutation 必须进入 Subagent Work Unit。

## Architecture audit

- 两个 Owner → **Authority Conflict**。
- 没有 Owner → **Authority Vacuum**；保持 Gap/Handoff，不让模型补位。
- Contract 未授予但 Runtime 暴露 → **Authority Leak**。
- Contract 正确但代码未执行 → **Runtime Drift**。
- 角色看到职责外信息 → **Context Leak**。
- 漂移未被测试发现 → **Eval Gap**。

维护时使用 `ARCHITECTURE_REVIEW.md` 的固定链：`Contract → Owner → Runtime → Context → Test/Eval`。新增模块前先问它是否拥有新的关键决定；如果没有，必须归入现有 Owner，而不是扩大 Authority graph。
