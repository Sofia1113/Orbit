---
name: verify
description: Orbit 验证阶段。EXECUTION_DONE 后调用：设计验证集合并 dispatch 独立 evaluator subagent 给出 PASS/FAIL。禁止自评——evaluator 必须独立于 executor。
---

verify 解决"实现是否真的达到了 acceptance"——但不自己回答这个问题，而是把判定交给独立 evaluator。

## 自评禁止（核心约束）

- PASS / FAIL 必须由独立 `evaluator` subagent 给出
- evaluator 不得接管修复
- `repairing.current_owner` 必须等于 `first_executor`

## 路由

| 完成事件 | density | 下一阶段 / 下一 skill |
|---|---|---|
| `VERIFY_PASS` | high | reviewing → reviewing |
| `VERIFY_PASS` | low / medium | completed（声明 `COMPLETE`） |
| `VERIFY_FAIL` | 任意 | repairing → execute |

`verify_fail_streak` 达到 `consecutive_verify_fail_limit`（默认 3）→ 用 `AskUserQuestion` 让用户决策（升级 density / 重设方案 / 取消）。

## verification_level

| density | 默认 level |
|---|---|
| low | `optional` |
| medium | `required` |
| high | `required_plus_review` |

只允许上调，不允许下调。

### optional 级别的轻量 evaluator 模板

`optional` 级别下 evaluator **仍必须独立 dispatch**，但允许使用精简契约：

- 派发输入精简：可省略完整 `acceptance_criteria` 表，传入 `goal` + `changes_made` + 1 条决定性 check（如"运行单元测试"）
- `verification.md` 最小模板：

  ```
  ## Evaluator Verdict
  - evaluator_id: <subagent handle>
  - result: PASS | FAIL
  - dispatched_at: <ISO8601>
  - summary: <一句话结论>
  - evidence: <一行命令或观察事实即可>
  ```

- evaluator 调用时声明 `effort=low`，最大轮次 ≤3
- 守住的硬规则不变：仍由独立 evaluator 返回结论；`## Evaluator Verdict` 锚点必须存在；FAIL 仍走 `repairing` 且 owner=`first_executor`；`verify_fail_streak` 计数照常

`required` 与 `required_plus_review` 级别**不适用**轻量模板，必须使用完整 evidence 表与逐项 check。

## verification.md 锚点

`VERIFY_PASS` 前必须包含：

```
## Evaluator Verdict
- evaluator_id: <subagent handle>
- result: PASS | FAIL | INCOMPLETE
- dispatched_at: <ISO8601>
- summary: <一句话结论>
```

没有该锚点或 `result` 非 `PASS` 时不得声明 `VERIFY_PASS`。

## 执行流程

1. 读取 `task_packet`、`execution` 摘要与 acceptance
2. 设计 `checks[]`（覆盖 acceptance 与高风险面）
3. 逐项执行并记录 `evidence`
4. 写入 `verification` 工件（结论留空）
5. 通过 `Agent` tool dispatch 独立 `evaluator` subagent。**完整注入** `task_packet` + `verification` 工件内容 + `execution` 摘要 + `acceptance_criteria`，禁止让 subagent 读文件
6. 按 evaluator 返回回写 runtime

## evaluator 返回消费

| evaluator_result | controller 动作 |
|---|---|
| `PASS` | 声明 `VERIFY_PASS`；`verify_fail_streak` 归零 |
| `FAIL` | 声明 `VERIFY_FAIL`；`repair_actions` 逐条 `TaskCreate` 追加；交回 `first_executor`；`REPAIR_SUBMITTED` 后 `verify_fail_streak` +1 |
| `INCOMPLETE` | 用 `AskUserQuestion` 向用户请求缺失证据，补齐后重新 dispatch evaluator；不得自行翻转结论；不改 streak |

## 输出

| 字段 | 说明 |
|---|---|
| `verification_level` | `optional` / `required` / `required_plus_review` |
| `checks` | 每项含 `id` / `description` / `how` / `evidence` |
| `candidate_result` | 本 skill 观察到的倾向（不等于最终结论） |
| `evaluator_result` | `PASS` / `FAIL` / `INCOMPLETE` |
| `summary` | evaluator 一句话结论 |
| `failed_checks` | FAIL 时未通过 check id |
| `repair_actions` | FAIL 时的结构化修复动作 |
| `artifact_written` | `verification` |
| `next_event` | `VERIFY_PASS` / `VERIFY_FAIL` |
| `next_skill` | `reviewing` / `execute` / `handoff` |
| `next_action` | 下一步唯一动作 |

## 工件与状态

- 写入工件：`verification` → `.orbit/state/<task_id>/verification.md`
- 任务清单进入项：checks[] 展开为 items
- FAIL 时 `repair_actions` 追加为 todo，`verify_fail_streak` 在 `REPAIR_SUBMITTED` 时 +1
- 通用持久化、任务清单、退出自检见 [state-protocol.md](../references/state-protocol.md)

## 优先工具

- `Bash`：运行测试 / lint / 编译验证
- `Read` / `Grep` / `Glob`：检查关键模式与文件内容
- `AskUserQuestion`：evaluator 返回 `INCOMPLETE` 时请求补充证据；streak 超限时让用户决策

详见 [native-tools.md](../references/native-tools.md)。

## 本阶段特有退出条件

- [ ] `verification.md` 包含 `## Evaluator Verdict` 锚点（`optional` 级别允许使用轻量模板）
- [ ] `evaluator_result` 由独立 evaluator subagent 返回，非本 skill 自评
- [ ] PASS 时 `verify_fail_streak` 归零；FAIL 时 +1
- [ ] FAIL 时 `repair_actions` 已逐条 `TaskCreate` 追加
- [ ] streak 超限时已用 `AskUserQuestion` 停止循环
