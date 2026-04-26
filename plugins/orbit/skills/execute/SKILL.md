---
name: execute
description: Orbit 实现执行阶段。任务边界已收敛、准备写代码时调用：按 task_packet 推进实现，FAIL 时以 first_executor 身份进入 repairing。不自宣完成，结论交给 verify。
---

execute 解决"在既定边界内把代码写出来"——不重新发散解释，不自评，不自宣完成。

用户体验目标：让用户看到当前聚焦的 step、实际改了哪些文件、还有哪些风险，以及为什么下一步必须交给 verify。失败或缺上下文时，明确给出 blocker_root_cause 或缺失信息，而不是反复重试。

## 路由

| 完成事件 | 下一阶段 | 下一 skill |
|---|---|---|
| `EXECUTION_DONE` | verifying | verify |
| `REPAIR_SUBMITTED` | repairing（仍在本 skill） | execute |
| `HANDOFF_SAVED` | 保持当前 stage | handoff |
| `ESCALATE_DENSITY` | 先 handoff（reason='escalate_density'），再切到新 density 入口阶段 | handoff |

evaluator FAIL 回流时：以 `first_executor` 身份进入 `repairing`，owner 不变。

## task_packet 兜底生成

`artifacts.task_packet` 为 `null` 时（low 任务直通常见），进入执行前必须自举生成最小 task_packet：

| 字段 | 来源 |
|---|---|
| `task_id` | runtime.task_id |
| `task_spec` | runtime.goal |
| `scene` | `triage_result.rationale` + 当前 target 摘要 |
| `files_in_scope` | 通过 `Glob` / `Grep` 确定的目标文件列表 |
| `acceptance` | 从 goal 反推 2-3 条可验证的接受条件 |
| `out_of_scope` | `["不做范围外的重构", "不做未在 acceptance 中定义的功能"]` |
| `next_action` | runtime.next_action |

生成后回写到 `artifacts.task_packet`，落盘 `.orbit/state/<task_id>/task_packet.json`。

## 不做

- 不重新解释整个计划，不重写已批准方案
- 不修改未授权范围
- 不自判 PASS，不替代 evaluator 给完成结论
- 不把"看起来完成"当"实现完成"

## 子任务派发

step 标记 `spawn_subtask` 时：

1. dispatch `executor` subagent，完整注入子任务 task_packet
2. 子任务返回 `handoff_payload` 后，将对应父 todo 置 `done` 并合并结果

## 输出

| 字段 | 说明 |
|---|---|
| `focus` | 当前聚焦的 step / subtask |
| `task_packet_used` | 所消费的 task_packet 路径 |
| `implementation_status` | 已完成 / 进行中 / 阻塞项 |
| `changes_made` | 文件级变更摘要（路径 + 一句话） |
| `action_updates` | 任务清单同步结果 |
| `artifact_written` | `execution` |
| `next_event` | `EXECUTION_DONE` / `REPAIR_SUBMITTED` / `HANDOFF_SAVED` |
| `next_skill` | `verify` / `execute` / `handoff` |
| `next_action` | 下一步唯一动作 |
| `risks` | 已识别但未消除的风险 |
| `verification_notes` | 传递给 verify 的关键线索 |

## 工件与状态

- 写入工件：`execution` → `.orbit/state/<task_id>/execution.md`
- `repairing` 阶段：`stage = repairing`，`repair_direction` 必须落盘，`current_owner` = `first_executor`
- 通用持久化、任务清单、退出自检见 [state-protocol.md](../references/state-protocol.md)

## 优先工具

- `LSP`（关键）：goToDefinition / findReferences / hover / documentSymbol / incomingCalls / outgoingCalls — 确认改动位置、评估波及面、追踪调用链
- `Glob` / `Grep`：搜索目标文件或代码模式
- `Explore` agent：宏观理解模块交互
- `AskUserQuestion`：返回 `BLOCKED` 时说明阻塞根因；返回 `NEEDS_CONTEXT` 时说明缺失上下文

详见 [native-tools.md](../references/native-tools.md)。

## 本阶段特有退出条件

- [ ] task_packet 为 null 时已自举生成并落盘
- [ ] `execution.md` 已落盘，changes_made 逐文件列出
- [ ] `repairing` 时 `current_owner == first_executor`
- [ ] 不得自宣完成——`EXECUTION_DONE` 后必须传入 verify
