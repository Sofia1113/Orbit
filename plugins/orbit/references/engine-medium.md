# medium_engine

`medium_engine` 是 `/orbit:pilot` 内部 workflow，不是 agent、不是 skill、不是 runtime stage。

## 第一阶段披露

作用：处理目标明确但边界需要收敛的 medium 任务。

能力：必要时进行 discovery/scoping，把父 medium 拆成一个或多个 `low_engine` 子任务，递归执行并聚合结果，最后执行父级 integration verify。

完整内容路径：`plugins/orbit/references/engine-medium.md`

## 第二阶段完整流程

仅当当前 density 为 medium，或 `high_engine` 递归运行 medium 子任务时，才读取并应用本节。

1. 进入 `scoping`，确认父任务 in_scope、out_of_scope、acceptance。
2. 若真实目标、边界或验收不足，dispatch `brainstormer`；若信息足够，不为形式感提问。
3. 写入 `scope.md`。
4. 生成一个或多个 low 子任务，task id 使用 `<parent_task_id>.<n>`。
5. 每个 low 子任务拥有独立 `.orbit/state/<parent>.<n>/runtime.json` 与 `task_packet.json`。
6. 在 `plan.md` 或父 runtime todo 中记录子任务依赖：`dependency_mode=parallel|serial|mixed|none`。
7. 对每个 low 子任务递归运行 `low_engine` workflow，不得把多个 low 子任务合并成普通 todo 跳过 low_engine。
8. 只有所有 low 子任务 evaluator PASS 后，父 medium 才能进入 integration verify。
9. 父 medium 的 integration verify 必须验证 low 子任务组合后的接口、状态、数据流、UI 或行为效果，不能只汇总子任务 PASS。
10. dispatch 独立 `evaluator` 验证父级 integration acceptance。
11. 写入父 `verification.md`，包含 `## Parent Integration Verification` 与 `## Evaluator Verdict`。

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
