# Orbit 插件质量评估与优化报告

**评估日期**：2026年4月26日  
**评估方**：Agent 工作流专家视角  
**版本**：0.3.0（重构中：single entry point 设计）

---

## 执行摘要

Orbit 是一个**架构清晰、原则明确的工作流内核**，但当前处于"设计 ✓ + 骨架 ✓ + 完整实现 ⚠️"的阶段。

### 核心评分

| 维度 | 评分 | 说明 |
|------|------|------|
| **架构设计** | ⭐⭐⭐⭐⭐ | single entry point + 三层密度路由 + 文件化 SSOT 极其清晰 |
| **状态机设计** | ⭐⭐⭐⭐ | 事件驱动、rules.json 权威性强，但实现复杂度高 |
| **协议设计** | ⭐⭐⭐⭐⭐ | schema + handoff + task_packet 契约明确，工件槽位设计优秀 |
| **实现完整性** | ⭐⭐⭐ | 验证脚本通过，但 pilot 命令的算法细节待深化 |
| **用户体验** | ⭐⭐ | 需要优化密度判定的交互，降低 AskUserQuestion 频率 |
| **可维护性** | ⭐⭐⭐⭐ | 规则文件化极佳，但决策点过多导致脚本逻辑可能复杂 |
| **生产就绪度** | ⭐⭐ | 流程设计完整但需实现验证、性能测试、边界案例覆盖 |

---

## 强项分析

### 1️⃣ 设计理念清晰度 ⭐⭐⭐⭐⭐

**亮点**：
- **Single Entry Point 原则**：`/orbit:pilot` 是唯一外部命令，彻底规避了"skill 爆炸"和"命名冲突"
- **三层密度路由**：low/medium/high 的密度判定框架科学，覆盖了从微改到架构设计的全谱
- **显式的 `first_executor` 语义**：解决了跨会话修复的所有权问题，避免了"换人修复"的混乱

**证据**：
- pilot.md 中的双层判断逻辑清晰：启发式快速分流 + 锚点客观验证
- rules.json 中的硬规则明确，几乎所有状态转移都有对应的事件定义

---

### 2️⃣ 状态机与规则文件化 ⭐⭐⭐⭐⭐

**亮点**：
- **JSON 作为权威源**：`rules.json` 中的 `density_stage_paths`、`event_stage_transitions`、`gates` 三大部分形成完整的规则库
- **gates 三层闸门**：`preflight / revision / escalation` 分离了前置条件、修复约束、风险升级，逻辑分层合理
- **验证脚本**：`validate-orbit-state.mjs` 自动检查 schema / rules / examples 的一致性，防止文档漂移

**问题**：
- `rules.json` 达 **182 行**，复杂度高，阅读成本大
- 规则的触发条件有些冗长（如 `escalation.rules[2-3]`），可合并或提取为函数式 validator

---

### 3️⃣ 工件与恢复协议 ⭐⭐⭐⭐⭐

**亮点**：
- **九槽位工件模型**：`triage / scope / design / plan / task_packet / execution / verification / review / handoff`，覆盖完整生命周期
- **handoff 与 task_packet schema**：7 个必填字段的 handoff 设计足以支撑跨会话无损恢复
- **recovery_priority 清晰**：`handoff.json → runtime.json → 最近工件 → 原始描述`，优先级明确

**设计亮点**：
- `task_packet.schema.json` 作为 executor/evaluator 的输入契约，完全隔离了"任务信息"与"工件文件"
- `.orbit/.gitignore` 默认不入库状态目录，用户可自主决策

---

### 4️⃣ Executor/Evaluator 分离 ⭐⭐⭐⭐

**亮点**：
- **明确的角色定义**：
  - `executor.md`：专注实现，四态返回（DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED）
  - `evaluator.md`：独立验收，三态结论（PASS / FAIL / INCOMPLETE）
  - `spec-compliance-evaluator.md` + `code-quality-evaluator.md`：两阶段审查隔离
  
- **防护机制强**：
  - FAIL 固定回 `repairing`，修复必须由 `first_executor` 承担
  - evaluator "不接管修复" 的原则明确，避免了权力混淆

---

## 问题诊断

### ⚠️ 关键问题

#### 1. Pilot 命令的算法复杂性与交互频率

**问题**：
- 双层判定逻辑（启发式 + 锚点）设计清晰，但**实现细节在 pilot.md 中以文本形式呈现**
- triage 过程中 `AskUserQuestion` 的触发条件模糊（"信号弱" / "半信半疑"）
- 实际用户体验未知：是否真能在启发式阶段快速判定，还是频繁进入第二层？

**影响**：
- 用户可能频繁被打断做决策（Q1/Q2/Q3 判定 + 二层锚点 + 弱信号补救）
- "避免 pilot 浪费 token" 的目标可能反而成为痛点

**建议**：
```
优先级：P0

方案 A（推荐）：参数化 triage 逻辑
  - 把启发式规则参数化为代码/配置（不是文本指令）
  - 预定义信号的权重或计分规则，减少模棱两可的判定
  - 设定一个"最多进二层锚点 N 次"的退出条件

方案 B：优化 AskUserQuestion 的使用
  - 启发式阶段严格控制：只在"明显无法判定"时才问用户
  - 使用 preview 模式呈现三种密度的示例任务，让用户自选
  - 记录用户在 triage 中的选择，后续可微调启发式权重

关键指标：
  - triage 平均交互次数（目标 ≤1 次 AskUserQuestion）
  - 二层锚点的触发频率（目标 <10%）
```

---

#### 2. 状态复杂度与规则的可编程性

**问题**：
- **36 个阶段-事件转移规则**分散在 `rules.json` 中
- **gates 的三层**与 `interruption_rules` 的**5 种回退映射**，总规则数 >50 条
- 没有看到"规则引擎"的实现代码，rules.json 的权威性依赖于**纯文本解读** + 验证脚本的有限检查

**影响**：
- pilot 命令的 controller 逻辑可能极其复杂（事件分发 + 条件检查 + 回退判断）
- 如果 controller 代码中的逻辑与 rules.json 不一致，无法自动发现

**建议**：
```
优先级：P1（架构优化）

方案 A：建立规则执行引擎
  - 编写一个轻量的状态机引擎（Node.js / Python），读取 rules.json
  - 导出 `canTransit(current_stage, event, density) → next_stage`
  - 导出 `getGate(event, stage) → [rules...]` 用于前置校验
  - controller 调用引擎而非硬编码逻辑

方案 B：参数化关键决策点
  - 把"三层 gates"的检查条件用 JSON 表示（selector + validator pairs）
  - 验证脚本增强：检查所有 gates 在 pilot 命令的实现中是否被覆盖
  
关键指标：
  - controller 的圈复杂度（目标 <20）
  - rules.json 与实现的一致性测试覆盖率（目标 100%）
```

---

#### 3. 用户中断与回退的鲁棒性

**问题**：
- state-protocol.md 中定义了 **5 种回退映射**（executing / scoping / designing / planning / repairing）
- 但没有看到"用户中断"时的完整处理流程
- pilot 命令如何判定"用户输入影响范围"？是否有自动化的逻辑，还是纯人工判断？

**影响**：
- 如果是人工判断，controller 会频繁陷入 "NEEDS_CONTEXT" 或 "PAUSED" 状态
- 跨会话恢复时，是否能正确识别"哪些工件仍然有效"？

**建议**：
```
优先级：P1（生产就绪）

方案：显式的中断处理路由
  - 定义 3 种用户输入类型：{实现细节, 边界/接纳标准, 方案/架构}
  - 对每种输入类型定义自动的回退阶段 + 废弃工件清单
  - 在 pilot 中显式实现 `handleUserInterruption(input_type) → { revert_to, discard_artifacts }`
  
例子：
  input: "改成用 async/await 而不是 Promise"
  type: 实现细节
  revert_to: executing
  discard: null
  
  input: "发现还需要支持 batch API"
  type: 边界变化
  revert_to: scoping
  discard: [plan.md, design.md]

关键指标：
  - 中断处理的自动化率（目标 >80%）
  - 工件有效性判定的精确性（无误删、无遗漏）
```

---

#### 4. Evaluator 的完整性与一致性

**问题**：
- `evaluator.md` 中定义了 "INCOMPLETE" 状态，但 rules.json 的 `event_stage_transitions` **没有 INCOMPLETE 事件**
- `code-quality-evaluator.md` 和 `spec-compliance-evaluator.md` 的输出契约与 evaluator 的输出契约是否完全一致？

**影响**：
- reviewing 阶段的两个 evaluator 返回结果后，controller 如何聚合 INCOMPLETE 状态？
- 如果某个 evaluator 返回 INCOMPLETE，是否应该进入 `paused`？

**建议**：
```
优先级：P1（完整性）

方案：补全 INCOMPLETE 处理路径
  - rules.json 中补加 INCOMPLETE 事件的转移规则：
    "INCOMPLETE": "paused"  （进入 paused，由 controller 补齐证据）
  - reviewing 阶段：spec-compliance INCOMPLETE → paused（等待补充证据）
  - 不允许跳过 INCOMPLETE 进入下一阶段
  
  - 三个 evaluator 的输出 schema 统一：
    result: PASS | FAIL | INCOMPLETE (用于 reviewing 两阶段)
    next_stage: completed | repairing | paused
    next_action: 明确的下一步动作

关键指标：
  - INCOMPLETE 覆盖率（reviewing 中 >1 次测试）
  - 三个 evaluator 输出的一致性测试覆盖（目标 100%）
```

---

#### 5. Task_Packet 与实际工程任务的贴合度

**问题**：
- task_packet.schema.json 定义了输入契约，但**没看到具体的内容示例**
- executor 消费的 task_packet 信息是否足以支撑从 planning 到 execution 的完整转移？
- 特别是在 medium_engine（scoping → low_engine）的分解中，子任务的 task_packet 如何生成？

**影响**：
- executor dispatch 时，如果 task_packet 内容不完整，executor 会频繁返回 NEEDS_CONTEXT
- 这直接影响自动推进的效率

**建议**：
```
优先级：P2（完整性）

方案：补充 task_packet 的实现指南与示例
  - 添加 `state/examples/task-packet-*.json` 样例，覆盖 low/medium/high 的典型场景
  - 在 planning 阶段明确规定 task_packet 的生成逻辑（从 plan.md 中哪些部分提取？）
  - 在 scoping 阶段明确规定子任务 task_packet 的裂变规则
  
  task_packet 必填字段建议：
  - task_id, title, density, stage
  - goal, acceptance_criteria
  - in_scope, out_of_scope （for scoping context）
  - key_constraints, known_limitations （for planning context）
  - test_instructions （for verify context）

关键指标：
  - executor NEEDS_CONTEXT 的触发率（目标 <5%）
  - task_packet 的完整性测试覆盖（目标 100%）
```

---

### ⚠️ 次要问题

#### 6. Verify 与 Reviewing 的级联关系

**问题**：
- `verification_level` 规则：low → optional，medium → required，high → required_plus_review
- 但在 rules.json 中，`low` 和 `medium` 在 VERIFY_PASS 后直接 → completed，只有 `high` 进 reviewing
- 这意味着 medium 的 verification_level=required 但不 review——这是故意的吗？

**建议**：
```
需要明确说明文档：
  - verification_level 与是否进 reviewing 的关系
  - 如果 medium 的 code_quality 不 review，那 "required_plus_review" 的语义是什么？
  
建议澄清：
  - low: verification optional（可跳过）
  - medium: verification required 但无 review
  - high: verification required + spec-compliance review + code-quality review
```

---

#### 7. Subtask 与并行执行的限制

**问题**：
- rules.json 中定义了 subtask_rules，但：
  1. 限制了 "parent_cannot_complete_before_all_subtasks_verified"
  2. 没有定义子任务的**并行执行策略**——是串行还是并行？
  3. 如果某个子任务失败，其他子任务是否继续执行？

**影响**：
- 对于 high_engine 派发的 medium 子任务，如果只能串行，性能会显著下降
- 没有清晰的失败处理策略

**建议**：
```
优先级：P2（性能）

方案：补充 subtask 执行策略
  rules.json 中新增：
  {
    "subtask_execution_strategy": "parallel | serial | partial_parallel",
    "failed_subtask_handling": "fail_parent | continue_others | retry_with_backoff",
    "parallel_limit": 3  // 最多同时执行 N 个子任务
  }

default 建议：
  - execution 阶段：并行派发所有子任务
  - verify 阶段：等待全部完成，记录失败子任务清单
  - 如果有失败：进入 repairing，fix 失败的子任务
```

---

#### 8. 文档与代码的同步机制

**问题**：
- pilot.md 在第 115 行引用 `../references/state-protocol.md` 和 `../references/native-tools.md`
- 但当前删除的文件清单中有 `D plugins/orbit/skills/references/native-tools.md`——是否有文件路径不匹配？
- state/README.md 是权威源，但与 pilot.md、README.md 中的说法可能冲突

**影响**：
- 开发者可能依据过时的文档
- 修改规则时容易漏同步

**建议**：
```
优先级：P1（维护性）

方案：建立文档同步检查
  - validate-orbit-state.mjs 中增加检查：
    1. 检查 pilot.md 中的所有 ../ 引用是否实际存在
    2. 检查 pilot.md / README.md / state-protocol.md 中的关键术语是否一致
    3. 检查 rules.json 中的阶段名是否与 pilot.md 中的说法一致
  
  - 在 CLAUDE.md 中补充规则变更流程：
    新增规则 → 先改 state/rules.json → 运行验证脚本 → 同步文档
```

---

## 实现检查清单

基于架构设计，以下是生产化前的关键检查项：

### 必须完成（P0）

- [ ] Pilot triage 双层判定的实际逻辑是否与文档一致？（需代码审查）
- [ ] AskUserQuestion 的触发条件是否能自动化（参数化信号权重）？
- [ ] 完整的状态转移测试：所有 36 条 event_stage_transitions 均有测试覆盖
- [ ] Executor 四态返回的 100% 覆盖测试
- [ ] Evaluator INCOMPLETE 路径的完整实现与测试

### 高优先级（P1）

- [ ] 规则引擎的实现或文件化规则到代码的一致性检查
- [ ] 用户中断与回退的自动化处理（输入类型判定 → 自动回退）
- [ ] Task_packet 的完整示例与生成规则
- [ ] Subtask 的并行执行策略定义与实现
- [ ] 跨会话恢复的完整场景测试（≥5 个真实场景）

### 中优先级（P2）

- [ ] 性能基准测试（单个任务从 triage 到 completion 的时间）
- [ ] Verify_level 与 reviewing 的关系澄清
- [ ] 文档同步检查的自动化（加入 validate 脚本）
- [ ] UI/UX 优化（减少 AskUserQuestion 频率）
- [ ] 边界案例覆盖（e.g., 极限小任务、极限大任务）

---

## 建议的优化路线（90 天计划）

### Phase 1（第 1-2 周）：补全与澄清

1. **补全 INCOMPLETE 路径**（P1 级）
   - rules.json 加入 INCOMPLETE → paused 转移
   - 三个 evaluator 的输出 schema 对齐
   - 添加 reviewing 阶段的 INCOMPLETE 处理测试

2. **补充 task_packet 示例**（P2 级）
   - 添加 `state/examples/task-packet-low.json`、`medium.json`、`high.json`
   - 在 planning 中明确规定 task_packet 的生成逻辑

3. **澄清文档与代码的同步**（P1 级）
   - 验证 pilot.md 的所有 reference 路径
   - 修正文件路径不匹配

### Phase 2（第 3-4 周）：参数化与自动化

1. **参数化 triage 启发式**（P0 级）
   - 信号权重配置化
   - 自动推进阈值明确化
   - 减少 AskUserQuestion 频率至 <1 次平均

2. **规则引擎**（P1 级）
   - 实现轻量规则执行引擎或代码生成脚本
   - rules.json ↔ controller 代码的一致性校验

3. **用户中断处理**（P1 级）
   - 显式的中断处理路由
   - 工件有效性判定的自动化

### Phase 3（第 5-8 周）：测试与优化

1. **完整性测试**
   - 36 个 event_stage_transitions 的覆盖
   - Executor 四态返回的覆盖
   - Evaluator 三态结论的覆盖
   - 跨会话恢复的 5+ 场景测试

2. **性能测试与优化**
   - 单任务 triage 到 completion 的基准
   - Subtask 并行执行的策略选择与测试

3. **UX 优化**
   - 用户反馈收集（真实任务 5+ 个）
   - AskUserQuestion 的设计评估

### Phase 4（第 9-12 周）：文档与生产化

1. 完整的用户指南与开发者指南
2. 故障恢复手册与最佳实践
3. 性能基准与扩展性分析
4. 首批真实用户的反馈整合与迭代

---

## 总体建议

### 🎯 短期（立即）

**Orbit 当前是 "设计 ✓ 、架构 ✓ 、实现 ⚠️"的状态。**

建议**优先发布 0.3.0 的 beta 版本**，通过真实任务验证以下三个关键假设：

1. **Triage 双层判定是否真能快速**（目标：平均 <30s，<1 次额外交互）
2. **Executor/Evaluator 分离是否足以保证质量**（目标：first-time-right >70%）
3. **跨会话恢复是否真的无损**（目标：恢复成功率 >95%）

如果这三个假设验证不通过，后续的优化将无从下手。

### 🔧 中期（1-2 个月）

重点在**参数化、自动化、测试完整性**，把设计变成可维护的代码。特别要关注：

- **Triage 的自动化程度**：目标是让 AskUserQuestion 尽可能少
- **规则执行的一致性**：rules.json 与实现的自动同步
- **用户中断的鲁棒性**：自动判定回退阶段，减少人工决策

### 📈 长期（3-6 个月）

打磨成**市场级工作流插件**，需要：

- 完整的性能基准与扩展性分析
- 丰富的错误恢复手册与最佳实践
- 真实用户的多轮反馈与迭代
- 开源社区的贡献机制

---

## 结论

Orbit 的**架构设计已经达到行业一流水准**。single entry point、文件化 SSOT、executor/evaluator 分离这三个核心设计选择都非常正确。

**现在的关键不是设计修改，而是完整实现 + 真实验证**。

建议按照上述优先级列表逐步推进，特别是：
1. 先做真实场景验证（beta 测试）
2. 再做参数化与自动化（降低交互成本）
3. 最后做文档与最佳实践（生产化）

期待 Orbit 能成为 Claude Code 生态中的标杆工作流插件。

