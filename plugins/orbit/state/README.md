# Orbit State 协议

本目录是 Orbit 的**规则与协议权威源**。

Skill 文本是面向模型的指令副本，本目录的 JSON / Schema 是机器与评估器的权威。当两者冲突时，以本目录为准；修改规则请先改本目录，再同步 skill 文本。

## 文件清单

| 文件 | 作用 |
|---|---|
| `runtime-state.schema.json` | 每个任务 `runtime.json` 必须符合的权威 schema |
| `task-packet.schema.json` | executor / evaluator dispatch 时注入的输入契约 |
| `handoff.schema.json` | `handoff.json` / 子代理 `handoff_payload` 的契约（7 个必填字段） |
| `rules.json` | 阶段路径、事件转换、三类闸门、密度 / 子任务 / 评估者规则、持久化、硬规则的权威源 |
| `examples/` | 有效状态样例与非法状态反例（供 schema 联调） |

## 权威顺序（冲突时从高到低）

1. `runtime-state.schema.json`（运行时 schema，可程序化校验）
2. `rules.json`（语义规则与闸门）
3. Skill 文本（对模型的指令副本，不具权威性）

任何规则新增 / 修改流程：

1. 先更新对应 schema 或 json
2. 再同步受影响的 skill 文本
3. 若涉及锚点 / 字段名，确认 `rules.json.gates.preflight.rules` 里的锚点仍然对齐

## 运行时根目录

每个任务一个目录：

```
.orbit/state/<task_id>/
├─ runtime.json          # 每次 skill 结束时回写
├─ handoff.json          # 存在时是后续会话恢复的最高优先级源
├─ triage.md / scope.md / design.md / plan.md
├─ task_packet.json
├─ execution.md / verification.md / review.md / handoff.md
```

子任务放在 `.orbit/state/<parent>.<n>/`，有独立 runtime。

## 修改检查清单

改动影响 → 必须同步的文件：

- 新增事件枚举 → `runtime-state.schema.json` + `rules.json.event_stage_transitions` + 相关 skill
- 新增闸门 → `rules.json.gates` + 相关 skill 的"特有退出条件"段
- 调整密度路径 → `rules.json.density_stage_paths` + `pilot` skill 的 rubric
- 新增工件槽位 → `runtime-state.schema.json.artifacts` + `references/state-protocol.md` 的 artifacts 表 + `rules.json.persistence.recovery_priority`
