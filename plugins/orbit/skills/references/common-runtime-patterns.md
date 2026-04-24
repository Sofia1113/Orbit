# 公共运行时模式

所有 skill 共享的持久化与 TodoWrite 规则。各 SKILL.md 引用本文件，仅描述本阶段独有的差异。

## 状态持久化

每个 skill 结束时必须：

1. 将阶段工件写入 `.orbit/state/<task_id>/<artifact>.md`
2. 回写 `.orbit/state/<task_id>/runtime.json`，更新以下字段：
   - `stage`：当前阶段 → 目标阶段
   - `last_event`：本阶段产出的结束事件
   - `next_action`：指向下一个 skill 的唯一动作
   - `artifacts.<slot>`：工件路径
3. 未使用的 artifacts 槽位保持 `null`

全量字段定义见 `state/runtime-state-lite.schema.json`。

## TodoWrite 绑定

**双层模型**：
- **持久 SSOT** = `runtime.todo[]`（跨会话存活）
- **会话投影** = TodoWrite（仅当前会话可见）

**规则**：
1. 进入任意 stage 第一步调用 TodoWrite，结果回写到 `runtime.todo[]`
2. 状态变化先改 TodoWrite，再同步 `runtime.todo[]`；不允许只改其一
3. 任意时刻只能有一个 `in_progress`
4. 完成一项立刻 `done`；evaluator FAIL 时 `repair_actions` 逐条追加为新 todo
5. 后续会话恢复时由 `runtime.todo[]` 反向重建 TodoWrite；冲突以 `runtime.todo[]` 为准
6. 阶段切换前所有实现类 todo 必须 `done`，未完成项挂到下一阶段或 handoff

## 原生工具集成

各 skill 按需使用以下 Claude Code 原生工具：

- **`Explore` agent**：宏观理解代码模块交互，全局扫描代替逐文件阅读
- **`Glob` / `Grep`**：定位目标文件、搜索关键模式
- **`Read`**：读取文件当前内容
- **`Bash`**：运行测试、lint、编译验证
- **`LSP`**：代码智能（goToDefinition / findReferences / hover / documentSymbol / incomingCalls / outgoingCalls）
- **`AskUserQuestion`**：边界模糊、需要用户确认方向时使用
- **Agent tool**：dispatch 独立 evaluator / executor subagent

**原则**：
- Explore / LSP 优先于主观猜测和手动搜索
- AskUserQuestion 是兜底，不是默认路径
- dispatch subagent 时必须完整注入 task_packet + scene，禁止让 subagent 读文件
