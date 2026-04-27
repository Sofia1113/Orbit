# high_engine

`high_engine` 是 `/orbit:pilot` 内部 workflow，不是 agent、不是 skill、不是 runtime stage。

## 第一阶段披露

作用：处理需要架构取舍、方案设计、跨模块协调或高风险验收的 high 任务。

能力：处理 worktree 决策，必要时进行 discovery，调用 `architect` 完成设计与架构评审，把父 high 拆成一个或多个 `medium_engine` 子任务，递归执行并聚合结果，最后执行端到端 integration verify 与三阶段 review。

完整内容路径：`plugins/orbit/references/engine-high.md`

## 第二阶段完整流程

仅当当前 density 为 high 时，才读取并应用本节。

1. 进入 design 前处理 worktree 决策；若用户原始任务已明确说明使用或不使用 worktree，记录该决定并继续。
2. 若真实目标、约束或验收不足，dispatch `brainstormer`；若信息足够，直接把需求摘要注入 `architect`。
3. dispatch `architect` 生成或复核候选方案、推荐方案、架构契约、风险和验收策略。
4. `design.md` 必须包含 architect 方案摘要、`## User Approval` 与 `approved_option`。
5. 未经用户批准，不得进入 planning。
6. 在 `plan.md` 中生成一个或多个 medium 子任务，task id 使用 `<parent_task_id>.<n>`。
7. 每个 medium 子任务拥有独立 `.orbit/state/<parent>.<n>/runtime.json` 与 `task_packet.json`。
8. 在 `plan.md` 中记录 medium 子任务依赖：`dependency_mode=parallel|serial|mixed|none`。
9. 对每个 medium 子任务递归运行 `medium_engine` workflow，不得直接运行 `low_engine` 或 `executor` 跳过 medium_engine 编排。
10. 只有所有 medium 子任务完成各自 integration verify 且 PASS 后，父 high 才能进入端到端 integration verify。
11. 父 high 的端到端 integration verify 必须验证跨 medium 子任务的完整用户路径、系统边界、数据契约、运行组合或部署组合效果，不能只汇总 medium PASS。
12. dispatch 独立 `evaluator` 验证父级端到端 integration acceptance。
13. 写入父 `verification.md`，包含 `## End-to-End Integration Verification` 与 `## Evaluator Verdict`。
14. 端到端验收 PASS 后，dispatch `architect` 做 architecture review。
15. architecture review PASS 后，依次 dispatch `spec-compliance-evaluator` 与 `code-quality-evaluator`。
16. `review.md` 必须同时包含 `## Architecture Review Verdict`、`## Spec Compliance Verdict` 与 `## Code Quality Verdict`，且均 `result=PASS`。

## 并行规则

- 只有兄弟 medium 子任务 `files_in_scope` 不重叠，且不存在接口、迁移、生成物、部署顺序或 acceptance 依赖时，才允许并行。
- 涉及共享公共契约、数据库迁移、全局配置、构建系统、发布顺序或跨子任务验收依赖时必须串行。
- 并行安全理由必须写入 `plan.md`。

## 完成条件

high 父任务只有同时满足以下条件才能完成：

- 所有 medium 子任务 PASS
- 每个 medium 子任务已完成自己的 Parent Integration Verification
- 父 `verification.md` 包含 `## End-to-End Integration Verification`
- 父级端到端 evaluator PASS
- architecture review PASS
- spec-compliance PASS
- code-quality PASS
- `runtime.json.stage=completed`
- `runtime.json.last_event=REVIEW_PASS`

## 失败回流

- medium 子任务失败：只修失败 medium 子任务或其失败 low 子任务。
- medium 全部 PASS 但端到端失败：由父 high 判断修复范围，并说明影响哪些 medium 子任务。
- architecture/spec/code review FAIL：进入 `repairing`，owner 保持 `first_executor`。
