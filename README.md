# Orbit

<p align="center">
  <img src="orbit-banner.svg" width="800" alt="Orbit Banner">
</p>

面向 Claude Code 的通用工作流插件。

`Orbit` 的目标不是提供一堆零散命令，而是为 Claude Code 提供一套**可重复、可恢复、可评估、可分层**的任务执行内核，让模型在复杂软件工程任务里更稳定地规划、实现、验证与交接。

## 为什么是 Orbit

在真实开发里，模型最容易出问题的地方，不是写一段代码，而是：

- 复杂任务做到一半后开始自我感觉良好，产生自评失真
- 上下文越来越长，噪声越来越多，后续质量越来越差
- 简单任务误入重流程，浪费 token 和时间
- 复杂任务缺少状态机保护，执行中途很容易跑偏
- 阶段产物和恢复载荷不统一，导致跨会话恢复与 handoff 很难稳定复用

`Orbit` 想解决的不是“如何让模型更会说”，而是“如何让模型更可靠地做完一项开发任务”。

## 核心理念

### 1. Evaluator 与 Executor 分离

复杂任务默认不允许执行者自己给自己判定“完成得很好”。

在 `Orbit` 中：

- `executor` 负责产出实现
- `evaluator` 负责独立判断完成度、质量与是否达标
- 若评估失败，默认仍由**首次执行者**继续修复

这样做的原因很简单：

- 执行者最了解当前改动上下文
- evaluator 负责客观闸门，而不是接管修复
- 减少“重新交接给陌生修复者”带来的上下文损耗

### 2. Handoff 与恢复载荷是一等公民

当任务进入阶段边界，或者子代理执行中断时，必须有 handoff。

这里需要区分两个概念：

- `handoff`：Orbit 产出的结构化恢复载荷，用于子代理或任务级执行在异常中断后继续
- 官方恢复命令：主会话恢复仍交给 Claude Code 官方机制，Orbit 不注册 `resume` skill，避免命名冲突

`handoff` 的职责不是写冗长会议纪要，而是只保留子代理恢复任务真正需要的信息：

- 当前焦点任务
- 当前状态
- 下一步唯一动作
- 已确认的关键决策
- 风险与待验证项

`Orbit` 的原则是：

- 恢复优先于重来
- 聚焦优先于堆上下文
- 最小高价值上下文优先于全量记录

### 3. 按思考密度分层，而不是按文件数分层

任务复杂度首先取决于**是否需要设计性思考**，而不是改几个文件。

#### Low

不需要设计，只是实现已知改动。

典型例子：

- 调整样式
- 修改 API 返回结构
- 补一个明确的小逻辑分支

#### Medium

需要思考和设计，但单轮内可以收敛边界。

典型例子：

- 一个模块内的新增功能
- 单模块重构
- 需要理解现有系统能力后再实现的任务

#### High

需求模糊、目标较大、背景不足，需要多轮澄清、方案比较，并且通常可以拆成多个 `medium` 任务。

典型例子：

- 大范围新能力设计
- 缺乏上下文支撑的架构性任务
- 需要先做多轮 design exploration 才能进入实现的任务

### 4. 状态机负责保障任务正确流转

`Orbit` 的任务执行不是“看感觉推进”，而是由状态机约束：

- 当前在哪个阶段
- 下一步允许做什么
- 什么条件下可以进入下一个阶段
- 失败后如何回退
- 暂停后如何恢复

同时，状态机只解决“阶段”，不解决“当前回合先做什么”。

因此 `Orbit` 在 v1 采用轻量双层模型：

- **状态机**：维护任务阶段
- **`todo + next_action`**：维护当前会话执行动作

`action_layer` 继续保留，但仅作为 high/planning 的扩展层，不作为 v1 最小内核前提。

当前仓库已补充最小可执行内核：

- 运行时最小状态 schema：`plugins/orbit/state/runtime-state-lite.schema.json`
- 运行时规则源：`plugins/orbit/state/rules.json`
- 统一工件槽位：`triage / scope / design / plan / execution / verification / review / handoff / task_packet`
- 约定式流程约束：通过 skill、提示词与阶段规则推进

核心硬规则：

- `density` 决定可进入阶段
- `VERIFY_FAIL` / `REVIEW_FAIL` 只能回到 `repairing`
- `repairing.current_owner` 必须等于 `first_executor`
- `paused` 与 handoff payload 必须携带 `next_action`
- 任意时刻只能有一个 `todo` 为 `in_progress`
- v1 默认以 `todo + next_action` 作为主动作模型
- `DESIGN_DONE` 前 `design.md` 必须含 `## User Approval` 锚点且 `approved_option` 非空
- `VERIFY_PASS` / `REVIEW_PASS` 前对应工件 md 必须含独立 evaluator 锚点且 `result=PASS`
- 连续 verify FAIL 达到 `consecutive_verify_fail_limit`（默认 3）必须进入 `paused`

## 初步工作流设计

### Low

```text
triaged -> executing -> completed
                \-> verifying_optional -> completed
```

适用于已知改动，默认直接实现；只有用户要求或存在真实交互风险时才进入可选验证。

### Medium

```text
triaged -> scoping -> executing -> verifying -> completed
```

先收敛边界，再进入实现，然后做 required 验证。

### High

```text
triaged -> designing -> planning -> executing -> verifying -> reviewing -> completed
```

先澄清需求和方案，再生成计划，再执行、验证、审查，最后完成。

## Orbit 从哪些项目吸收灵感

### 来自 Superpowers 的精髓

- 把工作流当作产品设计，而不是散乱 prompt
- evaluator 必须独立，避免实现者自评失真
- 失败后默认让首次执行者继续修复
- skill 决定流程阶段，agent 承担单次执行角色
- 子代理 handoff 与官方会话恢复机制必须有明确边界

### 来自 Get Shit Done 的精髓

- 用状态文件作为短期工作内存
- 用状态机守卫阶段推进
- 用 Todo / Task 列表维护当前动作序列
- 明确主会话恢复、子代理 handoff 与偏航处理机制
- 尽可能从工件与事实重建状态，而不是只依赖口头声明

## Orbit 要避免的问题

`Orbit` 不想继承以下缺点：

- 任何任务都强制进入重流程
- 子代理 handoff 只靠文档约定，没有结构化状态支撑
- 执行、评估、修复三者职责混乱
- 过多历史命名导致阶段概念重叠
- 没有 todo 层，导致状态机只描述阶段、不约束当前动

## 插件仓库落地方式

`Orbit` 现在被组织为一个 Claude Code 插件目录，核心实现位于 `plugins/orbit/`。

### 仓库结构

```text
Orbit/
├─ README.md
└─ plugins/
   └─ orbit/
      ├─ .claude-plugin/plugin.json
      ├─ skills/
      ├─ agents/
      └─ state/
```
其中：

- `plugins/orbit/.claude-plugin/plugin.json`：`orbit` 插件自己的清单
- `skills/`：提供流程入口，例如 triage、design、execute、verify
- `agents/`：提供 executor / evaluator 等单次执行角色
- `state/`：状态协议 schema 与样例

### 安装思路

当前仓库先收录一个插件：

- `orbit`：任务执行工作流内核插件

插件主体位于 `plugins/orbit/`。当前实现采用轻量状态协议、声明式 gate、skill 约束与本地校验脚本共同保证流程一致性。

## 当前骨架映射

初版骨架采用以下映射方式：

- `pilot`：统一入口，负责 low / medium / high 路由
- `scoping`：medium 任务的 scoping 阶段
- `design`：high 任务的 designing 阶段
- `planning`：high 任务的 planning 阶段
- `execute`：执行阶段入口
- `verify`：验证阶段入口
- `reviewing`：high 任务的 reviewing 阶段
- `handoff`：子代理或任务级执行的恢复交接入口
- `executor`：单次任务执行者
- `evaluator`：独立评估者

当前实现已覆盖 low / medium / high 的主要阶段、handoff 恢复载荷，以及最小状态机守卫能力。

同时，v1 额外引入：
- `runtime-state-lite.schema.json` 作为最小运行时状态协议
- `rules.json` 作为最小 gate 与阶段转换规则集
- 面向最小运行时的正反样例，用于表达恢复、修复与非法状态

## 当前已落地的运行时能力

### 1. 评估者客观评价，首次执行者负责修复

- `evaluator` 只负责 PASS / FAIL 与 repair direction
- FAIL 必须进入 `repairing`
- `repairing` 的执行者必须是 `first_executor`

### 2. 阶段性 handoff / 恢复

- `handoff` 产出结构化恢复载荷
- 后续会话按工件优先级恢复上下文，优先读取 `handoff.json`
- `next_action` 是恢复的强制字段

### 3. low / medium / high 差异化工作流

- `low`：最短闭环
- `medium`：增加 scoping
- `high`：增加 designing / planning / reviewing

### 4. 状态机 + Todo 双层约束

- 状态机约束阶段与事件
- `todo` 约束当前动作序列
- 通过提示词约定、skill 约束与人工抽查维持合法状态

## 一句话总结

`Orbit` 不是一个“更多命令”的插件，而是一个让 Claude Code 围绕任务稳定运转的工作流内核。
