---
name: resume
description: Orbit 的主会话恢复 skill。每次新会话启动后，用户说『继续之前那个任务』『接着做 X』『恢复上下文』『我们上次到哪了』，或检测到 `.orbit/state/<task_id>/` 目录已存在时必须调用本 skill：按固定优先级（handoff.json → runtime.json → 最近失败的 review / verification → 最近 execution → 其他 artifact → 历史描述）重建任务上下文，并把 TodoWrite 同步到 runtime.todo[]。目的是恢复执行连续性而不是重述全部历史。
---

目标：
- 基于当前工件、状态与最近事实重建任务上下文
- 判断任务停留在哪个阶段，以及下一步最合理动作
- 优先恢复执行连续性，而不是重述全部历史

路由规则（完成后触发）：
- 恢复到 `triaged` → 调用 `pilot`（少见，通常 triage 已完成）
- 恢复到 `scoping` → 调用 `scoping`
- 恢复到 `designing` → 调用 `design`
- 恢复到 `planning` → 调用 `planning`
- 恢复到 `executing` / `repairing` → 调用 `execute`
- 恢复到 `verifying` → 调用 `verify`
- 恢复到 `reviewing` → 调用 `reviewing`
- 恢复到 `handoff` / `paused` → 呈现状态并等待用户指示，不自动推进

文件化 SSOT：
- 状态根目录固定为 `.orbit/state/<task_id>/`
- 必须存在的文件：
  - `runtime.json`：符合 `runtime-state-lite.schema.json`，每次 skill 结束时回写
  - `handoff.json`：存在时必须符合 `handoff.schema.json`
- 工件文件（存在时）：
  - `triage.md` / `scope.md` / `design.md` / `plan.md` / `task_packet.json` /
    `execution.md` / `verification.md` / `review.md` / `handoff.md`

恢复优先级（固定顺序）：
1. `.orbit/state/<task_id>/handoff.json`（若存在）
2. `.orbit/state/<task_id>/runtime.json`
3. 最近失败 `review.md`
4. 最近失败 `verification.md`
5. 最近 `execution.md`
6. 其他 artifact 扫描
7. 历史描述（最低优先级）

原则：
- 先依赖当前工件与事实，再引用历史描述
- 恢复后只保留当前阶段判断与唯一 `next_action`
- 若历史与现状冲突，以 `runtime.json` + 最新工件为准
- 若 `runtime.json` 与 `handoff.json` 冲突，以更新时间较新者为准并记录 discrepancy
- 恢复后必须记录 `resume_context`
- 优先恢复 `runtime-state-lite` 所需字段，不尝试补齐全量 `task-state` 扩展字段
- 恢复后第一件事是调用 TodoWrite 把 `runtime.todo[]` 反向重建为当前会话 todo（`runtime.todo[]` 是持久 SSOT，TodoWrite 是会话投影）；若两者在历史上存在冲突，以 `runtime.todo[]` 为准

执行流程：
1. 探测 `.orbit/state/<task_id>/` 是否存在；不存在时回退到历史描述并提示缺失
2. 按优先级读取文件，构造最小 resume brief
3. 同步 TodoWrite：保留未完成 todo、按 runtime 标记一个 `in_progress`
4. 若存在 handoff 且未被消费：
   - 校验一致性
   - 声明 `RESUME_RESTORED`
   - 清理 handoff：重命名为 `handoff.consumed.json`，或保留只读并在 runtime 标记 `handoff_consumed: true`
5. 产出下一步唯一 `next_action` 并根据当前 `stage` 指向对应 skill
6. 声明 `RESUME_RESTORED` 前 append 一行 JSON 到 `.orbit/state/<task_id>/events.jsonl`（事件名 `RESUME_RESTORED`；`note` 记录实际 `restored_from`，如 `"handoff.json"` / `"runtime.json+verification.md"`）。事件流契约见 `state/README.md#事件流append-only`；resume 自身不消费 events.jsonl，写这一行只为保持时间线完整。

输出格式（含期望内容说明）：
1. `recovered_context`：恢复后的任务上下文摘要
2. `current_stage`：当前所处阶段
3. `restored_from`：按优先级列出实际使用的源
4. `active_blockers_or_risks`：当前阻塞项与风险
5. `next_action`：下一步唯一动作
6. `pending_actions`：待办动作列表
7. `todo_sync`：TodoWrite 重建说明
8. `artifact_written`：`null`（resume 不产生新工件，仅可能将 `handoff.json` 重命名为 `handoff.consumed.json`）
9. `next_event`：`RESUME_RESTORED`
10. `next_skill`：按上方路由规则选定的阶段 skill

## 原生工具集成

本 skill 在以下操作点必须使用 Claude Code 原生工具：

- **`Glob` / `Read`**：读取 `.orbit/state/<task_id>/` 下的工件文件和 `runtime.json`。`Glob` 匹配存在的工件文件清单，`Read` 读取具体内容。恢复不依赖历史对话，只依赖文件系统状态。
- **`AskUserQuestion`**：
  - 当存在多个候选任务（多个 `.orbit/state/*/` 目录）且不确定恢复哪个时，用 AskUserQuestion 让用户指定。
  - 当恢复后 `stage=handoff/paused`，next_action 需要用户确认方向时，用 AskUserQuestion 呈现选项。

关联约束：
- 恢复优先级固定为 `handoff.json > runtime.json > review.md > verification.md > execution.md > 其他 artifact > 历史描述`。Glob/Read 按该顺序读取。
- "当两者冲突，以 runtime.todo[] 为准" → Glob 读取 runtime.json 后直接重建 TodoWrite，不做额外推测。
11. `minimal_resume_brief`：供下一轮消费的最小恢复摘要
