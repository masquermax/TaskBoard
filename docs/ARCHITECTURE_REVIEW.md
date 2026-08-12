# Architecture Review Method

Status: ACTIVE MAINTAINER METHOD — not runtime Agent law

TaskBoard 的架构诊断统一使用下面这条检查链。它不是新的 Constitution、Capability 或 Prompt Rule；它用于定位一个问题究竟发生在哪一层，避免用新的提示词补丁掩盖真正缺口。

```text
需求 / 原则
   ↓
Contract
   ↓
Owner
   ↓
Runtime Enforcement
   ↓
Context Exposure
   ↓
Test / Eval
```

五个固定问题：

- **哪个 Contract 没定义？** → 语义缺口（Semantic Gap）。
- **哪个 Owner 错了？** → Authority 错位；多个 Owner 是 Authority Conflict，没有 Owner 是 Authority Vacuum。
- **哪个 Runtime 没落实？** → Runtime Drift：设计正确，但代码没有真实执行。
- **哪个 Context 暴露错了？** → Context Leak：权限可能没越界，但角色看到不属于当前职责的信息而污染判断。
- **哪个 Test / Eval 没覆盖，所以漂移没有被发现？** → Eval Gap。

审查目标只有五个：**语义位置唯一、Owner 唯一、Runtime 真实、Context 最小、验证可证明。**

Prompt 只是 Runtime 根据系统定义生成的角色视图，不是架构事实源。若上层 Capability 已经决定一个位置没有某能力，优先检查 Runtime Surface 是否错误暴露该能力，而不是给角色增加“禁止使用”的负面规则。
