---
name: planning
description: High 任务的方案拆解阶段。design 获批后调用：把方案拆成有序 execution_steps，产出 task_packet 与可选子任务 task_packet，供 executor 按契约执行。
---

planning 解决"已批准方案怎么落到可执行步骤"——不重开方案分歧，不写实现。

## 路由

| 完成事件 | 下一阶段 | 下一 skill |
|---|---|---|
| `PLAN_DONE` | executing | execute |

步骤被标记 `spawn_subtask` → 由 executing 阶段按需 dispatch `executor` subagent；planning 只负责产出 `subtask_packets`。

## 不做

- 不重新打开已经确认的方案分歧
- 不直接写实现代码
- 步骤不可验证、不可交接、不可恢复 → 不允许进入 executing

## 子任务拆分

- `task_id` 格式：`<parent_task_id>.<n>`（n 从 1 起）
- 子任务默认 density = medium
- 父任务必须通过全部子任务 `VERIFY_PASS` 后才能进入 reviewing

## task_packet 必需字段

详见 `state/task-packet.schema.json`：`task_id` / `stage` / `task_spec` / `scene` / `files_in_scope` / `acceptance` / `out_of_scope` / `next_action`。

## 输出

| 字段 | 说明 |
|---|---|
| `execution_steps` | 有序步骤数组，每项含 `id` / `title` / `description` / `depends_on` / `acceptance_signal` / 可选 `spawn_subtask` |
| `dependencies` | 步骤间依赖关系摘要 |
| `verification_plan` | 每一步的验证方式 |
| `task_packet` | 主任务 task_packet（符合 schema） |
| `subtask_packets` | 若存在的子任务 task_packet |
| `artifact_written` | `plan` + `task_packet` |
| `next_event` | `PLAN_DONE` |
| `next_skill` | `execute` |
| `executor_handoff` | 交接给 executing 的关键上下文摘要 |
| `next_action` | 下一步唯一动作 |

## 工件与状态

- 写入工件：`plan` → `.orbit/state/<task_id>/plan.md`，`task_packet` → `.orbit/state/<task_id>/task_packet.json`
- 任务清单进入项：与 `execution_steps` 1:1 对应
- 子任务：每个标记 `spawn_subtask` 的 step 需为其创建 `.orbit/state/<parent>.<n>/` 与独立 `runtime.json`
- 通用持久化、任务清单、退出自检见 [state-protocol.md](../references/state-protocol.md)

## 优先工具

- `Explore`：分析代码依赖、模块结构、调用链路
- `Plan` agent：≥5 步骤或子任务边界不清时，dispatch 独立 Plan agent 产出"步骤序 + 依赖图 + 验证点"
- `LSP`：documentSymbol 了解模块导出、findReferences 追踪跨模块引用
- `AskUserQuestion`：步骤顺序歧义或子任务边界不清时确认

详见 [native-tools.md](../references/native-tools.md)。

## 本阶段特有退出条件

- [ ] `plan.md` 已落盘，execution_steps 有序且每步含 `depends_on` / `acceptance_signal`
- [ ] `task_packet.json` 已落盘，必填字段完整
- [ ] 若存在 `spawn_subtask`：子任务目录与独立 runtime.json 已创建，子任务 `first_executor` 也填 `"primary-session"`
