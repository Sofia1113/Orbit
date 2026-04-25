---
name: scoping
description: Medium 任务的边界收敛阶段。pilot 分流为 medium 或用户需要划定范围时调用：明确 in_scope/out_of_scope 与 acceptance_criteria。范围变化时可升级为 high 或降级为 low。
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

## 运行时契约

遵循 [公共运行时模式](../references/common-runtime-patterns.md)。本阶段特有：
- **写入工件**：`scope` → `.orbit/state/<task_id>/scope.md`
- **结束事件**：`SCOPE_DONE` / `ESCALATE_DENSITY` / `DOWNGRADE_DENSITY`
- **阶段转换**：`scoping` → `executing` / `designing`
- **任务清单进入项**（用 `TaskCreate`）：确认 in_scope、确认 out_of_scope、确认 acceptance_criteria

输出格式（含期望内容说明）：
1. `scoped_goal`：一句话目标，与 triage 的 `goal` 对齐
2. `in_scope`：本轮要完成的具体项列表
3. `out_of_scope`：明确排除的项
4. `constraints_and_risks`：实现约束与可预见风险
5. `acceptance_criteria`：可验证的成功判据列表
6. `artifact_written`：`scope`（路径：`.orbit/state/<task_id>/scope.md`）
7. `next_event`：`SCOPE_DONE` / `ESCALATE_DENSITY` / `DOWNGRADE_DENSITY`
8. `next_skill`：`execute` / `design`（按路由规则）
9. `next_action`：下一步唯一动作

## 原生工具集成

- **`Explore` agent**：确认 in_scope/out_of_scope 前，扫描现有相关代码，了解实现边界与依赖关系
- **`Glob` / `Grep`**：搜索具体模式或文件，配合 Explore 使用
- **`AskUserQuestion`**：边界经 Explore 后仍模糊时，让用户圈定范围或确认 acceptance_criteria

### 退出前自检（缺一不可声明 SCOPE_DONE / ESCALATE / DOWNGRADE）
- [ ] runtime.json 已回写：stage、last_event、next_action 已更新
- [ ] `scope.md` 已落盘且包含 in_scope / out_of_scope / acceptance_criteria
- [ ] 原生任务清单已同步到 runtime.todo[]（`TaskUpdate` 后回写）
- [ ] 若升级/降级 density：triage_result 已更新并记录原因
- [ ] 调用 `node plugins/orbit/scripts/validate-orbit-state.mjs --runtime .orbit/state/<task_id>/runtime.json` 通过
