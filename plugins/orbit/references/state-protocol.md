# Orbit 状态协议

`/orbit:pilot` 内部所有阶段共享的持久化、任务清单与跨会话恢复规则。本文件是 `.orbit/` 状态目录运作方式的唯一权威源。

## 任务状态目录

每个任务对应一个独立目录：

```
.orbit/state/<task_id>/
├─ runtime.json          # 当前任务运行时状态（每个阶段 结束时回写）
├─ handoff.json          # 存在时是后续会话恢复的最高优先级源
├─ triage.md / scope.md / design.md / plan.md
├─ task_packet.json
├─ execution.md / verification.md / review.md / handoff.md
```

子任务放在 `.orbit/state/<parent>.<n>/`，拥有独立 runtime。

## 层级 engine 模型

`low_engine` / `medium_engine` / `high_engine` 是内部执行模型，不是 runtime `stage`。runtime 仍只使用 `triaged / scoping / designing / planning / executing / verifying / reviewing / repairing / paused / completed / cancelled`。

- `low_engine`：`executing → verifying`，用于目标明确的单元任务。
- `medium_engine`：`scoping → N × low_engine → integration_verify`，用于先收敛边界再拆分执行的任务。
- `high_engine`：`worktree decision → designing → planning → N × medium_engine → integration_verify → reviewing`，用于需要方案取舍或架构判断的任务。

`/orbit:pilot` 是唯一外部斜杠入口。Orbit 不暴露任何 Claude Code skill；阶段只作为命令内部的渐进式工作流状态，由 engine 的 `next_action` 驱动。pilot 是 engine controller，默认从 triage 自动推进到当前 density 的自然完成点，而不是只输出 triage 结果。

## 初始化

`.orbit/` 根目录首次由 pilot 创建时必须同时写入 `.orbit/.gitignore`，内容仅一行 `*`。意图：默认任务状态不入库；如需入库由用户自行调整或删除该文件。

## runtime.json

`runtime.json` 必须严格符合 `state/runtime-state.schema.json`，禁止写入 schema 外字段。面向用户的 `engine_path_taken`、`required_artifacts`、详细决策轨迹等只出现在最终输出或 markdown 工件中，不进入 runtime。

每个阶段结束时回写以下字段：

| 字段 | 说明 |
|---|---|
| `stage` | 当前阶段 → 目标阶段 |
| `last_event` | 本阶段产出的结束事件 |
| `next_action` | 指向下一个阶段 的唯一动作 |
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

## 自动推进与用户打断

默认规则：只要当前阶段已产出必需工件，且没有用户决策点、阻塞或评估失败，controller 必须沿 `next_action` 自动推进；不得把 `TRIAGE_DONE` 当作用户可见终点。low / medium 的常规任务应在同一次 `/orbit:pilot` 调用中推进到 `completed`。

必须暂停并询问用户的决策点：

- high_engine 进入 design 前，询问是否使用 `git worktree`。
- design 阶段候选方案批准。
- scoping / planning 中发现范围变化或拆解歧义，且原始任务没有足够偏好让 controller 自行收敛。
- 用户随时打断并提出新的决策或建议。
- 连续 verify / review 失败达到上限。
- 执行将越过 `files_in_scope` 或触及 `out_of_scope`。

用户打断后的回退映射：

| 用户输入影响范围 | 回退阶段 | 处理方式 |
|---|---|---|
| 仅影响当前实现细节 | `executing` | 更新当前 task_packet scene 或 handoff 后继续执行 |
| 改变 in_scope / out_of_scope / acceptance | `scoping` | 重新收敛边界，废弃不再有效的后续工件 |
| 改变方案选择或架构方向 | `designing` | 重新给出候选方案并请求批准 |
| 改变拆解、依赖或子任务边界 | `planning` | 重新生成 execution_steps 与子任务包 |
| 针对 evaluator / reviewer FAIL 的修复意见 | `repairing` | `current_owner` 保持等于 `first_executor` |
| 缺少外部信息或需要用户确认 | `paused` | `next_action` 写明唯一问题或可选决策 |

回退不新增 stage；需要保留现场时先写 handoff，再调整 runtime。

## artifacts 槽位

所有工件都必须位于 `.orbit/state/<task_id>/`；`.orbit/<task_id>/`、仓库根目录或其他路径都不是合法状态目录。

`artifacts` 对象必须始终包含完整九槽位；即使当前 density 不使用某槽位，也必须显式写 `null`。

统一九槽位，未使用为 `null`：

| 槽位 | 写入阶段 | 文件名 | 内容要点 |
|---|---|---|---|
| `triage` | pilot | `triage.md` | density 决策与路由理由 |
| `scope` | scoping | `scope.md` | in_scope / out_of_scope / acceptance |
| `design` | design | `design.md` | 候选方案 + `## User Approval` 锚点 |
| `plan` | planning | `plan.md` | execution_steps + 依赖图 |
| `task_packet` | planning 或 execute 自举 | `task_packet.json` | dispatch subagent 的输入契约，必须符合 `state/task-packet.schema.json` 且无额外字段 |
| `execution` | execute | `execution.md` | 文件级变更摘要 |
| `verification` | verify | `verification.md` | checks + 独立 evaluator 返回的 `## Evaluator Verdict` 锚点 |
| `review` | reviewing | `review.md` | 独立 spec-compliance 与 code-quality evaluator 返回的 `## Spec Compliance Verdict` + `## Code Quality Verdict` |
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
7. 父任务的子任务聚合状态通过 `runtime.todo[]` 和 `SUBTASK_COMPLETED` 事件表达，不向 `task_packet.json` 写入额外字段

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

## 父子 task_packet 聚合

`task_packet.json` 必须遵守 `state/task-packet.schema.json`，不得写入 schema 之外的聚合字段。层级关系只通过以下字段表达：

- `task_id`: `<parent_task_id>.<n>`
- `parent_task_id`: 父任务 id
- `subtask_index`: 子任务序号
- `density`: 子任务密度

依赖图、聚合策略、失败传播和回退说明写入 `plan.md`、`runtime.todo[]` 或 handoff。父任务不得在所有子任务 `VERIFY_PASS` 前进入 reviewing 或 completed。

## handoff 人类摘要

`handoff.md` 是人类接力单，不是长总结。它应优先回答：当前焦点是什么、哪些决策已经确认、哪些事实可作为恢复依据、有哪些风险或待验证项、下一步唯一动作是什么。恢复时先读 `handoff.json` 获取机器状态，再读 `handoff.md` 获取人类上下文。

## 退出前通用自检

每个阶段 在声明结束事件前必须确认：

- [ ] 本阶段工件已按上表落盘
- [ ] `runtime.json` 已回写：stage、last_event、next_action、artifacts.<slot>、todo[]
- [ ] `runtime.json` 无 schema 外字段，artifacts 九槽位完整，未使用槽位为 `null`
- [ ] `task_packet.json` 符合 `state/task-packet.schema.json`，无 `title` / `goal` / `allowed_changes` 等 schema 外字段
- [ ] 原生任务清单已与 `runtime.todo[]` 同步（实现类 todo 已 `done`，未完成项挂到下一阶段或 handoff）
- [ ] `first_executor == "primary-session"` 未被改动
- [ ] 处于 `repairing` 时 `current_owner == first_executor` 且 `repair_direction` 非空
- [ ] 不依赖外部 validator；按本协议逐项自检路径、工件、runtime 字段与阶段事件一致

各阶段在此基础上加自己的特有退出条件（如 design 必须含 `## User Approval`、verify 必须含 `## Evaluator Verdict`）。
