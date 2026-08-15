# Architecture Decisions

Status: ACTIVE DECISIONS ONLY — superseded decisions live in Git history

## ADR-0005 🔒 — Scheduler Owns Task Admission; Root Owns Per-Task Subagent Allocation
Derived from C-001 / C-002 / C-004. Scheduler 只在真实 Root 执行资源已获得后把 READY Task 纳入 RUNNING；Root 决定本 Task 内部工作如何拆分并按需创建 Subagent。用户只设置 Task 并发上限和“每个 Root 最大 Subagent 数”，不承担 Agent 调度。资源不预留、不抢占：配置/明确能力上限降低时，已有执行自然完成，系统停止新增直到数量收敛到有效上限。


## ADR-0006 🔒 — Duplicate Assignment Must Be Prevented
一次有效执行中，同一 Task/工作单元只能有一个有效执行者。MVP 由单本地 Scheduler、Root Runtime 与内存 claim 保证。


## ADR-0007 🔒 — Dynamic Model Routing
模型选择按阶段/工作单元动态路由，Task 不绑定固定模型。Core 不保存 Codex 模型/线程等执行器私有字段。


## ADR-0009 🔒 — Task Core Is Source of Truth
Task、用户补充、Human Gateway、最终结果、引用关系等业务事实由 Task Core 管理；Executor 会话不是业务事实来源。


## ADR-0010 🔒 — Single Local Scheduler (MVP)
MVP 使用单本地 Scheduler，不设计分布式协调。


## ADR-0011 🔒 — Stage-Boundary Recovery
未提交阶段中的可重复、无副作用工作在恢复时重新执行；系统不恢复 Agent 执行指针，而从最近有价值的任务事实与当前真实环境重新规划。


## ADR-0012 🔒 — Executor Is an Extension
第一版只实际接入 Codex，但 Core 只依赖 ExecutorPort。Codex thread、JSON-RPC、approval、模型字段不得进入 Task 核心模型。


## ADR-0016 🔒 — Task Status Migration Uses Quiescent Boundaries
非静止 Task 需要离开 RUNNING 时，Scheduler 先要求 Root 停止继续派发并收敛/中断当前执行；Root 回报结束且 Scheduler 确认无有效执行 claim 后，Scheduler 才迁移 Task 状态。QUIESCENT 是内部条件，不是第五个用户状态。


## ADR-0017 🔒 — Retry Is Hard-Capped
凡被系统判定为“允许重试”的故障，统一最多进行 5 次总尝试。首次失败即为 1/5；失败计数 `>= 5` 时不得产生第六次自动尝试并进入挂起。确定性、不可重试错误不进入 Retry 流程，可首次失败即挂起。


## ADR-0018 🔒 — Integrations Have Three Independent Extension Axes
External integrations are decomposed into generic **Executor / Capability Provider / Surface Host** axes. Codex is only the first implementation. Task Core must not depend on Codex-specific account, model-provider, App Server, CDP, or desktop UI details. Surface availability does not determine Executor availability, and Executor availability does not require its visible desktop client to be open.


## ADR-0019 🔒 — Capability Discovery Is Automatic and Read-Only
Capability discovery is an internal control-plane mechanism, not a user workflow. It must not log in/out, collect/store API keys, switch providers, or write external configuration. Known capability may be used only within the executor-declared range; unknown or context-mismatched capability falls back to executor defaults instead of being guessed. Discovery failure must not create Human Gateway.


## ADR-0020 🔒 — CDP Is an Optional Surface Transport
CDP may be used to embed TaskBoard into compatible Chromium/Electron hosts without moving Task ownership or execution into that host. CDP endpoints are local-only, injection must be idempotent, and failure of a CDP Surface must leave the standalone TaskBoard and execution pipeline available.



## ADR-0021 🔒 — Executor Runtime Bootstrap Stays Behind the Executor
Task Core 不管理外部执行器安装。某个 Executor 可以为自己的机械运行依赖做只读解析和必要的自动 bootstrap，但不得借此管理登录、API Key、Provider 或计费配置。Codex/Windows 优先复用现有 CLI；缺失时使用 OpenAI 官方 standalone installer 后台准备运行时，不要求 npm。该过程不进入 Human Gateway，失败也不得由高频健康检查无限重复安装。


## ADR-0027 🔒 — Capability Contracts Are the Runtime Authority Boundary
Derived from C-001 / C-004. TaskBoard defines authority positively through `Capability Map + Capability Contracts`, not by accumulating negative Prompt rules. Every critical capability has exactly one Owner. A component may act only through capabilities explicitly granted by its Contract; out-of-scope discoveries must be handed to the owning role instead of being implicitly absorbed. Runtime/API surfaces should expose the same boundary so correctness does not depend on Agent self-discipline.

A helper class/module does not become a new Authority merely because it has code or state. Deterministic mechanisms such as persistence, retry, cleanup, settings storage, model routing and Surface transport belong to the implementation surface of an existing Owner unless they truly own a new critical decision.

This ADR supersedes the role-authority content of ADR-0002/0003/0004/0013/0014/0015/0025/0026. Those ADRs remain historical evidence of how the boundary evolved.


## ADR-0028 🔒 — Skill Is External Reusable Experience, Not Core Governance
Derived from C-001 / C-004 / C-005. Skill stores reusable “how to do a class of work” experience. TaskBoard core owns only the Skill capability shape and the runtime boundary by which Root may select a method for a delegated Work Unit. Concrete/distilled Skill content is a user-owned asset and lives in an independent package/extension branch, so changing or growing the Skill library does not change Core Governance.

The Work Unit owns the concrete goal/output/stop/access boundary; Environment/Executor owns actual available operations. A Skill contributes method context inside that already-defined boundary. The core package therefore ships no concrete Skill library and does not implement cross-Task experience distillation in this branch.


## ADR-0029 🔒 — Runtime Context Is a Projection, Not a Repeated Rule Stack
Derived from C-001 / C-004. Product Constitution defines the system and Capability Contracts translate that definition into owned runtime surfaces. Ordinary Root/Subagent/Validator turns therefore receive the current role Capability Contract plus current Task/Work Unit inputs; a selected external method is added only to that Work Unit executor when applicable. Constitution, ADR and superseded Analysis Rules are not re-injected for each role to reinterpret.

The context compiler is deterministic and read-only. Runtime enforcement and schemas carry the authority boundary; role context describes the owned capability and current work rather than repeating system-wide prohibitions.



## ADR-0030 🔒 — Project Mutation Is an Explicit Delegated Work Unit Capability
Derived from C-001 / C-004 / C-005. Root is the Task reasoning/organization authority, not an implicit project reader/writer. Root control Turns receive only TaskBoard-managed scratch and do not receive Project Scope filesystem access or network capability. Project read/write is represented by a delegated Work Unit with explicit `projectAccess` plus selected `inputRefs`; `projectAccess` is a request, not an Authority fact. `GovernanceCompiler` may preserve `write` in the effective `AuthorizedGrant` only when machine Role capability, certified `TaskContract` Project authority, selected Project scope and the Work Unit request all permit it. `taskMode` does not grant Project mutation.

When Root reaches a certified Task convergence decision, remaining no-side-effect read-only Work Units may be stopped because they no longer have future value. This does not change the non-preemption rule for resource-limit reductions, and write-capable Work Units are not force-aborted merely to shorten completion latency; they first reach a safe boundary.
