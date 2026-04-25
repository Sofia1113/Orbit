---
name: reviewing
description: High 任务最终双阶段审查闸门。verify PASS 后调用：先 spec-compliance evaluator，PASS 后再 code-quality evaluator。两阶段都 PASS 才能 COMPLETE。
---

reviewing 解决"高密度任务最终是否可以收尾"——通过两次独立审查给出闸门，本 skill 只做汇总与派发，不自评。

## 自评禁止

- 结论必须由独立 evaluator subagent 给出
- 两次审查中任何一次 FAIL，最终结论即 `REVIEW_FAIL`

## 路由

| 完成事件 | 下一阶段 | 下一 skill |
|---|---|---|
| `REVIEW_PASS` | completed（声明 `COMPLETE`） | — |
| `REVIEW_FAIL` | repairing | execute |

连续 2 轮 FAIL → 用 `AskUserQuestion` 让用户决策（`consecutive_review_fail_limit=2`）。

## review.md 锚点

`REVIEW_PASS` 前必须同时包含：

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

未同时出现两个锚点且 `result=PASS` 时不得声明 `REVIEW_PASS`。

## 执行流程

1. 汇总 executing + verifying 事实，写入 `review` 工件（结论留空）
2. dispatch `spec-compliance-evaluator`；FAIL → `REVIEW_FAIL` + 回 `repairing`
3. spec PASS → dispatch `code-quality-evaluator`；FAIL → `REVIEW_FAIL` + 回 `repairing`
4. 两阶段均 PASS → 执行收尾动作清单，声明 `REVIEW_PASS + COMPLETE`

## 双阶段 dispatch 契约

**第一阶段：spec-compliance-evaluator**

- 必须完整注入：`task_packet`、`plan` 摘要、`execution` 摘要 / `changes_made`、`verification` 结果与证据
- 只评判 acceptance 契约是否 100% 满足、是否存在 `files_in_scope` / `out_of_scope` 之外的多做
- FAIL 即终止 review，`next_stage=repairing`，`owner=first_executor`

**第二阶段：code-quality-evaluator**

- 仅在第一阶段 `result=PASS` 时触发
- 必须完整注入：`task_packet.files_in_scope`、相关 diff 或 `changes_made` 摘要、新增/修改的测试代码、`plan.verification_plan` 摘要
- 评价维度：分层与边界、抽象合理性、可读性、边界处理、测试完整性
- FAIL 时返回具体代码级 `repair_actions`（文件 + 位置 + 问题 + 修复方向）

## evaluator 返回消费

| spec_compliance | code_quality | final_result | 动作 |
|---|---|---|---|
| `PASS` | `PASS` | `PASS` | 执行收尾，声明 `REVIEW_PASS + COMPLETE` |
| `PASS` | `FAIL` | `FAIL` | `TaskCreate` 追加 repair_actions，回 `repairing` |
| `FAIL` | `SKIPPED` | `FAIL` | `TaskCreate` 追加 repair_actions，回 `repairing` |

## 收尾动作（REVIEW_PASS 后）

- `stage → completed`、`status → completed`、`last_event → COMPLETE`
- 所有 todo[] 必须为 `done` 或 `pending`（不允许 `in_progress`）
- 若为子任务，通知父任务声明 `SUBTASK_COMPLETED`

## 输出

| 字段 | 说明 |
|---|---|
| `review_summary` | 汇总 executing + verifying 的关键事实 |
| `spec_compliance_result` | `PASS` / `FAIL` |
| `code_quality_result` | `PASS` / `FAIL` / `SKIPPED` |
| `final_result` | 两阶段合取 |
| `failed_checks` | FAIL 时的未通过条款 |
| `repair_actions` | FAIL 时的结构化修复动作 |
| `artifact_written` | `review` |
| `next_event` | `REVIEW_PASS` / `REVIEW_FAIL` |
| `next_skill` | `null` / `execute` / `handoff` |
| `repair_direction` | FAIL 时的修复方向摘要 |
| `next_action` | 下一步唯一动作 |

## 工件与状态

- 写入工件：`review` → `.orbit/state/<task_id>/review.md`
- 任务清单进入项：汇总事实、派发 spec-compliance、派发 code-quality
- 通用持久化、任务清单、退出自检见 [state-protocol.md](../references/state-protocol.md)

## 优先工具

- `Grep`：审查阶段搜索代码模式、长函数、重复模式
- `LSP`：documentSymbol 检查模块结构、findReferences 检查依赖方向
- `Bash`：运行测试套件、linter
- `AskUserQuestion`：code-quality 发现模糊问题时确认偏好；连续 2 轮 FAIL 时决策

详见 [native-tools.md](../references/native-tools.md)。

## 本阶段特有退出条件

- [ ] `review.md` 同时包含 `## Spec Compliance Verdict` 与 `## Code Quality Verdict` 锚点
- [ ] 两个 evaluator 均独立 dispatch：spec-compliance 先，PASS 后才触 code-quality
- [ ] PASS 时：所有 todo[] 为 `done` 或 `pending`，stage=completed，status=completed
- [ ] FAIL 时：repair_actions 已逐条 `TaskCreate` 落到任务清单，`current_owner == first_executor`
- [ ] 连续 2 轮 FAIL 已停止并用 `AskUserQuestion` 让用户决策
