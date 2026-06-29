# Reasoning Intercept Mode Implementation Plan

**Goal:** 为 `codex-retry-gateway` 增加流式/非流式独立拦截开关，保持三种合法模式可选，并补齐统计、模型一致性收口和回归测试。

**Architecture:** 保持当前 `gateway.mjs` 单文件架构不拆，只在配置模型、命中处理分支、状态快照、管理页 UI 和测试矩阵上做外科手术式改动。命中检测与证据留存继续工作，真正拆开的只是“是否执行拦截”的控制面。

**Tech Stack:** Node.js 18+、`gateway.mjs`、内嵌管理页脚本、`scripts/test-gateway-e2e.mjs`、`scripts/test-install-restore.mjs`

---

### Task 1: 扩配置与状态快照

**Files:**
- Modify: `C:\Users\dashuai\.config\superpowers\worktrees\codex-retry-gateway-git\codex-model-consistency-clean\gateway.mjs`
- Modify: `C:\Users\dashuai\.config\superpowers\worktrees\codex-retry-gateway-git\codex-model-consistency-clean\config.example.json`

- [ ] 新增配置字段：
  - `intercept_streaming`
  - `intercept_non_streaming`
- [ ] 默认值保持双开
- [ ] 配置保存时禁止双关
- [ ] 状态快照新增：
  - `matched_streaming_count`
  - `matched_non_streaming_count`
  - `blocked_response_count`
  - `blocked_streaming_count`
  - `blocked_non_streaming_count`

### Task 2: 修非流式命中逻辑

**Files:**
- Modify: `C:\Users\dashuai\.config\superpowers\worktrees\codex-retry-gateway-git\codex-model-consistency-clean\gateway.mjs`

- [ ] 非流式命中时区分：
  - 拦截
  - 仅观察透传
- [ ] 无论是否拦截，都进入受控模型一致性收口
- [ ] 日志明确区分：
  - `action=status_<code>`
  - `action=observe_only`

### Task 3: 修流式命中逻辑

**Files:**
- Modify: `C:\Users\dashuai\.config\superpowers\worktrees\codex-retry-gateway-git\codex-model-consistency-clean\gateway.mjs`

- [ ] 流式命中时区分：
  - 拦截
  - 仅观察继续透传
- [ ] 关闭流式拦截时，仍保留 matched 统计和模型信号收集
- [ ] 继续保护“正常拦截 516 不应误报 rebuild_suspected”回归

### Task 4: 接 UI 控件与文案

**Files:**
- Modify: `C:\Users\dashuai\.config\superpowers\worktrees\codex-retry-gateway-git\codex-model-consistency-clean\gateway.mjs`

- [ ] 在“拦截规则”卡片里加入：
  - `拦截流式`
  - `拦截非流式`
- [ ] 表单回填两个复选框
- [ ] 前端禁止双关并立即提示
- [ ] 加当前模式文字：
  - `仅流式 / 仅非流式 / 流式+非流式`

### Task 5: 补 E2E 与安装回归

**Files:**
- Modify: `C:\Users\dashuai\.config\superpowers\worktrees\codex-retry-gateway-git\codex-model-consistency-clean\scripts\test-gateway-e2e.mjs`
- Modify: `C:\Users\dashuai\.config\superpowers\worktrees\codex-retry-gateway-git\codex-model-consistency-clean\scripts\test-install-restore.mjs`

- [ ] 增加 UI 脚本断言：
  - 两个拦截复选框存在
  - 双关时前端阻止保存
- [ ] 增加后端配置断言：
  - 双关时 `/api/config` 返回 400
- [ ] 增加三种模式回归：
  - 仅流式
  - 仅非流式
  - 双开
- [ ] 增加“命中但不拦截仍要统计和留证据”断言

### Task 6: 验证、本地应用、记录 err.md

**Files:**
- Modify: `C:\Users\dashuai\.config\superpowers\worktrees\codex-retry-gateway-git\codex-model-consistency-clean\err.md`

- [ ] 运行：
  - `node .\scripts\test-gateway-e2e.mjs`
  - `node .\scripts\test-install-restore.mjs`
  - `node --check .\gateway.mjs`
- [ ] 把本轮修复过程记入 `err.md`
- [ ] 将新版应用到本地已安装 gateway，供牢大直接在当前路由下验收
