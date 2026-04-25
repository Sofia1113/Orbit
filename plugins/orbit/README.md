# orbit

`orbit` 是 `orbit-marketplace` 中的一个 Claude Code 插件，面向复杂软件工程任务提供：

- 基于思考密度的 low / medium / high 路由
- executor / evaluator 分离，修复固定回首次执行者
- 以 handoff 恢复载荷为中心的跨会话恢复
- 由 skill / agent / 状态 schema / 规则文件组合成的工作流骨架
- 以文件化 SSOT 驱动的状态机内核
- 以 Claude Code 原生 task 工具（`TaskCreate` / `TaskUpdate` / `TaskList`）作为阶段执行的源权威

## 目录结构

```text
plugins/orbit/
├─ .claude-plugin/plugin.json
├─ skills/
│  ├─ references/
│  │  ├─ state-protocol.md   # 状态目录、runtime.json、artifacts、任务清单、跨会话恢复
│  │  └─ native-tools.md     # Claude Code 原生工具集成指南
│  └─ <skill>/SKILL.md       # 触发语 + 决策逻辑 + 输出 + 阶段特有退出条件
├─ agents/                   # executor / evaluator / spec-compliance / code-quality
└─ state/                    # 运行时 schema + rules + examples
```

## 内置能力

- `pilot`：统一入口，按密度路由
- `scoping`：medium 任务的边界收敛
- `design`：high 任务的方案设计与用户批准
- `planning`：high 任务的方案拆解与 task_packet 产出
- `execute`：实现执行
- `verify`：独立 evaluator 验证闸门
- `reviewing`：high 任务的双阶段审查闸门
- `handoff`：跨会话 / 跨子代理恢复交接
- `executor` (subagent)：单次任务实现执行者
- `evaluator` (subagent)：verify 阶段独立评估者
- `spec-compliance-evaluator` (subagent)：reviewing 第一阶段
- `code-quality-evaluator` (subagent)：reviewing 第二阶段

## 任务状态模型

运行时状态使用 `state/runtime-state.schema.json`。核心字段：

- `task_id`、`density`、`stage`、`status`
- `first_executor`、`current_owner`
- `goal`、`next_action`、`last_event`
- `artifacts`（统一槽位）、`todo[]`
- `triage_result`（`decision_path` + `density` + `rationale`）
- `verification_level`、`repair_direction`、`verify_fail_streak`

### 阶段枚举

`triaged / scoping / designing / planning / executing / verifying / reviewing / repairing / paused / completed / cancelled`

### 密度与阶段约束

- `low`：`triaged → executing → verifying → completed`
- `medium`：`triaged → scoping → executing → verifying → completed`
- `high`：`triaged → designing → planning → executing → verifying → reviewing → completed`

### 补充事件

- `DOWNGRADE_DENSITY`：仅允许在 `scoping` / `designing` / `planning` 期间发起
- `ESCALATE_DENSITY`：允许在 `scoping` / `designing` / `planning` / `executing` 期间发起；在 `executing` 发起时必须先产出 `handoff_reason='escalate_density'` 的迁移 handoff，再切换到新 density 入口阶段（low→scoping，medium→designing）
- `SUBTASK_SPAWNED` / `SUBTASK_COMPLETED`：high 任务可通过 planning 标记 `spawn_subtask`，派发独立 medium 子任务
- `NEEDS_CONTEXT` / `BLOCKED` / `DONE_WITH_CONCERNS`：executor 四态返回

### 核心硬规则

- `VERIFY_FAIL` / `REVIEW_FAIL` 只能进入 `repairing`
- `repairing.current_owner` 必须等于 `first_executor`
- `paused` 与 handoff payload 必须带 `next_action`
- 任意时刻只能有一个 `todo` 处于 `in_progress`
- 连续 2 轮 review 仍失败必须停止自动循环，用 `AskUserQuestion` 让用户决策
- 连续 verify FAIL 达到 `consecutive_verify_fail_limit`（默认 3）必须停止循环，用 `AskUserQuestion` 让用户决定升级 / 重设方案 / 取消
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

统一槽位：`triage / scope / design / plan / execution / verification / review / handoff / task_packet`。未使用为 `null`。

详细写入时机与内容见 `skills/references/state-protocol.md`。

## 文件化 SSOT

每个任务对应独立目录：

```
.orbit/state/<task_id>/
├─ runtime.json
├─ handoff.json
├─ triage.md / scope.md / design.md / plan.md
├─ task_packet.json
├─ execution.md / verification.md / review.md / handoff.md
```

子任务放在 `.orbit/state/<parent>.<n>/`，拥有独立 runtime。

`.orbit/` 根目录首次由 pilot 创建时会写入 `.orbit/.gitignore`（内容仅一行 `*`），默认不把任务状态纳入版本控制；如需入库，由用户自行调整或删除该文件。

恢复优先级：

```
handoff.json
  → runtime.json
  → 最近失败 review.md
  → 最近失败 verification.md
  → 最近 execution.md
  → 其他 artifact
  → 原始任务描述
```

## 闭环规则

### 评估与修复（独立 evaluator）

- `verify` skill **禁止自评**，必须 dispatch 独立 `evaluator` subagent 给出 PASS / FAIL
- `reviewing` skill 必须做**两阶段独立审查**：
  1. spec-compliance evaluator
  2. code-quality evaluator（仅当第一阶段 PASS）
- evaluator 不得接管修复
- FAIL 固定回 `repairing`，owner 必须等于 `first_executor`
- evaluator 返回的 `repair_actions` 必须逐条用 `TaskCreate` 追加为新 todo

### Subagent dispatch 纪律

- controller 必须把完整 `task_packet` + `scene` 注入 subagent，禁止让 subagent 读 plan / design / scope 文件
- executor 每次 dispatch 完成必须返回 `handoff_payload`
- executor 四态：`DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED`
- `NEEDS_CONTEXT` 禁止用同一 prompt 重试；`BLOCKED` 必须附 `blocker_root_cause`

### Handoff / 恢复

- `handoff` 触发：上下文预算临近 / 子代理边界 / 人工暂停 / 评估失败保留现场 / 大阶段切换
- `handoff` 是恢复载荷，不是长总结（schema 7 个必填字段）
- 子代理返回的 `handoff_payload` 由 handoff skill 合并进父 runtime
- Orbit 不注册 `resume` skill，避免与 Claude Code 官方恢复命令冲突；后续会话恢复直接读取 `.orbit/state/<task_id>/` 工件

### Skill 公共模式

各 SKILL.md 只描述本阶段独有的决策逻辑、输出契约与特有退出条件。共享内容收敛到 `references/`：

- `references/state-protocol.md`：状态目录、runtime.json、artifacts 槽位、任务清单双层模型、`first_executor` 跨会话恢复语义、退出前通用自检
- `references/native-tools.md`：Claude Code 原生工具的何时用 / 优先级 / 边界，与子 agent dispatch 纪律

### 任务清单（TaskCreate / TaskUpdate / TaskList）双层语义

- **持久 SSOT** = `runtime.todo[]`（跨会话存活）
- **会话投影** = 原生 task 工具维护的列表（仅当前会话可见）
- 阶段切换前所有实现类 todo 必须 `done`，未完成项挂到下一阶段或 handoff
- 详见 `references/state-protocol.md`

### `first_executor` 跨会话恢复语义

- `first_executor` 是逻辑首席执行者角色，不是会话 ID
- pilot 创建任务时填入约定 sentinel `"primary-session"`
- 新会话恢复同一任务时默认承接此身份，可在 `repairing` 阶段合法承担修复
- 子代理 dispatch 与 handoff 都不改变 `first_executor`
- 仅在用户显式换主时更新，并在 runtime 中记录原因

## 本地自检

```bash
# 全量自检：schema / rules / docs / examples 一致性
node plugins/orbit/scripts/validate-orbit-state.mjs

# 单 runtime 自检（每个 skill 退出前调用）
node plugins/orbit/scripts/validate-orbit-state.mjs --runtime .orbit/state/<task_id>/runtime.json
```

第一种模式会检查 `runtime-state.schema.json`、`rules.json` 与 `state/examples/` 的一致性；第二种模式仅校验单个任务的 `runtime.json` 是否符合 schema 与硬规则。

## 最小运行时样例

- `state/examples/valid-runtime-low.json`
- `state/examples/valid-low.json`
- `state/examples/valid-medium-resumable.json`
- `state/examples/valid-high-review-loop.json`
- `state/examples/invalid-*.json`（非法状态反例）
