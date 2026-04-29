# high_engine

`high_engine` 是 `/orbit:pilot` 内部 workflow，不是 agent、不是 skill、不是 runtime stage。

## 第一阶段披露

作用：处理需要架构取舍、方案设计、跨模块协调或高风险验收的 high 任务。

能力：处理 worktree 决策，必要时进行 discovery，调用 `architect` 完成设计与架构评审，把父 high 拆成一个或多个 `medium_engine` 子任务，递归执行并聚合结果，最后执行端到端 integration verify 与三阶段 review。

完整内容路径：`plugins/orbit/references/engine-high.md`

## 第二阶段完整流程

仅当当前 density 为 high 时，才读取并应用本节。

### 自动推进规则

design 批准后，controller 必须自动推进 `planning → medium 子任务拆分 → 逐个 medium_engine → 父级端到端 integration verify → 三阶段 review`。medium 子任务之间不暂停、不询问用户是否继续。

唯一暂停点：

- worktree 决策。
- brainstormer AskUserQuestion。
- design approval。
- 连续 verify / review FAIL 达到上限。
- executor / evaluator / reviewer 返回 `NEEDS_CONTEXT`、`INCOMPLETE` 或 `BLOCKED`。
- 用户中途改变范围、方案、验收或拆解。

### Worktree 决策

1. 进入 design 前必须处理 worktree 决策。
2. 默认必须通过 AskUserQuestion 询问用户是否使用 `git worktree`。
3. 只有用户原文出现明确决策句时，才可不询问并记录决定。例如：“使用 git worktree”、“不要使用 worktree”、“不创建 worktree，直接改当前目录”。
4. “在当前项目中实现”“当前仓库”“当前目录”“继续”“按推荐方式做”等语句不是 worktree 的显式决策。
5. 如果用户明确要求“不能跳过任何决策阶段”“必须以用户视角交互”“测试决策交互”，则无论原文是否包含偏好，都必须重新询问 worktree 决策。

### Brainstormer

6. controller 加载 `references/brainstormer.md` 并内联执行需求发现；不得 dispatch agent/subagent 承担头脑风暴阶段。
7. 必须通过 AskUserQuestion 完成 Intent → Constraints → Boundaries → Acceptance → Risks 五阶段确认。信息足够时只能压缩为单轮确认式头脑风暴，不得直接跳过并注入 architect。
8. 必须输出 READY_TO_DESIGN 后才可进入 designing。
9. 传给 architect 的上下文或 `design.md` 必须记录 `interaction_transcript`、`confirmed_decisions` 与 `skipped_stages=[]`。

### Design

10. dispatch `architect` 生成或复核候选方案、推荐方案、架构契约、风险和验收策略。
11. `design.md` 必须包含 `architect: orbit:architect`、architect 方案摘要、至少两个可替代方案、`## User Approval` 与非空 `approved_option`。
12. 未经用户批准，不得进入 planning。
13. 只有用户原文明确写“批准推荐方案并继续”“选择你推荐的方案并继续”或指定方案编号时，才可视作 design 预批准；如果用户要求测试交互或不得跳过决策，仍必须重新询问。
14. design 完成后立即回写 runtime 为 `stage=planning`、`last_event=DESIGN_DONE`。

### Planning 与 medium 子任务

15. 在 `plan.md` 中生成一个或多个 medium 子任务，task id 使用 `<parent_task_id>.<n>`。
16. 每个 medium 子任务拥有独立 `.orbit/state/<parent>.<n>/runtime.json` 与 `task_packet.json`，子任务 runtime 的非空 artifact 路径必须指向自己的任务目录。
17. 每个 medium 子任务负责该模块的完整实现与自己的父级 integration verify。
18. 在 `plan.md` 中记录 medium 子任务依赖：`dependency_mode=parallel|serial|mixed|none`。
19. 对每个 medium 子任务递归运行 `medium_engine` workflow，不得直接运行 `low_engine`、`executor` 或普通 todo 跳过 medium_engine 编排。
20. medium 子任务 PASS 后不询问用户，立即回到父 high，补写父 `execution.md` 聚合摘要，然后自动进入下一个 medium 子任务或端到端 integration verify。

### 父级端到端 integration verify

21. 只有所有 medium 子任务完成各自 Parent Integration Verification 且 PASS 后，父 high 才能进入端到端 integration verify。
22. 父 high 的端到端 integration verify 必须验证跨 medium 子任务的完整用户路径、系统边界、数据契约、运行组合或部署组合效果，不能只汇总 medium PASS。
23. dispatch 独立 `evaluator` 验证父级端到端 integration acceptance。
24. 写入父 `verification.md`，包含 `## End-to-End Integration Verification` 与 `## Evaluator Verdict`。

### Reviewing

25. 端到端验收 PASS 后，dispatch `architect` 做 architecture review。
26. architecture review PASS 后，依次 dispatch `spec-compliance-evaluator` 与 `code-quality-evaluator`。
27. `review.md` 必须同时包含 `## Architecture Review Verdict`、`## Spec Compliance Verdict` 与 `## Code Quality Verdict`，且均 `result=PASS`。
28. review PASS 后 runtime 写 `stage=completed`、`status=completed`、`last_event=REVIEW_PASS`，并把 `verify_fail_streak` 重置为 `0`。

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
- `runtime.json.verify_fail_streak=0`

## 最少父工件

high 父任务必须写入：

- `triage.md`
- `design.md`
- `plan.md`
- `task_packet.json`
- `execution.md`
- `verification.md`
- `review.md`
- `runtime.json`

## 失败回流

- medium 子任务失败：只修失败 medium 子任务或其失败 low 子任务。
- medium 全部 PASS 但端到端失败：由父 high 判断修复范围，并说明影响哪些 medium 子任务。
- architecture/spec/code review FAIL：进入 `repairing`，owner 保持 `first_executor`。
