---
name: execute
description: Orbit 的实现执行阶段入口。任务已完成 scoping（medium）或 planning（high）、或被 pilot 判定为 low、准备开始真正动手写代码时必须调用本 skill：按 task_packet 与已收敛边界推进实现、TodoWrite 作为 stage 源权威保持同步、evaluator 返回 FAIL 时以 `first_executor` 身份进入 `repairing` 继续修复。不得自宣完成，必须把结论交给 verify。
---

目标：
- 根据已收敛边界完成当前实现
- 消费已有 `task_packet` 与 `todo + next_action`，而不是重新发散解释全局计划
- 持续维护当前焦点、当前状态、下一步唯一动作
- 避免无关重构和额外抽象

路由规则（完成后触发）：
- `EXECUTION_DONE` → 调用 `verify` skill，进入 `verifying`
- evaluator FAIL 回流 → 声明 `REPAIR_SUBMITTED`，进入 `repairing`（仍在本 skill 运行，owner 不变）
- 上下文预算临近 / 需要切换会话 → 调用 `handoff` skill，进入 `handoff`
- **执行中发现任务实际更复杂（需要设计性思考）** → 声明 `ESCALATE_DENSITY`：
  1. 先调用 `handoff` skill 产出 `handoff_reason='escalate_density'` 的迁移 handoff（`source_stage=executing`）
  2. 清理或显式声明废弃对新 density 无效的工件引用
  3. 切换到新 density 入口阶段（low→`scoping`，medium→`designing`），调用对应 skill 继续
  4. `first_executor` 不变；`verification_level` 随新 density 上调（不得下调）

执行规则：
- 仅允许在 `executing` 或 `repairing` 阶段运行
- 优先修复根因
- 保持改动最小、聚焦、可验证
- 遇到失败时，记录风险与待验证项，而不是扩散上下文；当需要用户指导时使用 AskUserQuestion
- 若存在 evaluator 失败，默认由首次执行者进入 `repairing` 后继续修复
- 不自行宣布完成，必须进入 `verifying`
- 必须产出 `execution` 工件并声明 `EXECUTION_DONE`

状态持久化：
- `execution` 工件写入 `.orbit/state/<task_id>/execution.md`
- 每次 action 完成后回写 `.orbit/state/<task_id>/runtime.json`：
  - `todo[]`：与 TodoWrite 同步
  - `last_event`：阶段内可保持 `PLAN_DONE` / `SCOPE_DONE` / `TRIAGE_DONE` 直至 `EXECUTION_DONE`
  - `next_action`：下一步唯一动作
  - `artifacts.execution`：工件路径
- 若进入 `repairing`：
  - `stage`：`repairing`
  - `repair_direction`：evaluator 返回的修复方向
  - `current_owner`：保持等于 `first_executor`

事件流（append-only）：见 `state/README.md#事件流append-only`。本 skill 额外要求：进入 `repairing` 的事件行必须带 `repair_direction`；一次运行内若触发多个 `last_event`（如 `REPAIR_SUBMITTED` → `EXECUTION_DONE`），按时间顺序追加多行。

TodoWrite 绑定（持久 SSOT = `runtime.todo[]`，TodoWrite 是会话投影）：
- 进入 executing 的第一步必须调用 TodoWrite，把 `execution_steps`（或 low/medium 的直接动作）展开为 todo items，并把结果回写到 `runtime.todo[]`
- 每次状态变化先改 TodoWrite，再同步回写 `runtime.todo[]`；不允许只改其一
- 开始一项：对应 todo 置 `in_progress`；完成一项立刻 `done`；不批量延后
- 任意时刻只能有一个 todo 处于 `in_progress`
- 进入 `repairing` 时，evaluator 返回的 `repair_actions` 必须逐条追加为新 todo，owner = `first_executor`
- resume 时由 `runtime.todo[]` 反向重建 TodoWrite；冲突以 `runtime.todo[]` 为准
- `EXECUTION_DONE` 前所有实现类 todo 必须 `done`；未完成项必须显式挂到下一阶段或 handoff

子任务派发（若 step 标记 `spawn_subtask`）：
- 不在本 skill 里自己展开实现，而是 dispatch `executor` subagent
- dispatch 时必须**把子任务 task_packet 完整注入提示词**，禁止让 subagent 读文件
- 子任务返回 `handoff_payload` 后，将对应父 todo 置 `done` 并把返回结果合并进父 runtime

关于可选增强层：
- 高复杂度任务可在 planning 阶段额外产出 `action_layer`（见 `state/task-state.schema.json`）作为更精细的行动图
- `action_layer` 不是 executing 的前提，默认执行只依赖 `task_packet` 与 TodoWrite

输出格式（含期望内容说明）：
1. `focus`：当前聚焦的 step / subtask id 与一句话描述
2. `task_packet_used`：所消费的 task_packet 路径
3. `implementation_status`：已完成 / 进行中 / 阻塞项
4. `changes_made`：文件级变更摘要（路径 + 一句话说明）
5. `action_updates`：本轮 TodoWrite 与 runtime.todo[] 的同步结果
6. `artifact_written`：`execution`（路径：`.orbit/state/<task_id>/execution.md`）
7. `next_event`：`EXECUTION_DONE` / `REPAIR_SUBMITTED` / `HANDOFF_SAVED`
8. `next_skill`：`verify` / `execute`（repairing 内继续） / `handoff`
9. `next_action`：下一步唯一动作，如"调用 verify skill 设计验证集合"
10. `risks`：已识别但未消除的风险
11. `verification_notes`：传递给 verify 阶段的关键线索（高风险路径、待补测试）

## 原生工具集成

本 skill 在以下操作点必须使用 Claude Code 原生工具：

- **`LSP`**（关键新增）：实施代码变更时优先使用 LSP 工具获取代码智能：
  - `goToDefinition`：跳转到符号定义处，确认修改位置
  - `findReferences`：查找所有引用点，评估改动波及面
  - `hover`：获取类型/文档信息，避免误解 API 契约
  - `documentSymbol`：了解模块整体结构，定位入口和出口
  - `incomingCalls` / `outgoingCalls`：理解调用链，确保修改不破坏下游
- **`Glob` / `Grep`**：搜索目标文件或代码模式，快速定位实现位置。
- **`Explore` agent**：需要宏观理解代码模块间的交互模式时，用 Explore 全局扫描代替逐文件阅读。
- **`AskUserQuestion`**：
  - 返回 `BLOCKED` 时：用 AskUserQuestion 向用户说明阻塞根因（`blocker_root_cause`），请求用户指导方向。
  - 返回 `NEEDS_CONTEXT` 时：用 AskUserQuestion 说明缺失的上下文，请用户补充。

关联约束：
- "记录风险与待验证项" → 当使用 AskUserQuestion 时，用户反馈本身就是已验证的风险记录。
- "BLOCKED 必须附 blocker_root_cause" → 补充：用 AskUserQuestion 告知用户阻塞详情并请求决策方向。
- LSP 优先于手动搜索：先 LSP 再 Glob/Grep，减少盲目搜索。
