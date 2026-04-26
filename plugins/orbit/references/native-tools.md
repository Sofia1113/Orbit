# Orbit 原生工具集成指南

Claude Code 提供的原生工具通常更高效、交互更顺滑。Orbit 的任何阶段都应**优先使用官方工具**，而不是自己实现等价逻辑或手动搜索。

## 总原则

1. **原生工具优先于主观猜测**：对代码、调用关系、改动范围不确定时先用工具取事实，再做判断
2. **AskUserQuestion 是兜底，不是默认路径**：先用 Explore / Glob / Grep / LSP 取上下文，仍模糊再问用户
3. **dispatch subagent 时由 controller 完整注入 task_packet + scene**：禁止让 subagent 读 plan / design / scope 文件
4. **任务清单只有一个入口**：`TaskCreate` / `TaskUpdate` / `TaskList`，与 `runtime.todo[]` 双向同步

## 工具一览

| 工具 | 何时用 | 不用的场景 |
|---|---|---|
| `Explore` agent | 不熟悉的代码区域、需要理解模块布局或数据流；任务跨多个未知文件 | 已知具体路径或 ≤3 个文件的明确改动 |
| `Plan` agent | 方案权衡（design）、≥5 步骤或子任务边界不清的拆解（planning） | 单文件、无设计分歧的任务 |
| `Glob` | 按文件名 / 扩展名 pattern 定位 | 内容搜索（用 Grep） |
| `Grep` | 在代码内容中搜关键词、正则、跨文件模式 | 模糊或开放式搜索（用 Explore） |
| `Read` | 读取已知路径的具体文件 | 大范围扫描（用 Explore） |
| `Bash` | 跑测试、lint、编译、启动本地预览或浏览器辅助命令 | 替代 Glob/Grep/Read（请用专用工具） |
| `LSP` | goToDefinition / findReferences / hover / documentSymbol / incomingCalls / outgoingCalls；确认改动位置、评估波及面、追踪调用链 | 只看文件内容（用 Read） |
| `AskUserQuestion` | 边界经过 Explore 后仍模糊；候选方案需用户批准；evaluator 返回 INCOMPLETE 时请求证据 | 自己能用工具取事实的场景 |
| `TaskCreate` / `TaskUpdate` / `TaskList` | 阶段进入项、状态切换、清单查询 | 任务清单的唯一入口 |
| `Agent` tool | dispatch executor / evaluator subagent | 自身能直接完成的任务 |

## 阶段—工具映射

| 阶段 | 高价值工具 |
|---|---|
| pilot triage | `Explore`（不熟悉代码时）+ `AskUserQuestion`（仍模糊时） |
| scoping | `Explore`（边界探查）+ `AskUserQuestion`（必要时圈定） |
| design | `Explore`（架构事实）+ `Plan`（独立架构推演）+ `AskUserQuestion(preview)`（方案批准） |
| planning | `Explore` + `Plan`（≥5 步骤或子任务边界不清时）+ `LSP` |
| execute | `LSP`（关键）+ `Glob` / `Grep` + `Explore`（宏观） |
| verify | `Bash`（跑测试 / lint / 编译 / 本地预览）+ `Read` + `Grep` |
| reviewing | `Grep`（搜代码模式）+ `LSP`（依赖方向）+ `Bash` |
| handoff | `AskUserQuestion`（向用户呈现可选方向） |

各阶段均使用 `TaskCreate` / `TaskUpdate` / `TaskList` 维护任务清单，使用 `Agent` tool dispatch subagent。

## Subagent dispatch 纪律

dispatch executor / evaluator subagent 时：

- **完整注入 task_packet + scene**：禁止 subagent 读 plan / design / scope 文件
- **subagent 必须返回 `handoff_payload`**：哪怕失败状态也必须可恢复
- **evaluator 不接管修复**：FAIL 时 `next_stage` 固定为 `repairing`，owner 等于 `first_executor`
- **executor 四态严格区分**：`DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED`；`NEEDS_CONTEXT` 不允许同 prompt 重试；`BLOCKED` 必须附 `blocker_root_cause`

## AskUserQuestion 使用细节

- **design 阶段方案选择**：必须使用 preview 模式，每个 option 的 preview 写关键代码 / API 骨架，便于侧边栏对比
- **触发 streak 上限时**：用 AskUserQuestion 让用户在"升级 density / 重设方案 / 取消任务"中选择
- **evaluator 返回 INCOMPLETE 时**：用 AskUserQuestion 请求补充证据，不要自行翻转结论
