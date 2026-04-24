# orbit

`orbit` 是 `orbit-marketplace` 中的一个 Claude Code 插件。

它面向复杂软件工程任务，提供：

- 基于思考密度的 low / medium / high 路由
- executor / evaluator 分离，修复固定回首次执行者
- 以 handoff 恢复载荷为中心的跨会话恢复
- 以 skills、agents、轻量规则文件组合实现的工作流骨架
- 以 `runtime-state-lite`、阶段规则、最小 gate 与**文件化 SSOT**驱动的状态机内核
- 以 **TodoWrite** 作为 stage 执行的源权威，实现"状态机 × 待办"的双向约束

## 目录结构

```text
plugins/orbit/
├─ .claude-plugin/plugin.json
├─ skills/
│  ├─ references/common-runtime-patterns.md  # 公共持久化/TodoWrite 模式
│  └─ <skill>/
│     └─ SKILL.md           # 触发语 + 路由 + 阶段特有约束 + 输出字段 + 退出自检
├─ agents/                  # executor / evaluator / spec-compliance / code-quality
└─ state/                   # runtime-state-lite（唯一 schema） + rules + examples
```

## 当前内置能力

- `pilot`
- `scoping`
- `design`
- `planning`
- `execute`
- `verify`
- `reviewing`
- `handoff`
- `executor`（subagent）
- `evaluator`（subagent，verify 阶段使用）
- `spec-compliance-evaluator`（subagent，reviewing 第一阶段）
- `code-quality-evaluator`（subagent，reviewing 第二阶段）

## 任务状态模型

运行时状态使用 `state/runtime-state-lite.schema.json`（v1 唯一权威 schema）；核心字段：

- `task_id`、`density`、`stage`、`status`
- `first_executor`、`current_owner`
- `goal`、`next_action`、`last_event`
- `artifacts`（统一槽位）、`todo[]`
- `triage_result`（简化为 decision_path + density + rationale）
- `verification_level`、`repair_direction`、`verify_fail_streak`

运行时状态以 `runtime-state-lite.schema.json` 为唯一权威 schema。

### 阶段枚举

`triaged / scoping / designing / planning / executing / verifying / reviewing / repairing / paused / completed / cancelled`

### 密度与阶段约束

- `low`：`triaged → executing → verifying → completed`
- `medium`：`triaged → scoping → executing → verifying → completed`
- `high`：`triaged → designing → planning → executing → verifying → reviewing → completed`

补充事件：

- `DOWNGRADE_DENSITY`：仅允许在 `scoping` / `designing` / `planning` 期间发起
- `ESCALATE_DENSITY`：允许在 `scoping` / `designing` / `planning` / `executing` 期间发起；在 `executing` 发起时必须先产出 `handoff_reason='escalate_density'` 的迁移 handoff，再切换到新 density 入口阶段（low→scoping，medium→designing）
- `SUBTASK_SPAWNED` / `SUBTASK_COMPLETED`：high 任务可通过 planning 标记 `spawn_subtask`，派发独立 medium 子任务
- `NEEDS_CONTEXT` / `BLOCKED` / `DONE_WITH_CONCERNS`：executor 四态返回（承接 superpowers）

补充规则：

- `VERIFY_FAIL` / `REVIEW_FAIL` 只能进入 `repairing`
- `repairing.current_owner` 必须等于 `first_executor`
- `paused` 与 handoff payload 必须带 `next_action`
- 任意时刻只能有一个 `todo` 处于 `in_progress`
- 连续 2 轮 review 仍失败必须停止自动循环，用 AskUserQuestion 让用户决策（升级 / 重设 / 取消）
- 连续 verify FAIL 达到 `limits.consecutive_verify_fail_limit`（默认 3）必须停止循环，用 AskUserQuestion 让用户决定升级 / 重设方案 / 取消
- `DESIGN_DONE` 前 `design.md` 必须含 `## User Approval` 锚点且 `approved_option` 非空
- `VERIFY_PASS` 前 `verification.md` 必须含 `## Evaluator Verdict` 锚点且 `result=PASS`
- `REVIEW_PASS` 前 `review.md` 必须同时含 `## Spec Compliance Verdict` 与 `## Code Quality Verdict` 锚点且均 `result=PASS`

### verification_level × density 硬映射

| density | 默认 verification_level |
|---|---|
| low | `optional` |
| medium | `required` |
| high | `required_plus_review` |

仅允许上调，不允许下调（避免绕过独立评估）。

## 工件协议

统一槽位：`triage / scope / design / plan / execution / verification / review / handoff / task_packet`。未使用时为 `null`。

## 文件化 SSOT（v1 持久化规范）

每个任务对应独立目录：

```
.orbit/state/<task_id>/
├─ runtime.json          # runtime-state-lite，每次 skill 结束时回写
├─ handoff.json          # 存在时为后续会话恢复最高优先级源
├─ triage.md
├─ scope.md
├─ design.md
├─ plan.md
├─ task_packet.json
├─ execution.md
├─ verification.md
├─ review.md
└─ handoff.md
```

子任务放在 `.orbit/state/<parent>.<n>/`，拥有独立 runtime。

`.orbit/` 根目录首次由 pilot 创建时会写入 `.orbit/.gitignore`（内容仅一行 `*`），默认不把任务状态纳入版本控制；如需入库，由用户自行调整或删除该文件。

恢复优先级固定为：

1. `handoff.json`
2. `runtime.json`
3. 最近失败 `review.md`
4. 最近失败 `verification.md`
5. 最近 `execution.md`
6. 其他 artifact
7. 历史描述

## 闭环规则

### 评估与修复（独立 evaluator）

- `verify` skill **禁止自评**，必须 dispatch 独立 `evaluator` subagent 给出 PASS / FAIL
- `reviewing` skill 必须做**两阶段独立审查**：
  1. spec-compliance evaluator
  2. code-quality evaluator（仅当第一阶段 PASS）
- evaluator 不得接管修复
- FAIL 固定回 `repairing`，owner 必须等于 `first_executor`
- evaluator 返回的 `repair_actions` 必须逐条追加为 TodoWrite items

### Subagent dispatch 纪律（承接 superpowers）

- controller **必须把完整 `task_packet` + `scene` 注入 subagent 提示词**，禁止让 subagent 读 plan/design/scope 文件
- executor 每次 dispatch 完成必须返回 `handoff_payload`
- executor 四态：`DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED`
- `NEEDS_CONTEXT` 禁止用同一 prompt 重试；`BLOCKED` 必须附 `blocker_root_cause`

### Handoff / 恢复

- `handoff` 触发：上下文预算临近 / 子代理边界 / 人工暂停 / 评估失败保留现场 / 大阶段切换
- `handoff` 是恢复载荷，不是长总结（schema 精简为 7 个必填字段）
- 子代理返回的 `handoff_payload` 由 handoff skill 合并进父 runtime
- Orbit 不注册 `resume` skill，避免与 Claude Code 官方恢复命令冲突；后续会话恢复直接读取 `.orbit/state/<task_id>/` 工件

### Skill 公共模式

- `skills/references/common-runtime-patterns.md` 抽取了状态持久化、TodoWrite 绑定和原生工具集成的公共规则
- 各 SKILL.md 通过"运行时契约"段引用公共模式，仅描述本阶段特有差异

### TodoWrite 与 runtime.todo[] 的双层语义

- **持久化 SSOT = `runtime.todo[]`**（跨会话、跨子代理存活）
- **会话投影 = TodoWrite**（仅本次会话可见，会话结束即丢失）
- 规则：
  - 进入任意 stage 第一步必须调用 TodoWrite，并把结果回写到 `runtime.todo[]`
  - 阶段内任意一项状态变化（`pending` / `in_progress` / `done`），**先更新 TodoWrite，再同步回写 `runtime.todo[]`**
  - 任意时刻只能有一个 `in_progress`
  - 完成立刻 `done`；evaluator 返回的 `repair_actions` 立刻逐条追加为新 todo
  - **后续会话恢复时反向重建**：由 `runtime.todo[]` 重建当前会话的 TodoWrite，不从历史对话里回忆
  - 当两者冲突，以 `runtime.todo[]` 为准（持久源胜出），并在重建后同步 TodoWrite

## 本地自检

运行零依赖状态校验：

```bash
node plugins/orbit/scripts/validate-orbit-state.mjs
```

脚本会检查 `runtime-state-lite.schema.json`、`rules.json` 与 `state/examples/` 的一致性。也可通过以下抽查验证流程一致性：

- 阶段推进是否满足 `density`
- 失败后是否统一回到 `repairing`
- 修复执行者是否保持为 `first_executor`
- `paused` 与 handoff payload 是否明确 `next_action`
- todo 是否只存在一个 `in_progress`
- `verification` / `review` 结论是否来自独立 evaluator subagent
- dispatch subagent 时 task_packet 是否完整注入
- `.orbit/state/<task_id>/` 是否存在且 `runtime.json` 与当前 stage 一致

## 最小运行时样例

- `state/examples/valid-runtime-lite-low.json`
- `state/examples/valid-low.json`
- `state/examples/valid-medium-resumable.json`
- `state/examples/valid-high-review-loop.json`
- `state/examples/invalid-*.json`（非法状态反例）
