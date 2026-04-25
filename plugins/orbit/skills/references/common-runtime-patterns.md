# 公共运行时模式

所有 skill 共享的持久化、任务清单与会话恢复规则。各 SKILL.md 引用本文件，仅描述本阶段独有的差异。

## 命名映射：任务清单 = Claude Code 原生 task 工具

Orbit 在 SKILL/agent 文本中使用以下原生工具完成会话级任务清单管理：

| 用途 | Claude Code 原生工具 |
|---|---|
| 创建任务条目 | `TaskCreate` |
| 更新任务状态（pending / in_progress / done） | `TaskUpdate` |
| 查询当前任务列表 | `TaskList` |

历史 superpowers 风格中的 "TodoWrite" 概念在 Orbit 中即指上述三件套。`runtime.todo[]` 是该清单的持久化投影（schema 字段名保留不变）。

## 状态持久化

每个 skill 结束时必须：

1. 将阶段工件写入 `.orbit/state/<task_id>/<artifact>.md`
2. 回写 `.orbit/state/<task_id>/runtime.json`，更新以下字段：
   - `stage`：当前阶段 → 目标阶段
   - `last_event`：本阶段产出的结束事件
   - `next_action`：指向下一个 skill 的唯一动作
   - `artifacts.<slot>`：工件路径
3. 未使用的 artifacts 槽位保持 `null`
4. 调用 `node plugins/orbit/scripts/validate-orbit-state.mjs --runtime .orbit/state/<task_id>/runtime.json` 校验通过

全量字段定义见 `state/runtime-state-lite.schema.json`。

## 任务清单绑定（TaskCreate / TaskUpdate / TaskList）

**双层模型**：
- **持久 SSOT** = `runtime.todo[]`（跨会话存活）
- **会话投影** = 原生 task 工具维护的任务列表（仅当前会话可见）

**规则**：
1. 进入任意 stage 第一步调用 `TaskCreate` 创建本阶段所有 todo，结果回写到 `runtime.todo[]`
2. 状态变化先 `TaskUpdate` 改会话投影，再同步 `runtime.todo[]`；不允许只改其一
3. 任意时刻只能有一个 `in_progress`
4. 完成一项立刻 `TaskUpdate` 置 `done`；evaluator FAIL 时 `repair_actions` 逐条 `TaskCreate` 追加为新 todo
5. 后续会话恢复时，由 `runtime.todo[]` 反向重建会话任务列表（用 `TaskCreate` 重建未完成项）；冲突以 `runtime.todo[]` 为准
6. 阶段切换前所有实现类 todo 必须 `done`，未完成项挂到下一阶段或 handoff

## first_executor 与跨会话恢复

`first_executor` 不是会话 ID，而是**任务的逻辑首席执行者角色**——用于守护"FAIL 后修复必须由首次执行者承担"这条硬规则。

**身份约定**：
- pilot 创建 runtime 时，`first_executor` 默认填入约定 sentinel `"primary-session"`，代表"承接本任务主会话角色的当前会话本身"
- 子代理（executor / evaluator subagent）dispatch 不会改变 `first_executor`
- handoff 也**不**改变 `first_executor`，只改变 `current_owner` 与 `next_action`

**跨会话恢复语义**：
- 新会话恢复同一任务时，**默认承接 `first_executor="primary-session"` 的角色**——也就是说，新主会话即被视为 first_executor 的延续，可以在 `repairing` 阶段合法地承担修复
- 这一约定保证 `repairing.current_owner == first_executor` 的硬规则在跨会话场景仍然成立
- 仅当用户显式声明"换主"（例如把任务移交给另一个会话/团队成员）时，才更新 `first_executor`，并在 `triage_result.hard_rules_triggered` 或 `repair_direction` 中记录原因

**禁止**：
- 不得把当前会话的 transient ID（如时间戳、PID）写入 `first_executor`，否则下次恢复必失配
- 不得在 dispatch subagent 时把 subagent handle 写为 `first_executor`——subagent 是临时执行体，不是任务首席

## 原生工具集成

各 skill 按需使用以下 Claude Code 原生工具：

- **`Explore` agent**：宏观理解代码模块交互，全局扫描代替逐文件阅读
- **`Plan` agent**：方案权衡或步骤拆解需要独立架构推演时 dispatch（design / planning 高价值入口）
- **`Glob` / `Grep`**：定位目标文件、搜索关键模式
- **`Read`**：读取文件当前内容
- **`Bash`**：运行测试、lint、编译验证、调用 `validate-orbit-state.mjs`
- **`LSP`**：代码智能（goToDefinition / findReferences / hover / documentSymbol / incomingCalls / outgoingCalls）
- **`AskUserQuestion`**：边界模糊、需要用户确认方向时使用（design 必须以 preview 模式呈现候选方案）
- **`TaskCreate` / `TaskUpdate` / `TaskList`**：会话级任务清单的唯一入口，与 `runtime.todo[]` 双向同步
- **Agent tool**：dispatch 独立 evaluator / executor subagent

**原则**：
- Explore / LSP / Plan agent 优先于主观猜测和手动搜索
- AskUserQuestion 是兜底，不是默认路径
- dispatch subagent 时必须完整注入 task_packet + scene，禁止让 subagent 读文件
