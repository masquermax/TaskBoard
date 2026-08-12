# Capability Map v1

Status: ACTIVE

Capability Map 是 TaskBoard 的全局能力与权力拓扑。它回答“系统里谁负责什么、谁可以把什么交给谁”，而不是告诉 Agent 某类工作具体怎么做。

核心语义：

- **TaskBoard / Task Core** = 工作操作系统与业务事实持久化。
- **Root Agent** = Task 级分析、规划、综合与收敛主体。
- **Work Unit** = Root 创建的一张有限工作单，不是新的管理层。
- **Subagent** = 一个 Work Unit 的短生命周期执行者。
- **Skill** = 某类工作如何做的方法，不拥有 Task 权力。
- **Validator** = 结果认证主体，不重新承担 Root 的 Task 分析职责。
- **Tool / Execution Adapter** = 实际操作与模型执行能力，不拥有业务决定权。

## 全局 Owner 图

```text
User / UI
   │ intent / facts
   ▼
Task Core ◄──────── certified durable write ───── Validator
   │                                               ▲
   ▼                                               │ Root Candidate Delta
Scheduler                                          │
   │ Task lifecycle                                │
   ▼                                               │
Root Agent ◄──── Evidence / local Findings ──── Subagent
   │                                           ▲
   │ creates                                   │ executes
   ▼                                           │
Work Unit ─────────────────────────────────────┘
   │
   ├─ Skill = method
   └─ Tool / Execution Adapter = operation

Human Gateway = only human-information transport when Root identifies a true user-owned blocker and Scheduler authorizes WAITING_HUMAN.
```

## 关键能力唯一 Owner

| 关键能力 | 唯一 Owner |
| --- | --- |
| Task 生命周期状态、Admission、READY/RUNNING/WAITING_HUMAN/COMPLETED | Scheduler |
| Task 目标理解、执行规划、Work Unit 创建/调整、Work Unit Project Scope 访问请求、Skill 选择、结果综合、任务收敛 | Root Agent |
| 一个 delegated Work Unit 的具体执行 | Subagent |
| Root Candidate Delta 是否可成为正式 Task 结论 | Validator |
| 已认证 Root Result 是否形成新的有未来价值 History 边界 | Validator |
| 状态/History 的原子持久化 | Task Core |
| 人类问题与回答的传递 | Human Gateway |
| 某类工作“怎么做” | Skill |
| 文件、搜索、命令、模型 Turn 等具体操作 | Tool / Execution Adapter |
| UI 展示与用户意图提交 | UI / Surface |
| Task 创建、Project Registry、附件、正式结果等 durable business facts | Task Core |
| 已完成且满足固定保留策略的数据物理清理 | Task Core（由 deterministic maintenance controller 执行） |
| 用户配置的 Task 并发 / 每 Root 最大 Subagent 上限 | User（UI 只传递；Scheduler/Root 分别执行自己的上限） |


## 非独立 Authority 的实现部件

以下部件可以有代码和状态，但**不因为存在一个 class/module 就自动成为新的 Authority role**：

- `Repository / Database / AttachmentStore / TaskService`：属于 Task Core 的持久化与 durable fact 实现面。
- `DailyCleanupController`：只执行已经确定的 retention policy；删除资格由固定 predicate 决定，不获得 Task 分析或生命周期裁决权。
- `RuntimeSettingsStore`：保存用户配置；不决定业务目标。Scheduler 只消费 Task concurrency，Root Runtime 只消费 per-Root Subagent ceiling。
- `RetryPolicy`：确定性 runtime invariant；谁拥有当前执行单元，谁按同一 policy 执行重试/挂起，不产生新的业务 Owner。
- `ModelRouter / CapabilityProvider`：属于 Tool / Execution capability surface，只报告或选择执行能力，不获得 Task 业务权力。
- `SurfaceManager / CDP host`：属于 UI / Surface transport，不获得 Task 业务权力。

原则是：**只有真正拥有一个关键决定的节点才需要成为 Authority Owner；纯机制应归入其 Owner 的实现面，而不是继续增加角色。**

## 权力冲突与真空检查

- 一个关键能力出现 **两个 Owner** = `Authority Conflict`，架构错误。
- 一个关键能力 **没有 Owner** = `Authority Vacuum`，不得让模型自行补位。
- 一个组件执行了 Contract 未授予的能力 = `Authority Leak`，应修正能力归属或 Runtime Surface，而不是再增加 Prompt 禁止条款。

## 当前明确不存在的正式能力

### Project Knowledge
v0.8 仍没有独立、可认证、可复用的 Project Knowledge 子系统。当前只有 Project Scope、Attachments、Referenced Completed Results 与 Human Gateway Answers 作为 Task 输入来源。不得把这些输入集合宣传成已经实现的 Project Knowledge。未来若实现，应新增独立 Capability Contract 与持久化边界。

### Generic execution side-effect proof
v0.8 中 Subagent 结果先作为局部 Evidence/Findings 交给 Root；只有 Root 形成的 Task-level Candidate Delta 进入 Validator 认证。强证据边界认证目前 first-class 覆盖 analysis structured knowledge。对于代码修改、部署等外部副作用，Runtime 仍依靠 Work Unit 的明确写权限、执行结果、测试/工具事实和 side-effect safety 边界；尚没有一个通用的“外部副作用已经正确发生”的独立 proof contract。不得把 non-analysis pass-through 宣传成已经完成了语义事实认证。

### Root-owned first-class Work Unit execution
v0.8 没有独立的 Root-owned Work Unit Runtime。Root 的直接能力限于 Task 级规划/综合：Runtime 只给 Root TaskBoard-managed scratch 与逻辑 Task-input 引用，不给 Project Scope 文件系统、附件本地路径或网络能力；独立证据获取或项目修改必须创建 delegated Work Unit 交给 Subagent。需要修改 Project Scope 的 Work Unit 必须显式声明 `projectAccess=write`，且 Runtime 只在 execution Task 中授权。未来若要让 Root 自己执行并在 UI 中作为独立 Work Unit 可观测，必须先新增明确的 Runtime capability，而不是只在 Prompt 中宣称存在。
