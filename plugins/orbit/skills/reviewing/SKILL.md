---
name: reviewing
description: High 任务的**最终双阶段审查闸门**。只适用于 density=high 且 verify 已 PASS 的任务：必须调用本 skill 先 dispatch 独立 spec-compliance evaluator（acceptance 是否 100% 满足、是否存在未授权的多做），PASS 才能继续 dispatch 独立 code-quality evaluator（分层 / 重复 / 可读性 / 边界 / 测试）。两阶段都 PASS 才能声明 COMPLETE；任一 FAIL 回 `first_executor` 进入 `repairing`；连续 2 轮 FAIL 必须停止自动循环进入 `paused` 等待人工决策。
---

目标：
- 汇总 executing 与 verifying 的事实证据
- 通过 **两次独立 evaluator 审查**（spec-compliance → code-quality）给出最终闸门
- 若未达标，明确回退到 `repairing`，把修复责任保留给首次执行者
- review 失败时输出结构化 repair actions

路由规则：
- `REVIEW_PASS` → 声明 `COMPLETE`，进入 `completed`
- `REVIEW_FAIL` → 写入 TodoWrite，进入 `repairing`，回到 `execute` skill
- 连续 2 轮 review 仍 FAIL → 用 AskUserQuestion 让用户选择：升级 density / 重设方案 / 取消任务；不得自动进入 paused

自评禁止（核心约束）：
- 本 skill **不得自行宣布 REVIEW_PASS / REVIEW_FAIL**
- 结论必须由独立 evaluator subagent 给出；本 skill 只做汇总与派发
- 两次审查中任何一次 FAIL，最终结论即 `REVIEW_FAIL`
- `REVIEW_FAIL` 只能回到 `repairing`；`repairing.current_owner` 必须等于 `first_executor`

`review.md` 锚点规范（hook/校验器据此校验两阶段独立 evaluator 产出）：
```
## Spec Compliance Verdict
- evaluator_id: <subagent handle>
- result: PASS | FAIL
- dispatched_at: <ISO8601>
- summary: <一句话结论>

## Code Quality Verdict
- evaluator_id: <subagent handle>
- result: PASS | FAIL | SKIPPED
- dispatched_at: <ISO8601>
- summary: <一句话结论>
```
未同时出现两个锚点且 `result=PASS` 时，`REVIEW_PASS` 不得声明。

双阶段独立审查（承接 superpowers subagent-driven-development 精髓）：
- 第一阶段 dispatch `spec-compliance-evaluator` subagent
- 第二阶段 dispatch `code-quality-evaluator` subagent（仅第一阶段 PASS 时）
- 完整输入契约、提示词模板、消费逻辑、循环上限保护：**见 `references/evaluator-dispatch.md`**

状态持久化：
- review 汇总与两阶段结论写入 `.orbit/state/<task_id>/review.md`
- 两阶段 evaluator dispatch 完成后各自回写 `.orbit/state/<task_id>/runtime.json`（逐次更新 `last_event`）
- FAIL 时 `repair_direction` 与 `failed_stage_hint` 必须落盘
- PASS 进入 `completed` 时按下方"收尾动作清单"更新 runtime

事件流（append-only）：见 `state/README.md#事件流append-only`。本 skill 额外要求：
- 两阶段各自 append 一行，事件名 `REVIEW_PASS` / `REVIEW_FAIL`（code-quality 阶段 SKIPPED 时不单独写事件）
- 事件行必须带 `evaluator_id`；FAIL 额外带 `repair_direction`

收尾动作清单（`REVIEW_PASS` 后必须执行）：
- `stage`：`reviewing` → `completed`
- `status`：`active` → `completed`
- `last_event`：`REVIEW_PASS` → `COMPLETE`
- `next_action`：留空或设为收尾说明
- 所有 `todo[]` 项必须为 `done` 或 `pending`（不允许 `in_progress`）
- 若任务属于某父任务的子任务，额外通知父任务声明 `SUBTASK_COMPLETED`

TodoWrite 绑定（持久 SSOT = `runtime.todo[]`，TodoWrite 是会话投影）：
- 进入 reviewing 第一步建立 review checklist，至少包含：
  - 汇总 executing + verifying 事实
  - 派发并消费 spec-compliance evaluator
  - 派发并消费 code-quality evaluator（仅 spec PASS 时）
- 每阶段审查结论反映为对应 todo 的 `done` / `blocked`
- 任一阶段 FAIL 时，`repair_actions` 追加为新 todo（owner = `first_executor`）

执行流程：
1. 汇总 executing + verifying 事实，写入 `review` 工件（结论留空）
2. dispatch `spec-compliance-evaluator`；FAIL → `REVIEW_FAIL` + TodoWrite + 回 `repairing`
3. spec PASS → dispatch `code-quality-evaluator`；FAIL → `REVIEW_FAIL` + TodoWrite + 回 `repairing`
4. 两阶段均 PASS → 执行收尾动作清单，声明 `REVIEW_PASS + COMPLETE`

原则：
- 仅 `high` 使用本阶段
- preflight：进入 reviewing 前必须有 `verification` PASS
- revision：任一阶段 FAIL 即回 `repairing`
- escalation：连续 2 轮 review 仍失败，用 AskUserQuestion 让用户决策（升级 / 重设 / 取消）

输出格式（含期望内容说明）：
1. `review_summary`：汇总 executing + verifying 的关键事实
2. `summary`：两阶段结论的一句话合并说明
3. `evidence`：支撑 evaluator 判断的事实索引
4. `spec_compliance_result`：`PASS` / `FAIL`
5. `code_quality_result`：`PASS` / `FAIL` / `SKIPPED`（spec FAIL 时为 `SKIPPED`）
6. `final_result`：两阶段合取，`PASS` 当且仅当两者皆 `PASS`
7. `failed_checks`：FAIL 时列出未通过条款
8. `repair_actions`：FAIL 时 evaluator 返回的结构化修复动作
9. `todo_sync`：TodoWrite 同步说明
10. `artifact_written`：`review`（路径：`.orbit/state/<task_id>/review.md`）
11. `next_event`：`REVIEW_PASS` + `COMPLETE` / `REVIEW_FAIL` / `PAUSE`
12. `next_skill`：`null`（PASS 完成） / `execute`（FAIL 回流） / `handoff`（连续 FAIL 升级）
13. `fallback_stage`：`completed` / `repairing` / `paused`
14. `repair_direction`：FAIL 时的修复方向摘要
15. `next_action`：下一步唯一动作

## 原生工具集成

本 skill 在以下操作点必须使用 Claude Code 原生工具：

- **`Glob` / `Grep`**：在代码质量审查阶段搜索代码模式，检查分层、抽象、重复等问题。例如 `grep` 搜索长函数、重复模式。
- **`LSP`**：在审查中使用 `documentSymbol` 了解模块结构是否清晰、`findReferences` 检查依赖方向是否合理、`goToDefinition` 验证接口调用是否匹配。
- **`Bash`**：运行测试套件确认测试完整性、运行 linter 确认代码风格一致。
- **`AskUserQuestion`**：
  - code-quality evaluator 发现模糊问题（如设计模式选择不明确）时，用 AskUserQuestion 确认用户偏好。
  - 连续 2 轮 `REVIEW_FAIL`：用 AskUserQuestion 替代自动暂停，让用户选择升级 density / 重设方案 / 取消任务。

关联约束：
- "连续 2 轮 review 仍失败" → 用 AskUserQuestion 决策，不再自动 paused。
- spec-compliance evaluator 不引用工具（只做 acceptance ↔ 证据映射），工具集中在 code-quality 阶段。
16. `closure_or_repair_handoff`：PASS 时的收尾交接 / FAIL 时的修复交接摘要
