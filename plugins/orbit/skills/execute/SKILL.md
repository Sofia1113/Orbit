---
name: execute
description: Orbit 实现执行阶段。任务边界已收敛、准备写代码时调用：按 task_packet 推进实现，用 TaskCreate/TaskUpdate 同步进度，FAIL 时以 first_executor 身份进入 repairing。不自宣完成，结论交给 verify。
---

目标：
- 根据已收敛边界完成当前实现
- 消费已有 `task_packet` 与 `todo + next_action`，不重新发散解释
- 保持改动最小、聚焦、可验证

**task_packet 兜底生成**：若 `artifacts.task_packet` 为 null（low 任务经 pilot→execute 直通时常见），进入执行前必须从 runtime.json 自举生成最小 task_packet：
- `task_id` ← runtime.task_id
- `task_spec` ← runtime.goal
- `scene` ← 从 triage_result.rationale + 当前 target 摘要拼合
- `files_in_scope` ← 通过 Glob/Grep 确定的目标文件列表
- `acceptance` ← 从 goal 反推 2-3 条可验证的接受条件
- `out_of_scope` ← ["不做范围外的重构", "不做未在 acceptance 中定义的功能"]
- `next_action` ← runtime.next_action
生成后回写到 `artifacts.task_packet`，同时落盘 `.orbit/state/<task_id>/task_packet.json`

路由规则（完成后触发）：
- `EXECUTION_DONE` → 调用 `verify` skill，进入 `verifying`
- evaluator FAIL 回流 → 声明 `REPAIR_SUBMITTED`，进入 `repairing`（仍在本 skill，owner 不变）
- 上下文预算临近 / 需要切换会话 → 调用 `handoff` skill，保存恢复载荷但保持当前 stage
- **执行中发现任务实际更复杂** → 声明 `ESCALATE_DENSITY`，先调用 `handoff` skill 产出迁移 handoff，再切换到新 density 入口阶段。`first_executor` 不变

约束：
- 仅允许在 `executing` 或 `repairing` 阶段运行
- 优先修复根因
- 遇到失败时记录风险与待验证项
- 若 evaluator 失败，默认由 `first_executor` 进入 `repairing`
- 不自行宣布完成，必须进入 `verifying`
- 必须产出 `execution` 工件并声明 `EXECUTION_DONE`

## 运行时契约

遵循 [公共运行时模式](../references/common-runtime-patterns.md)。本阶段特有：
- **写入工件**：`execution` → `.orbit/state/<task_id>/execution.md`
- **结束事件**：`EXECUTION_DONE` / `REPAIR_SUBMITTED` / `HANDOFF_SAVED`
- **阶段转换**：`executing` → `verifying` / `repairing`；`HANDOFF_SAVED` 只保存工件并保持当前 stage
- **repairing 时**：`stage = repairing`，`repair_direction` 必须落盘，`current_owner` = `first_executor`

子任务派发（若 step 标记 `spawn_subtask`）：
- dispatch `executor` subagent，完整注入子任务 task_packet
- 子任务返回 `handoff_payload` 后，将对应父 todo 置 `done` 并合并结果

输出格式（含期望内容说明）：
1. `focus`：当前聚焦的 step/subtask
2. `task_packet_used`：所消费的 task_packet 路径
3. `implementation_status`：已完成/进行中/阻塞项
4. `changes_made`：文件级变更摘要（路径 + 一句话）
5. `action_updates`：原生任务清单（TaskCreate/TaskUpdate）与 runtime.todo[] 同步结果
6. `artifact_written`：`execution`
7. `next_event`：`EXECUTION_DONE` / `REPAIR_SUBMITTED` / `HANDOFF_SAVED`
8. `next_skill`：`verify` / `execute` / `handoff`
9. `next_action`：下一步唯一动作
10. `risks`：已识别但未消除的风险
11. `verification_notes`：传递给 verify 的关键线索

## 原生工具集成

- **`LSP`**（关键）：goToDefinition / findReferences / hover / documentSymbol / incomingCalls / outgoingCalls — 确认修改位置、评估波及面、理解调用链
- **`Glob` / `Grep`**：搜索目标文件或代码模式
- **`Explore` agent**：宏观理解模块交互模式
- **`AskUserQuestion`**：返回 `BLOCKED` 时说明阻塞根因；返回 `NEEDS_CONTEXT` 时说明缺失上下文

### 退出前自检（缺一不可声明 EXECUTION_DONE / REPAIR_SUBMITTED）
- [ ] 若 task_packet 为 null：已自举生成最小 task_packet 并落盘
- [ ] `execution.md` 已落盘，changes_made 逐文件列出
- [ ] runtime.json 已回写：stage、last_event、next_action 已更新
- [ ] 原生任务清单已同步（所有实现类 todo 已 `TaskUpdate` 为 done，未完成项挂到 handoff）
- [ ] `repairing` 时 `current_owner == first_executor`（默认承接 `"primary-session"`）
- [ ] 调用 `node plugins/orbit/scripts/validate-orbit-state.mjs --runtime .orbit/state/<task_id>/runtime.json` 通过
- [ ] 不得自宣完成——EXECUTION_DONE 后必须传入 verify
