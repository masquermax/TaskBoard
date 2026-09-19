# Role Guides / Capability Documentation

Status: ACTIVE — NON-AUTHORITATIVE ROLE GUIDE

这里只描述当前角色边界与已实现能力。机器 Authority 来自 `RoleCapabilityContract + TaskContract + GovernanceCompiler -> AuthorizedGrant`；本文档不进入 Runtime 数据面。

## SCHEDULER

Identity:
- Task lifecycle authority.

Purpose:
- 让 Task 开始、等待、恢复、结束，并控制 Task 级并发。

Owns:
- Task lifecycle / admission。

Capabilities:
- 读取 Runtime 是否真正执行或静止，并提交合法生命周期迁移。

Produces:
- Task lifecycle state。

Handoff:
- 判断与拆分 → Root；执行 → Subagent；持久化 → Task Core。

## ROOT

Identity:
- The Task brain and sole Task-level judgment owner.

Purpose:
- 用当前最小充分信息持续推进目标。

Owns:
- 是否拆分、如何拆分、结果意味着什么、是否足够、下一步、Claim / Gap / completion judgment / Human Gateway intent。

Capabilities:
- 只读取当前判断所需的 Task input catalog、Claims/Gaps、未满足 obligations、当前 Work Unit 结果和当前 Human trigger。
- 只创建填补当前必要缺口的最小 Work Unit；互不依赖的工作一次并行给出。
- Work Unit 返回后由 Root 判断正确性、充分性与 Task 级含义；Subagent 不替 Root 判断。
- `CONFIRMED` 只依赖 DIRECT 来源；推断保持 `SUPPORTED`；未知保持 Gap。
- 完成某个 governed obligation 时，由 Root 在 CONFIRMED Claim 的 `obligationRefs[]` 中显式建立关系。
- 跨边界只输出新判断与下一动作，不重放旧过程。

Produces:
- Minimal Work Units。
- Task-level judgment delta。
- Next control action。

Handoff:
- 执行 → Subagent；来源核对 → Validator；生命周期 → Scheduler；durable state → Task Core。

## WORK_UNIT

Identity:
- A bounded execution order, not an authority role.

Purpose:
- 把 Root 已决定的一小件工作完整传给 Subagent。

Owns:
- 当前执行边界的结构化表达。

Capabilities:
- 明确 `goal / expectedOutput / stopCondition / obligationRefs / inputRefs / dependsOn / projectAccess / networkAccess`；未声明能力视为不存在。

Produces:
- One bounded executable order。

Handoff:
- 执行结果或 blocker → Root。

## SUBAGENT

Identity:
- The hands: executor of exactly one Work Unit.

Purpose:
- 指哪打哪，达到 Work Unit 停止条件立即返回。

Owns:
- 当前 Work Unit 的实际执行。

Capabilities:
- 只使用 Work Unit 选中的输入和 AuthorizedGrant。
- 可复用当前 Task 已经通过 Root + Validator 认证的 `knownClaims` 作为执行起点；不能把它们当作新增权限，也不能静默改写。
- 只返回 `result + source-near Evidence + optional blocker`。
- 不生成 Task Claim、Gap、Recommendation、confidence、uncertainty、Discovery、下一任务、完成判断或 Human Gateway。

Produces:
- Work Unit execution result / source locator / blocker。

Handoff:
- 所有判断与后续动作 → Root。

## VALIDATOR

Identity:
- The accountant: deterministic source/provenance checker.

Purpose:
- 只核 Root 引用的凭证是否真实且引用关系成立。

Owns:
- Source/provenance ledger correctness。

Capabilities:
- 来源真实且 DIRECT observation 与 locator 对应 → 保留 DIRECT。
- 来源真实但不能机械核对 → 只能 INDIRECT。
- Referenced completed Result 只能证明“这个历史 Result 的确这样写过”；原始来源链不会随引用自动继承，因此始终只作为 INDIRECT。
- 来源不存在、伪造、locator/observation 不匹配 → 拒绝。
- Claim/Gap/Step 引用不存在的凭证 → 拒绝。
- CONFIRMED 依赖 INDIRECT → 拒绝可信度升级。
- 不重新调查、不解释业务、不修 Root 结论、不决定 Gap 是否应该存在，也不调用模型。

Produces:
- Accepted / downgraded / rejected ledger result。

Handoff:
- 证据意味着什么、是否继续、Gap 是否闭合 → Root；durable state → Task Core。

## TASK_CORE

Identity:
- Durable business-state source of truth.

Purpose:
- 原子保存跨执行必须继续存在的事实。

Owns:
- Task / Project / attachment refs / Gateway / Certified State / Result persistence。

Capabilities:
- 校验写入前置条件并原子提交；不保存可由当前状态重建的认知过程噪音。

Produces:
- Durable Task state。

Handoff:
- 判断与规划 → Root；生命周期 → Scheduler。

## HUMAN_GATEWAY

Identity:
- Thin human-owned information transport.

Purpose:
- 只传递确实由人拥有且阻塞推进的问题与回答。

Owns:
- 问题与回答的传输完整性。

Capabilities:
- 问题绑定当前 blocking Gap；回答作为当前 Human trigger 交给 Root，不自动生成 Evidence 或 Gap resolution。

Produces:
- Human answer trigger。

Handoff:
- 回答的含义与是否足够 → Root。

## CERTIFIED_COGNITION_REUSE

Identity:
- A Runtime reuse capability, not a new memory store and not a semantic owner.

Purpose:
- 避免“已经付过一次验证成本的可靠结论，在下一执行步骤又从 UNKNOWN 开始”。

Trigger:
- 一个 Task 已存在 Certified State，且下一 Work Unit 即将执行。

Inputs:
- 当前 Task 的 Certified State。
- 当前 Work Unit 的 goal / stopCondition / governed boundary。

Runtime:
1. 只把 `CONFIRMED` Claims 投影成紧凑 `knownClaims`；不重放原始 WorkReceipt、日志或推演过程。
2. Subagent 把 `knownClaims` 当执行起点；不得仅为了重新发现同一事实而重复探测。
3. 只有当前 Work 明确要求重新验证，或新 Reality 给出具体冲突/失效信号时，才重新观察该事实。
4. 新 DIRECT Reality 与 `knownClaims` 冲突时，下层返回 source-near Evidence + blocker/observation；Root 决定 reopen / revise。同一 subject、同一事实槽位被新 DIRECT Evidence 推翻时，Root 修订原 Claim id 并引用新 Evidence，使 current Certified State 只保留一个 active 值；旧值由 turn history 保留，而不是另加一个矛盾 active Claim。
5. `knownClaims` 永远不能扩大 inputRefs、project/network access、Work goal 或 Task authority。

Failure modes:
- 已有足够 CONFIRMED 结论且无新理由，仍重复探测同一事实。
- 把 `SUPPORTED` 推断或历史 final_result 当成当前已确认事实下传。
- 新 Reality 冲突时在 Subagent 层静默覆盖旧结论。
- 新 DIRECT Reality 已推翻旧事实，却另建新 Claim，让新旧互相矛盾的值同时留在 current Certified State。
- 为了“记住”而重放完整历史，导致上下文重新膨胀。
- 借已知结论扩大执行权限或越过 Parent boundary。

Evidence / Evals:
- A1：先认证事实 X，再执行依赖 X 的 Work；下层必须收到 X，且不需要重新获取 X 才能继续。
- A2：同一事实只有 `SUPPORTED`；下层不得把它当 `knownClaims`。
- A3：新 DIRECT Reality 与 X 冲突；下层必须把冲突证据向上返回，不能本地改写 Certified State；Root 重开后必须让新值替换旧 active 值，不能只追加一个互相矛盾的新 Claim。
- A4：已知 X 不得改变 AuthorizedGrant。
- A5：真实服务器/项目任务中，第二次同类步骤的人肉信息中继和重复探测应下降。

Boundary:
- 这是同一 Task 内的 Certified cognition reuse；不等于跨 Task 的长期能力学习。
- 是否把一次经验升级成跨 Task Skill/Capability，仍需独立 Eval 与 Runtime adoption。

Reopen Trigger:
- 真实任务仍反复查询已有 CONFIRMED 事实；
- `knownClaims` 造成陈旧事实被盲信；
- 冲突 Reality 没有可靠上返；
- 新旧互斥事实同时留在 current Certified State；
- 为减少重复探测而引入了新的权限或正确性问题。

## SKILL

Identity:
- Reusable execution method asset.

Purpose:
- 给 Work Unit 提供方法，不成为 Authority。

Owns:
- 可复用 Method 与适用边界。

Capabilities:
- 只作为 Root 选定后的 Subagent 方法上下文。

Produces:
- Method context。

Handoff:
- 是否使用 → Root；执行 → Subagent。

## EXECUTOR

Identity:
- Operational capability surface.

Purpose:
- 在明确 Grant 内执行模型、文件、命令或外部操作。

Owns:
- 单次操作协议与实际可用性。

Capabilities:
- 只实现 AuthorizedGrant；不能从 Task wording、Prompt 或默认环境补权。

Produces:
- Operation result / runtime availability。

Handoff:
- 为什么调用、调用后怎么办 → 当前 Owner。

## UI_SURFACE

Identity:
- User-facing projection and intent surface.

Purpose:
- 如实显示 Task/Core/Scheduler/Runtime 状态并收集用户意图。

Owns:
- 展示与交互，不拥有业务真相。

Capabilities:
- 不把 Work Unit retry/failure 冒充 Task 起点或完成事实；不从视觉状态自行推导 Runtime 真相。

Produces:
- User-visible projection / user intent。

Handoff:
- 生命周期意图 → Scheduler / Task Core；Human answer → Human Gateway。