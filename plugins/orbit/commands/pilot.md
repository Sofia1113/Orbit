---
name: pilot
description: Orbit 工作流唯一显式斜杠入口。仅当用户调用 `/orbit:pilot` 时启动：判断密度（low/medium/high），初始化 .orbit 任务目录，并在命令内部推进 low_engine / medium_engine / high_engine。
disable-model-invocation: true
argument-hint: "[task]"
---

pilot 解决"任务该走多重的流程"这一个问题。它是 Orbit 唯一用户斜杠入口、密度判定器与层级 engine controller，后续阶段都在本命令内部渐进披露，不暴露任何 Claude Code skill。

用户体验目标：让用户明确选择使用 Orbit 后，立刻知道本任务为什么是 low / medium / high，并在没有用户决策点、阻塞或评估失败时由 pilot 继续自动推进到该密度的自然完成点。pilot 的中间输出应短、确定、可追踪；不要只在 triage 停下，除非下一阶段必须由用户决策。

触发约束：pilot 是显式斜杠命令入口，并且是 Orbit 唯一外部斜杠入口，不应由模型在普通工程任务中自动调用。只有用户输入 `/orbit:pilot` 或明确要求使用 Orbit 工作流时才运行；Orbit 不暴露任何 Claude Code skill，阶段只作为本命令内部的渐进式工作流状态。

## triage 双层判断

**先用启发式快速分流，仅当启发式落入模糊区时再调用客观锚点。** 这样避免 pilot 为取量化证据反复 Explore 浪费 token。

### 第一层：思考密度启发式（默认路径）

按顺序提问，首个 Yes 即为最终 density；全部 No → low。

**Q1（思考密度）**：本任务是否需要在多种实现方案之间做权衡，或需要架构性设计判断？

- 信号："有几种做法" / "怎么设计" / "架构应该怎么拆"，跨模块协议、选型分歧、新模块引入
- → Yes = **high**，路由到 `high_engine`；进入 design 前确认是否使用 `git worktree`，若用户原始任务已明确说明“使用 / 不使用 worktree”，记录该决定并继续

**Q2（边界密度）**：本任务的改动范围是否需要先收敛边界、明确"做什么 / 不做什么"才能开始编码？

- 信号：目标区域未知、需先理解现有系统能力才能定范围、改动可能跨越多个未知文件、用户要求“找出 / 定位 / 先明确边界”后再修改
- 即使最终只改 1 个文件，只要执行前必须先定位目标文件或确认修改边界，也判为 **medium**
- → Yes = **medium**，路由到 `medium_engine`

**Q3（实现密度）**：本任务是否目标明确、单轮可完成、无设计分歧？

- 信号："把 X 改成 Y" / "加一个 Z 参数" / "修这个拼写错误"；单文件 / 已知路径 / 一句话描述完
- → Yes = **low**，路由到 `low_engine`

启发式信号清晰时直接出 `decision_path` 与 `density`，不必进入第二层。

### 第二层：客观锚点（仅当第一层模糊时调用）

进入条件：

1. Q1 / Q2 / Q3 都"半信半疑"，信号弱
2. 用户描述与代码事实可能冲突（用户说"很简单"但任务可能跨多模块）

进入前**先调用 `Explore` agent** 取事实，再对照锚点判断：

**Q1 锚点（任一满足即判 high）**：

- 涉及 ≥2 个模块的接口 / 协议变更
- 存在 ≥2 种可互相替代的实现路径且无法立即排除
- 改动会影响其他团队 / 系统的数据契约

**Q2 锚点（满足第 1 条，或第 2/3 条同时出现时判 medium）**：

- 涉及 ≥3 个需要修改的文件且边界未划定
- 目标代码区域无现有测试覆盖且上次修改 >30 天
- 用户描述缺具体文件路径或接口名称，且 Explore 后仍无法定位明确改动点

**Q3 锚点（必须全部满足才判 low）**：

- 涉及文件数 ≤3 且已知路径
- 改动逻辑可用一句话完整描述
- 不涉及新增模块 / 抽象 / 接口

### 硬规则（优先于两层判断）

- 需要 review gate 或多阶段恢复 → 至少 `high`
- 需求模糊且需要方案比较 → `high`
- 需要先收敛边界 → 至少 `medium`

### 仍模糊时

第二层锚点检查后仍无法稳定判断 → 用 `AskUserQuestion` 请用户确认 density，并把答案写入 `triage_result.rationale`。

## 路由与自动推进

pilot 是 engine controller，不是只做 triage 的分类器。完成 triage 后必须立即沿对应 engine 自动推进，直到任务 completed，或遇到明确暂停条件。

| density | 内部 engine | 自动推进路径 | 允许暂停点 |
|---|---|---|---|
| low | low_engine | `triaged → executing → verifying → completed` | 缺上下文、执行阻塞、verify FAIL / INCOMPLETE、用户打断 |
| medium | medium_engine | `triaged → scoping → executing → verifying → completed` | scoping 发现必须由用户选择的边界、执行阻塞、verify FAIL / INCOMPLETE、用户打断 |
| high | high_engine | `triaged → worktree decision → designing → planning → executing → verifying → reviewing → completed` | worktree 决策、design approval、planning 歧义、执行阻塞、verify/review FAIL 或 INCOMPLETE、用户打断 |

medium 的 scoping 规则：如果用户已在原始任务中给出足够边界（例如明确“放在 site/xxx.html”“不新增依赖”“验收项如下”），不得再停下询问；直接写 `scope.md` 并继续 executing。只有存在多个合理落点且原始任务没有偏好，或执行会越过未知边界时，才用 `AskUserQuestion` 暂停。

### 执行算法

1. 先创建或更新本阶段 `TaskCreate` 清单，并保持任意时刻只有一个 `in_progress`。
2. 初始化 `.orbit/.gitignore` 与 `.orbit/state/<task_id>/`，写入 `triage.md` 和 schema 合法的 `runtime.json`。
3. 为执行阶段写入 `task_packet.json`；即使 low 任务也必须写，且必须严格符合 `state/task-packet.schema.json`，禁止写入 `title` / `goal` / `allowed_changes` 等 schema 外字段。
4. execute 可由主会话直接完成或 dispatch executor；完成后只写 `execution.md`，不得写验证结论。
5. verify 必须 dispatch 独立 `evaluator` subagent，并完整注入 `task_packet`、`execution` 摘要、验证证据和 acceptance；主会话不得自评 PASS / FAIL。
6. high 的 reviewing 必须依次 dispatch `spec-compliance-evaluator` 与 `code-quality-evaluator`，两个 verdict 都 PASS 后才能完成。
7. evaluator 返回 PASS 后，主会话只把独立 verdict 转写进 `verification.md` / `review.md`，再更新 `runtime.json`。
8. evaluator 返回 FAIL / INCOMPLETE 时，按返回结果进入 `repairing` / `paused`，不得自行翻转为 PASS。

## task_id 命名

- 路径安全：仅含小写字母、数字、连字符（如 `rename-login-field`）
- 与可读 `title` 共存（如 "将登录响应字段从 token 改为 access_token"）
- 子任务由 planning 生成，格式 `<parent_task_id>.<n>`

## 输出

pilot 最终输出应反映本次自动推进后的真实状态，而不是固定停留在 triage。

| 字段 | 说明 |
|---|---|
| `task_id` | 路径安全标识符 |
| `title` | 可读任务描述 |
| `density` | `low` / `medium` / `high` |
| `current_stage` | 当前真实 stage：通常为 `completed`，或暂停/失败时的 `scoping` / `paused` / `repairing` |
| `triage_result` | `decision_path` (Q1/Q2/Q3) + `density` + `rationale` + `hard_rules_triggered` |
| `engine_path_taken` | 本次实际走过的 engine 阶段列表 |
| `required_artifacts` | 本次写入的工件路径列表 |
| `next_action` | 若 completed 则写完成摘要；若暂停则写唯一恢复动作 |
| `next_event` | 最后一个事件：通常为 `VERIFY_PASS` / `REVIEW_PASS`，暂停时为 `PAUSE` / `INCOMPLETE` / `BLOCKED` |

## 工件与状态

- 所有 Orbit 工件必须写入 `.orbit/state/<task_id>/`；`.orbit/<task_id>/`、仓库根目录或其他路径都无效。
- triage 后继续写入后续阶段工件，不得只写 `triage.md` 后停止。
- low 最少写入：`.orbit/state/<task_id>/triage.md`、`task_packet.json`、`execution.md`、`verification.md`、`runtime.json`。
- medium 最少写入：`.orbit/state/<task_id>/triage.md`、`scope.md`、`task_packet.json`、`execution.md`、`verification.md`、`runtime.json`。
- high 最少写入：`.orbit/state/<task_id>/triage.md`、`design.md`、`plan.md`、`task_packet.json`、`execution.md`、`verification.md`、`review.md`、`runtime.json`。
- `runtime.json` 必须严格符合 `state/runtime-state.schema.json`，禁止新增 schema 外字段；`engine_path_taken`、`required_artifacts` 只能出现在最终用户输出，不得写入 runtime。
- `runtime.json.artifacts` 必须完整包含 `triage / scope / design / plan / execution / verification / review / handoff / task_packet` 九个槽位，未使用槽位写 `null`。
- `triage_result.decision_path` 必须是 `Q1` / `Q2` / `Q3`，详细判断过程写入 `triage.md`，不得在 runtime 中写数组。
- `verification_level` 必须按 density 写入：low=`optional`、medium=`required`、high=`required_plus_review`。
- `task_packet.json` 必须符合 `state/task-packet.schema.json`：必填 `task_id / stage / task_spec / scene / files_in_scope / acceptance / out_of_scope / next_action`，无额外字段。
- 覆写既有 `runtime.json` 前必须先 `Read` 当前文件；不要用未读直接 `Write` 导致流程中断。
- `first_executor` 必须固定为 `primary-session`，`current_owner` 只能在阶段切换时按协议更新；完成态 `status` 必须为 `completed`。
- 进入 `completed` 前必须已有 `verification.md`，且包含 `## Evaluator Verdict`、独立 evaluator 名称、`result=PASS` 与证据摘要。
- 首次创建 `.orbit/` 目录时同时写入 `.orbit/.gitignore`（内容 `*`）。
- 其他持久化、任务清单、通用退出自检见 [state-protocol.md](../references/state-protocol.md)。

## 优先工具

`Explore`（不熟悉代码区域时优先于猜测）/ `Glob` / `Grep` / `AskUserQuestion`（兜底）。详见 [native-tools.md](../references/native-tools.md)。

## 本命令退出条件

- [ ] `task_id` 与 `title` 已确定（必要时通过 `AskUserQuestion` 确认）。
- [ ] `.orbit/.gitignore` 首次已写入。
- [ ] `triage_result.decision_path` 与 `density` 一致。
- [ ] engine 已按密度自动推进到 completed，或已因明确暂停条件停止。
- [ ] 若 density 为 low：已完成 execute 与独立 evaluator verify，并在 `.orbit/state/<task_id>/` 写入 `task_packet.json` / `execution.md` / `verification.md` / `runtime.json`。
- [ ] 若 density 为 medium：已完成 scoping、execute 与独立 evaluator integration verify，并在 `.orbit/state/<task_id>/` 写入 `scope.md` / `task_packet.json` / `execution.md` / `verification.md` / `runtime.json`。
- [ ] 若 density 为 high：进入 design 前已处理 worktree 决策；若用户批准继续，已完成 planning、execute、独立 evaluator verify 与双阶段 reviewing。
- [ ] `runtime.json` 符合 `state/runtime-state.schema.json`：必填字段齐全、无额外字段、artifact 九槽位完整、`triage_result.decision_path` 是单个枚举值。
- [ ] 只有当 `runtime.json.stage=completed`、`last_event=VERIFY_PASS` 或 `REVIEW_PASS`、`artifacts.verification` 指向有效 `verification.md` 时，最终输出才允许写 `current_stage=completed`。
- [ ] 最终输出的 `current_stage`、`next_event`、`next_action` 与 `runtime.json` 一致。
