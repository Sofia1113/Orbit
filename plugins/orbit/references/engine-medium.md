# medium_engine

`medium_engine` 是 `/orbit:pilot` 内部 workflow，不是 agent、不是 skill、不是 runtime stage。

## 第一阶段披露

作用：处理目标明确但边界需要收敛的 medium 任务。

能力：必要时进行 discovery/scoping，把父 medium 拆成一个或多个 `low_engine` 子任务，递归执行并聚合结果，最后执行父级 integration verify。

完整内容路径：`plugins/orbit/references/engine-medium.md`

## 第二阶段完整流程

仅当当前 density 为 medium，或 `high_engine` 递归运行 medium 子任务时，才读取并应用本节。

### 自动推进规则

scoping 完成后，controller 必须自动推进 `plan → low 子任务拆分 → 逐个 low_engine → 父级 integration verify`。low 子任务之间不暂停、不询问用户是否继续。

唯一暂停点：

- brainstormer AskUserQuestion。
- 连续 verify FAIL 达到上限。
- executor / evaluator 返回 `NEEDS_CONTEXT`、`INCOMPLETE` 或 `BLOCKED`。
- 用户中途改变范围、验收或拆解。

### Scoping

1. 进入 `scoping`，确认父任务 `in_scope`、`out_of_scope`、`acceptance` 与 `files_in_scope`。
2. controller 加载 `references/brainstormer.md` 并内联执行需求发现；不得 dispatch agent/subagent 承担头脑风暴阶段。
3. medium brainstormer 必须通过 AskUserQuestion 至少完成 Intent + Boundaries + Acceptance 三阶段确认。不得因为用户原始任务已详细、用户要求继续、用户要求不暂停、或 controller 认为信息足够而跳过。
4. 信息充分时只能压缩为单轮确认式头脑风暴；`scope.md` 仍必须记录 `interaction_transcript`、`confirmed_decisions`，且 `skipped_stages=[]`。

### Planning 与 low 子任务

5. 写入 `scope.md` 后，在同一连续推进段内写入 `plan.md`、父 `task_packet.json`、low 子任务 runtime 与子任务 `task_packet.json`。
6. 按 `plan.md` 中识别的独立实现边界拆成一个或多个 low 子任务，task id 使用 `<parent_task_id>.<n>`。
7. 每个 low 子任务拥有独立 `.orbit/state/<parent>.<n>/runtime.json` 与 `task_packet.json`，子任务 runtime 的非空 artifact 路径必须指向自己的任务目录。
8. 在 `plan.md` 或父 runtime todo 中记录子任务依赖：`dependency_mode=parallel|serial|mixed|none`。
9. 对每个 low 子任务递归运行 `low_engine` workflow，不得把多个 low 子任务合并成普通 todo 跳过 low_engine。
10. low 子任务 PASS 后不询问用户，立即回到父 medium，补写父 `execution.md` 聚合摘要，然后自动进入下一个 low 子任务或 integration verify。

### 父级 integration verify

11. 只有所有 low 子任务 evaluator PASS 后，父 medium 才能进入 integration verify。
12. 父 medium 的 integration verify 必须验证 low 子任务组合后的接口、状态、数据流、UI 或行为效果，不能只汇总子任务 PASS。
13. dispatch 独立 `evaluator` 验证父级 integration acceptance。
14. 写入父 `verification.md`，包含 `## Parent Integration Verification` 与 `## Evaluator Verdict`。
15. PASS 后 runtime 写 `stage=completed`、`status=completed`、`last_event=VERIFY_PASS`，并把 `verify_fail_streak` 重置为 `0`。

## 并行规则

- 只有兄弟 low 子任务 `files_in_scope` 不重叠，且不存在接口、迁移、生成物或 acceptance 依赖时，才允许并行。
- 共享文件、共享公共接口、数据库迁移、全局配置或生成文件冲突时必须串行。
- 并行安全理由必须写入 `plan.md`。

## 完成条件

medium 父任务只有同时满足以下条件才能完成：

- 所有 low 子任务 PASS
- 父 `verification.md` 包含 `## Parent Integration Verification`
- 父级 integration evaluator PASS
- `runtime.json.stage=completed`
- `runtime.json.last_event=VERIFY_PASS`
- `runtime.json.verify_fail_streak=0`

## 最少父工件

medium 父任务必须写入：

- `triage.md`
- `scope.md`
- `plan.md`
- `task_packet.json`
- `execution.md`
- `verification.md`
- `runtime.json`

## 返回给父 high_engine

medium 子任务完成后，父 `high_engine` 聚合以下信息：

- `task_id`
- `status=PASS|FAIL|INCOMPLETE|BLOCKED`
- `low_results`
- `integration_verification`
- `changes_made`
- `cross_task_risks`
- `artifacts.scope`
- `artifacts.verification`
