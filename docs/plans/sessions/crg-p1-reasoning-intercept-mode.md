# Session Plan

schema_version: agos.session-plan.v1
architecture_contract_version: agos.brainstorming-gate.v1
task_id: crg-p1-reasoning-intercept-mode
work_class: standard
task_summary: 为 codex-retry-gateway 增加流式/非流式独立拦截开关，并修正相关统计与模型一致性收口。
project_root: C:\Users\dashuai\.config\superpowers\worktrees\codex-retry-gateway-git\codex-model-consistency-clean
trigger_source: user-approved-design-2026-06-29
decision_status: approved
approval_source: direct-user
approved_decision_ref: session-plan:crg-p1-reasoning-intercept-mode#decision
scope_boundary: gateway-config-ui-tests-and-local-application-only
selected_business_path: knowledge-vault-governance
verification_commands:
  - node .\scripts\test-gateway-e2e.mjs
  - node .\scripts\test-install-restore.mjs
  - node --check .\gateway.mjs
closeout_ref: pending-current-task

## Approved Decision

- Decision: 采用两个布尔开关 `intercept_streaming` 与 `intercept_non_streaming`，支持仅流式、仅非流式、双开三种合法模式，禁止双关。
- Reason: 这最贴合当前 UI 诉求，且与现有流式/非流式双链路代码结构最一致，改动面最小，后续也更易扩展。
- Scope boundary: 仅修改 `gateway.mjs`、示例配置、回归测试与本地已安装 gateway 应用；不做仓库结构重构，不做 PR 收口。
- Rejected options:
  - 单枚举模式 `stream_only | non_stream_only | both`
  - 再拆一层“只检测不拦截”的第四类运行模式

## Brainstorming

```yaml
level: standard
proposal_mode: simulated-roles
fallback_reason: unsupported-executor
superpowers_skill: superpowers:brainstorming
actual_agent_count: 0
agent_result_refs:
  - terminal:2026-06-29-user-approved-two-checkbox-design
agent_budget_guard:
  initial_review_agents: 0
  escalation_agents: 0
  divergence: low
  idle_agent_cleanup: not-available
  timeout_policy: blocked-main-thread-rereview
  model_downgrade: forbidden
agent_proposals:
  - role: architecture-reviewer
    recommendation: 使用两个布尔开关并保留现有 stream_action/non_stream_status_code 语义。
    risks: 命中统计与实际拦截统计容易混淆；非流式命中收口若不补会继续裂口径。
    required_changes: 增加 blocked 统计，补非流式命中后的 finalizeModelInsights。
    reject_if: 把 matched_response_count 改成“实际拦截次数”。
  - role: operator-experience-reviewer
    recommendation: UI 放两个复选框，并显示当前模式文字摘要。
    risks: 两项都取消时用户会误以为配置成功但不生效。
    required_changes: 前后端双重禁止双关，并给出明确错误文案。
    reject_if: 只做后端校验，不做前端即时反馈。
  - role: verification-reviewer
    recommendation: 先补 E2E，再改逻辑，重点覆盖“命中但不拦截仍要统计和留证据”。
    risks: 现有模型一致性用例可能因 total_checked 口径变化而需要同步修订。
    required_changes: 增加流式-only / non-stream-only / both 三种模式测试矩阵。
    reject_if: 不补安装回归或只做手测。
user_decision: 批准两个选择框方案，要求先落盘方案，再按 AGOS 长任务模式执行，不使用 goal。
decision_reason: 用户明确表示三种诉求同时存在，并确认“落盘就好了，然后用 agos 的长任务模式执行，不要用 goal”。
rejected_options:
  - 单枚举模式
  - 四态检测/拦截分层
```

## Local Knowledge Lookup

Standard / Major 不允许留空。必须写实际 GBrain 查询、本地 vault 引用、rules 引用、项目文档引用和缺口结论；没有覆盖时写 RAG gap、audit-only 边界或 blocker。

```yaml
local_knowledge_lookup:
  gbrain_queries:
    - "AGOS 长任务模式 session plan runtime workflow 执行计划"
    - "codex-retry-gateway 模型一致性 主动探针 516"
  vault_refs:
    - D:\Android_source\ai-growth-os\components\rules\rules\workflows\ai-growth-os-auto-application.md
    - D:\Android_source\ai-growth-os\components\rules\rules\workflows\ai-growth-os-brainstorming-gate.md
    - D:\Android_source\ai-growth-os\components\rules\rules\workflows\ai-growth-os-runtime-workflow.md
  rules_refs:
    - D:\Android_source\ai-growth-os\components\rules\templates\session-plan.md
    - D:\Android_source\ai-growth-os\components\rules\scripts\verify-session-plan.ps1
    - D:\Android_source\ai-growth-os\components\rules\scripts\verify-runtime-workflow.ps1
    - D:\Android_source\ai-growth-os\components\rules\scripts\verify-git-snapshot-governance.ps1
  project_refs:
    - C:\Users\dashuai\.config\superpowers\worktrees\codex-retry-gateway-git\codex-model-consistency-clean\AGENTS.md (不存在，按项目根事实处理)
    - C:\Users\dashuai\.config\superpowers\worktrees\codex-retry-gateway-git\codex-model-consistency-clean\build.md
    - C:\Users\dashuai\.config\superpowers\worktrees\codex-retry-gateway-git\codex-model-consistency-clean\err.md
    - C:\Users\dashuai\.config\superpowers\worktrees\codex-retry-gateway-git\codex-model-consistency-clean\README.md
    - 当前 spec 与真源说明保留在 legacy docs/superpowers 目录中，仅作历史事实参考，不作为 AGOS active control doc
  missing_coverage:
    - "AGOS registry 当前没有 Node/网关功能开发的现成 business path；本任务按 external-project warning mode 记录，并在 runtime workflow 中标注 dynamic-generated coverage gap。"
```

## Master Plan

```yaml
path:
update_required: false
update_summary: 当前仓库没有 AGOS master plan 控制塔，不创建额外控制面。
```

## Runtime Workflow

```yaml
path: .ai-growth-os/runtime-workflows/crg-p1-reasoning-intercept-mode.yml
session_plan_ref: docs/plans/sessions/crg-p1-reasoning-intercept-mode.md
approved_decision_ref: session-plan:crg-p1-reasoning-intercept-mode#decision
selected_business_path: knowledge-vault-governance
workflow_nodes:
  - startup
  - knowledge-prep
  - plan
  - execute
  - verify
  - distill
  - sync
subagent_roles:
  - rule-auditor
  - knowledge-retriever
  - build-verifier
skill_tree_nodes:
  - global-maintenance
  - knowledge-vault
  - verification
  - self-distillation
stop_gates:
  - 两个拦截开关不能同时为 false
  - 不允许把 matched_response_count 偷换成 blocked 次数
  - 不允许打坏现有主动探针隔离语义
verification_commands:
  - node .\scripts\test-gateway-e2e.mjs
  - node .\scripts\test-install-restore.mjs
  - node --check .\gateway.mjs
```

## Delivery Governance

```yaml
delivery_mode: local-only-no-pr
tracking: not-applicable
branch: codex/model-consistency-clean
review: local-tests-and-owner-review
ci: local-verification-only
merge: owner-controlled
```

## Inputs

```yaml
project_docs:
  - C:\Users\dashuai\.config\superpowers\worktrees\codex-retry-gateway-git\codex-model-consistency-clean\build.md
  - C:\Users\dashuai\.config\superpowers\worktrees\codex-retry-gateway-git\codex-model-consistency-clean\err.md
rules_refs:
  - D:\Android_source\ai-growth-os\components\rules\rules\workflows\ai-growth-os-brainstorming-gate.md
  - D:\Android_source\ai-growth-os\components\rules\rules\workflows\ai-growth-os-runtime-workflow.md
vault_refs:
  - D:\Android_source\ai-growth-os\components\rules\rules\workflows\ai-growth-os-auto-application.md
tool_refs:
  - superpowers:brainstorming
  - karpathy-guidelines
```

## Outputs

```yaml
expected_files:
  - docs/plans/sessions/crg-p1-reasoning-intercept-mode.md
  - .ai-growth-os/runtime-workflows/crg-p1-reasoning-intercept-mode.yml
  - docs/plans/2026-06-29-reasoning-intercept-mode-implementation.md
  - gateway.mjs
  - config.example.json
  - scripts/test-gateway-e2e.mjs
  - scripts/test-install-restore.mjs
  - err.md
expected_reports:
  - local verification output in terminal
evidence_refs:
  - git checkpoint report
  - e2e pass output
  - install/restore pass output
  - local gateway health/status/ui smoke output
  - historical-spec: docs/superpowers/specs/2026-06-29-reasoning-intercept-mode-design.md
```

## Closeout

```yaml
verification_results:
  - "PASS: node .\\scripts\\test-gateway-e2e.mjs"
  - "PASS: node .\\scripts\\test-install-restore.mjs"
  - "PASS: node --check .\\gateway.mjs"
  - "PASS: git diff --check; only line-ending conversion warnings reported"
  - "PASS: local launch-ui.ps1 -NoOpen restarted http://127.0.0.1:4610 with intercept_streaming=true and intercept_non_streaming=true persisted"
closeout_refs:
  - err.md#30
  - local-ui:http://127.0.0.1:4610/__codex_retry_gateway/ui
rollout_ref:
candidate_ref:
distillation_result: matched-vs-blocked-intercept-mode-correction-recorded
```
