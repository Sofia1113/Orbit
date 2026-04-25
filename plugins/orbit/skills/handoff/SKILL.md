---
name: handoff
description: Orbit 跨会话 / 跨子代理恢复交接。上下文预算临近、dispatch subagent 前后、用户暂停、评估失败保留现场、阶段切换时调用：产出 handoff.json（机器恢复源）+ handoff.md（人类摘要）。
---

handoff 解决"任务被打断后能不能无损接续"——只产出恢复载荷，不做总结、不做长篇汇报。

## 触发条件（任一满足即调用）

1. **上下文预算临近**：当前会话 context 使用率高
2. **子代理边界**：dispatch executor / evaluator subagent 前后
3. **人工暂停**：用户明确要求暂停，或运行时收到 `PAUSE` 事件
4. **评估失败保留现场**：`VERIFY_FAIL` / `REVIEW_FAIL` 后暂不立即修复
5. **阶段切换明显**：跨大阶段交接需切会话

## 原则

- handoff 不是总结全文，而是恢复载荷
- 只记录当前焦点、当前状态、下一步唯一动作、关键决策、风险与待验证项
- `next_action` 不能为空
- handoff 是恢复的最高优先级输入

## Subagent 边界规则

- dispatch 前：controller 必须完整注入 `task_packet` + `scene`
- dispatch 后：subagent 必须返回 `handoff_payload`
- 禁止让 subagent 读 plan / design / scope 文件
- subagent 返回的 handoff 由本 skill 校验并合并入父 runtime

## handoff.json 必填字段

详见 `state/handoff.schema.json`：`task_id`、`density`、`stage`、`status`、`task_summary`、`current_focus`、`next_action`。

## 输出

| 字段 | 说明 |
|---|---|
| `task_focus` | 当前聚焦的 step / subtask |
| `source_stage` | handoff 触发时所处阶段 |
| `trigger` | 五类触发条件之一 |
| `next_action` | 下一步唯一动作 |
| `confirmed_decisions` | 已确认的关键决策 |
| `risks_and_open_checks` | 风险与待验证项 |
| `machine_payload` | `.orbit/state/<task_id>/handoff.json` |
| `human_summary` | `.orbit/state/<task_id>/handoff.md` |
| `artifact_written` | `handoff` |
| `next_event` | `HANDOFF_SAVED` |

## 工件与状态

- 写入工件：`handoff` → `.orbit/state/<task_id>/handoff.json` + `.orbit/state/<task_id>/handoff.md`
- `HANDOFF_SAVED` 是工件事件，**保持当前 stage 不变**
- `last_event=HANDOFF_SAVED` 时必须记录 `handoff_reason`
- 通用持久化、任务清单、退出自检见 [state-protocol.md](../references/state-protocol.md)

## 优先工具

`AskUserQuestion`（handoff 生成后向用户呈现可选方向：继续 / 升级 / 重设 / 取消，用户回答映射为 `next_action`）。详见 [native-tools.md](../references/native-tools.md)。

## 本阶段特有退出条件

- [ ] `handoff.json` 已落盘，7 个必填字段完整
- [ ] `handoff.md` 人类摘要已落盘
- [ ] `last_event=HANDOFF_SAVED`，`handoff_reason` 已记录
- [ ] **`first_executor` 未被改动**（`current_owner` 可调整）
- [ ] `next_action` 非空
