# Orbit 原生工具集成指南

Claude Code 提供的原生工具通常更高效、交互更顺滑。Orbit 的任何阶段都应**优先使用官方工具**，而不是自己实现等价逻辑或手动搜索。

## 总原则

1. **原生工具优先于主观猜测**：对代码、调用关系、改动范围不确定时先用工具取事实，再做判断
2. **AskUserQuestion 通常是兜底，brainstormer/design gates 例外**：代码事实先用 Explore / Glob / Grep / LSP 获取；medium/high 的 brainstormer、high 的 design approval、失败超限与 INCOMPLETE 必须向用户确认
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
| `AskUserQuestion` | medium/high brainstormer 交互；候选方案需用户批准；边界经过 Explore 后仍模糊；evaluator 返回 INCOMPLETE 时请求证据 | 自己能用工具取事实且不属于用户决策 gate 的场景 |
| `TaskCreate` / `TaskUpdate` / `TaskList` | 阶段进入项、状态切换、清单查询 | 任务清单的唯一入口 |
| `Agent` tool | dispatch executor / evaluator subagent | 自身能直接完成的任务 |

## 阶段—工具映射

| 阶段 | 高价值工具 |
|---|---|
| pilot triage | `Explore`（不熟悉代码时）+ `AskUserQuestion`（仍模糊时） |
| scoping | `Explore`（边界探查）+ `AskUserQuestion`（brainstormer 必须确认边界/验收） |
| design | `Explore`（架构事实）+ `AskUserQuestion`（brainstormer 五阶段确认）+ `Plan`（独立架构推演）+ `AskUserQuestion(preview)`（方案批准） |
| planning | `Explore` + `Plan`（≥5 步骤或子任务边界不清时）+ `LSP` |
| execute | `LSP`（关键）+ `Glob` / `Grep` + `Explore`（宏观） |
| verify | `Bash`（跑测试 / lint / 编译 / 本地预览）+ `Read` + `Grep` |
| reviewing | `Grep`（搜代码模式）+ `LSP`（依赖方向）+ `Bash` |
| handoff | `AskUserQuestion`（向用户呈现可选方向） |

各阶段均使用 `TaskCreate` / `TaskUpdate` / `TaskList` 维护任务清单，使用 `Agent` tool dispatch subagent。

## Subagent dispatch 纪律

dispatch executor / evaluator subagent 时：

- **完整注入 task_packet + scene**：禁止 subagent 读 plan / design / scope 文件
- **状态根目录必须注入且固定**：controller dispatch 时必须在 prompt/scene 中明确 `state_root` 为 `/orbit:pilot` 启动仓库根目录的 `.orbit/state/<task_id>/`。即使 `files_in_scope` 是子目录，subagent 也禁止在该子目录中创建 `.orbit/`。
- **subagent 不直接写 Orbit 状态**：architect / evaluator / reviewer 默认只返回结构化内容给 controller；需要写 `design.md`、`verification.md`、`review.md` 或 runtime 时由 controller 写入根 `.orbit/state/<task_id>/`。executor 只在 controller 明确授权的实现文件范围内改代码。
- **subagent 必须返回 `handoff_payload`**：哪怕失败状态也必须可恢复
- **evaluator 不接管修复**：FAIL 时 `next_stage` 固定为 `repairing`，owner 等于 `first_executor`
- **executor 四态严格区分**：`DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED`；`NEEDS_CONTEXT` 不允许同 prompt 重试；`BLOCKED` 必须附 `blocker_root_cause`

## AskUserQuestion 使用细节

- **schema 必填项**：每次调用都必须为每个问题对象提供 `header`、`question`、`options`。`header` 必须是简短标题（建议 ≤12 个汉字/字符），用于客户端渲染问题卡片；禁止只提供 `question` 和 `options`。
- **多问题调用强制检查**：调用前逐项检查 `questions[0]`、`questions[1]`、`questions[2]` 等所有元素；任何一个问题缺少 `header` 都会导致工具调用失败。不能只给第一个问题写 `header`。
- **选项结构**：每个 `options[]` 必须包含清晰的 `label` 与 `description`，且 label 应可直接表达用户要选择的决策。
- **最小合法模板**：

```json
{
  "questions": [
    {
      "header": "边界确认",
      "question": "请确认本阶段 in_scope / out_of_scope 是否正确。",
      "options": [
        { "label": "正确，继续", "description": "边界无需调整" },
        { "label": "需要调整", "description": "补充或修改边界" }
      ]
    },
    {
      "header": "验收确认",
      "question": "请确认验收标准是否完整。",
      "options": [
        { "label": "完整，继续", "description": "验收标准无需调整" },
        { "label": "需要调整", "description": "补充或修改验收标准" }
      ]
    }
  ]
}
```

- **brainstormer 阶段**：medium/high 必须使用；信息充分时也要做单轮确认式头脑风暴，不能以"信息足够"跳过
- **design 阶段方案选择**：必须使用 preview 模式，但 schema 仍然必须是顶层 `questions: [...]`。`preview` 只能写在某个 `options[]` 条目上作为附加展示信息，不能放在顶层，也不能用 `preview` 替代 `questions`。
- **design preview 合法模板**：

```json
{
  "questions": [
    {
      "header": "方案批准",
      "question": "请选择要进入 planning 的设计方案。",
      "options": [
        {
          "label": "方案二：FMA（推荐）",
          "description": "选择推荐方案并继续拆分 medium 子任务",
          "preview": "关键 API / 文件结构 / 风险摘要"
        },
        {
          "label": "方案一：DDSA",
          "description": "选择替代方案并继续拆分 medium 子任务",
          "preview": "关键 API / 文件结构 / 风险摘要"
        }
      ]
    }
  ]
}
```
- **触发 streak 上限时**：用 AskUserQuestion 让用户在"升级 density / 重设方案 / 取消任务"中选择
- **evaluator 返回 INCOMPLETE 时**：用 AskUserQuestion 请求补充证据，不要自行翻转结论
