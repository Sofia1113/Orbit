# Orbit 状态协议

所有 skill 共享的持久化、任务清单与跨会话恢复规则。SKILL 文本只描述本阶段独有差异，本文件是 `.orbit/` 状态目录运作方式的唯一权威源。

## 任务状态目录

每个任务对应一个独立目录：

```
.orbit/state/<task_id>/
├─ runtime.json          # 当前任务运行时状态（每个 skill 结束时回写）
├─ handoff.json          # 存在时是后续会话恢复的最高优先级源
├─ triage.md / scope.md / design.md / plan.md
├─ task_packet.json
├─ execution.md / verification.md / review.md / handoff.md
```

子任务放在 `.orbit/state/<parent>.<n>/`，拥有独立 runtime。

## 初始化

`.orbit/` 根目录首次由 pilot 创建时必须同时写入 `.orbit/.gitignore`，内容仅一行 `*`。意图：默认任务状态不入库；如需入库由用户自行调整或删除该文件。

## runtime.json

每次 skill 结束时回写以下字段：

| 字段 | 说明 |
|---|---|
| `stage` | 当前阶段 → 目标阶段 |
| `last_event` | 本阶段产出的结束事件 |
| `next_action` | 指向下一个 skill 的唯一动作 |
| `artifacts.<slot>` | 工件路径，未使用的槽位置 `null` |
| `todo[]` | 任务清单的持久化投影 |
| `current_owner` | 当前执行身份；`repairing` 阶段必须等于 `first_executor` |
| `repair_direction` | `repairing` 阶段必填 |

完整字段定义见 `state/runtime-state.schema.json`。

pilot 首次写入 runtime 的最小模板：

```json
{
  "task_id": "<path-safe-id>",
  "title": "<可读标题>",
  "density": "low | medium | high",
  "stage": "triaged",
  "status": "active",
  "goal": "<一句话目标>",
  "first_executor": "primary-session",
  "current_owner": "primary-session",
  "next_action": "<下一步唯一动作>",
  "last_event": "TRIAGE_DONE",
  "verification_level": "optional | required | required_plus_review",
  "repair_direction": null,
  "artifacts": {
    "triage": ".orbit/state/<task_id>/triage.md",
    "scope": null, "design": null, "plan": null,
    "execution": null, "verification": null,
    "review": null, "handoff": null, "task_packet": null
  },
  "todo": [],
  "triage_result": {
    "decision_path": "Q1 | Q2 | Q3",
    "density": "low | medium | high",
    "rationale": "<决策理由>",
    "hard_rules_triggered": []
  }
}
```

## artifacts 槽位

统一九槽位，未使用为 `null`：

| 槽位 | 写入阶段 | 文件名 | 内容要点 |
|---|---|---|---|
| `triage` | pilot | `triage.md` | density 决策与路由理由 |
| `scope` | scoping | `scope.md` | in_scope / out_of_scope / acceptance |
| `design` | design | `design.md` | 候选方案 + `## User Approval` 锚点 |
| `plan` | planning | `plan.md` | execution_steps + 依赖图 |
| `task_packet` | planning 或 execute 自举 | `task_packet.json` | dispatch subagent 的输入契约 |
| `execution` | execute | `execution.md` | 文件级变更摘要 |
| `verification` | verify | `verification.md` | checks + `## Evaluator Verdict` 锚点 |
| `review` | reviewing | `review.md` | `## Spec Compliance Verdict` + `## Code Quality Verdict` |
| `handoff` | 任意阶段 HANDOFF_SAVED | `handoff.json` + `handoff.md` | 恢复载荷 |

## 任务清单双层模型

- **持久 SSOT** = `runtime.todo[]`（跨会话存活）
- **会话投影** = 原生 `TaskCreate` / `TaskUpdate` / `TaskList` 维护的列表（仅当前会话可见）

规则：

1. 进入任意 stage 第一步用 `TaskCreate` 创建本阶段所有 todo，结果回写到 `runtime.todo[]`
2. 状态变化先 `TaskUpdate` 改会话投影，再同步 `runtime.todo[]`，不允许只改其一
3. 任意时刻只能有一个 `in_progress`
4. 完成一项立刻 `TaskUpdate` 置 `done`；evaluator 返回的 `repair_actions` 逐条 `TaskCreate` 追加为新 todo
5. 后续会话恢复时由 `runtime.todo[]` 反向重建会话任务列表；冲突以 `runtime.todo[]` 为准
6. 阶段切换前所有实现类 todo 必须 `done`，未完成项挂到下一阶段或 handoff

## first_executor 与跨会话恢复

`first_executor` 不是会话 ID，而是**任务的逻辑首席执行者角色**——用于守护"FAIL 后修复必须由首次执行者承担"这条硬规则。

约定：

- pilot 创建 runtime 时填入约定 sentinel `"primary-session"`
- subagent dispatch 不改变 `first_executor`
- handoff 也不改变 `first_executor`，只改变 `current_owner` 与 `next_action`
- 新会话恢复同一任务时默认承接 `first_executor="primary-session"` 角色，可在 `repairing` 阶段合法承担修复
- 仅当用户显式声明换主时才更新 `first_executor`，并在 `triage_result.hard_rules_triggered` 或 `repair_direction` 中记录原因

禁止：

- 不得把 transient ID（时间戳、PID）写入 `first_executor`
- 不得在 dispatch subagent 时把 subagent handle 写为 `first_executor`

## 恢复优先级

```
handoff.json
  → runtime.json
  → 最近失败 review.md
  → 最近失败 verification.md
  → 最近 execution.md
  → 其他 artifact
  → 原始任务描述
```

## handoff 人类摘要

`handoff.md` 是人类接力单，不是长总结。它应优先回答：当前焦点是什么、哪些决策已经确认、哪些事实可作为恢复依据、有哪些风险或待验证项、下一步唯一动作是什么。恢复时先读 `handoff.json` 获取机器状态，再读 `handoff.md` 获取人类上下文。

## 退出前通用自检

每个 skill 在声明结束事件前必须确认：

- [ ] 本阶段工件已按上表落盘
- [ ] `runtime.json` 已回写：stage、last_event、next_action、artifacts.<slot>、todo[]
- [ ] 原生任务清单已与 `runtime.todo[]` 同步（实现类 todo 已 `done`，未完成项挂到下一阶段或 handoff）
- [ ] `first_executor == "primary-session"` 未被改动
- [ ] 处于 `repairing` 时 `current_owner == first_executor` 且 `repair_direction` 非空
- [ ] 调用 `node plugins/orbit/scripts/validate-orbit-state.mjs --runtime .orbit/state/<task_id>/runtime.json` 通过

各 skill 在此基础上加自己的特有退出条件（如 design 必须含 `## User Approval`、verify 必须含 `## Evaluator Verdict`）。
