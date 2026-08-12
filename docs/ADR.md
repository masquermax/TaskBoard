# Architecture Decisions

Status markers: 💡 IDEA · 🟡 PROPOSED · 🔒 ACCEPTED · ↪ SUPERSEDED

## ADR-0001 ↪ SUPERSEDED — Lead Agent Is the Sole Task Owner
Superseded by ADR-0013 and ADR-0014. Root/Lead no longer owns Task lifecycle state.

## ADR-0002 ↪ SUPERSEDED — Subagent Is a Short-Lived Worker
Superseded by ADR-0027 and the active Subagent Capability Contract.

Subagent 是 Root Agent 分配的短生命周期具体执行者。

## ADR-0003 ↪ SUPERSEDED — Subagent Has No Task State Authority
Superseded by ADR-0027 and the active Subagent/Scheduler Capability Contracts.

Subagent 不能修改 Task 业务状态。

## ADR-0004 ↪ SUPERSEDED — Subagent Has No Human Interaction Authority
Superseded by ADR-0027 and the active Subagent/Human Gateway Capability Contracts.

Subagent 不能直接触达用户或 Human Gateway；只向 Root Agent 返回 Result/Finding/Blocker/Uncertainty/Recommendation。

## ADR-0005 🔒 — Scheduler Owns Task Admission; Root Owns Per-Task Subagent Allocation
Derived from C-001 / C-002 / C-004. Scheduler 只在真实 Root 执行资源已获得后把 READY Task 纳入 RUNNING；Root 决定本 Task 内部工作如何拆分并按需创建 Subagent。用户只设置 Task 并发上限和“每个 Root 最大 Subagent 数”，不承担 Agent 调度。资源不预留、不抢占：配置/明确能力上限降低时，已有执行自然完成，系统停止新增直到数量收敛到有效上限。

## ADR-0006 🔒 — Duplicate Assignment Must Be Prevented
一次有效执行中，同一 Task/工作单元只能有一个有效执行者。MVP 由单本地 Scheduler、Root Runtime 与内存 claim 保证。

## ADR-0007 🔒 — Dynamic Model Routing
模型选择按阶段/工作单元动态路由，Task 不绑定固定模型。Core 不保存 Codex 模型/线程等执行器私有字段。

## ADR-0008 ↪ SUPERSEDED — Lead Owns Human Escalation Decision
Superseded by ADR-0015. Root Agent 判断执行是否需要人；Scheduler 拥有 Task 是否进入/离开 WAITING_HUMAN 的唯一状态权限。

## ADR-0009 🔒 — Task Core Is Source of Truth
Task、用户补充、Human Gateway、最终结果、引用关系等业务事实由 Task Core 管理；Executor 会话不是业务事实来源。

## ADR-0010 🔒 — Single Local Scheduler (MVP)
MVP 使用单本地 Scheduler，不设计分布式协调。

## ADR-0011 🔒 — Stage-Boundary Recovery
未提交阶段中的可重复、无副作用工作在恢复时重新执行；系统不恢复 Agent 执行指针，而从最近有价值的任务事实与当前真实环境重新规划。

## ADR-0012 🔒 — Executor Is an Extension
第一版只实际接入 Codex，但 Core 只依赖 ExecutorPort。Codex thread、JSON-RPC、approval、模型字段不得进入 Task 核心模型。

## ADR-0013 ↪ SUPERSEDED — Scheduler Is the Task Lifecycle Owner
Superseded by ADR-0027 and the active Scheduler Capability Contract.

只有 Scheduler 有权编排 Task 的 READY / RUNNING / WAITING_HUMAN / COMPLETED，以及取消、逻辑删除、锁定等 Task 生命周期行为。UI、Root Agent、Subagent、Executor 都只能提交事实或意图，不能直接改 Task 状态。

## ADR-0014 ↪ SUPERSEDED — Root Agent Is the Execution Owner
Superseded by ADR-0027 and the active Root Capability Contract.

Root Agent 被 Scheduler 指派后负责理解目标、规划阶段、拆分工作、管理依赖、安排 Subagent、聚合结果与判断执行下一步。Root Agent 不拥有 Task 生命周期。

## ADR-0015 ↪ SUPERSEDED — Human Gateway Is a Thin Human Channel
Superseded by ADR-0027 and the active Human Gateway Capability Contract.

Root Agent 负责判断是否出现真正阻塞执行的用户拥有信息；进入 Human Gateway 前先将执行收敛到静止。Scheduler 验证静止后才迁移到 WAITING_HUMAN。Human Gateway 只负责展示问题和传回答案，不做业务判断、不改 Task 状态。

## ADR-0016 🔒 — Task Status Migration Uses Quiescent Boundaries
非静止 Task 需要离开 RUNNING 时，Scheduler 先要求 Root Agent 停止继续派发并收敛/中断当前执行；Root Agent 回报结束且 Scheduler 确认无有效执行 claim 后，Scheduler 才迁移 Task 状态。QUIESCENT 是内部条件，不是第五个用户状态。

## ADR-0017 🔒 — Retry Is Hard-Capped
凡被系统判定为“允许重试”的故障，统一最多进行 5 次总尝试。首次失败即为 1/5；失败计数 `>= 5` 时不得产生第六次自动尝试并进入挂起。确定性、不可重试错误不进入 Retry 流程，可首次失败即挂起。

## ADR-0018 🔒 — Integrations Have Three Independent Extension Axes
External integrations are decomposed into generic **Execution Adapter / Capability Provider / Surface Host** axes. Codex is only the first implementation. Task Core must not depend on Codex-specific account, model-provider, App Server, CDP, or desktop UI details. Surface availability does not determine Executor availability, and Executor availability does not require its visible desktop client to be open.

## ADR-0019 🔒 — Capability Discovery Is Automatic and Read-Only
Capability discovery is an internal control-plane mechanism, not a user workflow. It must not log in/out, collect/store API keys, switch providers, or write external configuration. Known capability may be used only within the executor-declared range; unknown or context-mismatched capability falls back to executor defaults instead of being guessed. Discovery failure must not create Human Gateway.

## ADR-0020 🔒 — CDP Is an Optional Surface Transport
CDP may be used to embed TaskBoard into compatible Chromium/Electron hosts without moving Task ownership or execution into that host. CDP endpoints are local-only, injection must be idempotent, and failure of a CDP Surface must leave the standalone TaskBoard and execution pipeline available.


## ADR-0021 🔒 — Executor Runtime Bootstrap Stays Behind the Execution Adapter
Task Core 不管理外部执行器安装。某个 Execution Adapter 可以为自己的机械运行依赖做只读解析和必要的自动 bootstrap，但不得借此管理登录、API Key、Provider 或计费配置。Codex/Windows 优先复用现有 CLI；缺失时使用 OpenAI 官方 standalone installer 后台准备运行时，不要求 npm。该过程不进入 Human Gateway，失败也不得由高频健康检查无限重复安装。

## ADR-0022 ↪ SUPERSEDED — Governance Is Compiled Before Agent Execution
Superseded by ADR-0029. ADRs are engineering decision memory and are no longer injected wholesale into ordinary Task execution.

TaskBoard 在 Root/Subagent 开始工作前，将 Product Constitution、Active ADR 与适用的 Active Rules 编译为同一份只读 Policy Context。运行时优先级为 Constitution > Active ADR > applicable Active Rules > current Task request > Agent heuristics/best practices。Superseded ADR 仅保留历史，不进入运行时 Policy Context。Governance Compiler 是确定性组件，不拥有 Task 生命周期。

## ADR-0023 ↪ SUPERSEDED — Analysis Uses Source Anchor → Evidence → Claim → Gap → Recommendation With a Publication Gate
Derived from C-003 / C-004. 分析/审查/需求类 Task 的 DIRECT Evidence 必须保留具体 Source Anchor（locator + source-near observation），再生成受证据强度/范围约束的 Claim；缺失信息形成 Gap；Recommendation 必须由明确 `kind=problem` Evidence 或有效 Gap 触发。跨系统 Claim 逐 Hop 取证，新增能力遵循 reuse-before-expansion。确定性违规由 Validator/Enforcer 直接删除、降级或转 Gap；高风险语义只允许对已有 Source Anchor 做窄复核。仍有阻塞 Gap 时 Root 只能提交受限 Patch（判断非阻塞或请求 Human Gateway），不能整份重写结果或重新调查。剩余 HARD 违规禁止发布。

## ADR-0024 ↪ SUPERSEDED — Progress History Is System-Derived Valuable Knowledge, Not Agent Activity
Derived from C-005. `历史进展` 记录已经形成并会影响后续继续/恢复/判断的知识边界，与该工作由 Root 还是 Subagent 完成无关。分析任务由系统从通过 Governance 的 Claims/Gaps 自动提炼 Progress Commit，不依赖 Agent 自愿填写 History。Shell 命令、文件计数、临时目录、解析器限制和其他可重建过程不得作为业务历史节点。

## ADR-0025 ↪ SUPERSEDED — Delegation Is Adaptive, Not Mandatory
Superseded by ADR-0027, Root Capability Contract, and Skill-driven bounded work.

Derived from C-001 and C-002. Root 可以直接完成短小局部验证；当多个独立证据域都需要非轻量调查、并行能明显缩短有效路径时，Root 应优先少量 Delegate。不得为了展示多 Agent 而强拆，也不得长期把可并行的独立调查全部串行压在 Root 上。


## ADR-0026 ↪ SUPERSEDED — Validator Is the Peer Certification Authority
Superseded by ADR-0027 and the active Validator Capability Contract. The detailed v0.7 model-review behavior is intentionally not preserved as authority.

Derived from C-001 / C-003 / C-004 / C-005. Validator 是与 Root 平级的系统角色，不是单一常驻 Agent 或全局串行队列。Scheduler 拥有 Task 生命周期权；Root 拥有分析/组织权；Subagent 仅拥有具体执行权；Validator 拥有认证权。Subagent Result 必须先经 Validator 才能作为可靠输入交给 Root；Root 自己的调查、综合、Checkpoint 与 Final Result 同样必须经过 Validator，只有 Root 层经认证的 Task 结论才有资格进入正式结果或 History。

Validator 校验以可追溯原始证据地址为依据，而不是 Root/Subagent 对来源的转述。确定性检查优先；只有 Source-near 之外的语义转换、视觉语义、跨来源/跨系统关系等无法机械证明的高风险 Claim 才请求窄范围语义认证，不允许恢复 v0.6.0 那种整份结果二次重审。第一次未通过允许一次针对性重做；再次不成立时必须保留可认证部分，并把剩余内容转换为明确 Gap/待确认，不得静默删除。

Validator 决定一个已认证 Root 结果是否形成新的、有未来价值的 History 边界；Task Core 只执行该决定并原子持久化，写库成功后才算 Commit 并对 UI 可见。Subagent 认证本身不直接写 History。不同 Task/Work Unit 的认证可并行，局部认证不阻塞无依赖 Subagent，Validator 不计入每 Root Subagent 上限。若 Validator 或其要求的针对性重做暂时拿不到执行资源，保留候选结果/审核反馈并在资源恢复后续接，不为认证资源短缺重跑已经完成的 Root/Subagent 工作。

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
Derived from C-001 / C-004 / C-005. Root is the Task reasoning/organization authority, not an implicit project writer. Root control Turns receive only TaskBoard-managed scratch write access and keep Project Scope read-only. A concrete project mutation is represented by a delegated Work Unit with `projectAccess=write`; Runtime grants that access only when the Task is execution-mode and only inside the declared Project Scope. Read-only Work Units may use TaskBoard-managed scratch without gaining project write authority.

When Root reaches a certified Task convergence decision, remaining no-side-effect read-only Work Units may be stopped because they no longer have future value. This does not change the non-preemption rule for resource-limit reductions, and write-capable Work Units are not force-aborted merely to shorten completion latency; they first reach a safe boundary.
