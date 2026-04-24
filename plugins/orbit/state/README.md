# Orbit State 协议

本目录是 Orbit 的**规则与协议权威源**。
Skill 文本是面向模型的指令副本，本目录的 JSON/Schema 是机器与评估器的权威。
当两者冲突时，以本目录为准；修改规则请先改本目录，再同步 skill 文本。

## 文件清单

| 文件 | 作用 |
|---|---|
| `runtime-state-lite.schema.json` | 每个任务 `runtime.json` 的运行时契约（必须符合） |
| `task-state.schema.json` | 全量状态协议（保留扩展字段，当前运行时只用 lite 子集） |
| `task-packet.schema.json` | executor / evaluator dispatch 时注入的输入契约 |
| `handoff.schema.json` | `handoff.json` / 子代理 `handoff_payload` 的契约 |
| `transition-rules.json` | 密度×阶段路径、事件→阶段映射、子任务规则、持久化规则 |
| `gates.json` | preflight / revision / escalation 三类闸门；连续失败上限 |
| `examples/` | 有效状态样例与非法状态反例（供 schema 联调） |

## 权威顺序（冲突时从高到低）

1. **Schema**（结构契约，可程序化校验）
2. **`transition-rules.json` + `gates.json`**（语义规则与闸门）
3. **Skill 文本**（对模型的指令副本，不具权威性）

任何规则新增/修改流程：

1. 先更新对应 schema 或 json
2. 再同步受影响的 skill 文本
3. 若涉及锚点/字段名，确认 `gates.json.preflight.rules` 里的锚点仍然对齐

## 运行时根目录

每个任务一个目录：

```
.orbit/state/<task_id>/
├─ runtime.json          # 每次 skill 结束时回写（runtime-state-lite）
├─ handoff.json          # 存在时是 resume 的最高优先级源
├─ events.jsonl          # append-only 事件流（见下）
├─ triage.md / scope.md / design.md / plan.md
├─ task_packet.json
├─ execution.md / verification.md / review.md / handoff.md
```

子任务放在 `.orbit/state/<parent>.<n>/`，有独立 runtime 与 events 流。

## 事件流（append-only）

文件：`.orbit/state/<task_id>/events.jsonl`

每次 `last_event` 发生时 **append 一行 JSON**（严格 JSONL，一行一事件）。

必填字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `ts` | string | ISO8601，事件发生时间 |
| `event` | string | 取值必须属于 `runtime-state-lite.schema.json#last_event` 枚举 |
| `task_id` | string | 与运行时 task_id 一致 |
| `stage_from` | string \| null | 事件前所处阶段；`TASK_CREATED` 可为 null |
| `stage_to` | string | 事件后所处阶段 |
| `owner` | string | 当前 `current_owner` 会话标识 |

可选字段（按事件类型按需带上，为未来复盘服务）：

| 字段 | 适用事件 |
|---|---|
| `note` | 任意事件：一句话原因或上下文 |
| `evaluator_id` | `VERIFY_PASS` / `VERIFY_FAIL` / `REVIEW_PASS` / `REVIEW_FAIL` |
| `repair_direction` | `VERIFY_FAIL` / `REVIEW_FAIL` |
| `verify_fail_streak` | `VERIFY_FAIL` / `REPAIR_SUBMITTED`（便于绘制 streak 曲线） |
| `artifact` | 工件落盘/更新时（值为相对路径） |
| `handoff_reason` | `HANDOFF_SAVED` |
| `downgrade_from` / `escalate_from` | `DOWNGRADE_DENSITY` / `ESCALATE_DENSITY` |
| `blocker_root_cause` | `BLOCKED` |

约束：

- **append-only**：严禁删除或改写已有行；修正用新一行 + `note` 描述
- **非恢复源**：events.jsonl 只用于事后复盘、failure pattern 分析，不参与 `resume` skill 的恢复优先级
- **子任务独立**：父任务与子任务各自维护 events.jsonl，不合并
- **写入时机**：每个 skill 在结束前回写 `runtime.json` 的同时追加事件行；一次 skill 运行内可追加多条（例：`REPAIR_SUBMITTED` → `VERIFY_FAIL` → `PAUSE` 触发三行）

样例：

```jsonl
{"ts":"2026-04-20T10:00:00Z","event":"TASK_CREATED","task_id":"rename-login","stage_from":null,"stage_to":"triaged","owner":"sess-a","note":"user requested rename"}
{"ts":"2026-04-20T10:00:04Z","event":"TRIAGE_DONE","task_id":"rename-login","stage_from":"triaged","stage_to":"executing","owner":"sess-a","note":"low by rubric: score 2"}
{"ts":"2026-04-20T10:03:21Z","event":"EXECUTION_DONE","task_id":"rename-login","stage_from":"executing","stage_to":"verifying","owner":"sess-a","artifact":".orbit/state/rename-login/execution.md"}
{"ts":"2026-04-20T10:04:11Z","event":"VERIFY_FAIL","task_id":"rename-login","stage_from":"verifying","stage_to":"repairing","owner":"sess-a","evaluator_id":"eval-a1","repair_direction":"补充对 null token 的防御","verify_fail_streak":1}
```

## 修改检查清单

改动影响 → 必须同步的文件：

- 新增事件枚举 → `runtime-state-lite.schema.json` + `transition-rules.json.event_stage_transitions` + 相关 skill
- 新增闸门 → `gates.json` + 相关 skill 的 preflight 段
- 调整密度路径 → `transition-rules.json.density_stage_paths` + `pilot` skill 的 rubric
- 新增工件槽位 → `runtime-state-lite.schema.json.artifacts` + 相关 skill 的"状态持久化"段 + `resume` 恢复优先级
