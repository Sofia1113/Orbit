# reviewing 阶段双评估者 dispatch 参考

reviewing 必须做**两阶段独立审查**：先 spec-compliance，PASS 才允许触发 code-quality。
两阶段都 PASS 才能声明 `REVIEW_PASS + COMPLETE`；任一 FAIL 即 `REVIEW_FAIL`。

## 第一阶段：spec-compliance-evaluator

- subagent_type：`spec-compliance-evaluator`
- controller 必须完整注入，**禁止让 subagent 读文件**：
  - `task_packet`
  - `plan` 摘要
  - `execution` 摘要 / `changes_made`
  - `verification` 结果与证据
- 只评判 acceptance 契约是否 100% 满足、是否存在 `files_in_scope` / `out_of_scope` 之外的多做
- FAIL 即终止 review，`next_stage = repairing`，`owner = first_executor`
- 完整评估指令 / 输出字段 / 反面示例：见 `agents/spec-compliance-evaluator.md`

## 第二阶段：code-quality-evaluator

- 仅在第一阶段 `result = PASS` 时触发
- subagent_type：`code-quality-evaluator`
- controller 必须完整注入：
  - `task_packet.files_in_scope`
  - 相关 diff 或 `changes_made` 摘要
  - 新增 / 修改的测试代码
  - `plan.verification_plan` 摘要
- 评价维度：分层 / 抽象 / 重复 / 可读性 / 边界处理 / 测试完整性
- FAIL 时返回具体代码级 `repair_actions`（文件 + 位置 + 问题 + 修复方向）
- 完整评估指令 / 输出字段 / 反面示例：见 `agents/code-quality-evaluator.md`

## 消费逻辑

| spec_compliance | code_quality | final_result | 动作 |
|---|---|---|---|
| `PASS` | `PASS` | `PASS` | 执行收尾动作清单，声明 `REVIEW_PASS + COMPLETE` |
| `PASS` | `FAIL` | `FAIL` | TodoWrite 追加 repair_actions，回 `repairing` |
| `FAIL` | `SKIPPED` | `FAIL` | TodoWrite 追加 repair_actions，回 `repairing` |

## review 循环上限保护

- 连续 2 轮 review 仍 FAIL → **用 AskUserQuestion 让用户选择**：升级 density / 重设方案 / 取消任务；不得自动进入 paused
- 承接 `state/gates.json.limits.consecutive_review_fail_limit = 2`
