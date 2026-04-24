# verify 阶段 evaluator dispatch 参考

verify skill 在设计完 `checks[]` 并写入 `verification.md`（结论留空）之后，
必须通过 Agent tool 派发 **独立 `evaluator` subagent** 完成 PASS / FAIL 闸门。

## dispatch 约束

- 一次 dispatch 一个 `evaluator`，不做平行投票
- controller 必须完整注入以下内容到 subagent 提示词，**禁止让 subagent 自行读文件**：
  - `task_packet`（整包）
  - `verification` 工件内容（整包）
  - `execution` 摘要（关键 diff / 变更要点）
  - `acceptance_criteria`
- evaluator 不得接管修复；FAIL 时 `next_stage = repairing`，`owner = first_executor`
- 不因措辞自信放松标准——见 `agents/evaluator.md` 的反面示例清单

## 提示词模板

```
你是 Orbit 的 verify 阶段独立 evaluator。

目标：对本次 verifying 结果做 PASS / FAIL 闸门。

输入：
- task_packet：<完整注入>
- verification：<完整注入>
- execution 摘要：<关键 diff / 变更要点>
- acceptance：<契约>

约束：
- 不接管修复；FAIL 时 next_stage = repairing
- repairing.current_owner 必须 = first_executor
- 不因措辞自信而放松标准
- 只输出 result / summary / evidence / failed_checks / repair_actions /
  next_stage / repair_direction / next_action / owner_rule
```

## 消费 evaluator 返回

| evaluator_result | controller 动作 |
|---|---|
| `PASS` | 声明 `VERIFY_PASS`；runtime.`verify_fail_streak` 归零 |
| `FAIL` | 声明 `VERIFY_FAIL`；把 `repair_actions` 逐条写入 TodoWrite；交回 `first_executor`；随后 `REPAIR_SUBMITTED` 回写 runtime 时把 `verify_fail_streak` +1 |
| `INCOMPLETE` | 用 AskUserQuestion 向用户请求缺失证据，补齐后重新 dispatch evaluator；不得自行翻转结论；不改 streak |

## 循环上限保护

承接 `state/gates.json` 的 `limits.consecutive_verify_fail_limit`（默认 3）：

在声明 `VERIFY_FAIL` 前若发现 `verify_fail_streak + 1 >= limit`，停止自动循环，
**使用 `AskUserQuestion` 让用户选择**：升级 density / 重设方案 / 取消任务。

- 用户选择升级或重设 → 保留 `repair_direction` 作为交接信息，调用 `handoff` skill
- 用户选择取消 → 声明 `CANCEL`，进入 `cancelled`
- 不得自行进入 `paused`——决策权交给用户
