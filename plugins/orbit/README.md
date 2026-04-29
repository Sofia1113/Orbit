# orbit

`orbit` 是 `orbit-marketplace` 中的一个 Claude Code 插件，面向复杂软件工程任务提供：

- 基于思考密度的 low / medium / high 路由
- medium / high 的多阶段交互式需求发现
- high 的系统架构师设计与架构评审
- executor / evaluator 分离，修复固定回首次执行者
- 以 handoff 恢复载荷为中心的跨会话恢复
- high→medium_engine→low_engine 的内部递归工作流与父级集成验收
- 由唯一显式 `/orbit:pilot` 入口、内部阶段状态、agent、状态 schema 与规则文件组合成的工作流骨架
- 以文件化 SSOT 驱动的状态机内核
- 以 Claude Code 原生 task 工具（`TaskCreate` / `TaskUpdate` / `TaskList`）作为阶段执行的源权威

## 目录结构

```text
plugins/orbit/
├─ .claude-plugin/plugin.json
├─ commands/
│  └─ pilot.md               # 显式 /orbit:pilot 入口，禁用模型自动调用
├─ references/
│  ├─ triage-density.md      # density 判定规则
│  ├─ brainstormer.md        # 主会话 controller 内联执行的需求发现流程
│  ├─ pilot-contract.md      # pilot 输出、工件与退出契约
│  ├─ state-protocol.md      # 状态目录、runtime.json、artifacts、任务清单、跨会话恢复
│  ├─ engine-low.md / engine-medium.md / engine-high.md
│  └─ native-tools.md        # Claude Code 原生工具集成指南
├─ agents/                   # architect / executor / evaluator / review evaluators
└─ state/                    # 运行时 schema + rules + examples
```

## 使用入口

从 `/orbit:pilot` 开始。`/orbit:pilot` 是唯一外部斜杠命令入口，已禁用模型自动调用；普通工程任务不会因为插件存在而自动进入 Orbit。pilot 只回答一个问题：这次任务该走多重的流程？

- 已知小改动 → `low_engine`：直接执行，再做轻量独立验证
- 目标明确但边界未知 → `medium_engine`：主会话 controller 必须按 `references/brainstormer.md` 做交互式需求发现，再收敛 in_scope / out_of_scope / acceptance，拆成一个或多个可并行的 `low_engine`，最后做集成验证
- 需要方案取舍或架构判断 → `high_engine`：先询问是否使用 `git worktree`，主会话 controller 必须按 `references/brainstormer.md` 发现真实需求，再由 `architect` 设计、规划、拆成一个或多个可并行的 `medium_engine`，最后做端到端集成验证、架构评审与审查

用户在使用 Orbit 时应始终能看到三件事：当前阶段在解决什么问题、失败后有哪些选择、下一步唯一动作是什么。

## 常见场景

- Bugfix：通常从 `low` 或 `medium` 开始；如果修复过程中发现边界扩大，再升级密度。
- Feature：需求清楚但落点未知时走 `medium`；需要比较方案时走 `high`。
- Review loop：高密度任务在 verify PASS 后进入 reviewing，先过 spec-compliance，再过 code-quality。

## 失败与恢复

- `VERIFY_FAIL` / `REVIEW_FAIL` 不会直接换人修复，而是回到 `repairing`，由 `first_executor` 按 repair_actions 继续。
- evaluator 返回 `INCOMPLETE` 时，Orbit 应请求补证据，而不是自行翻转结论。
- 连续失败达到上限时，Orbit 会停止自动循环并让用户选择升级密度、重设方案或取消。
- `handoff.json` 是机器恢复入口，`handoff.md` 是人类接力摘要；恢复时优先读取 handoff，再读 runtime。

## 内置能力

- `/orbit:pilot`：唯一外部斜杠入口，按密度路由到内部 engine；禁用模型自动调用
- `low_engine`：内部工作流，目标明确任务或 low 子任务的 executor→evaluator 闭环；完整内容见 `references/engine-low.md`
- `medium_engine`：内部工作流，递归运行一个或多个 `low_engine` 并做父级 integration verify；完整内容见 `references/engine-medium.md`
- `high_engine`：内部工作流，递归运行一个或多个 `medium_engine` 并做端到端 integration verify 与 review；完整内容见 `references/engine-high.md`
- `scoping` / `design` / `planning` / `execute` / `verify` / `reviewing` / `handoff`：命令内部阶段，由 `/orbit:pilot` 与 engine 状态推进，不暴露为 Claude Code skill
- `brainstormer`：medium/high 的多阶段需求发现与交互式头脑风暴，由主会话 controller 通过 `references/brainstormer.md` 内联执行，不注册为 agent / subagent / skill
- `architect` (subagent)：high 的系统架构设计与架构评审
- `executor` (subagent)：单次任务实现执行者
- `evaluator` (subagent)：verify 阶段独立评估者
- `spec-compliance-evaluator` (subagent)：reviewing 第二阶段
- `code-quality-evaluator` (subagent)：reviewing 第三阶段

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
- `SUBTASK_SPAWNED` / `SUBTASK_COMPLETED`：`high_engine` 可通过 planning 生成 medium 子任务，`medium_engine` 可生成 low 子任务；父任务必须等全部子任务验证通过后才能集成验证，完整细节见对应 `references/engine-*.md`
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

详细写入时机与内容见 `references/state-protocol.md`。

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

### 用户打断与阶段回退

- 自动化默认沿 `next_action` 推进，只有 worktree 选择、design approval、范围变化、用户打断、连续失败超限或风险越界时暂停。
- 用户提出新决策或建议时，先判断影响范围：实现细节回退到 `executing`，边界变化回退到 `scoping`，方案变化回退到 `designing`，拆解变化回退到 `planning`，评估失败修复回退到 `repairing`。
- 回退不得新增 runtime stage；必要时记录 `PAUSE` / `NEEDS_CONTEXT` / `BLOCKED`，并在 `next_action` 中写明唯一恢复动作。

### 评估与修复（独立 evaluator）

- `verify` 阶段**禁止自评**，必须 dispatch 独立 `evaluator` subagent 给出 PASS / FAIL
- `reviewing` 阶段必须做**三阶段独立审查**：
  1. architect architecture review
  2. spec-compliance evaluator（仅当 architecture review PASS）
  3. code-quality evaluator（仅当前两阶段 PASS）
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
- 子代理返回的 `handoff_payload` 由 handoff 阶段合并进父 runtime
- Orbit 不注册任何 Claude Code skill，避免与官方能力或其他插件命名冲突；后续会话恢复直接读取 `.orbit/state/<task_id>/` 工件

### 阶段公共模式

所有阶段都在 `/orbit:pilot` 内部渐进披露，不暴露为 Claude Code skill。共享内容收敛到 `references/`：

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

Orbit 不提供额外 validator 或门禁脚本；状态正确性由 `runtime-state.schema.json`、`rules.json`、`references/state-protocol.md` 与 `/orbit:pilot` 的退出条件共同约束。

日常检查建议直接抽读本次任务的 `.orbit/state/<task_id>/runtime.json`、`verification.md`、`review.md`，确认：

- `runtime.json` 必填字段齐全，且没有 schema 外字段
- `artifacts` 九槽位完整，未使用槽位为 `null`
- `verification.md` 包含独立 evaluator 的 `## Evaluator Verdict` 与 `result=PASS`
- high 任务的 `review.md` 同时包含两个独立 review verdict 且均为 PASS
