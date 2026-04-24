---
name: planning
description: High 任务的方案拆解阶段。在 design 的推荐方案已获得用户显式批准、进入编码之前必须调用本 skill：把推荐方案拆成有序、可验证、可恢复的 `execution_steps`，产出主任务 `task_packet` 以及（必要时的）子任务 `task_packet`。目的是让 executor 消费固定 task_packet 而不必重新解释全局计划，避免上下文发散与重复判断。
---

目标：
- 把 design 阶段已批准的方案拆成可执行步骤
- 明确每一步的依赖、验证方式与完成标志
- 为 executing 阶段提供最小但充分的执行输入（`task_packet`）

路由规则（完成后触发）：
- `PLAN_DONE` → 调用 `execute` skill，进入 `executing`
- 若步骤被标记 `spawn_subtask` → 由 executing 阶段按需 dispatch `executor` subagent；父任务在 planning 阶段只产出 `subtask_packets`，不直接派发

约束：
- 仅 `high` 可进入本阶段
- 不重新打开已经确认的方案分歧
- 不直接写实现代码
- plan 服务执行，不重复 design 讨论内容
- 步骤必须可验证、可交接、可恢复
- 必须产出 `plan` 工件与 `task_packet` 工件才能声明 `PLAN_DONE`

状态持久化：
- `plan` 工件写入 `.orbit/state/<task_id>/plan.md`
- `task_packet` 工件写入 `.orbit/state/<task_id>/task_packet.json`
- 子任务 `task_packet` 写入 `.orbit/state/<subtask_task_id>/task_packet.json`，并初始化该子任务的 `runtime.json`（`stage: triaged`，`density: medium`，`last_event: TASK_CREATED`）
- 结束时回写父任务 `.orbit/state/<task_id>/runtime.json`：
  - `stage`：`planning` → `executing`
  - `last_event`：`PLAN_DONE`
  - `artifacts.plan` / `artifacts.task_packet`：工件路径
  - `next_action`：指向 executing 阶段的首个动作

事件流（append-only）：见 `state/README.md#事件流append-only`。本 skill 额外要求：若派发子任务，需为每个子任务独立 append 一行 `SUBTASK_SPAWNED`（子任务事件写入各自的 events.jsonl）。

子任务拆分（high → 多 medium）：
- 每个 `execution_step` 可标记 `spawn_subtask: true`
- 标记为子任务的 step 必须提供：`subtask_goal`、`subtask_scene`（父 scene 摘要）、`subtask_acceptance`、`subtask_out_of_scope`
- 子任务 `task_id` 格式：`<parent_task_id>.<n>`（n 从 1 起）
- 子任务默认 density = medium；若子任务本身仍需方案比较，升级为 high
- 父任务必须通过全部子任务 `VERIFY_PASS` 后才能进入 reviewing，不允许越过子任务直接结束

`task_packet` 必需字段（详见 `state/task-packet.schema.json`）：
- `TaskSpec`：任务目标与背景
- `Scene`：当前实现场景摘要（涉及代码位置、上下游依赖）
- `FilesInScope`：本次改动涉及的文件路径白名单
- `Acceptance`：可验证的成功判据
- `OutOfScope`：明确不做的事项

TodoWrite 绑定（源权威）：
- 进入 planning 的第一步调用 TodoWrite，items 与 `execution_steps` 1:1 对应
- 若某 step 标记 `spawn_subtask`，该 item 文案应为"派发子任务 <subtask_id> 并等待完成"
- `PLAN_DONE` 前所有 planning 阶段自身 todo 必须 `done`
- 执行期 todo（对应 `execution_steps`）保持 `pending`，交给 executing 阶段消费

输出格式（含期望内容说明）：
1. `execution_steps`：有序步骤数组，每项含 `id`、`title`、`description`、`depends_on`、`acceptance_signal`、可选 `spawn_subtask` / `subtask_goal` / `subtask_acceptance`
2. `dependencies`：步骤间依赖关系摘要
3. `verification_plan`：每一步的验证方式（单测 / 集成 / 手动复现）
4. `acceptance_signals`：整体 acceptance 信号汇总
5. `task_packet`（主任务）：符合 `task-packet.schema.json`
6. `subtask_packets`：若存在子任务，每个子任务一个 task_packet
7. `artifact_written`：`plan` + `task_packet`（+ `subtask_packets` 若有），含路径
8. `next_event`：`PLAN_DONE`
9. `next_skill`：`execute`
10. `executor_handoff`：交接给 executing 阶段的关键上下文摘要
11. `next_action`：下一步唯一动作，如"调用 execute skill 从 step-1 开始实现"

## 原生工具集成

本 skill 在以下操作点必须使用 Claude Code 原生工具：

- **`Explore` agent**：拆解步骤前先用 Explore 分析代码依赖关系、模块结构、调用链路。让 execution_steps 的拆分基于代码事实而非猜测。
- **`Glob` / `Grep`**：定位具体文件路径、搜索函数引用模式，辅助判断 `depends_on` 依赖方向。
- **`LSP`**：必要时使用 `documentSymbol` 了解模块导出结构、`findReferences` 追踪跨模块引用，辅助细化子任务边界。
- **`AskUserQuestion`**：当 `execution_steps` 的 `depends_on` 顺序存在歧义、或 `spawn_subtask` 边界不清晰时，用 AskUserQuestion 让用户确认。

关联约束：
- "把方案拆成可执行步骤" → 通过 Explore + LSP 理解代码依赖后拆解，确保步骤顺序反映真实依赖关系。
- Explore 和 LSP 获取代码事实，AskUserQuestion 只在事实不充分时打断用户。
