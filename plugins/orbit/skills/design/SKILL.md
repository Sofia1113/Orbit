---
name: design
description: High 任务的方案澄清与决策阶段。对于需要权衡不同实现路径的任务（用户说『有几种做法你给我比一下』『这个架构应该怎么拆』『先设计一下再写』、或 pilot 判定为 high 后）必须调用本 skill 产出 2–3 个候选方案与取舍分析。**未经用户显式批准推荐方案不得推进到 planning**——这是为了避免把未经确认的假设带进实现、造成下游返工。
---

<HARD-GATE>
未经用户显式批准推荐方案，禁止声明 `DESIGN_DONE`、禁止调用 `planning` skill、禁止生成 `plan` 工件。
『用户没反对』『方案看起来合理』『先生成 plan 供用户审查』都不构成批准——
这一闸门的目的是让后续 planning/executing 永远建立在已确认的方案之上。
批准必须通过 `AskUserQuestion`（preview 模式）完成——向用户展示 2-3 个候选方案的 label/description/preview，待用户选择后，所选 option 即为 `approved_option`。
这一闸门的目的是让后续 planning/executing 永远建立在已确认的方案之上。
</HARD-GATE>

目标：
- 澄清问题边界、约束和成功标准
- 给出 2 到 3 个候选方案，并说明主要取舍
- 推荐一个方案，用 AskUserQuestion(preview) 呈交用户批准后进入 `planning`

路由规则（完成后触发）：
- `DESIGN_DONE`（已获用户批准）→ 调用 `planning` skill，进入 `planning`
- 用户要求修改方案 → 不推进事件，继续在本阶段迭代
- 经过澄清发现任务实际是 medium 规模 → 声明 `DOWNGRADE_DENSITY`，降级为 `medium`，进入 `scoping`
- 用户拒绝所有方案且无法继续 → 声明 `PAUSE`，进入 `paused`，调用 `handoff` skill 保留现场

约束：
- 仅 `high` 可进入本阶段
- 不直接写实现代码
- 不把未经确认的假设带入 planning
- 只保留推进当前任务真正必要的信息
- 不进入实现细排期，不直接执行代码改动
- 必须产出 `design` 工件并声明 `DESIGN_DONE`
- `DESIGN_DONE` 前 `design.md` 必须包含 `## User Approval` 锚点，且 `approved_option` 非空

状态持久化：
- `design` 工件写入 `.orbit/state/<task_id>/design.md`
- 未获批准时 `approved_option: null`，`stage` 保持在 `designing`
- 结束时回写 `.orbit/state/<task_id>/runtime.json`：
  - `stage`：`designing` → 目标阶段
  - `last_event`：`DESIGN_DONE` / `DOWNGRADE_DENSITY` / `PAUSE`
  - `artifacts.design`：工件路径
  - `next_action`：指向下一个 skill 的具体动作

事件流（append-only）：见 `state/README.md#事件流append-only`。本 skill 若触发多个 `last_event`（如 `DOWNGRADE_DENSITY` → `PAUSE`），按时间顺序追加多行。

TodoWrite 绑定：
- 进入 designing 的第一步调用 TodoWrite，至少包含：
  - 澄清范围
  - 候选方案枚举
  - 推荐方案与取舍
- 每个 option 的比较可作为子 todo；任意时刻只能有一个 `in_progress`
- `DESIGN_DONE` 前所有澄清/比较类 todo 必须 `done`

`design.md` 锚点规范（必须保留，hook 据此校验）：
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
5. `open_questions`：尚未回答、阻碍 `DESIGN_DONE` 的问题
6. `user_approval`：`{ approved_option, approved_by, approved_at }`，未获批时全部为 `null`
7. `artifact_written`：`design`（路径：`.orbit/state/<task_id>/design.md`）
8. `next_event`：`DESIGN_DONE`（需在 user_approval 就位后） / `DOWNGRADE_DENSITY` / `PAUSE`
9. `next_skill`：`planning` / `scoping` / `handoff`
10. `planning_input`：供 planning 消费的关键输入（推荐方案摘要、关键约束、acceptance 雏形）
11. `next_action`：下一步唯一动作，如"调用 planning skill 拆解推荐方案"

## 原生工具集成

本 skill 在以下操作点必须使用 Claude Code 原生工具：

- **`Explore` agent**：在设计方案前，先用 Explore agent 探索现有架构、技术栈、代码模式。关键是不靠假设做设计——先看代码事实，再提出方案。聚焦：
  - 当前相关模块的文件布局和职责
  - 现有数据流和依赖方向
  - 已有的类似模式或约定
- **`AskUserQuestion`**（核心工具）：
  - **方案选择必须使用 `AskUserQuestion(preview)`**：在产出 2-3 个候选方案后，通过 AskUserQuestion 展示方案对比。配置方式：
    - 每个 option 的 `label` 写方案简称（如 `"Option A: 命名式导出"`）
    - `description` 写方案简要与关键取舍
    - `preview` 写关键代码/API 形状/对比要点（利用 preview 的 markdown monospace 渲染做侧边栏对比，用户切换 option 时右侧实时显示对应方案的代码骨架）
    - 用户选定后，`approved_option` = 所选 option 的 label
  - 当 `clarified_scope` 或 `open_questions` 需要用户补充时，也可用 AskUserQuestion 收集反馈

关联约束：
- `### User Approval` 锚点中的 `approved_option` 必须与 AskUserQuestion 用户所选一致
- "未经用户批准不推进" → 通过 AskUserQuestion 的结构化选择实现，禁止用纯文本"看起来没问题"替代
- Explore 优先于发散：设计前先用 Explore 获取事实，让方案建立在代码现状之上
