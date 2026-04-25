---
name: scoping
description: Medium 任务的边界收敛阶段。明确 in_scope / out_of_scope 与 acceptance_criteria；范围变化时升级 high 或降级 low。
---

scoping 解决"该做什么、不做什么"的边界问题——只回答这一个问题，不做设计、不写实现。

## 路由

| 完成事件 | 触发条件 | 下一阶段 | 下一 skill |
|---|---|---|---|
| `SCOPE_DONE` | 边界已收敛 | executing | execute |
| `ESCALATE_DENSITY` | 发现需要方案比较 | designing | design |
| `DOWNGRADE_DENSITY` | 范围比预估更小、可直接实现 | executing | execute |

## 不做

- 不写实现代码
- 不把未确认事项伪装成既定范围
- 不产出 design / plan
- 不做 verify / review

## 输出

| 字段 | 说明 |
|---|---|
| `scoped_goal` | 一句话目标，与 triage 的 goal 对齐 |
| `in_scope` | 本轮要完成的具体项列表 |
| `out_of_scope` | 明确排除的项 |
| `constraints_and_risks` | 实现约束与可预见风险 |
| `acceptance_criteria` | 可验证的成功判据列表 |
| `artifact_written` | `scope` |
| `next_event` | `SCOPE_DONE` / `ESCALATE_DENSITY` / `DOWNGRADE_DENSITY` |
| `next_skill` | `execute` / `design` |
| `next_action` | 下一步唯一动作 |

## 工件与状态

- 写入工件：`scope` → `.orbit/state/<task_id>/scope.md`
- 任务清单进入项：确认 in_scope、确认 out_of_scope、确认 acceptance_criteria
- 通用持久化、任务清单、退出自检见 [state-protocol.md](../references/state-protocol.md)

## 优先工具

`Explore`（探查现有代码与依赖关系）+ `Glob` / `Grep` + `AskUserQuestion`（边界经 Explore 后仍模糊时圈定范围）。详见 [native-tools.md](../references/native-tools.md)。

## 本阶段特有退出条件

- [ ] `scope.md` 包含 in_scope / out_of_scope / acceptance_criteria 三项均非空
- [ ] 升级 / 降级 density 时已更新 `triage_result` 并记录原因
