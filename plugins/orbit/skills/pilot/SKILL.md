---
name: pilot
description: Orbit 工作流的统一入口与任务分流器。每当用户发起新的工程任务（『帮我实现 X』『修一下这个 bug』『重构 Y』『加个 feature』『优化 Z』等表述，即使看起来只是一两行小改动）时必须首先调用本 skill：用结构化 triage rubric 判断思考密度（low/medium/high），初始化 `.orbit/state/<task_id>/` 状态目录并路由到 execute / scoping / design。只有当 resume / handoff 已经激活现存任务、或用户显式指定了下一阶段 skill 时才可以跳过。
---

目标：
- 判断用户请求属于 low、medium 还是 high
- 使用结构化 triage rubric 生成客观 `triage_result`
- 选择最小足够流程，避免简单任务误入重流程
- 初始化任务状态并写入持久化目录，为后续 skill 提供唯一的状态来源

路由规则（判定后立即触发）：
- low：目标已知、单轮可收敛、无设计分歧 → 直接调用 `execute` skill，进入 `executing`
- medium：需要先收敛边界再编码 → 调用 `scoping` skill，进入 `scoping`
- high：需要方案比较或存在设计不确定性 → 调用 `design` skill，进入 `designing`

若无法稳定判断 `density`，先通过 Explore agent 补齐上下文，仍模糊时用 AskUserQuestion 请用户决策，不直接进入执行。

triage rubric：
- 评分维度：`scope_breadth`、`requirement_clarity`、`design_uncertainty`、`state_recovery_need`、`validation_risk`、`coordination_complexity`
- 各维度各打 0–2 分，合计：`0-4 => low`，`5-9 => medium`，`10+ => high`
- 硬规则（优先于分数）：
  - 需求模糊且需要方案比较 → `high`
  - 需要 review gate 或多阶段恢复 → 至少 `high`
  - 需要先收敛边界再编码 → 至少 `medium`
  - 只有目标明确、单轮可收敛、无设计分歧时才允许 `low`

task_id 命名规则：
- 用途：作为文件路径的组成部分（`.orbit/state/<task_id>/`），必须路径安全
- 格式：只含小写字母、数字、连字符，如 `rename-login-field`、`add-auth-middleware`
- 子任务由 planning 生成，格式为 `<parent_task_id>.<n>`，如 `add-auth-middleware.1`
- `title` 字段是可读描述（如"将登录响应字段从 token 改为 access_token"），与 `task_id` 共存

状态持久化（SSOT）：
- pilot 在 `TRIAGE_DONE` 时必须创建 `.orbit/state/<task_id>/` 并写入：
  - `runtime.json`（见下方模板）
  - `triage.md`（triage 工件摘要）
- **首次创建 `.orbit/` 根目录时必须同时写入 `.orbit/.gitignore`，内容为单行 `*`**（意图：任务状态默认不入库；如用户希望入库，由用户自己调整或删除该文件）
- 后续每个 skill 结束时都必须回写 `runtime.json` 并更新对应工件文件
- 恢复优先级以该目录为准（见 resume skill）

`runtime.json` 写入模板（`TRIAGE_DONE` 时填充）：
```json
{
  "task_id": "rename-login-field",
  "title": "将登录响应字段从 token 改为 access_token",
  "density": "low",
  "stage": "triaged",
  "status": "active",
  "goal": "一句话描述任务目标",
  "first_executor": "当前会话标识",
  "current_owner": "当前会话标识",
  "next_action": "调用 execute skill 开始实现",
  "last_event": "TRIAGE_DONE",
  "verification_level": "optional",
  "repair_direction": null,
  "artifacts": {
    "triage": ".orbit/state/rename-login-field/triage.md",
    "scope": null, "design": null, "plan": null,
    "execution": null, "verification": null,
    "review": null, "handoff": null, "task_packet": null
  },
  "todo": []
}
```
未使用的 artifacts 槽位置 `null`，由后续 skill 按需填充。全量字段定义见 `state/task-state.schema.json`，triage 阶段无需补齐。

事件流（append-only）：见 `state/README.md#事件流append-only`。本 skill 一次运行内通常追加两行（`TASK_CREATED` → `TRIAGE_DONE`），按时间顺序写入。

TodoWrite 绑定（硬规则）：
- 进入任何 stage 的第一步必须调用 TodoWrite 建立该 stage 的原子 todos
- runtime `todo[]` 与 TodoWrite 保持同步
- 任意时刻只能有一个 todo 处于 `in_progress`
- 完成一项立刻 `done`，不批量延后
- evaluator 返回 FAIL 时，`repair_actions` 必须逐条追加为新 todo（owner = first_executor）
- 阶段切换前所有 todo 必须是 `done` 或显式挂到下一阶段

输出格式（含期望内容说明）：
1. `task_id`：路径安全标识符，如 `rename-login-field`
2. `title`：可读任务描述，如"将登录响应字段从 token 改为 access_token"
3. `density`：`low` / `medium` / `high`
4. `current_stage`：固定为 `triaged`
5. `triage_result`：各维度评分（0–2）及合计分，含硬规则触发说明
6. `allowed_next_stage`：`low → executing`；`medium → scoping`；`high → designing`
7. `next_skill`：`low → execute`；`medium → scoping`；`high → design`
8. `required_artifacts`：本次 triage 写入的工件路径列表
9. `next_action`：下一步唯一动作，如"调用 scoping skill 收敛任务边界"
10. `why`：一句话说明为何这样路由
11. `next_event`：`TRIAGE_DONE`

## 原生工具集成

本 skill 在以下操作点必须使用 Claude Code 原生工具：

- **`Explore` agent**：在 triage scoring 前，若任务上下文涉及不熟悉的代码区域，先用 Explore agent 快速理解仓库结构（文件布局、关键模块、数据流）。尤其当 `scope_breadth` 或 `requirement_clarity` 难以打分时。
- **`Glob` / `Grep`**：快速定位目标文件或搜索关键模式，配合 Explore 使用。例如搜索 `grep` 某个关键函数名来判断改动波及范围。
- **`AskUserQuestion`**：
  - triage rubric 综合分处于密度边界（如 4–5 分，low ↔ medium 之间）或硬规则产生冲突时，用 AskUserQuestion 让用户确认 density。
  - 在写入 runtime.json 前，若 `task_id` 或 `title` 需要用户确认，也用 AskUserQuestion 确认。

关联约束：
- `Explore` agent 应优先于主观猜测：当对代码范围不确定时，先用 Explore 获取事实，再基于事实打分。
- `AskUserQuestion` 是"无法稳定判断"的兜底，不是默认路径——先 Explore 补齐上下文，仍模糊再用 AskUserQuestion。
- "若无法稳定判断 density，先补齐 triage" → 优先使用 Explore agent 补齐上下文，仍无法判断时用 AskUserQuestion 请用户决策。
