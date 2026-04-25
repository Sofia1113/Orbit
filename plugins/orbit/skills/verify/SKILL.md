---
name: verify
description: Orbit 验证阶段。EXECUTION_DONE 后调用：设计验证集合并 dispatch 独立 evaluator subagent 给出 PASS/FAIL。禁止自评——evaluator 必须独立于 executor。
---

目标：
- 判断当前任务需要的验证级别
- 设计最小充分的验证集合，逐项执行并记录 evidence
- 将 PASS / FAIL 闸门交给独立 evaluator，不在本 skill 自评
- FAIL 时将验证缺口转译为可执行 repair action

路由规则：
- `VERIFY_PASS` + `density = high` → 调用 `reviewing` skill
- `VERIFY_PASS` + `density = low / medium` → 声明 `COMPLETE`
- `VERIFY_FAIL` → 进入 `repairing`，回到 `execute` skill
- `verify_fail_streak` 达到 `consecutive_verify_fail_limit`（默认 3）→ 用 AskUserQuestion 让用户决策

验证级别默认映射：`low → optional`、`medium → required`、`high → required_plus_review`。只允许上调，不允许下调。

### verification_level=optional 轻量 evaluator 模板

`optional` 级别（low 任务默认）下，evaluator 仍**必须独立 dispatch**——禁止本 skill 自评——但允许使用以下精简契约，避免极小任务被通用模板压重：

- **派发输入精简**：可省略完整 `acceptance_criteria` 表，改为传入 `goal` + `changes_made` + 1 条决定性 check（如"运行单元测试"或"打开页面验证 selector"）
- **verification.md 最小模板**：
  ```
  ## Evaluator Verdict
  - evaluator_id: <subagent handle>
  - result: PASS | FAIL
  - dispatched_at: <ISO8601>
  - summary: <一句话结论>
  - evidence: <一行命令或观察事实即可>
  ```
  允许 `checks[]` 仅含 1 条；`repair_actions` 可降级为 `repair_direction` 一句话
- **evaluator effort**：subagent 调用时声明 `effort=low`，最大轮次 ≤3，不做发散探索
- **守住的硬规则不变**：仍由独立 evaluator subagent 返回结论；`## Evaluator Verdict` 锚点必须存在；FAIL 仍走 `repairing` 且 owner=`first_executor`；`verify_fail_streak` 计数照常

`required` 与 `required_plus_review` 级别**不适用**轻量模板，必须使用完整 evidence 表与逐项 check。

自评禁止（核心约束）：
- PASS / FAIL 必须由独立 `evaluator` subagent 给出
- evaluator 不得接管修复
- `repairing.current_owner` 必须等于 `first_executor`

`verification.md` 锚点规范：
```
## Evaluator Verdict
- evaluator_id: <subagent handle>
- result: PASS | FAIL | INCOMPLETE
- dispatched_at: <ISO8601>
- summary: <一句话结论>
```
没有该锚点或 `result` 非 `PASS` 时，不得声明 `VERIFY_PASS`。

## 运行时契约

遵循 [公共运行时模式](../references/common-runtime-patterns.md)。本阶段特有：
- **写入工件**：`verification` → `.orbit/state/<task_id>/verification.md`
- **结束事件**：`VERIFY_PASS` / `VERIFY_FAIL`
- **阶段转换**：`verifying` → `reviewing` / `completed` / `repairing`
- **任务清单进入项**（用 `TaskCreate`）：checks[] 展开为 items
- **特殊规则**：FAIL 时 `repair_actions` 追加为 todo，`verify_fail_streak` 在 REPAIR_SUBMITTED 时 +1

执行流程：
1. 读取 `task_packet`、`execution` 摘要与 acceptance
2. 设计 `checks[]`（覆盖 acceptance 与高风险面）
3. 逐项执行并记录 `evidence`
4. 写入 `verification` 工件（结论留空）
5. 通过 Agent tool 派发独立 `evaluator` subagent（subagent_type=`evaluator`）。必须完整注入 `task_packet` + `verification` 工件内容 + `execution` 摘要 + `acceptance_criteria`，禁止让 subagent 读文件。evaluator 不得接管修复——FAIL 时 `next_stage=repairing`，`owner=first_executor`
6. 按 evaluator 返回回写 runtime

### evaluator dispatch 消费逻辑

| evaluator_result | controller 动作 |
|---|---|
| `PASS` | 声明 `VERIFY_PASS`；`verify_fail_streak` 归零 |
| `FAIL` | 声明 `VERIFY_FAIL`；`repair_actions` 逐条 `TaskCreate` 追加到任务清单；交回 `first_executor`；`REPAIR_SUBMITTED` 后 `verify_fail_streak` +1 |
| `INCOMPLETE` | 用 AskUserQuestion 向用户请求缺失证据，补齐后重新 dispatch evaluator；不得自行翻转结论；不改 streak |

### verify 循环上限保护

`consecutive_verify_fail_limit` 默认 3（定义于 `state/rules.json`）。声明 `VERIFY_FAIL` 前若发现 `verify_fail_streak + 1 >= limit`，停止自动循环，用 AskUserQuestion 让用户选择：升级 density / 重设方案 / 取消任务。

输出格式（含期望内容说明）：
1. `verification_level`：`optional` / `required` / `required_plus_review`
2. `checks`：执行的 check 列表，每项含 `id`、`description`、`how`、`evidence`
3. `candidate_result`：本 skill 观察到的倾向（不等于最终结论）
4. `evaluator_result`：`PASS` / `FAIL` / `INCOMPLETE`
5. `summary`：evaluator 一句话结论
6. `failed_checks`：FAIL 时的未通过 check id
7. `repair_actions`：FAIL 时的结构化修复动作
8. `artifact_written`：`verification`
9. `next_event`：`VERIFY_PASS` / `VERIFY_FAIL`
10. `next_skill`：`reviewing` / `execute` / `handoff`
11. `next_action`：下一步唯一动作

## 原生工具集成

- **`Glob` / `Grep`**：搜索测试覆盖、检查关键模式存在性
- **`Bash`**：运行测试命令、linter、编译验证
- **`Read`**：检查关键文件当前内容
- **`AskUserQuestion`**：evaluator 返回 INCOMPLETE 时请求补充证据；streak 超限时让用户决策

### 退出前自检（缺一不可声明 VERIFY_PASS / VERIFY_FAIL）
- [ ] `verification.md` 已落盘且包含 `## Evaluator Verdict` 锚点（`optional` 级别允许使用轻量模板）
- [ ] evaluator_result 由独立 evaluator subagent 返回，非本 skill 自评
- [ ] runtime.json 已回写（PASS 时 verify_fail_streak 归零；FAIL 时 +1）
- [ ] FAIL 时 repair_actions 已逐条 `TaskCreate` 追加到任务清单
- [ ] streak 超限时已用 AskUserQuestion 停止循环并让用户决策
- [ ] 调用 `node plugins/orbit/scripts/validate-orbit-state.mjs --runtime .orbit/state/<task_id>/runtime.json` 通过
