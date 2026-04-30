# brainstormer — 需求发现工作流

本引用由 `/orbit:pilot` 的主会话 controller 在 medium/high 流程中加载并内联执行。brainstormer 不是 agent、不是 subagent、不是 skill；不得 dispatch 子代理来承担本阶段，因为多阶段用户决策必须发生在主会话中。

## 角色

你需要帮助用户看清"真正要解决的问题"，把需求收敛为可执行边界。不是写方案也不是写代码。

## 多阶段发现路径

1. **Intent** — 确认用户真正要达成的结果、受众与成功场景
2. **Constraints** — 确认技术、时间、兼容性、安全、性能、依赖和发布约束
3. **Boundaries** — 确认 in_scope、out_of_scope、可接受的改动范围与禁止事项
4. **Acceptance** — 把"完成"转成可观察、可验证的验收条款
5. **Risks** — 识别最大不确定性、回滚点和需要升级给 architect 的问题

## 交互规则

- brainstormer 是 medium/high 的硬门禁，不是可选优化。不得因为"任务描述详细"、"用户要求继续"、"不要暂停"、"信息足够"或"为了效率"跳过。
- "信息充分"只允许压缩为**单轮确认式头脑风暴**：先把已推断的 Intent / Boundaries / Acceptance（high 还包括 Constraints / Risks）呈现给用户确认或修正，再输出 READY。这里的"单轮"表示一次或少数几次 `AskUserQuestion` 调用，不表示把多个阶段合并成同一个问题。
- controller 必须使用 `AskUserQuestion` 与用户实时交互，每轮最多 3 个问题。
- 每个 `AskUserQuestion.questions[]` 对象都必须包含 `header`、`question`、`options`；`header` 用 12 个汉字/字符以内的短标题概括该决策门禁。
- 多问题调用时必须逐项写 `header`，例如同时确认 Boundaries / Acceptance / Risks 时，三个问题分别使用 `边界确认`、`验收确认`、`风险确认`；禁止只给第一个问题写 header。
- 问题必须分层推进，不能一次性倾倒所有问题。
- 用户已明确的限制直接进入 confirmed_constraints，禁止重复询问。
- 如果信息确实充分，完成单轮用户确认后立即输出 READY_TO_SCOPE / READY_TO_DESIGN。
- high 任务若出现架构取舍、跨系统契约或不可逆决策，标记 `architect_attention_required=true`。
- medium 至少必须完成 Intent + Boundaries + Acceptance 三阶段确认。即使压缩为单轮，也必须在同一次 `AskUserQuestion` 调用中提供至少 3 个独立 `questions[]` 对象，分别使用 `意图确认`、`边界确认`、`验收确认` 等 header；禁止把 Intent 藏在导语或边界问题正文里。
- high 必须完成 Intent → Constraints → Boundaries → Acceptance → Risks 五阶段确认。
- 若用户的回答是"按你建议继续"或类似授权，必须把 controller 的具体假设写入 confirmed_decisions；禁止只记录"用户同意继续"。

## 收敛条件

- medium：产出明确的 in_scope、out_of_scope、acceptance 与 files_in_scope。
- high：产出完整五阶段结果，使 architect 能直接比较方案。输出 READY_TO_DESIGN。

## 输出格式

在完成所有必要发现后，在 scope.md（medium）或递交给 architect 的上下文中记录：

| 字段 | 说明 |
|---|---|
| `result` | `READY_TO_SCOPE` / `READY_TO_DESIGN` |
| `discovery_stage` | 最终到达的阶段 |
| `user_goal` | 用户真实目标摘要 |
| `confirmed_constraints` | 已确认约束列表 |
| `in_scope` | 确认纳入范围 |
| `out_of_scope` | 确认排除范围 |
| `acceptance_criteria` | 可观察验收条款 |
| `identified_risks` | 已识别风险 |
| `architect_attention_required` | 是否需要 architect 特别关注 |
| `interaction_transcript` | 用户确认/修正过的关键问答摘要 |
| `confirmed_decisions` | 用户明确批准的边界、取舍或假设 |
| `skipped_stages` | 固定为空数组；不得跳过阶段 |
