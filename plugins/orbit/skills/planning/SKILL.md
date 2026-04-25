---
name: planning
description: High 任务的方案拆解阶段。design 获批后调用：把方案拆成有序 execution_steps，产出 task_packet 与可选的子任务 task_packet，供 executor 按契约执行。
---

目标：
- 把 design 阶段已批准的方案拆成可执行步骤
- 明确每一步的依赖、验证方式与完成标志
- 为 executing 阶段提供最小但充分的执行输入（`task_packet`）

路由规则（完成后触发）：
- `PLAN_DONE` → 调用 `execute` skill，进入 `executing`
- 若步骤被标记 `spawn_subtask` → 由 executing 阶段按需 dispatch `executor` subagent；planning 只产出 `subtask_packets`

约束：
- 仅 `high` 可进入本阶段
- 不重新打开已经确认的方案分歧
- 不直接写实现代码
- 步骤必须可验证、可交接、可恢复
- 必须产出 `plan` 工件与 `task_packet` 工件

## 运行时契约

遵循 [公共运行时模式](../references/common-runtime-patterns.md)。本阶段特有：
- **写入工件**：`plan` → `.orbit/state/<task_id>/plan.md`，`task_packet` → `.orbit/state/<task_id>/task_packet.json`
- **结束事件**：`PLAN_DONE`
- **阶段转换**：`planning` → `executing`
- **任务清单进入项**（用 `TaskCreate`）：与 `execution_steps` 1:1 对应
- **子任务**：每个标记 `spawn_subtask` 的 step 需为其创建 `.orbit/state/<parent>.<n>/` 并写入独立 `runtime.json`

子任务拆分：
- `task_id` 格式：`<parent_task_id>.<n>`（n 从 1 起）
- 子任务默认 density = medium
- 父任务必须通过全部子任务 `VERIFY_PASS` 后才能进入 reviewing

`task_packet` 必需字段（详见 `state/task-packet.schema.json`）：
- `task_id`、`stage`、`task_spec`、`scene`、`files_in_scope`、`acceptance`、`out_of_scope`、`next_action`

输出格式（含期望内容说明）：
1. `execution_steps`：有序步骤数组，每项含 `id`、`title`、`description`、`depends_on`、`acceptance_signal`、可选 `spawn_subtask`
2. `dependencies`：步骤间依赖关系摘要
3. `verification_plan`：每一步的验证方式
4. `task_packet`（主任务）：符合 task-packet.schema.json
5. `subtask_packets`：若存在的子任务 task_packet
6. `artifact_written`：`plan` + `task_packet`
7. `next_event`：`PLAN_DONE`
8. `next_skill`：`execute`
9. `executor_handoff`：交接给 executing 的关键上下文摘要
10. `next_action`：下一步唯一动作

## 原生工具集成

- **`Explore` agent**：拆解步骤前分析代码依赖、模块结构、调用链路
- **`Plan` agent**（推荐）：当 design 输出的方案需要落到 ≥5 个有依赖关系的步骤、或子任务边界不清晰时，dispatch 独立 Plan agent 产出"步骤序 + 依赖图 + 验证点"的草案，再融入本 skill 输出
- **`LSP`**：documentSymbol 了解模块导出、findReferences 追踪跨模块引用
- **`AskUserQuestion`**：步骤顺序歧义或子任务边界不清时确认

### 退出前自检（缺一不可声明 PLAN_DONE）
- [ ] `plan.md` 已落盘，execution_steps 有序且每步含 depends_on / acceptance_signal
- [ ] `task_packet.json` 已落盘，必填字段完整（task_id / task_spec / scene / files_in_scope / acceptance / out_of_scope / next_action）
- [ ] 若存在 spawn_subtask：子任务目录与独立 runtime.json 已创建（子任务 `first_executor` 同样填 `"primary-session"`）
- [ ] runtime.json 已回写：stage=planning→executing、last_event=PLAN_DONE
- [ ] 原生任务清单已同步到 runtime.todo[]
- [ ] 调用 `node plugins/orbit/scripts/validate-orbit-state.mjs --runtime .orbit/state/<task_id>/runtime.json` 通过
