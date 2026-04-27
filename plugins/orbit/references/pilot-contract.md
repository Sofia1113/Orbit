# pilot 输出与退出契约

本文件承载 `/orbit:pilot` 的输出字段、工件状态约束与退出自检。pilot 主入口只保留摘要和路径，完整检查按需读取本文件。

## 第一阶段披露

作用：约束 pilot 最终输出必须反映真实 runtime 状态，避免只停留在 triage 或把未验收任务说成 completed。

能力：定义输出字段、工件位置、runtime/schema 约束、完成前必备证据与退出条件。

完整内容路径：`plugins/orbit/references/pilot-contract.md`

## 输出契约

pilot 最终输出应反映本次自动推进后的真实状态，而不是固定停留在 triage。

| 字段 | 说明 |
|---|---|
| `task_id` | 路径安全标识符 |
| `title` | 可读任务描述 |
| `density` | `low` / `medium` / `high` |
| `current_stage` | 当前真实 stage：通常为 `completed`，或暂停/失败时的 `scoping` / `paused` / `repairing` |
| `triage_result` | `decision_path` (Q1/Q2/Q3) + `density` + `rationale` + `hard_rules_triggered` |
| `engine_path_taken` | 本次实际走过的 engine 阶段列表 |
| `required_artifacts` | 本次写入的工件路径列表 |
| `next_action` | 若 completed 则写完成摘要；若暂停则写唯一恢复动作 |
| `next_event` | 最后一个事件：通常为 `VERIFY_PASS` / `REVIEW_PASS`，暂停时为 `PAUSE` / `INCOMPLETE` / `BLOCKED` |

## 工件与状态

- 所有 Orbit 工件必须写入 `.orbit/state/<task_id>/`；`.orbit/<task_id>/`、仓库根目录或其他路径都无效。
- triage 后继续写入后续阶段工件，不得只写 `triage.md` 后停止。
- low 最少写入：`.orbit/state/<task_id>/triage.md`、`task_packet.json`、`execution.md`、`verification.md`、`runtime.json`。
- medium 最少写入：`.orbit/state/<task_id>/triage.md`、`scope.md`、`task_packet.json`、`execution.md`、`verification.md`、`runtime.json`。
- high 最少写入：`.orbit/state/<task_id>/triage.md`、`design.md`、`plan.md`、`task_packet.json`、`execution.md`、`verification.md`、`review.md`、`runtime.json`；`design.md` 必须来自或包含 `architect` 的方案设计，`review.md` 必须包含 architecture review verdict。
- `runtime.json` 必须严格符合 `state/runtime-state.schema.json`，禁止新增 schema 外字段；`engine_path_taken`、`required_artifacts` 只能出现在最终用户输出，不得写入 runtime。
- `runtime.json.artifacts` 必须完整包含 `triage / scope / design / plan / execution / verification / review / handoff / task_packet` 九个槽位，未使用槽位写 `null`。
- `triage_result.decision_path` 必须是 `Q1` / `Q2` / `Q3`，详细判断过程写入 `triage.md`，不得在 runtime 中写数组。
- `verification_level` 必须按 density 写入：low=`optional`、medium=`required`、high=`required_plus_review`。
- `task_packet.json` 必须符合 `state/task-packet.schema.json`：必填 `task_id / stage / task_spec / scene / files_in_scope / acceptance / out_of_scope / next_action`，无额外字段；engine 选择由父 workflow 与 runtime density 决定，不写入 task_packet。
- 覆写既有 `runtime.json` 前必须先 `Read` 当前文件；不要用未读直接 `Write` 导致流程中断。
- `first_executor` 必须固定为 `primary-session`，`current_owner` 只能在阶段切换时按协议更新；完成态 `status` 必须为 `completed`。
- 进入 `completed` 前必须已有 `verification.md`，且包含 `## Evaluator Verdict`、独立 evaluator 名称、`result=PASS` 与证据摘要。
- 首次创建 `.orbit/` 目录时同时写入 `.orbit/.gitignore`（内容 `*`）。
- 其他持久化、任务清单、通用退出自检见 `references/state-protocol.md`。

## 本命令退出条件

- [ ] `task_id` 与 `title` 已确定（必要时通过 `AskUserQuestion` 确认）。
- [ ] `.orbit/.gitignore` 首次已写入。
- [ ] `triage_result.decision_path` 与 `density` 一致。
- [ ] engine 已按密度自动推进到 completed，或已因明确暂停条件停止。
- [ ] 若 density 为 low：已完成 execute 与独立 evaluator verify，并在 `.orbit/state/<task_id>/` 写入 `task_packet.json` / `execution.md` / `verification.md` / `runtime.json`。
- [ ] 若 density 为 medium：已完成 discovery（必要时）、scoping、一个或多个 low 子任务 execute/verify、父任务 integration verify，并在 `.orbit/state/<task_id>/` 写入 `scope.md` / `task_packet.json` / `execution.md` / `verification.md` / `runtime.json`。
- [ ] 若 density 为 high：进入 design 前已处理 worktree 决策与 discovery（必要时）；若用户批准继续，已完成 architect design、planning、一个或多个 medium 子任务 integration verify、父任务端到端 integration verify、architecture review 与三阶段 reviewing。
- [ ] 若存在并行子任务：每个子任务都有独立 runtime 与 task_packet，且 plan 已证明文件范围或依赖不冲突；父任务只在所有子任务 PASS 后做集成验收。
- [ ] `runtime.json` 符合 `state/runtime-state.schema.json`：必填字段齐全、无额外字段、artifact 九槽位完整、`triage_result.decision_path` 是单个枚举值。
- [ ] 只有当 `runtime.json.stage=completed`、`last_event=VERIFY_PASS` 或 `REVIEW_PASS`、`artifacts.verification` 指向有效 `verification.md` 时，最终输出才允许写 `current_stage=completed`。
- [ ] 最终输出的 `current_stage`、`next_event`、`next_action` 与 `runtime.json` 一致。
