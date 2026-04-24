---
name: scoping
description: Medium 任务的边界收敛阶段。在进入实现之前必须调用本 skill 明确范围、输入、输出、不做什么、可验证的成功标准：pilot 已把任务分流为 medium，或用户说『先把范围定一下再写』『帮我圈一下这次要做哪些』『列一下成功标准』时触发。若澄清过程中发现需要方案比较 → 升级为 high 走 design；发现范围比预估小 → 降级为 low 直接 execute。
---

目标：
- 收敛当前任务的边界、输入、输出与不做什么
- 明确实现约束、风险与可验证的成功标准
- 产出 `scope` 工件，`SCOPE_DONE` 后直接进入 `executing`

路由规则（完成后触发）：
- `SCOPE_DONE` → 调用 `execute` skill，进入 `executing`
- 发现需求模糊、需要方案比较 → 声明 `ESCALATE_DENSITY`，升级为 `high`，进入 `designing`（调用 `design` skill）
- 发现范围比预估更小、可直接实现 → 声明 `DOWNGRADE_DENSITY`，降级为 `low`，进入 `executing`（调用 `execute` skill）

约束：
- 仅 `medium` 可进入本阶段
- 不直接写实现代码
- 不把未确认事项伪装成既定范围
- 只保留推进本轮实现真正需要的信息
- 本阶段不产出 design/plan，不做 verify/review
- 必须产出 `scope` 工件并更新 `next_action`

状态持久化：
- `scope` 工件写入 `.orbit/state/<task_id>/scope.md`
- 结束时回写 `.orbit/state/<task_id>/runtime.json`：
  - `stage`：`scoping` → 目标阶段（`executing` / `designing`）
  - `last_event`：`SCOPE_DONE` / `ESCALATE_DENSITY` / `DOWNGRADE_DENSITY`
  - `next_action`：指向下一个 skill 的具体动作
  - `artifacts.scope`：工件路径

事件流（append-only）：见 `state/README.md#事件流append-only`。本 skill 若触发多个 `last_event`（如 `ESCALATE_DENSITY` → `SCOPE_DONE`），按时间顺序追加多行。

TodoWrite 绑定：
- 进入 scoping 的第一步调用 TodoWrite，items 至少覆盖：
  - 确认 `in_scope`（做什么）
  - 确认 `out_of_scope`（不做什么）
  - 确认 `acceptance_criteria`（成功判据）
- 任意时刻只能有一个 todo 处于 `in_progress`
- `SCOPE_DONE` 前所有 scope 确认类 todo 必须 `done`

输出格式（含期望内容说明）：
1. `scoped_goal`：一句话目标，与 triage 的 `goal` 对齐
2. `in_scope`：本轮要完成的具体项列表
3. `out_of_scope`：明确排除的项，避免后续扩散
4. `constraints_and_risks`：实现约束（技术栈、兼容性）与可预见风险
5. `acceptance_criteria`：可验证的成功判据列表
6. `artifact_written`：`scope`（路径：`.orbit/state/<task_id>/scope.md`）
7. `next_event`：`SCOPE_DONE` / `ESCALATE_DENSITY` / `DOWNGRADE_DENSITY`
8. `next_skill`：`execute` / `design`（按上方路由规则）
9. `next_action`：下一步唯一动作，如"调用 execute skill 开始实现"

## 原生工具集成

本 skill 在以下操作点必须使用 Claude Code 原生工具：

- **`Explore` agent**：在确认 `in_scope` / `out_of_scope` 前，用 Explore agent 扫描现有相关代码，了解当前实现边界、依赖关系和模块职责。获取事实后再划定范围，而非靠推测。
- **`Glob` / `Grep`**：搜索具体模式或文件，配合 Explore 使用。例如 `glob` 匹配相关文件的模式、`grep` 搜索关键函数调用链。
- **`AskUserQuestion`**：
  - 当 `in_scope` / `out_of_scope` 边界经 Explore 后仍模糊时，用 AskUserQuestion 让用户圈定范围。
  - 当 `acceptance_criteria` 初版需要用户确认时，用 AskUserQuestion 请用户验证。

关联约束：
- "收敛边界" → 通过 Explore agent 获取代码事实 + AskUserQuestion 确认模糊区域，协作收敛。
- Explore 优先：先看代码再问用户，减少不必要的人工打断。
