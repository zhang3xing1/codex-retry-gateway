# 主动探针控制区实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在管理页主动探针面板中加入可用的控制区，支持同时选择 `gpt-5.4` / `gpt-5.5`、开关自动探测、设置分钟频率，并提供“现在探测一次”按钮。

**Architecture:** 保持现有主动探针样本、统计和普通代理隔离逻辑不变，只扩展 `active_probe` 配置模型、调度控制和管理页交互。手动探测走独立管理接口，不依赖自动探测是否开启；自动探测继续由 `scheduleActiveProbes()` 托管，但保存配置后要立即重建调度。

**Tech Stack:** Node.js 18+、`gateway.mjs` 单文件网关、内嵌管理页脚本、`scripts/test-gateway-e2e.mjs`、`scripts/test-install-restore.mjs`

---

### Task 1: 先补失败测试

**Files:**
- Modify: `C:\Users\dashuai\.config\superpowers\worktrees\codex-retry-gateway-git\codex-model-consistency-clean\scripts\test-gateway-e2e.mjs`
- Modify: `C:\Users\dashuai\.config\superpowers\worktrees\codex-retry-gateway-git\codex-model-consistency-clean\scripts\test-install-restore.mjs`

- [ ] 增加管理页脚本沙箱断言：
  - 存在 `probeTargetFamily54Input`
  - 存在 `probeTargetFamily55Input`
  - 存在 `probeAutoEnabledInput`
  - 存在 `probeIntervalMinutesInput`
  - 存在 `probeRunButton`
- [ ] 增加 `saveConfig()` 发送体断言：
  - `active_probe.enabled`
  - `active_probe.interval_ms`
  - `active_probe.target_families`
- [ ] 增加手动探测接口断言：
  - `POST /__codex_retry_gateway/api/probe/run`
  - 未开启自动探测时也能触发一次
  - 不污染普通代理统计

### Task 2: 扩展后端配置与调度

**Files:**
- Modify: `C:\Users\dashuai\.config\superpowers\worktrees\codex-retry-gateway-git\codex-model-consistency-clean\gateway.mjs`
- Modify: `C:\Users\dashuai\.config\superpowers\worktrees\codex-retry-gateway-git\codex-model-consistency-clean\config.example.json`

- [ ] 为 `active_probe` 增加 `target_families`
- [ ] `runActiveProbeOnce()` 按选中的模型家族逐个执行
- [ ] `safeRunActiveProbeOnce()` 支持手动触发，不被 `enabled=false` 直接拦掉
- [ ] 保存配置后立即重建 probe timer
- [ ] 新增手动探测接口并复用并发保护

### Task 3: 接入管理页控件与回归验证

**Files:**
- Modify: `C:\Users\dashuai\.config\superpowers\worktrees\codex-retry-gateway-git\codex-model-consistency-clean\gateway.mjs`

- [ ] 在主动探针面板红框区域加入控制区
- [ ] 表单回填当前主动探针设置
- [ ] “现在探测一次”按钮能即时刷新状态与日志
- [ ] 保持下面 6 个指标和样本表展示不变

### Task 4: 验证与本地应用

**Files:**
- Modify: `C:\Users\dashuai\.config\superpowers\worktrees\codex-retry-gateway-git\codex-model-consistency-clean\err.md`

- [ ] 运行：
  - `node .\scripts\test-gateway-e2e.mjs`
  - `powershell -ExecutionPolicy Bypass -File .\scripts\test-install-restore.ps1`
  - `node --check .\gateway.mjs`
- [ ] 把新版 `gateway.mjs` 覆盖到本地安装版
- [ ] 重启本地 gateway，给牢大直接在 UI 页面验收
