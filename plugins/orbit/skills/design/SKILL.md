---
name: design
description: High 任务的方案设计阶段。产出 2-3 个候选方案与取舍分析，用 AskUserQuestion(preview) 交用户批准后才能进入 planning。
---

design 解决"该选哪条实现路径"——只做方案权衡，不写实现，不替用户做决定。

## 硬闸门

未经用户显式批准推荐方案，**禁止**声明 `DESIGN_DONE`、**禁止**调用 `planning` skill、**禁止**生成 `plan` 工件。

批准必须通过 `AskUserQuestion(preview)` 完成——向用户展示 2-3 个候选方案的 label / description / preview，待用户选择后，所选 option 即为 `approved_option`。

## 路由

| 完成事件 | 触发条件 | 下一阶段 | 下一 skill |
|---|---|---|---|
| `DESIGN_DONE` | 已获用户批准 | planning | planning |
| `DOWNGRADE_DENSITY` | 经澄清发现实际是 medium | scoping | scoping |
| `PAUSE` | 用户拒绝所有方案且无法继续 | paused | handoff |

用户要求修改方案 → 不推进事件，继续在本阶段迭代。

## 不做

- 不写实现代码
- 不把未经确认的假设带入 planning

## design.md 锚点

`DESIGN_DONE` 前 `design.md` 必须包含：

```
## User Approval
- approved_option: <option id>
- approved_by: <用户确认消息的引用或时间戳>
- approved_at: <ISO8601>
```

## 输出

| 字段 | 说明 |
|---|---|
| `clarified_scope` | 澄清后的范围、约束、成功标准 |
| `options` | 2-3 个候选方案，每个含 `id` / `summary` / `pros` / `cons` |
| `recommendation` | 推荐方案 id 与理由 |
| `tradeoffs` | 方案间关键取舍对比 |
| `open_questions` | 尚未回答的问题 |
| `user_approval` | `{ approved_option, approved_by, approved_at }` |
| `artifact_written` | `design` |
| `next_event` | `DESIGN_DONE` / `DOWNGRADE_DENSITY` / `PAUSE` |
| `next_skill` | `planning` / `scoping` / `handoff` |
| `planning_input` | 供 planning 消费的关键输入 |
| `next_action` | 下一步唯一动作 |

## 工件与状态

- 写入工件：`design` → `.orbit/state/<task_id>/design.md`
- 通用持久化、任务清单、退出自检见 [state-protocol.md](../references/state-protocol.md)

## 优先工具

- `Explore`：先取架构事实，让方案建立在代码之上
- `Plan` agent：独立架构推演，得到第二意见再融入 options
- `AskUserQuestion(preview)`：方案批准的**唯一入口**，每个 option 的 preview 写关键代码 / API 骨架便于侧边栏对比

详见 [native-tools.md](../references/native-tools.md)。

## 本阶段特有退出条件

- [ ] `design.md` 包含 `## User Approval` 锚点
- [ ] `approved_option` 非空，已通过 `AskUserQuestion(preview)` 获得用户显式批准
- [ ] 未经批准不得推进到 planning
