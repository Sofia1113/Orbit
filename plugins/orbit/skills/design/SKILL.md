---
name: design
description: High 任务的方案设计阶段。需要权衡多种实现路径时调用：产出 2-3 个候选方案与取舍分析，用 AskUserQuestion 交用户批准后才能进入 planning。
---

<HARD-GATE>
未经用户显式批准推荐方案，禁止声明 `DESIGN_DONE`、禁止调用 `planning` skill、禁止生成 `plan` 工件。
批准必须通过 `AskUserQuestion`（preview 模式）完成——向用户展示 2-3 个候选方案的 label/description/preview，待用户选择后，所选 option 即为 `approved_option`。
</HARD-GATE>

目标：
- 澄清问题边界、约束和成功标准
- 给出 2 到 3 个候选方案，并说明主要取舍
- 推荐一个方案，用 AskUserQuestion(preview) 呈交用户批准后进入 `planning`

路由规则（完成后触发）：
- `DESIGN_DONE`（已获用户批准）→ 调用 `planning` skill，进入 `planning`
- 用户要求修改方案 → 不推进事件，继续在本阶段迭代
- 经过澄清发现任务实际是 medium 规模 → 声明 `DOWNGRADE_DENSITY`，降级为 `medium`，进入 `scoping`
- 用户拒绝所有方案且无法继续 → 声明 `PAUSE`，进入 `paused`，调用 `handoff` skill

约束：
- 仅 `high` 可进入本阶段
- 不直接写实现代码
- 不把未经确认的假设带入 planning
- `DESIGN_DONE` 前 `design.md` 必须包含 `## User Approval` 锚点，且 `approved_option` 非空

## 运行时契约

遵循 [公共运行时模式](../references/common-runtime-patterns.md)。本阶段特有：
- **写入工件**：`design` → `.orbit/state/<task_id>/design.md`
- **结束事件**：`DESIGN_DONE` / `DOWNGRADE_DENSITY` / `PAUSE`
- **阶段转换**：`designing` → `planning` / `scoping` / `paused`
- **TodoWrite 进入项**：澄清范围、候选方案枚举、推荐方案与取舍
- **特殊规则**：未获批时 `stage` 保持在 `designing`，不推进

`design.md` 锚点规范：
```
## User Approval
- approved_option: <option id>
- approved_by: <用户确认消息的引用或时间戳>
- approved_at: <ISO8601>
```

输出格式（含期望内容说明）：
1. `clarified_scope`：澄清后的范围、约束与成功标准
2. `options`：2–3 个候选方案，每个含 `id`、`summary`、`pros`、`cons`
3. `recommendation`：推荐方案 `id` 与理由
4. `tradeoffs`：方案间关键取舍对比
5. `open_questions`：尚未回答的问题
6. `user_approval`：`{ approved_option, approved_by, approved_at }`
7. `artifact_written`：`design`
8. `next_event`：`DESIGN_DONE` / `DOWNGRADE_DENSITY` / `PAUSE`
9. `next_skill`：`planning` / `scoping` / `handoff`
10. `planning_input`：供 planning 消费的关键输入
11. `next_action`：下一步唯一动作

## 原生工具集成

- **`Explore` agent**：设计前先探索现有架构、技术栈、代码模式，让方案建立在代码事实之上
- **`AskUserQuestion`**（核心工具）：方案选择必须使用 preview 模式，每个 option 的 preview 写关键代码/API 骨架做侧边栏对比。用户选定后 `approved_option` = 所选 label

### 退出前自检（缺一不可声明 DESIGN_DONE）
- [ ] `design.md` 已落盘且包含 `## User Approval` 锚点
- [ ] `approved_option` 非空，已通过 AskUserQuestion(preview) 获得用户显式批准
- [ ] runtime.json 已回写：stage、last_event=DESIGN_DONE、next_action=调用 planning
- [ ] TodoWrite 已同步到 runtime.todo[]
- [ ] 未经用户批准不得推进到 planning
