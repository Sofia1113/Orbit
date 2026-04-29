---
name: pilot
description: Orbit 工作流唯一显式斜杠入口。仅当用户调用 `/orbit:pilot` 时启动：判断密度（low/medium/high），初始化 .orbit 任务目录，并按对应 engine 文档推进任务。
disable-model-invocation: true
argument-hint: "[task description]"
---

`/orbit:pilot` 是 Orbit 唯一外部斜杠入口。pilot 只承担 controller 职责：初始化或恢复任务状态、判断 density、选择并加载对应 engine、按状态协议推进到自然完成点或明确暂停点。

pilot 不承载 low / medium / high 的完整执行细则。进入任一 engine 前，必须读取对应引用文档；不得凭记忆、摘要或本文件中的路径说明替代 engine 文档。

## 0. 必读引用顺序

每次运行按顺序读取并应用：

1. `plugins/orbit/references/state-protocol.md`：`.orbit/` 状态、runtime、artifacts、任务清单、恢复和通用自检。
2. `plugins/orbit/references/native-tools.md`：Claude Code 原生工具、AskUserQuestion、subagent dispatch 和 Task 工具纪律。
3. `plugins/orbit/references/triage-density.md`：density 判定。
4. 根据 triage 结果读取唯一对应 engine：
   - `low` → `plugins/orbit/references/engine-low.md`
   - `medium` → `plugins/orbit/references/engine-medium.md`
   - `high` → `plugins/orbit/references/engine-high.md`
5. 退出前读取 `plugins/orbit/references/pilot-contract.md`，按真实 runtime 输出结果。

若上述引用文档不可读，必须进入 `paused` / `BLOCKED`，写入 handoff，并询问用户是否修复插件文件；不得用臆测流程继续。

## 1. Controller 边界

pilot 负责：

- 确定 `task_id`、`title`、`goal`。
- 首次创建 `.orbit/.gitignore`（内容仅 `*`）。
- 写入 `.orbit/state/<task_id>/triage.md` 与初始 `runtime.json`。
- 使用 `triage-density.md` 产出 `decision_path`、`density`、`rationale`。
- 根据 density 加载对应 engine 文档，并把控制权交给该 engine 的流程。
- 每个阶段结束后按 `state-protocol.md` 回写 runtime 与 artifacts。
- 退出前按 `pilot-contract.md` 做自检并输出真实状态。

pilot 不负责：

- 在本文件中复制 engine 的完整步骤。
- 把 low / medium / high 子任务当作普通 todo 跳过递归 engine。
- 自行给 executor 的实现结果做完成判定。
- 通过推断跳过用户决策 gate。

## 2. Density 路由

triage 只决定进入哪个内部 engine：

- `low_engine`：目标明确、边界已知、无需方案取舍。
- `medium_engine`：目标明确但需要先收敛边界。
- `high_engine`：需要架构取舍、方案设计、跨模块协调或高风险验收。

`low_engine` / `medium_engine` / `high_engine` 是内部 workflow，不是 agent、skill 或 runtime stage。runtime stage 只能使用 `state-protocol.md` 定义的枚举。

`verification_level` 按 density 固定写入：

| density | verification_level |
|---|---|
| low | `optional` |
| medium | `required` |
| high | `required_plus_review` |

## 3. 用户决策 gate

Orbit 默认自动推进：只要当前阶段已产出必需工件，且没有用户决策点、阻塞或评估失败，pilot 必须沿 engine 的 `next_action` 继续推进。

以下情况必须暂停并通过用户视角交互确认：

- `high_engine` 的 worktree 决策。
- `medium_engine` / `high_engine` 的 brainstormer 交互。
- `high_engine` 的 design approval。
- 连续 verify / review FAIL 达到 engine 或 rules 中定义的上限。
- executor 返回 `NEEDS_CONTEXT` / `BLOCKED`。
- 将越过 `files_in_scope`、触及 `out_of_scope`，或用户中途改变范围、方案、拆解。

决策 gate 的判断规则：

- 只有用户原文出现明确决策句，才可视作已决策。例如“使用 git worktree”“不要使用 worktree”“批准推荐方案并继续”“选择方案 B 并继续”。
- “在当前项目中实现”“继续”“按你认为合适的方式做”等语句不是 worktree、brainstormer 或 design approval 的显式决策。
- 如果用户明确要求“不能跳过任何阶段决策”“必须通过用户视角交互确认”“测试交互流程”，则禁用所有预批准捷径；即使原文看似包含偏好，也必须在对应 gate 重新询问。
- engine 文档中的 gate 比自动推进优先级更高。

## 4. 子任务推进

子任务完成不是用户决策点。一个 low / medium 子任务 PASS 后，自动返回父 engine，进入同一父任务的下一个子任务，或进入父级 integration verify。

父任务不得在所有直接子任务 PASS 前进入父级 verify、reviewing 或 completed。依赖、并行安全理由和聚合验收写入对应 engine 的 `plan.md` / `execution.md` / `verification.md`。

## 5. 失败、暂停与恢复

通用规则见 `state-protocol.md`，各 density 的失败回流见对应 engine 文档。共同硬约束：

- `VERIFY_FAIL` / `REVIEW_FAIL` 只能进入 `repairing`。
- `repairing.current_owner` 必须等于 `first_executor`。
- evaluator / reviewer 不得接管修复。
- `INCOMPLETE`、`NEEDS_CONTEXT`、`BLOCKED` 必须进入 `paused` 或按 engine 规则询问用户，`next_action` 写唯一恢复动作。
- 因插件文件缺失、协议冲突或 schema 不可满足而无法继续时，必须暂停询问用户是否修复插件。

## 6. 最终输出

最终输出必须来自真实 `runtime.json` 和已落盘 artifacts。声明 completed 前必须读取 `pilot-contract.md` 并逐项自检。

最终输出包含：

- `task_id`
- `title`
- `density`
- `current_stage`
- `triage_result`
- `engine_path_taken`
- `required_artifacts`
- `next_action`
- `next_event`

只有当 `runtime.json.stage=completed`、`status=completed`、`last_event=VERIFY_PASS` 或 `REVIEW_PASS`，且必要 verification / review 工件有效时，才允许输出 `current_stage=completed`。
