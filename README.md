# TaskBoard Codex v0.9.1

TaskBoard 是一个 local-first AI Task Board：**TaskBoard 管任务与可持久化事实，Executor 负责实际执行；Codex 是当前第一个 Executor 实现。**

日常使用不需要先理解内部架构。详细产品规则、能力边界、实现与当前状态都有各自唯一 Owner，本 README 只负责让人快速进入。

## 日常使用（Windows）

前提：Node.js 16.6+（开发建议 18+），Codex 按你平时的方式可用。TaskBoard 不管理登录、API Key、provider 或 billing。

1. 双击 `TaskBoard.vbs`。
2. 浏览器打开 `http://127.0.0.1:4317`。
3. 等左下角 Executor 状态稳定。
4. 创建 Task；后续拆分、调度、执行、重试和汇总由 TaskBoard 处理。
5. 使用 `退出 TaskBoard` 停止服务。

常用入口：

- `Start-TaskBoard-Debug.cmd`：启动并显示诊断信息；
- `Create-Desktop-Shortcut.vbs`：创建桌面快捷方式；
- `TaskBoard-in-Codex.vbs`：可选，将 TaskBoard Surface 嵌入 Codex Desktop；
- 若找不到可用 Codex CLI，Executor 可准备官方 standalone runtime；设置 `TASKBOARD_CODEX_AUTO_INSTALL=0` 可关闭该修复路径。

## 这个系统怎么工作

当前核心角色只有：

- **Scheduler**：Task 生命周期、接纳、并发、取消；
- **Root**：Task 级判断、规划、有限 Work Unit 创建与收敛；
- **Subagent**：执行一个边界明确的 Work Unit，并返回带来源的 Evidence；
- **Validator**：认证 Root Candidate Delta、限制越界结论、保留明确 Gap；
- **Task Core**：唯一持久化 Task 正式事实的 Owner；
- **Executor**：具体执行能力，不拥有 Task 业务语义。

关键原则不是靠不断增长 Prompt 规则维持，而是由 Constitution / Capability Contract 定义语义，Runtime/Test 执行和证明其后果。

## 当前是什么

当前 Release 与仍有效/未实现的能力统一看：

`docs/CURRENT_STATE.md`

不要从 README、旧 PR、历史分支或聊天推导当前 Runtime 真相。当前仓库状态与当前 Runtime/Test Reality 冲突时，以更新的真实证据为准并修正真正 Owner。

## 想知道什么，看哪里

- **产品第一原则** → `docs/PRODUCT_CONSTITUTION.md`
- **当前 Release / 当前有效事实 / 外部限制** → `docs/CURRENT_STATE.md`
- **能力由谁拥有** → `docs/CAPABILITY_MAP.md`
- **能力精确 Contract** → `docs/CAPABILITY_CONTRACTS.md`
- **为什么采用当前架构** → `docs/ADR.md`
- **系统结构与数据/运行关系** → `docs/ARCHITECTURE.md`
- **产品/行为规格** → `docs/SPECIFICATION.md`
- **Codex 集成细节** → `docs/CODEX_INTEGRATION.md`
- **验证与 Release proof** → `docs/VERIFICATION.md`
- **维护时的架构诊断方法** → `docs/ARCHITECTURE_REVIEW.md`

读取原则：先从当前问题找到最小 Owner，只读本轮需要的文档；不要把所有 Authority 一次性塞进上下文。

## 维护原则

TaskBoard 自身已经采用的方向保持不变：

`Reality -> Owner -> Delta -> Proof -> Reality`

- 新问题先看当前 Reality，不从历史重新演绎；
- 一个关键语义只允许一个 Owner；
- 没有会改变行为/判断的 Delta，就不新增持久化材料；
- 能由现有 Owner 吸收的内容不再建新 Rule / Manager / Gate；
- 只有必要 Proof 完成后，候选变化才成为当前事实；
- 已被吸收且不再承担责任的临时分支、过程记录、重复测试或说明应退出 Hot Path。

这与 `PRODUCT_CONSTITUTION.md` 的 Lightweight First / Explicit Singular Authority / Preserve Valuable State, Not Process 一致；README 不再复制这些规则正文。

## Development

```bash
npm install
npm run verify
npm start
```

Release 完成条件与 fresh-unpack / artifact identity / SHA 要求统一看 `docs/CURRENT_STATE.md` 与 `docs/VERIFICATION.md`。
