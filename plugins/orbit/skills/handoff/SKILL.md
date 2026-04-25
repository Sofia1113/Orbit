---
name: handoff
description: Orbit 跨会话/跨子代理恢复交接。上下文预算临近、dispatch subagent 前后、用户暂停、评估失败保留现场、阶段切换时调用：产出 handoff.json（机器恢复源）与 handoff.md（人类摘要），不占用官方 resume 命令名。
---

目标：
- 为子代理或任务级执行中断后的恢复提供最小必要上下文
- 同时产出机器恢复源与人类摘要
- 避免把大量历史过程原样搬运进恢复输入

触发条件（任一满足即须调用本 skill）：
1. **上下文预算临近**：当前会话 context 使用率高
2. **子代理边界**：dispatch executor/evaluator subagent 前后
3. **人工暂停**：用户明确要求暂停，或运行时收到 `PAUSE` 事件
4. **评估失败保留现场**：VERIFY_FAIL / REVIEW_FAIL 后暂不立即修复
5. **阶段切换明显**：跨大阶段交接需切会话

原则：
- handoff 不是总结全文，而是恢复载荷
- 只记录当前焦点、当前状态、下一步唯一动作、关键决策、风险与待验证项
- `next_action` 不能为空
- handoff 是恢复的最高优先级输入

## 运行时契约

遵循 [公共运行时模式](../references/common-runtime-patterns.md)。本阶段特有：
- **写入工件**：`handoff` → `.orbit/state/<task_id>/handoff.json` + `.orbit/state/<task_id>/handoff.md`
- **结束事件**：`HANDOFF_SAVED`
- **阶段转换**：保持在触发时的阶段；`HANDOFF_SAVED` 是工件事件，不是常规执行阶段
- **特殊规则**：`HANDOFF_SAVED` 事件行必须带 `handoff_reason`

子代理 dispatch 边界规则：
- dispatch 前：controller 必须完整注入 task_packet + scene
- dispatch 后：子代理必须返回 `handoff_payload`
- 禁止让子代理读 plan/design/scope 文件
- 子代理返回的 handoff 由本 skill 校验并合并入父 runtime

`handoff.json` 最小字段（详见 `state/handoff.schema.json`）：
- `task_id`、`density`、`stage`、`status`、`task_summary`、`current_focus`、`next_action`

输出格式（含期望内容说明）：
1. `task_focus`：当前聚焦的 step/subtask
2. `source_stage`：handoff 触发时所处阶段
3. `trigger`：五类触发条件之一
4. `next_action`：下一步唯一动作
5. `confirmed_decisions`：已确认的关键决策
6. `risks_and_open_checks`：风险与待验证项
7. `machine_payload`：`.orbit/state/<task_id>/handoff.json`
8. `human_summary`：`.orbit/state/<task_id>/handoff.md`
9. `artifact_written`：`handoff`
10. `next_event`：`HANDOFF_SAVED`

## 原生工具集成

- **`AskUserQuestion`**：handoff 生成后向用户呈现可选方向（继续/升级/重设/取消），用户回答映射为 `next_action`

### 退出前自检（缺一不可声明 HANDOFF_SAVED）
- [ ] `handoff.json` 已落盘，7 个必填字段完整（task_id / density / stage / status / task_summary / current_focus / next_action）
- [ ] `handoff.md` 人类摘要已落盘
- [ ] runtime.json 已回写：last_event=HANDOFF_SAVED，handoff_reason 已记录
- [ ] **`first_executor` 未被改动**（handoff 不更换首席执行者；`current_owner` 可调整）
- [ ] next_action 非空
- [ ] 调用 `node plugins/orbit/scripts/validate-orbit-state.mjs --runtime .orbit/state/<task_id>/runtime.json` 通过
