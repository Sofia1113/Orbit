---
name: pilot
description: Orbit 工作流统一入口。用户请求任何工程任务（实现/修复/重构/feature/优化）时必须首先调用本 skill：判断密度（low/medium/high），初始化任务状态目录，路由到 execute / scoping / design。
---

目标：
- 判断用户请求属于 low、medium 还是 high
- 使用决策树生成客观 `triage_result`
- 选择最小足够流程，避免简单任务误入重流程
- 初始化任务状态并写入持久化目录，为后续 skill 提供唯一的状态来源

## triage 双层判断

判定流程分两层：**先用启发式快速分流，仅当启发式落入模糊区时再调用客观锚点**。这样避免 pilot 阶段为了取量化证据反复 Explore，浪费 token。

### 第一层：思考密度启发式（默认路径）

按以下顺序提问，首个 Yes 即为最终 density。若全部 No → low。

**Q1（思考密度）**：本任务是否需要在多种实现方案之间做权衡，或需要架构性设计判断？
- 典型信号：用户说"有几种做法""怎么设计""架构应该怎么拆"，涉及跨模块协议、选型分歧、新模块引入
- → Yes = **high**，直接路由到 `design`

**Q2（边界密度）**：本任务的改动范围是否需要先收敛边界、明确"做什么 / 不做什么"才能开始编码？
- 典型信号：目标区域未知、需要先理解现有系统能力才能定范围、改动可能跨越多个未知文件
- → Yes = **medium**，路由到 `scoping`

**Q3（实现密度）**：本任务是否目标明确、单轮可完成、无设计分歧？
- 典型信号："把 X 改成 Y""加一个 Z 参数""修这个拼写错误"、单文件 / 已知路径 / 一句话描述完
- → Yes = **low**，直接路由到 `execute`

启发式可稳定判断时（任一 Q 信号清晰）→ 不必进入第二层，直接出 `decision_path` 与 `density`。

### 第二层：客观锚点（仅当第一层模糊时调用）

仅在以下两种情况下进入第二层：
1. 第一层 Q1/Q2/Q3 都"半信半疑"（信号弱，缺少决定性词汇）
2. 用户描述与代码事实可能冲突（用户说"很简单"但任务可能跨多模块）

进入第二层前**先调用 Explore agent** 取事实，再对照锚点判断：

**Q1 锚点（任一满足即判 high）**：
- 涉及 ≥2 个模块的接口 / 协议变更
- 存在 ≥2 种可互相替代的实现路径且无法立即排除
- 改动会影响其他团队 / 系统的数据契约

**Q2 锚点（满足第 1 条，或第 2/3 条同时出现时判 medium）**：
- 涉及 ≥3 个需要修改的文件且边界未划定
- 目标代码区域无现有测试覆盖且上次修改 >30 天
- 用户描述缺少具体文件路径或接口名称，且 Explore 后仍无法定位明确改动点

**Q3 锚点（必须全部满足才判 low）**：
- 涉及文件数 ≤3 且已知路径
- 改动逻辑可用一句话完整描述
- 不涉及新增模块 / 抽象 / 接口

### 硬规则（优先于两层判断）

- 需要 review gate 或多阶段恢复 → 至少 `high`
- 需求模糊且需要方案比较 → `high`
- 需要先收敛边界 → 至少 `medium`

### 仍模糊时

第二层锚点检查后仍无法稳定判断 → 用 `AskUserQuestion` 请用户确认 density，并把答案写入 `triage_result.rationale`。

路由规则（判定后立即触发）：
- low → 直接调用 `execute` skill，进入 `executing`
- medium → 调用 `scoping` skill，进入 `scoping`
- high → 调用 `design` skill，进入 `designing`

task_id 命名规则：
- 用途：作为文件路径的组成部分（`.orbit/state/<task_id>/`），必须路径安全
- 格式：只含小写字母、数字、连字符，如 `rename-login-field`、`add-auth-middleware`
- 子任务由 planning 生成，格式为 `<parent_task_id>.<n>`，如 `add-auth-middleware.1`
- `title` 字段是可读描述（如"将登录响应字段从 token 改为 access_token"），与 `task_id` 共存

状态持久化（SSOT）：
- pilot 在 `TRIAGE_DONE` 时必须创建 `.orbit/state/<task_id>/` 并写入：
  - `runtime.json`（见下方模板）
  - `triage.md`（triage 工件摘要）
- **首次创建 `.orbit/` 根目录时必须同时写入 `.orbit/.gitignore`，内容为单行 `*`**（意图：任务状态默认不入库；如用户希望入库，由用户自己调整或删除该文件）
- 后续每个 skill 结束时都必须回写 `runtime.json` 并更新对应工件文件
- 后续会话恢复时以该目录为准（优先读取 handoff.json，再读取 runtime.json 与最近工件）
- 持久化、任务清单（TaskCreate/TaskUpdate/TaskList）绑定与 `first_executor` 跨会话恢复语义见 `references/common-runtime-patterns.md`

`runtime.json` 写入模板（`TRIAGE_DONE` 时填充）：
```json
{
  "task_id": "rename-login-field",
  "title": "将登录响应字段从 token 改为 access_token",
  "density": "low",
  "stage": "triaged",
  "status": "active",
  "goal": "一句话描述任务目标",
  "first_executor": "primary-session",
  "current_owner": "primary-session",
  "next_action": "调用 execute skill 开始实现",
  "last_event": "TRIAGE_DONE",
  "verification_level": "optional",
  "repair_direction": null,
  "artifacts": {
    "triage": ".orbit/state/rename-login-field/triage.md",
    "scope": null, "design": null, "plan": null,
    "execution": null, "verification": null,
    "review": null, "handoff": null, "task_packet": null
  },
  "todo": [],
  "triage_result": {
    "decision_path": "Q3",
    "density": "low",
    "rationale": "目标明确、单文件改动、无设计分歧",
    "hard_rules_triggered": []
  }
}
```
未使用的 artifacts 槽位置 `null`，由后续 skill 按需填充。全量字段定义见 `state/runtime-state-lite.schema.json`。

`first_executor` 必须填入约定 sentinel `"primary-session"`（不是会话 ID、不是时间戳、不是 PID），跨会话恢复时新主会话默认承接此身份；详见 `references/common-runtime-patterns.md`。

输出格式（含期望内容说明）：
1. `task_id`：路径安全标识符
2. `title`：可读任务描述
3. `density`：`low` / `medium` / `high`
4. `current_stage`：固定为 `triaged`
5. `triage_result`：`decision_path`（Q1/Q2/Q3）、`density`、`rationale`、`hard_rules_triggered`
6. `allowed_next_stage`：`low → executing`；`medium → scoping`；`high → designing`
7. `next_skill`：`low → execute`；`medium → scoping`；`high → design`
8. `required_artifacts`：本次 triage 写入的工件路径列表
9. `next_action`：下一步唯一动作
10. `why`：一句话说明为何这样路由
11. `next_event`：`TRIAGE_DONE`

## 原生工具集成

本 skill 在以下操作点必须使用 Claude Code 原生工具：

- **`Explore` agent**：在 triage 决策前，若任务上下文涉及不熟悉的代码区域，先用 Explore agent 快速理解仓库结构（文件布局、关键模块、数据流）。尤其当 Q1/Q2 难以判断时。
- **`Glob` / `Grep`**：快速定位目标文件或搜索关键模式，配合 Explore 使用。
- **`AskUserQuestion`**：
  - 决策树 Q1/Q2 经 Explore 后仍无法稳定判断时，用 AskUserQuestion 让用户确认 density。
  - 在写入 runtime.json 前，若 `task_id` 或 `title` 需要用户确认，也用 AskUserQuestion 确认。

关联约束：
- `Explore` agent 应优先于主观猜测：当对代码范围不确定时，先用 Explore 获取事实，再基于事实判断。
- `AskUserQuestion` 是"无法稳定判断"的兜底，不是默认路径——先 Explore 补齐上下文，仍模糊再用 AskUserQuestion。

### 退出前自检（缺一不可声明 TRIAGE_DONE）
- [ ] task_id 与 title 已确定并通过 AskUserQuestion 确认（必要时）
- [ ] `.orbit/state/<task_id>/` 目录已创建
- [ ] `.orbit/.gitignore` 首次已写入（内容 `*`）
- [ ] `runtime.json` 已写入且字段完整（stage=triaged, status=active, triage_result 非空）
- [ ] `first_executor == "primary-session"` 且 `current_owner == "primary-session"`
- [ ] `triage.md` 已落盘
- [ ] `next_action` 指向对应 density 的入口 skill
- [ ] 调用 `node plugins/orbit/scripts/validate-orbit-state.mjs --runtime .orbit/state/<task_id>/runtime.json` 通过
