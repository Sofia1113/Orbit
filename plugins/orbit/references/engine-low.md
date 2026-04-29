# low_engine

`low_engine` 是 `/orbit:pilot` 内部 workflow，不是 agent、不是 skill、不是 runtime stage。

## 第一阶段披露

作用：处理目标明确、边界已知、无需方案取舍的 low 任务或 low 子任务。

能力：执行 `executor → evaluator` 闭环，产出 `execution.md`、`verification.md` 与合法 `runtime.json`，只有独立 evaluator PASS 后才能完成。

完整内容路径：`plugins/orbit/references/engine-low.md`

## 第二阶段完整流程

仅当当前 density 为 low，或 `medium_engine` 递归运行 low 子任务时，才读取并应用本节。

### 自动推进规则

low 没有额外用户决策点。进入 `executing` 后，controller 必须自动推进 `executor → evidence collection → evaluator`，直到 PASS、FAIL、INCOMPLETE、NEEDS_CONTEXT 或 BLOCKED。

子任务 low PASS 后不询问用户是否继续；直接返回父 `medium_engine`。

### 执行步骤

1. 写入或更新 `.orbit/state/<task_id>/runtime.json`，stage 从 `triaged` 推进到 `executing`。
2. 写入 `task_packet.json`，必须符合 `state/task-packet.schema.json`，不写 schema 外字段。
3. dispatch `executor`，完整注入 `task_packet`、当前 action 与必要 scene。
4. executor 只写实现、`execution.md` 或返回 handoff，不得给验证结论。
5. 完成任何代码 Edit/Write 后，controller 必须先收集 diff、测试输出、运行日志或人工可观察证据，立即写 `execution.md`，再继续任何验证或父级聚合。
6. stage 推进到 `verifying`，dispatch 独立 `evaluator`，完整注入 `task_packet`、`execution` 摘要、验证证据和 acceptance。
7. evaluator PASS 后写入 `verification.md`，包含 `## Evaluator Verdict`、固定 evaluator 名称 `orbit:evaluator`、`result=PASS` 与 acceptance→证据映射。
8. PASS 后 runtime 写 `stage=completed`、`status=completed`、`last_event=VERIFY_PASS`，并把 `verify_fail_streak` 重置为 `0`。
9. evaluator FAIL 时进入 `repairing`，`current_owner=first_executor`，逐条 `repair_actions` 追加 todo，再由首次执行者修复。
10. evaluator INCOMPLETE 时进入 `paused`，`next_action` 写明需要补充的唯一证据。

## 完成条件

- `runtime.json.stage=completed`
- `runtime.json.last_event=VERIFY_PASS`
- `verification.md` 含独立 evaluator PASS verdict
- `verification.md` 的 evaluator 名称固定为 `orbit:evaluator`
- `runtime.json.verify_fail_streak=0`
- 所有实现类 todo 已完成或挂入后续 handoff

## 最少工件

普通 low 与任何 low 子任务都必须写入：

- `triage.md`
- `task_packet.json`
- `execution.md`
- `verification.md`
- `runtime.json`

对应 runtime 的 `artifacts.triage`、`artifacts.task_packet`、`artifacts.execution`、`artifacts.verification` 都必须非空并指向自己的任务目录。

## 子任务返回给父 workflow

low 子任务完成后，父 `medium_engine` 聚合以下信息：

- `task_id`
- `status=PASS|FAIL|INCOMPLETE|BLOCKED`
- `changes_made`
- `verification_result`
- `integration_notes`
- `artifacts.execution`
- `artifacts.verification`
