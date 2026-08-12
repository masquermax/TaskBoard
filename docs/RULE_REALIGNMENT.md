# Rule Realignment v1

Status: ACTIVE

本文件记录 v0.8 架构归位结果，用于代码审查，不进入运行时 Agent Prompt。

## 原有规则归位

| 原内容 | v0.8 归属 | 处理 |
| --- | --- | --- |
| AR-001 Truth Boundary | Constitution C-003 + Validator Contract + source trace runtime invariant | 删除 Active Rule；不再重复注入 Prompt |
| AR-002 Gap/Recommendation Boundary | C-003 保留事实边界；“如何产出 Gap/Recommendation”移到 Skill/输出结构 | 删除 Active Rule；移除通用最佳实践/新增能力等专用补丁校验 |
| AR-003 Minimum Sufficient Investigation | C-001 + reusable method experience | 删除 Active Rule；具体方法进入外部 Skill 包，不回流 Core Governance |
| AR-004 Certification Gate And Authority | C-004 + Capability Map + Validator/Root/Task Core Contracts | 删除 Active Rule；由 Runtime capability ownership 实现 |
| “Subagent 不得改 Task 状态/联系用户/管理其他 Agent” | Subagent Contract + Runtime Surface | 不再作为多条分析 Rule；Contract 未授予这些能力 |
| “Root 决定规划/Delegation/综合” | Root Contract | 从 Prompt patch 归为正式能力 |
| “Validator 决定认证/History 价值” | Validator Contract | 从长 ADR/Prompt 归为正式能力 |
| “Task Core 只负责持久化，不做业务判断” | Task Core Contract | 正式归位 |
| “如何定向搜索、何时停止” | external Skill method | 从 Governance/Root/Worker 大 Prompt 移出；具体方法不随 Core 打包 |
| “CDP/Executor/Capability discovery” | ADR + Tool/Executor Contract | 保留为工程架构，不注入普通 Task Agent Prompt |

## 被取消的运行时大 Prompt 模式

v0.7 运行时将 Constitution + 全部 Active ADR + Analysis Rules 同时注入 Root/Subagent/Validator。v0.8 起：

```text
Runtime Context = 当前角色 Capability Contract
                + 当前 Task / Work Unit 必要上下文
                + 当前 Work Unit 选择的外部 Method（仅执行者）
```

ADR 是工程决策记忆，供维护 TaskBoard 的 Agent/开发者阅读，不再作为普通业务 Task 的通用运行时 Prompt。
## 不再升级成 Rule 的确定性机制

以下内容有真实约束，但不再作为 Agent Rule 重复注入：

- 最多 5 次重试、capacity wait 不计失败 → `RetryPolicy` runtime invariant。
- day 91 cleanup、锁定/引用保护 → Task Core 的 deterministic retention implementation。
- 运行时两个 1–5 资源配置 → 用户配置事实 + Scheduler/Root 各自 owned ceiling。
- Task 状态转换、History 原子写入、Project Scope write capability → Capability Contract + Runtime/API surface。

这些机制仍须符合 Constitution 与当前 Capability/Runtime 语义；ADR 只记录为什么采用这些机制。**实现已经能机械保证的事实不再复制成 Prompt 规则**。

