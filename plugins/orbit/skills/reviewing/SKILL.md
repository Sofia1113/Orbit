---
name: reviewing
description: High 任务最终双阶段审查闸门。verify PASS 后调用：先 spec-compliance evaluator，PASS 后再 code-quality evaluator。两阶段都 PASS 才能 COMPLETE，任一 FAIL 回到 first_executor 修复。
---

目标：
- 汇总 executing 与 verifying 的事实证据
- 通过两次独立 evaluator 审查（spec-compliance → code-quality）给出最终闸门
- FAIL 时明确回退到 `repairing`

路由规则：
- `REVIEW_PASS` → 声明 `COMPLETE`，进入 `completed`
- `REVIEW_FAIL` → 进入 `repairing`，回到 `execute` skill
- 连续 2 轮 FAIL → 用 AskUserQuestion 让用户决策

自评禁止：
- 结论必须由独立 evaluator subagent 给出；本 skill 只做汇总与派发
- 两次审查中任何一次 FAIL，最终结论即 `REVIEW_FAIL`

`review.md` 锚点规范：
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
未同时出现两个锚点且 `result=PASS` 时，不得声明 `REVIEW_PASS`。

## 运行时契约

遵循 [公共运行时模式](../references/common-runtime-patterns.md)。本阶段特有：
- **写入工件**：`review` → `.orbit/state/<task_id>/review.md`
- **结束事件**：`REVIEW_PASS` + `COMPLETE` / `REVIEW_FAIL`
- **阶段转换**：`reviewing` → `completed` / `repairing`
- **任务清单进入项**（用 `TaskCreate`）：汇总事实、派发 spec-compliance、派发 code-quality

收尾动作（REVIEW_PASS 后）：
- `stage → completed`、`status → completed`、`last_event → COMPLETE`
- 所有 todo[] 必须为 `done` 或 `pending`（不允许 `in_progress`）
- 若为子任务，通知父任务声明 `SUBTASK_COMPLETED`

执行流程：
1. 汇总 executing + verifying 事实，写入 `review` 工件（结论留空）
2. dispatch `spec-compliance-evaluator`；FAIL → `REVIEW_FAIL` + 回 `repairing`
3. spec PASS → dispatch `code-quality-evaluator`；FAIL → `REVIEW_FAIL` + 回 `repairing`
4. 两阶段均 PASS → 执行收尾动作清单，声明 `REVIEW_PASS + COMPLETE`

### 双阶段评估 dispatch 契约

**第一阶段：spec-compliance-evaluator**
- subagent_type：`spec-compliance-evaluator`
- 必须完整注入：`task_packet`、`plan` 摘要、`execution` 摘要 / `changes_made`、`verification` 结果与证据
- 只评判 acceptance 契约是否 100% 满足、是否存在 `files_in_scope`/`out_of_scope` 之外的多做
- FAIL 即终止 review，`next_stage=repairing`，`owner=first_executor`

**第二阶段：code-quality-evaluator**
- 仅在第一阶段 `result=PASS` 时触发
- subagent_type：`code-quality-evaluator`
- 必须完整注入：`task_packet.files_in_scope`、相关 diff 或 `changes_made` 摘要、新增/修改的测试代码、`plan.verification_plan` 摘要
- 评价维度：分层与边界、抽象合理性、可读性、边界处理、测试完整性
- FAIL 时返回具体代码级 `repair_actions`（文件 + 位置 + 问题 + 修复方向）

**消费逻辑：**

| spec_compliance | code_quality | final_result | 动作 |
|---|---|---|---|
| `PASS` | `PASS` | `PASS` | 执行收尾动作清单，声明 `REVIEW_PASS + COMPLETE` |
| `PASS` | `FAIL` | `FAIL` | `TaskCreate` 追加 repair_actions，回 `repairing` |
| `FAIL` | `SKIPPED` | `FAIL` | `TaskCreate` 追加 repair_actions，回 `repairing` |

### review 循环上限保护

连续 2 轮 review 仍 FAIL → 用 AskUserQuestion 让用户选择：升级 density / 重设方案 / 取消任务；不得自动进入 paused。`consecutive_review_fail_limit=2` 定义于 `state/rules.json`。

输出格式（含期望内容说明）：
1. `review_summary`：汇总 executing + verifying 的关键事实
2. `spec_compliance_result`：`PASS` / `FAIL`
3. `code_quality_result`：`PASS` / `FAIL` / `SKIPPED`
4. `final_result`：两阶段合取
5. `failed_checks`：FAIL 时的未通过条款
6. `repair_actions`：FAIL 时的结构化修复动作
7. `artifact_written`：`review`
8. `next_event`：`REVIEW_PASS` / `REVIEW_FAIL`
9. `next_skill`：`null` / `execute` / `handoff`
10. `repair_direction`：FAIL 时的修复方向摘要
11. `next_action`：下一步唯一动作

## 原生工具集成

- **`Glob` / `Grep`**：审查阶段搜索代码模式、长函数、重复模式
- **`LSP`**：documentSymbol 检查模块结构、findReferences 检查依赖方向
- **`Bash`**：运行测试套件、linter
- **`AskUserQuestion`**：code-quality 发现模糊问题时确认偏好；连续 2 轮 FAIL 时决策

### 退出前自检（缺一不可声明 REVIEW_PASS / REVIEW_FAIL）
- [ ] `review.md` 已落盘且同时包含 `## Spec Compliance Verdict` 与 `## Code Quality Verdict` 锚点
- [ ] 两个 evaluator 均独立 dispatch：spec-compliance 先，PASS 后才触 code-quality
- [ ] PASS 时：所有 todo[] 为 done 或 pending，stage=completed，status=completed
- [ ] FAIL 时：repair_actions 已逐条 `TaskCreate` 落到任务清单，next_stage=repairing，`current_owner == first_executor`
- [ ] 连续 2 轮 FAIL 已停止并用 AskUserQuestion 让用户决策
- [ ] 调用 `node plugins/orbit/scripts/validate-orbit-state.mjs --runtime .orbit/state/<task_id>/runtime.json` 通过
