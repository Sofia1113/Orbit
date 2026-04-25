---
name: pilot
description: Orbit 工作流统一入口。任何工程任务（实现/修复/重构/feature/优化）请求都先调用本 skill：判断密度（low/medium/high），初始化 .orbit 任务目录，路由到 execute / scoping / design。
---

pilot 解决"任务该走多重的流程"这一个问题。它是密度判定与路由器，不做实现也不做设计。

## triage 双层判断

**先用启发式快速分流，仅当启发式落入模糊区时再调用客观锚点。** 这样避免 pilot 为取量化证据反复 Explore 浪费 token。

### 第一层：思考密度启发式（默认路径）

按顺序提问，首个 Yes 即为最终 density；全部 No → low。

**Q1（思考密度）**：本任务是否需要在多种实现方案之间做权衡，或需要架构性设计判断？

- 信号："有几种做法" / "怎么设计" / "架构应该怎么拆"，跨模块协议、选型分歧、新模块引入
- → Yes = **high**，路由到 `design`

**Q2（边界密度）**：本任务的改动范围是否需要先收敛边界、明确"做什么 / 不做什么"才能开始编码？

- 信号：目标区域未知、需先理解现有系统能力才能定范围、改动可能跨越多个未知文件
- → Yes = **medium**，路由到 `scoping`

**Q3（实现密度）**：本任务是否目标明确、单轮可完成、无设计分歧？

- 信号："把 X 改成 Y" / "加一个 Z 参数" / "修这个拼写错误"；单文件 / 已知路径 / 一句话描述完
- → Yes = **low**，路由到 `execute`

启发式信号清晰时直接出 `decision_path` 与 `density`，不必进入第二层。

### 第二层：客观锚点（仅当第一层模糊时调用）

进入条件：

1. Q1 / Q2 / Q3 都"半信半疑"，信号弱
2. 用户描述与代码事实可能冲突（用户说"很简单"但任务可能跨多模块）

进入前**先调用 `Explore` agent** 取事实，再对照锚点判断：

**Q1 锚点（任一满足即判 high）**：

- 涉及 ≥2 个模块的接口 / 协议变更
- 存在 ≥2 种可互相替代的实现路径且无法立即排除
- 改动会影响其他团队 / 系统的数据契约

**Q2 锚点（满足第 1 条，或第 2/3 条同时出现时判 medium）**：

- 涉及 ≥3 个需要修改的文件且边界未划定
- 目标代码区域无现有测试覆盖且上次修改 >30 天
- 用户描述缺具体文件路径或接口名称，且 Explore 后仍无法定位明确改动点

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

## 路由

| density | 进入阶段 | 调用 skill |
|---|---|---|
| low | executing | execute |
| medium | scoping | scoping |
| high | designing | design |

## task_id 命名

- 路径安全：仅含小写字母、数字、连字符（如 `rename-login-field`）
- 与可读 `title` 共存（如 "将登录响应字段从 token 改为 access_token"）
- 子任务由 planning 生成，格式 `<parent_task_id>.<n>`

## 输出

| 字段 | 说明 |
|---|---|
| `task_id` | 路径安全标识符 |
| `title` | 可读任务描述 |
| `density` | `low` / `medium` / `high` |
| `current_stage` | 固定为 `triaged` |
| `triage_result` | `decision_path` (Q1/Q2/Q3) + `density` + `rationale` + `hard_rules_triggered` |
| `allowed_next_stage` | `executing` / `scoping` / `designing` |
| `next_skill` | `execute` / `scoping` / `design` |
| `required_artifacts` | 本次写入的工件路径列表 |
| `next_action` | 下一步唯一动作 |
| `next_event` | `TRIAGE_DONE` |

## 工件与状态

- 写入工件：`triage` → `.orbit/state/<task_id>/triage.md`
- 首次创建 `.orbit/` 目录时同时写入 `.orbit/.gitignore`（内容 `*`）
- 其他持久化、任务清单、通用退出自检见 [state-protocol.md](../references/state-protocol.md)

## 优先工具

`Explore`（不熟悉代码区域时优先于猜测）/ `Glob` / `Grep` / `AskUserQuestion`（兜底）。详见 [native-tools.md](../references/native-tools.md)。

## 本阶段特有退出条件

- [ ] `task_id` 与 `title` 已确定（必要时通过 `AskUserQuestion` 确认）
- [ ] `.orbit/.gitignore` 首次已写入
- [ ] `triage_result.decision_path` 与 `density` 一致
- [ ] `next_skill` 与 density 路由一致
