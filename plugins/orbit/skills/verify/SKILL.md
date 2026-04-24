---
name: verify
description: Orbit 的验证阶段入口，强制独立 evaluator 闸门。实现阶段声明 `EXECUTION_DONE` 之后必须调用本 skill：按 density 选 optional / required / required_plus_review 设计最小充分验证集合，再 dispatch 独立 `evaluator` subagent 给出最终 PASS / FAIL。**禁止在本 skill 内自评**——让 executor 与 evaluator 分离是为了防止实现者用自己的信心替代客观判断；FAIL 必须回到 `first_executor` 进入 `repairing`。
---

目标：
- 判断当前任务需要 optional 或 required 验证
- 设计最小充分的验证集合，并产生客观事实
- 将 PASS / FAIL 闸门交给独立 evaluator，不在本 skill 自评
- 将验证缺口转译为可执行 repair action

路由规则：
- `VERIFY_PASS` + `density = high` → 调用 `reviewing` skill，进入 `reviewing`
- `VERIFY_PASS` + `density = low / medium` → 声明 `COMPLETE`，进入 `completed`
- `VERIFY_FAIL` → 写入 TodoWrite，进入 `repairing`，回到 `execute` skill 继续修复
- `verify_fail_streak` 达到 `consecutive_verify_fail_limit`（默认 3）→ 用 AskUserQuestion 让用户选择升级 density / 重设方案 / 取消任务

验证级别默认映射（由 `state/transition-rules.json` 兜底）：
- `low → optional`、`medium → required`、`high → required_plus_review`
- 只允许例外上调，不允许下调

自评禁止（核心约束）：
- 本 skill 只产出验证事实与候选结论，**不得自行宣布 PASS / FAIL**
- PASS / FAIL 必须由独立 `evaluator` subagent 给出
- evaluator 不得接管修复；`VERIFY_FAIL` 只能进入 `repairing`
- `repairing.current_owner` 必须等于 `first_executor`
- 二次验证必须先 `REPAIR_SUBMITTED` 再回 `verifying`

`verification.md` 锚点规范（hook/校验器据此判断独立 evaluator 产出）：
```
## Evaluator Verdict
- evaluator_id: <subagent handle>
- result: PASS | FAIL | INCOMPLETE
- dispatched_at: <ISO8601>
- summary: <一句话结论>
```
没有该锚点或 `result` 非 `PASS` 时，不得声明 `VERIFY_PASS`。

状态持久化：
- 验证证据与候选结论写入 `.orbit/state/<task_id>/verification.md`
- evaluator 返回后回写 `.orbit/state/<task_id>/runtime.json`：
  - `stage`：`verifying` → 目标阶段（`reviewing` / `completed` / `repairing` / `paused`）
  - `last_event`：`VERIFY_PASS` / `VERIFY_FAIL`
  - `verify_fail_streak`：PASS 归零；FAIL 后下一次 `REPAIR_SUBMITTED` 时 +1
  - `repair_direction`：FAIL 时必须落盘
  - `artifacts.verification`：工件路径
  - `next_action`：指向下一个 skill 的具体动作

事件流（append-only）：见 `state/README.md#事件流append-only`。本 skill 额外要求：
- `VERIFY_PASS` / `VERIFY_FAIL` 事件行必须带 `evaluator_id`
- `VERIFY_FAIL` 额外带 `repair_direction` 与 `verify_fail_streak`

TodoWrite 绑定（持久 SSOT = `runtime.todo[]`，TodoWrite 是会话投影）：
- 进入 verifying 第一步：用 TodoWrite 把 `checks[]` 展开为 items，并回写 `runtime.todo[]`
- 每个 check 完成立即 `done`；任意时刻只能一个 `in_progress`
- FAIL 时逐条把 `repair_actions` 追加为新 todo（owner = `first_executor`）

执行流程（摘要）：
1. 读取 `task_packet`、`execution` 摘要与当前 acceptance
2. 设计 `checks[]`（覆盖 acceptance 与高风险面）
3. 逐项执行并记录 `evidence`
4. 写入 `verification` 工件（结论留空）
5. dispatch 独立 `evaluator` subagent（完整输入 + 模板 + 消费规则 + 循环上限保护：**见 `references/evaluator-dispatch.md`**）
6. 按 evaluator 返回回写 runtime.json 与事件流

原则：
- 事实优先：不用空泛结论代替具体验证
- preflight：`VERIFY_PASS` / `VERIFY_FAIL` 前必须已有 `verification` 工件
- revision：`VERIFY_FAIL` 必须进入 `repairing`

输出格式（含期望内容说明）：
1. `verification_level`：`optional` / `required` / `required_plus_review`
2. `checks`：执行过的 check 列表，每项含 `id`、`description`、`how`、`evidence`
3. `candidate_result`：本 skill 观察到的倾向（不等于最终结论）
4. `evaluator_result`：`PASS` / `FAIL` / `INCOMPLETE`（由 evaluator 返回）
5. `summary`：evaluator 一句话结论
6. `evidence`：支撑 evaluator 判断的事实索引
7. `failed_checks`：FAIL 时列出未通过的 check id
8. `repair_actions`：FAIL 时 evaluator 返回的结构化修复动作
9. `todo_sync`：TodoWrite 同步说明
10. `artifact_written`：`verification`（路径：`.orbit/state/<task_id>/verification.md`）
11. `next_event`：`VERIFY_PASS` / `VERIFY_FAIL`
12. `next_skill`：`reviewing` / `execute`（repairing 回流） / `handoff`（paused 时） / `null`（low/medium 完成时）
13. `repair_direction`：FAIL 时的修复方向摘要
14. `next_action`：下一步唯一动作
15. `handoff_to_next_stage`：交接给下一阶段的关键上下文摘要

## 原生工具集成

本 skill 在以下操作点必须使用 Claude Code 原生工具：

- **`Glob` / `Grep`**：搜索测试覆盖范围、检查关键模式存在性（如是否缺少对某条 acceptance 的测试）、定位相关文件。
- **`Bash`**：运行测试命令（`node --test`、`npm test` 等）、检查 linter 输出（`eslint`）、编译验证（`tsc --noEmit`）。
- **`Read`**：检查关键文件的当前内容，验证变更是否正确生效。
- **`AskUserQuestion`**：
  - evaluator 返回 `INCOMPLETE`（证据不足）时：用 AskUserQuestion 请求用户补充缺失的证据（如"这步的测试输出是什么？"），补齐后重新 dispatch evaluator，**不得自行翻转结论**。
  - `verify_fail_streak` 达到 `consecutive_verify_fail_limit`（默认 3）时：**用 AskUserQuestion 替代自动暂停**，让用户选择升级 density / 重设方案 / 取消任务。不得自行进入 paused。

关联约束：
- "逐项执行并记录 evidence" → 使用 Glob/Grep/Bash/Read 获取客观事实作为 evidence，而非凭印象写结论。
- "INCOMPLETE：补齐证据后重新 dispatch；不得自行翻转结论；不改 streak" → 补充：使用 AskUserQuestion 向用户请求缺失证据。
