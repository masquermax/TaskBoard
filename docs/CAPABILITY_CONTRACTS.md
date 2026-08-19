# Role Guides / Capability Documentation v2

Status: ACTIVE — NON-AUTHORITATIVE ROLE GUIDE

本文件是角色职责的人类可读说明与 Prompt 投影，不是 Runtime Authority 数据源。静态角色能力事实只来自 `src/governance/role-capability-contract.js`；Task-specific Authority 只来自 governed `TaskContract`；只有 `GovernanceCompiler` 可以把 Task facts、RoleCapabilityContract、Work Unit request、selected scope 与 policy 收窄成 `AuthorizedGrant`。Executor 只执行该 Grant 并报告 Runtime availability，不从本文件、Task wording、`taskMode` 或默认 sandbox 补权。

下列 `Owns` / `Capabilities` 用于解释位置职责；它们不能独立扩大机器 Contract 或 `AuthorizedGrant`。遇到自身职责之外的问题，按 `Handoff` 交回有权位置。

## SCHEDULER

Identity: Task lifecycle authority.

Purpose: 根据真实执行资源与已提交事实维护 Task 生命周期。

Owns:
- Task admission 与 READY / RUNNING / WAITING_HUMAN / COMPLETED 生命周期迁移。
- 取消、锁定、逻辑删除等 Task 生命周期裁决。
- Task 级并发上限与 Root admission。

Capabilities:
- 读取 Task Core 当前事实与 Root Runtime quiescence / execution claim。
- 请求 Root 开始、停止、恢复执行。
- 在满足真实边界后提交生命周期变更。

Produces:
- Task lifecycle decision。
- Scheduler activity state。

Handoff:
- Task 如何分析、拆分或继续 → Root。
- 业务结果是否成立 → Validator。
- 具体持久化实现 → Task Core 的 JSON Repository。

## ROOT

Identity: Task-level reasoning and organization authority.

Purpose: 持续掌握一个 Task，把当前目标拆成最小充分、可停止并尽可能并行的 Work Unit；结果返回后只把 Task 级结论与证据关系收敛成下一步，不复述问题、资料或 Subagent 调查过程。

Owns:
- Task 目标理解与执行规划。
- Work Unit 创建、依赖关系、优先顺序、Task Input 选择与能力请求。
- 是否 Delegate，以及为 Work Unit 选择 Skill。
- 已认证局部结果的综合、阶段判断、Gap 收敛与最终 Task Result 候选。
- 是否存在真正需要用户拥有信息的 blocker 候选。

Capabilities:
- 读取 Task Baseline、Task Input Catalog 的逻辑引用、Current Certified State、新 Subagent Result 与触发当前 Turn 的 Human answer；不取得 Project Scope 文件系统路径、附件本地路径或网络能力。
- 创建有限 Work Unit 并显式声明 `inputRefs`、`projectAccess=none|read|write` 与 `networkAccess`；Root 自己的控制/综合 Turn 不继承这些执行能力。
- 每个 Root Turn 只跨边界输出当前推进所需的最小充分 Decision Delta：目标拆分时只给出实际 Work Unit；结果回来时只形成必要的结论、Evidence 引用、Gap 与下一动作，不重新总结 Subagent 已表达的调查过程。
- 根据新发现调整计划；普通 Root Turn 必须由 Task 启动、新 Work Unit Result、已解决 Human Gateway 或技术恢复触发，Current Certified State 本身不产生新的 Root Turn。
- 当 Current Certified State 存在标记为 `blocking` 的 Gap 时，Root 必须把不安全的完成/收敛视为阻塞；若仍需系统可获得的证据，可以创建独立满足 Work Unit Contract 与 `AuthorizedGrant` 的有限 evidence-acquisition Work Unit。该 Work Unit 只能返回证据/局部发现，不能自行关闭 Gap；若剩余信息或决定确属用户拥有或系统不可获得，Root 再为该 Gap 提交 Human Gateway intent。
- 每次 Root 决策都把本轮形成/更新的 Task 级 Claims/Gaps 作为 Root Result candidate 提交 Validator；History 是否形成不由 Root 决定。

Produces:
- Work Unit。
- Root Result candidate。
- Human Gateway intent candidate。

Handoff:
- 有限 delegated execution → Subagent。
- 某类工作的成熟做法 → Skill。
- 结果认证 → Validator。
- Task 生命周期 → Scheduler。
- 状态/History 持久化 → Task Core。

## WORK_UNIT

Identity: A bounded work order created by Root; not an authority role.

Purpose: 把 Root 当前需要解决的一个具体问题表达成有限、可执行、可停止的工作。

Owns:
- Root 已决定的当前工作边界之结构化表达与完整传递。

Capabilities:
- 必须显式描述 `goal`、`expectedOutput`、`stopCondition`、`projectAccess`（`none` / `read` / `write`）、`networkAccess`、`inputRefs`、`dependsOn` 与可选 `skillId`。
- 通过 `inputRefs` 携带完成本工作所需的最小 Task 输入，并通过 `dependsOn` 接收前置结果。
- 未声明能力按最小权限处理：缺失/无效 Project 能力为 `none`，网络为关闭；Runtime 不补权。

Produces:
- 一个 delegated execution 的工作边界；当前 first-class executor 为 Subagent。

Handoff:
- 当前 Work Unit 已完成 → 以 Evidence / local Finding 交回 Root。
- 当前问题无法在现有证据/能力下闭合 → 只返回当前 Work Unit 的 Blocker / uncertainty 给 Root；是否形成 Task Gap、扩大 Scope 或创建新 Work Unit 仍由 Root 决定。

## SUBAGENT

Identity: Short-lived executor of one delegated Work Unit.

Purpose: 在给定 Work Unit 边界内使用指定 Skill/Tool 完成具体工作，达到 expectedOutput 后立即把最小充分结果交回。

Owns:
- 当前 Work Unit 的具体执行过程。

Capabilities:
- 只读取 Work Unit 通过 `inputRefs` 明确选择的 Task 输入与依赖结果；未选择的 Task 输入不进入该 Subagent 的 Task Context。
- `projectAccess` 是 Work Unit request，不是授权事实；最终 Project 能力只取 `AuthorizedGrant`。所选 Project 可被收窄到 `none` / `read` / `write`，其中 `write` 必须同时满足 machine Role capability、governed TaskContract authority、Work Unit request 与 selected Project scope。
- `networkAccess=true` 只表示 Work Unit 请求网络；Executor 仍可基于实际环境继续削减，未声明时网络关闭。
- 临时产物只写 TaskBoard-managed scratch；能力未声明时 Runtime fail-closed，不从 Task 或 Executor 默认值补权。
- 返回当前 Work Unit 必要的 source-near Evidence、局部 Finding、blocker / uncertainty；Finding 只表达当前 Work Unit 内由证据支持的局部发现，不定义 Task 级 Claim / Gap / Recommendation，也不建议新的 Task 工作。
- 一旦 expectedOutput 已由充分、可追溯的证据建立就结束；剩余时间、Tool budget 或可继续搜索本身都不是继续执行的理由。`stopCondition` 是工作边界，Codex Executor 的 steer / interrupt 只是最终技术停止保护，不替代这个业务停止判断。
- 当 Root 已形成经过认证的 Task 收敛决定时，可响应 Runtime 的停止请求结束仍在进行且无副作用的只读调查；写入型 Work Unit 不因这种收敛被强行中断。

Produces:
- Work Unit Result（必要 Evidence + local Findings + optional Blocker / uncertainty）。

Handoff:
- Task 级事实判断、Gap、Recommendation、下一步与完成判断 → Root。
- 新工作、扩大 Scope、下一阶段或更多 Agent → Root；Subagent 不生成这些 Task 级决定。
- 用户信息 → Root；Subagent 不直接进入 Human Gateway。

## VALIDATOR

Identity: Peer certification authority for Task-level candidate knowledge.

Purpose: 只判断 Root Candidate 中声明的关系是否被其引用证据与 Contract 支持；不替 Root 思考、不重新调查 Task。

Owns:
- Root Result / Candidate Delta 是否可成为正式 Task 结论。
- 已认证 Root Result 是否形成新的、有未来价值的 History 边界。

Capabilities:
- 核对 Root Candidate Delta 使用的可追溯原始证据地址与结构关系。
- 对可确定问题执行确定性认证。
- 在确实无法机械认证且存在可直接提供的精确原始语义输入时，仅检查当前具体 proof obligation；不得重新规划、浏览 Project Scope 或重新调查 Task。
- 语义证据不足时直接把 `CONFIRMED` 收窄为 `SUPPORTED` 并保留明确 Gap，或保持未被证明的 Gap resolution 为未闭合；不为同一证据边界额外要求一次 Root 模型重写。只有收窄后的认证状态确实改变合法控制动作时，才把控制权交回 Root。

Produces:
- Certified Result / Narrowed Result / Gap。
- History commit decision。

Handoff:
- 需要重新调查、重新规划或创建 Work Unit → Root。
- 原子持久化 → Task Core。
- Task 生命周期 → Scheduler。

## TASK_CORE

Identity: Business-state source of truth and persistence executor.

Purpose: 以原子方式保存 TaskBoard 已授权的业务事实。

Owns:
- Task、Project List、附件引用、Human Gateway、正式结果、History、引用关系等 durable facts 的一致性。
- 已完成数据在固定 retention policy 下的持久化清理一致性；清理策略本身由 Constitution/ADR/Specification 决定，不由 Task Core 临时发明。

Capabilities:
- 校验写入前置条件与不可变边界。
- 创建/读取 Task、Project List、附件元数据与引用等 durable facts。
- 原子写入/读取 Repository。
- 按固定 retention predicate 清理 eligible COMPLETED 数据，并保持数据库/附件的一致性与失败回滚。
- 在写入成功后暴露新的 durable state。

Produces:
- Durable Task state / History / Result。

Handoff:
- 生命周期决定 → Scheduler。
- 业务分析与规划 → Root。
- 结果是否正确 → Validator。

## HUMAN_GATEWAY

Identity: Thin transport between human-owned information and Task execution.

Purpose: 只在系统无法自行获得且确实影响继续执行时传递问题与回答。

Owns:
- 人类问题与回答的传递完整性。

Capabilities:
- 展示 Scheduler 已授权且绑定到一个当前认证 blocking Gap 的问题；Gateway question 必须保持该 Gap 的认证问题语义。
- 保存用户回答及系统验证出的 Gateway/Gap provenance 并交回 Task Core；普通 Root context 只接收触发当前 Turn 的回答，不自动重放全部历史问答。

Produces:
- Human answer fact。

Handoff:
- 是否需要询问用户 → Root candidate + Scheduler lifecycle decision。
- 回答如何影响 Task → Root。

## SKILL

Identity: User-owned reusable method asset supplied through a Skill library.

Purpose: 把“某类工作怎么做”的成熟经验作为独立方法资产供具体 Work Unit 复用。

Owns:
- 某类工作的可复用方法定义。

Capabilities:
- 声明适用工作、Method、方法 Contract、Capability Requirements 与 Stop Condition。
- 被 Skill library 发现，并在 Root 选择后作为当前 Work Unit 的方法上下文提供给执行者。

Produces:
- Method context。

Handoff:
- 何时使用哪个 Skill → Root。
- 具体 Work Unit 执行 → Subagent / assigned executor。
- 结果认证 → Validator。

## EXECUTOR

Identity: Operational capability surface.

Purpose: 执行文件读取、搜索、命令、模型 Turn、外部适配等明确操作。

Owns:
- 自身操作协议、能力声明与单次操作执行。

Capabilities:
- 暴露明确、可审计的操作能力与当前可用性。
- 在授权 Scope 内执行请求并返回结果。

Produces:
- Executor operation result。

Handoff:
- 为什么做、是否继续做 → 调用 Executor 的当前 Owner（Root / Subagent / Validator）。
- 结果是否构成正式事实 → Validator。
- Task 生命周期 → Scheduler。

## UI_SURFACE

Identity: User-facing display and intent surface.

Purpose: 展示 TaskBoard 真实状态并收集用户意图。

Owns:
- 视觉呈现与用户输入交互；不拥有 Task 业务状态。

Capabilities:
- 读取 Task/Core/Scheduler 暴露的状态。
- 提交 create / retry / cancel / answer / configuration 等用户意图。

Produces:
- User intent。

Handoff:
- 生命周期意图 → Scheduler / Task Core API。
- Human Gateway answer → Human Gateway / Task Core。