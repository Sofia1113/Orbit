---
name: handoff
description: Orbit 的跨会话 / 跨子代理恢复交接 skill。以下任一情形必须调用本 skill 产出恢复载荷：(1) 上下文预算临近或预计超过压缩阈值、(2) dispatch `executor` / `evaluator` subagent 的前后边界、(3) 用户 `/pause` 或 `PAUSE` 事件、(4) `VERIFY_FAIL` / `REVIEW_FAIL` 后暂不立即修复需要保留现场、(5) 跨大阶段切换会话。同时产出 `.orbit/state/<task_id>/handoff.json`（机器恢复源）与 `handoff.md`（人类摘要），由下一轮的 `resume` skill 消费。
---

目标：
- 为子代理或任务级执行中断后的恢复提供最小必要上下文
- 同时产出机器恢复源与人类摘要
- 避免把大量历史过程原样搬运进恢复输入

触发条件（任一满足即须调用本 skill）：
1. **上下文预算临近**：当前会话 context 使用率高、或预计将超过压缩阈值
2. **子代理边界**：controller 在 dispatch `executor` / `evaluator` subagent 前后必产出 handoff，作为父子会话的唯一接口
3. **人工暂停**：用户触发 `/pause`、`PAUSE` 事件
4. **评估失败保留现场**：`VERIFY_FAIL` / `REVIEW_FAIL` 后若暂不立即 repair
5. **阶段切换明显**：跨大阶段交接（如 planning → executing 之间需要切会话）

路由规则（完成后触发）：
- `HANDOFF_SAVED` 后下一轮会话启动 → 调用 `resume` skill 基于 `handoff.json` 恢复
- 子代理 dispatch 前写 handoff → 继续在当前会话 dispatch subagent
- 子代理返回 `handoff_payload` → 由本 skill 校验并合并入父 runtime，随后回到父任务对应阶段 skill

原则：
- handoff 不是总结全文，而是恢复载荷
- 只记录当前焦点、当前状态、下一步唯一动作、关键决策、风险与待验证项
- 信息必须服务于继续执行，而不是展示思考过程
- 输出必须严格匹配 `plugins/orbit/state/handoff.schema.json`
- 必须同时写入：
  - `.orbit/state/<task_id>/handoff.json`：机器可恢复源
  - `.orbit/state/<task_id>/handoff.md`：人类摘要
- `next_action` 不能为空
- handoff 是恢复的最高优先级输入，必须优先服务 `resume` skill
- 子代理返回后，其 `handoff_payload` 必须合并进父任务的 `runtime.json`，并在 `runtime.todo[]` 上落位

状态持久化：
- 写入 `.orbit/state/<task_id>/handoff.json` 与 `handoff.md`
- 回写 `.orbit/state/<task_id>/runtime.json`：
  - `last_event`：`HANDOFF_SAVED`
  - `stage`：保持触发时的阶段（如 `paused` / 原阶段）
  - `artifacts.handoff`：`.orbit/state/<task_id>/handoff.md`
  - `next_action`：必须与 `handoff.json.next_action` 一致

事件流（append-only）：见 `state/README.md#事件流append-only`。本 skill 额外要求：
- `HANDOFF_SAVED` 事件行必须带 `handoff_reason`（对应本 skill 五类触发之一）
- 子代理 `handoff_payload` 合并到父 runtime 时，在**父任务**的 events.jsonl 追加一行（可带 `note: "subagent handoff merged"`）

子代理 dispatch 边界规则（必须执行）：
- dispatch 前：controller 先把当前 runtime 快照 + 子任务 task_packet 完整注入提示词
- dispatch 后：子代理必须返回 `handoff_payload` 字段（符合 `handoff.schema.json`）
- 禁止让子代理通过读 plan 文件获取上下文
- 子代理返回的 handoff 内容由本 skill 校验并合并到父 `runtime.json`

`handoff.json` 最小结构（详见 `state/handoff.schema.json`）：
- `version`
- `task_id`
- `density`
- `stage`
- `status`
- `source_stage`：handoff 触发时所处阶段
- `handoff_reason`：对应上方五类触发之一
- `task_summary`：一句话任务概述
- `current_focus`：当前聚焦项
- `next_action`：下一步唯一动作
- `actions`：待办或子任务动作列表
- `decisions`：已确认的关键决策
- `blockers`：阻塞项
- `risks`：已识别风险
- `artifacts`：工件路径映射
- `resume_order_hint`：建议的恢复优先顺序
- `resume_brief`：供 resume skill 直接消费的最小摘要

输出格式（含期望内容说明）：
1. `task_focus`：当前聚焦的 step / subtask id 与一句话描述
2. `source_stage`：handoff 触发时所处阶段
3. `trigger`：五类触发条件之一
4. `current_status`：`runtime.json` 的关键字段快照
5. `next_action`：下一步唯一动作（必须与 `handoff.json.next_action` 一致）
6. `confirmed_decisions`：已确认的关键决策
7. `risks_and_open_checks`：风险与待验证项
8. `pending_actions`：尚未启动的动作列表
9. `machine_payload`：`.orbit/state/<task_id>/handoff.json`
10. `human_summary`：`.orbit/state/<task_id>/handoff.md`
11. `artifact_written`：`handoff`
12. `next_event`：`HANDOFF_SAVED`
13. `next_skill`：下一轮会话启动时的 `resume`；子代理边界时的对应阶段 skill

## 原生工具集成

本 skill 在以下操作点必须使用 Claude Code 原生工具：

- **`AskUserQuestion`**：当 handoff 触发生成后（如 pause 状态），用 AskUserQuestion 向用户呈现可选的下一个方向：
  - 继续当前任务（回到对应阶段 skill）
  - 升级 density / 重设方案 / 取消任务
  - 用户的回答直接映射为 `handoff.json.next_action`

关联约束：
- "handoff 是恢复载荷，不是长总结" → AskUserQuestion 让用户确认 next_action，确保下一轮 resume 方向正确。
- 子代理 dispatch 边界仍由 controller 通过 Agent tool 完成，不在本 skill 重复集成。
