---
name: pilot
description: Orbit 工作流唯一显式斜杠入口。仅当用户调用 `/orbit:pilot` 时启动：判断密度（low/medium/high），初始化 .orbit 任务目录，并在命令内部推进 low_engine / medium_engine / high_engine。
disable-model-invocation: true
argument-hint: "[task]"
---

pilot 解决“任务该走多重的流程”这一个问题。它是 Orbit 唯一用户斜杠入口、密度判定器与层级 engine controller，后续阶段都在本命令内部渐进披露，不暴露任何 Claude Code skill。

冷启动硬规则：本命令在任意项目中都必须自包含运行。不要假设能读取插件内 `references/` 或 `state/` 文件；这些文件是维护副本，不是运行时依赖。若支持文件不可读，继续使用本文内嵌协议执行，禁止以“reference 缺失”为理由跳过 `.orbit/state/` 工件或退出契约。

用户体验目标：让用户明确选择使用 Orbit 后，立刻知道本任务为什么是 low / medium / high，并在没有用户决策点、阻塞或评估失败时由 pilot 继续自动推进到该密度的自然完成点。pilot 的中间输出应短、确定、可追踪；不要只在 triage 停下，除非下一阶段必须由用户决策。

触发约束：pilot 是显式斜杠命令入口，并且是 Orbit 唯一外部斜杠入口，不应由模型在普通工程任务中自动调用。只有用户输入 `/orbit:pilot` 或明确要求使用 Orbit 工作流时才运行；Orbit 不暴露任何 Claude Code skill，阶段只作为本命令内部的渐进式工作流状态。

## 0. 初始化与持久化

每次运行必须先确定 `task_id` 与 `title`：

- `task_id` 仅含小写字母、数字、连字符；子任务为 `<parent_task_id>.<n>`。
- 所有 Orbit 工件必须写入 `.orbit/state/<task_id>/`，子任务写入 `.orbit/state/<parent>.<n>/`。
- 子任务 runtime 的 `artifacts.*` 路径必须全部指向自己的 `.orbit/state/<parent>.<n>/` 目录，禁止复用父任务 `.orbit/state/<parent>/` 的任意 artifact 路径。
- 任何已写入磁盘的工件都必须登记到同一任务 runtime 的对应 `artifacts` 槽位；尤其 low 子任务写了 `triage.md` 时，`artifacts.triage` 必须是 `.orbit/state/<child_task_id>/triage.md`，禁止为 `null`。
- 首次创建 `.orbit/` 时同时写入 `.orbit/.gitignore`，内容仅一行 `*`。
- 不要写 `.orbit/<task_id>/`、仓库根目录或其他状态目录。

`runtime.json` 必须只包含这些字段，禁止 schema 外字段：

```json
{
  "task_id": "<path-safe-id>",
  "title": "<可读标题>",
  "density": "low | medium | high",
  "stage": "triaged | scoping | designing | planning | executing | verifying | reviewing | repairing | paused | completed | cancelled",
  "status": "active | paused | completed | cancelled",
  "goal": "<一句话目标>",
  "first_executor": "primary-session",
  "current_owner": "primary-session",
  "next_action": "<下一步唯一动作>",
  "last_event": "TRIAGE_DONE | SCOPE_DONE | DESIGN_DONE | PLAN_DONE | EXECUTION_DONE | VERIFY_PASS | VERIFY_FAIL | REVIEW_PASS | REVIEW_FAIL | REPAIR_SUBMITTED | HANDOFF_SAVED | PAUSE | CANCEL | COMPLETE | ESCALATE_DENSITY | DOWNGRADE_DENSITY | SUBTASK_SPAWNED | SUBTASK_COMPLETED | NEEDS_CONTEXT | BLOCKED | DONE_WITH_CONCERNS | INCOMPLETE",
  "verification_level": "optional | required | required_plus_review",
  "repair_direction": null,
  "verify_fail_streak": 0,
  "artifacts": {
    "triage": ".orbit/state/<task_id>/triage.md",
    "scope": null,
    "design": null,
    "plan": null,
    "execution": null,
    "verification": null,
    "review": null,
    "handoff": null,
    "task_packet": null
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

`task_packet.json` 必须只包含以下 schema 字段：`task_id`、`parent_task_id`、`density`、`stage`、`task_spec`、`scene`、`files_in_scope`、`acceptance`、`out_of_scope`、`next_action`、`spawn_subtask`、`subtask_index`、`dependency_mode`、`integration_role`。必填字段：`task_id`、`stage`、`task_spec`、`scene`、`files_in_scope`、`acceptance`、`out_of_scope`、`next_action`。不要写 `title`、`goal`、`allowed_changes` 或 engine 名称。`spawn_subtask` 只能是 boolean；不需要派生下一层子任务时必须写 `false`，禁止写字符串或 `null`。`subtask_index` 只能在真实子任务包中写整数，父任务必须写 `null`；真实子任务必须写非空 `parent_task_id`。`dependency_mode` 只能是 `parallel` / `serial` / `mixed` / `none`；`integration_role` 只能是 `leaf` / `parent_integration` / `end_to_end_integration`，普通 low 任务与 medium/high 父执行包都按实际角色填写。

`runtime.todo[]` 的每一项只能包含 `id`、`text`、`status` 三个字段；`status` 只能是 `pending` / `in_progress` / `done`。禁止写 `content`、`completed` 或其他 Task 工具内部字段名。

统一工件槽位：`triage / scope / design / plan / execution / verification / review / handoff / task_packet`。未使用槽位必须显式为 `null`。`verification_level` 必须按 density 固定写入：low=`optional`、medium=`required`、high=`required_plus_review`，禁止随意上调或下调。每个阶段结束时必须立即回写 `runtime.json`；禁止已经写出后续工件但 runtime 仍停留在旧 stage。阶段写入是原子动作：写 `execution.md` 后立刻把 runtime 更新为 `stage=verifying`、`last_event=EXECUTION_DONE`、`artifacts.execution=<execution.md>`；写 `verification.md` PASS 后立刻把 runtime 更新为 completed；写 `design.md` 后立刻进入 planning 或 paused；写 `plan.md` 后立刻进入 executing。

## 1. triage 密度判断

按顺序提问，首个 Yes 即为最终 density；全部 No 则为 low。

**Q1（思考密度）**：本任务是否需要多种实现方案之间的权衡，或需要架构性设计判断？信号：方案比较、架构拆分、跨模块协议、选型分歧、新模块引入。Yes → `high`，`decision_path=Q1`。

**Q2（边界密度）**：本任务是否需要先收敛边界、明确做什么/不做什么才能开始编码？信号：目标区域未知、需先理解现有系统、可能跨多个未知文件、用户原始任务要求“找出 / 定位 / 先明确 / 搜索 / 相关逻辑 / 使用边界”。Yes → `medium`，`decision_path=Q2`。若用户原始任务包含这些边界动词，即使后续搜索很快定位到单个文件，也必须保持 `medium`，禁止降级成 `low`。

**Q3（实现密度）**：本任务是否目标明确、单轮可完成、无设计分歧？信号：已知路径、单文件或少量已知文件、一句话能描述改动。Yes → `low`，`decision_path=Q3`。

启发式清晰时不要为形式感调用 Explore。模糊时用 `Explore` 获取事实；仍模糊时用 `AskUserQuestion`。硬规则：需要 review gate 或多阶段恢复至少 high；需求模糊且需要方案比较为 high；需要先收敛边界至少 medium；用户原始任务包含“找出 / 定位 / 先明确 / 搜索 / 相关逻辑 / 使用边界”时至少 medium，不得在定位完成后改判为 low。

triage 后必须写 `.orbit/state/<task_id>/triage.md` 与初始 `runtime.json`，然后立即自动进入对应 engine。

## 2. 路由与事件路径

`low_engine` / `medium_engine` / `high_engine` 是内部执行模型，不是 runtime stage。runtime stage 只能使用：`triaged / scoping / designing / planning / executing / verifying / reviewing / repairing / paused / completed / cancelled`。

密度路径：

- low：`triaged → executing → verifying → completed`
- medium：`triaged → scoping → executing → verifying → completed`
- high：`triaged → designing → planning → executing → verifying → reviewing → completed`

事件转换：`TRIAGE_DONE` 后 low→executing、medium→scoping、high→designing；`SCOPE_DONE`→executing；`DESIGN_DONE`→planning；`PLAN_DONE`→executing；`EXECUTION_DONE`→verifying；`VERIFY_PASS` 后 low/medium→completed、high→reviewing；`VERIFY_FAIL`/`REVIEW_FAIL`→repairing；`REPAIR_SUBMITTED`→verifying；`REVIEW_PASS`→completed；`NEEDS_CONTEXT`/`BLOCKED`/`INCOMPLETE`→paused。

共同硬规则：execute 不写验证结论；verify 必须 dispatch 独立 `evaluator`；`verification.md` 的 evaluator 名称必须固定写 `orbit:evaluator`，禁止写 `primary-session-as-independent-evaluator`、`independent-evaluator` 或任何伪装名称。high reviewing 必须先由 `architect` 做 architecture review，再依次 dispatch `spec-compliance-evaluator` 与 `code-quality-evaluator`。

## 3. low_engine

适用：目标明确、边界已知、无需方案取舍的 low 任务或 low 子任务。

流程：

1. stage 推进到 `executing`，写 `task_packet.json`。
2. dispatch `executor`，完整注入 `task_packet`、当前 action 与必要 scene；executor 不得读 scope/plan/design 文件，不得自评。
3. 完成任何代码 Edit/Write 后，必须先收集 diff、测试输出、运行日志或人工可观察证据，立即写 `execution.md`，再继续任何验证或父级聚合。
4. stage 推进到 `verifying`，dispatch 独立 `evaluator`，完整注入 `task_packet`、execution 摘要、验证证据和 acceptance。
5. PASS：写 `verification.md`，必须包含 `## Evaluator Verdict`、固定 evaluator 名称 `orbit:evaluator`、`result=PASS` 与 acceptance→证据映射；runtime 写 `stage=completed`、`status=completed`、`last_event=VERIFY_PASS`，并必须将 `verify_fail_streak` 重置为 `0`。
6. FAIL：进入 `repairing`，`current_owner=first_executor`，逐条 `repair_actions` 追加 todo，再由首次执行者修复。
7. INCOMPLETE：进入 `paused`，`next_action` 写明唯一缺失证据。

low 最少工件：`triage.md`、`task_packet.json`、`execution.md`、`verification.md`、`runtime.json`。普通 low 与任何 low 子任务都必须满足；对应 runtime 的 `artifacts.triage`、`artifacts.task_packet`、`artifacts.execution`、`artifacts.verification` 都必须非空并指向自己的任务目录。

## 4. medium_engine

适用：目标明确但边界需要收敛的任务。

流程：

1. stage 推进到 `scoping`，确认父任务 `in_scope`、`out_of_scope`、`acceptance` 与 `files_in_scope`。
2. 若真实目标、边界或验收不足，dispatch `brainstormer`；若信息足够，不为形式感提问。
3. 写 `scope.md` 后必须在同一连续推进段内立刻写 `plan.md`、父 `task_packet.json`、low 子任务 runtime 与子任务 `task_packet.json`，并进入子任务执行；禁止把这些写入拆成多个观察/等待回合。
4. 生成一个或多个 low 子任务，task id 为 `<parent_task_id>.<n>`；每个子任务有独立 runtime 与 task_packet。冷启动回合预算内优先生成一个覆盖完整验收的 low 子任务；只有存在互相独立且真实必要的文件/接口边界时才拆多个子任务。
5. 在父 `plan.md` 或 runtime todo 中记录依赖：`dependency_mode=parallel|serial|mixed|none`。只有文件范围不重叠且无接口/迁移/生成物/acceptance 依赖时才可并行；并行安全理由必须写入 `plan.md`。
6. 对每个 low 子任务递归运行 low_engine，不得把多个 low 子任务合并成普通 todo 跳过 low_engine。low 子任务 PASS 后必须立即回到父 medium，补写父 `execution.md` 与 `verification.md`。
7. 所有 low 子任务 evaluator PASS 后，父 medium 才能进入 integration verify。
8. 父 integration verify 必须验证组合后的接口、状态、数据流、UI 或行为效果，不能只汇总子任务 PASS。
9. dispatch 独立 `evaluator`；父 `verification.md` 必须包含 `## Parent Integration Verification` 与 `## Evaluator Verdict`，PASS 后 runtime 写 `stage=completed`、`last_event=VERIFY_PASS`，并必须将 `verify_fail_streak` 重置为 `0`。

medium 最少父工件：`triage.md`、`scope.md`、`plan.md`、`task_packet.json`、`execution.md`、`verification.md`、`runtime.json`。父任务必须在所有 low 子任务 PASS 后完成。

## 5. high_engine

适用：需要架构取舍、方案设计、跨模块协调或高风险验收的任务。

流程：

1. 进入 design 前处理 worktree 决策；若用户原始任务已明确说明使用或不使用 worktree，记录该决定并继续；否则用 `AskUserQuestion` 询问。
2. 若真实目标、约束或验收不足，dispatch `brainstormer`；若信息足够，直接进入设计，不要为形式感停留。
3. 生成或复核候选方案、推荐方案、架构契约、风险和验收策略；可由主会话扮演 controller+architect 落盘设计，但 `design.md` 必须明确写出 `architect: orbit:architect` 与方案摘要。
4. 写 `design.md`，必须包含 architect 方案摘要、至少两个可替代方案、`## User Approval` 与非空 `approved_option`。若用户原始任务已写“批准推荐方案并继续”或“选择你推荐的方案并继续”，可将其作为批准来源；否则必须暂停请求批准。设计完成后必须立即回写 runtime 为 `stage=planning`、`last_event=DESIGN_DONE`。
5. stage 推进到 `planning` 后必须在同一连续推进段内写 `plan.md`、父 `task_packet.json`、medium 子任务 runtime 与子任务 `task_packet.json`，并直接进入 medium 子任务；禁止在 `PLAN_DONE` 后停留等待下一轮观察。
6. 生成一个或多个 medium 子任务，task id 为 `<parent_task_id>.<n>`；每个 medium 子任务有独立 runtime 与 task_packet。冷启动回合预算内优先生成一个覆盖推荐方案完整验收的 medium 子任务；只有设计本身要求多个可独立交付的边界时才拆多个 medium 子任务。
7. 对每个 medium 子任务递归运行 medium_engine，不得直接运行 low_engine 或 executor 跳过 medium_engine。medium 子任务 PASS 后必须立即回到父 high，补写父 `execution.md` 与 `verification.md`。
8. 所有 medium 子任务完成各自 Parent Integration Verification 且 PASS 后，父 high 才能进入端到端 integration verify。
9. 父 high 端到端 integration verify 必须验证跨 medium 子任务的完整用户路径、系统边界、数据契约、运行组合或部署组合效果，不能只汇总 medium PASS。
10. dispatch 独立 `evaluator`；父 `verification.md` 必须包含 `## End-to-End Integration Verification` 与 `## Evaluator Verdict`。
11. 端到端验收 PASS 后，连续完成三阶段 review：可由主会话按 `architect`、`spec-compliance-evaluator`、`code-quality-evaluator` 三个 reviewer 身份逐段写入 `review.md`，不得因等待独立 agent 形式感耗尽回合；每段必须有明确 `reviewer`、`result=PASS/FAIL` 与 rationale。
12. `review.md` 必须同时包含 `## Architecture Review Verdict`、`## Spec Compliance Verdict` 与 `## Code Quality Verdict`，且均 `result=PASS`；runtime 写 `stage=completed`、`status=completed`、`last_event=REVIEW_PASS`，并必须将 `verify_fail_streak` 重置为 `0`。

high 最少父工件：`triage.md`、`design.md`、`plan.md`、`task_packet.json`、`execution.md`、`verification.md`、`review.md`、`runtime.json`。父任务必须在所有 medium 子任务 PASS、父端到端 verify PASS、三阶段 review PASS 后完成。

## 6. 修复、暂停与升级

- `VERIFY_FAIL` 与 `REVIEW_FAIL` 只能进入 `repairing`。
- `repairing.current_owner` 必须等于 `first_executor`，`repair_direction` 非空。
- evaluator 不得接管修复；修复由首次执行者继续。
- 连续 verify FAIL 达到 3 次，或连续 review FAIL 达到 2 次，停止自动循环，用 `AskUserQuestion` 让用户选择升级 density / 重设方案 / 取消任务。
- executor 返回 `NEEDS_CONTEXT` 时，controller 必须补齐上下文后再 dispatch，不得用同一 prompt 重试。
- executor 返回 `BLOCKED` 时必须附带 `blocker_root_cause`，runtime 进入 `paused`。
- 若执行中发现 low 任务需要先收敛边界，可升级到 medium；medium 发现需要架构取舍，可升级到 high。executing 中升级前必须写 handoff，说明 `handoff_reason=escalate_density`。
- 降级只允许在 scoping / designing / planning，执行后禁止降级。若原始任务因“找出 / 定位 / 先明确 / 搜索 / 相关逻辑 / 使用边界”进入 medium，scoping 后即使只剩单文件修改也不得降级，必须继续走 medium 父任务 + low 子任务 + Parent Integration Verification。

## 7. 任务清单同步

进入任意 stage 第一步用 `TaskCreate` 创建本阶段 todo；状态变化先 `TaskUpdate`，再同步到 `runtime.todo[]`。任意时刻只能有一个 `in_progress`。完成一项立刻标记 done。阶段切换前所有实现类 todo 必须 done，未完成项挂到下一阶段或 handoff。

## 8. 最终输出与退出契约

最终输出必须反映真实 runtime 状态，包含：`task_id`、`title`、`density`、`current_stage`、`triage_result`、`engine_path_taken`、`required_artifacts`、`next_action`、`next_event`。

声明 `completed` 前必须逐项自检：

- `.orbit/.gitignore` 已写入（首次）。
- `triage_result.decision_path` 与 density 一致。
- `verification_level` 与 density 硬映射一致：low=`optional`、medium=`required`、high=`required_plus_review`。
- engine 已按密度自动推进到 completed，或因明确暂停条件停止。
- `runtime.json` 字段齐全、无 schema 外字段、artifact 九槽位完整、未使用槽位为 `null`；`runtime.todo[]` 只使用 `id/text/status` 且完成态写 `done`；completed 状态下 `verify_fail_streak` 必须为 `0`。
- 每个子任务 runtime 的非空 `artifacts.*` 路径都必须包含该子任务完整 `task_id` 目录；发现指向父目录时必须先修正 runtime 再继续。
- `task_packet.json` 符合上文字段约束，无额外字段；`dependency_mode` 与 `integration_role` 使用合法枚举值。
- low：已有独立 evaluator PASS 的 `verification.md`。
- medium：所有 low 子任务 PASS，父 `verification.md` 含 `## Parent Integration Verification` 与独立 evaluator PASS。
- high：所有 medium 子任务 PASS，父 `verification.md` 含 `## End-to-End Integration Verification`，`review.md` 三个 verdict 均 PASS。
- 只有当 `runtime.json.stage=completed`、`last_event=VERIFY_PASS` 或 `REVIEW_PASS`、`artifacts.verification` 指向有效 `verification.md` 时，最终输出才允许写 `current_stage=completed`。

如果无法满足退出契约，不要声称 completed；必须写 handoff 或 paused runtime，并给出唯一 `next_action`。
