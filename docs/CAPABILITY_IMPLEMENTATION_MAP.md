# Capability Implementation Map v1

Status: ACTIVE

本文件把 `CAPABILITY_MAP.md` / `CAPABILITY_CONTRACTS.md` 绑定到当前代码。它用于架构审查，不进入普通 Task Prompt。目标不是再增加一层规则，而是让每个关键能力都能回答：**Owner 是谁、代码在哪里、靠什么真正生效。**

| Capability | Owner Contract | Runtime / Source of Truth | Enforcement |
| --- | --- | --- | --- |
| Task lifecycle / admission / READY-RUNNING-WAITING_HUMAN-COMPLETED | SCHEDULER | `src/core/scheduler.js` | 只有 Scheduler 调用 lifecycle transition；真实 execution start 后才 admission |
| Task durable facts / History persistence | TASK_CORE | `src/core/task-service.js` + repository implementations | Repository preconditions + atomic progress commit where supported |
| Task creation / Project Registry / attachment durable facts | TASK_CORE | `src/core/task-service.js` + `attachment-store.js` + repositories | TaskService validates user intent and path boundaries; Repository is durable source of truth |
| Completed-data retention cleanup | TASK_CORE | `src/core/cleanup-controller.js` + Repository + AttachmentStore | deterministic day-91 eligibility; locked/referenced protection; DB/file rollback boundary; no model/Agent decision |
| Task reasoning / planning / Work Unit creation / convergence | ROOT | `src/core/root-runtime.js` + Root execution adapter schema | Root output schema + delegation-plan contract validation; independent evidence acquisition is expressed as Work Unit rather than hidden Root investigation |
| Work Unit boundary | WORK_UNIT | Root delegation schema + `RootRuntime.buildWorkUnits()` | `goal/expectedOutput/stopCondition/projectAccess/networkAccess/inputRefs/dependsOn/skillId`; Runtime 不授予 Task authority |
| Project Scope mutation request | ROOT | Root delegation `projectAccess` + `RootRuntime.validateDelegationPlan()` | `write` only in execution Task; concrete write runs in Subagent Work Unit, Root has no Project Scope filesystem access |
| One delegated Work Unit execution | SUBAGENT | `src/core/subagent-runtime.js` + Executor `runSubagent` schema | Subagent receives one Work Unit and only its declared inputs/capabilities |
| Result certification / narrowing / Gap conversion | VALIDATOR | `src/governance/validator-runtime.js` + `analysis-validator.js` + `source-trace-verifier.js` | Validator schema/structural checks; deterministic provenance first |
| History value decision for analysis knowledge | VALIDATOR | `ValidatorRuntime.deriveNewRootProgress()` | only certified Root-level unseen knowledge creates commit candidate |
| History write | TASK_CORE | Scheduler `onProgressCommit` → Repository | in-memory committed keys advance only after persistence callback succeeds |
| Skill discovery / method context | SKILL | `src/skills/skill-library-port.js` + injected Skill library | Root selects `skillId`; core resolves it only through the injected library and injects the selected method only to that Work Unit executor |
| Runtime authority context | capability contract of current role | `src/governance/capability-contract-loader.js` + `governance-compiler.js` | current role Contract + selected method when present; Constitution/ADR/old Analysis Rules are excluded from ordinary Task prompts |
| Source provenance | VALIDATOR | `src/governance/source-trace-verifier.js` | system resolves/validates source address; unverifiable DIRECT provenance cannot stay DIRECT |
| Narrow semantic proof when raw source is not mechanically interpretable | VALIDATOR | `src/governance/semantic-proof-verifier.js` | selected only when SourceTraceVerifier explicitly marks `needsSemantic`; no general second-analysis turn |
| User resource configuration persistence | User intent / supporting runtime mechanism | `src/core/runtime-settings.js` + server settings API | UI/API transports only 1–5 values; store persists configured intent; Scheduler/Root consume only their owned ceiling |
| Retry / suspend mechanics | owning runtime + deterministic invariant | `src/core/retry-policy.js`, Scheduler, RootRuntime | fixed five-attempt policy; capacity wait is not failure; no new authority role |
| Stale RUNNING recovery | SCHEDULER | `Scheduler.recoverStaleRunningTasks()` | reconciles lifecycle to real execution state; no Agent cursor restoration |
| Model selection / executor capability use | TOOL_EXECUTOR | `src/core/model-router.js` + capability providers | uses explicit compatible capability; unknown falls back to executor default |
| File/model/command operations | TOOL_EXECUTOR | execution adapters / ports | adapter scope, explicit Work Unit `projectAccess/networkAccess`, Root/Validator network-off defaults, executor protocol |
| Human information transport | HUMAN_GATEWAY | Scheduler + Repository + UI/API | Root proposes need; Scheduler owns WAITING_HUMAN; Gateway transports answer only |
| User presentation / intent | UI_SURFACE | `src/ui/*`, `src/server/*` | UI submits intents; durable state comes from Core/Scheduler |

## Architecture audit checks

这里的“audit rules”不是 Agent 运行时 Rule，而是静态架构判定：

1. 同一个关键 Capability 出现多个 Owner → `Authority Conflict`。
2. 关键 Capability 找不到 Owner → `Authority Vacuum`；保持 Gap/Handoff，不让模型补位。
3. 实际代码暴露了 Contract 未授予的业务能力 → `Authority Leak`。
4. 一个方法论步骤被塞回 Constitution / Root mega-prompt / Validator → 归到 Skill 或删除重复表达。
5. 一个确定性协议约束可由 Runtime 直接保证 → 代码保证，不重复要求 Agent 自律。
6. 一个 helper/class 只有机制没有关键决定 → 归入现有 Owner 的实现面，不为了“看起来完整”新增 Authority role。

## 当前明确缺失而不是伪装存在的能力

- **Project Knowledge subsystem**：未实现。Project Scope / attachments / references 是 Task 输入，不等于正式 Project Knowledge。
- **Root-owned first-class Work Unit / Skill execution**：不是 v0.8 已声明能力。Root 当前只做 Task 级规划/综合并为 delegated Work Unit 选择 Skill；独立项目/附件证据获取属于 Subagent Work Unit。若未来需要 Root 自己执行可观测 Work Unit，应先扩展 Contract 与 Runtime Surface，再实现，不允许只靠 Prompt 暗示。
- **Replayable PROJECT_SEARCH evidence record**：当前对 Agent 自述的“搜索未命中”不能认证为 DIRECT；在实现系统拥有的可重放搜索记录前，应保持限定范围的间接证据/Gap。
- **Generic execution side-effect proof**：non-analysis candidate 会经过 Validator Runtime，但当前没有对任意代码修改/部署副作用的通用独立证明框架；不得把 pass-through 当作已完成语义认证。

## Module placement audit

模块存在不等于新的 Authority。当前生产模块按 Owner/机制归位如下：

| Modules | Placement |
| --- | --- |
| `src/core/scheduler.js` | SCHEDULER lifecycle/admission owner |
| `src/core/root-runtime.js` | ROOT planning/synthesis runtime; also enforces Work Unit scheduling under Root-owned plan |
| `src/core/subagent-runtime.js` | SUBAGENT delegated Work Unit runtime |
| `src/governance/validator-runtime.js`, `analysis-validator.js`, `source-trace-verifier.js`, `semantic-proof-verifier.js` | VALIDATOR certification implementation |
| `src/core/task-service.js`, `repository.js`, `json-repository.js`, `database.js`, `attachment-store.js`, `cleanup-controller.js` | TASK_CORE durable facts / persistence / deterministic retention implementation |
| `src/governance/capability-contract-loader.js`, `governance-loader.js`, `governance-compiler.js` | Governance context composition mechanism; no Task business authority |
| `src/skills/skill-library-port.js` | SKILL library boundary only; concrete method packages are external |
| `src/core/model-router.js`, `executor-port.js`, `src/extensions/ports/*`, `src/extensions/executors/*`, `src/extensions/capabilities/*` | TOOL_EXECUTOR / execution-capability surface |
| `src/extensions/surfaces/*`, `src/extensions/runtime/surface-manager.js`, `src/ui/*` | UI_SURFACE / Surface transport |
| `src/server/app.js`, `http.js`, `bootstrap.js`, `index.js`, `mock.js` | transport/composition root; routes intents to Owner surfaces and must not acquire business authority |
| `src/core/runtime-settings.js` | user configuration persistence/supporting mechanism; configured intent is not a new system authority |
| `src/core/retry-policy.js` | deterministic runtime invariant shared by the runtime that owns the current execution unit |
| `src/core/types.js`, `src/version.js` | shared types/metadata; no independent authority |

This table is intentionally grouped by capability, not one Contract per file. Adding a new module requires asking whether it introduces a **new critical decision**. If not, it must be placed under an existing Owner instead of growing the authority graph.
