# Model Contract Falsification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不破坏现有被动流式监控的前提下，为 `codex-retry-gateway` 增加低频主动探针，向目标接口发送结构化探测请求，并结合返回协议、响应结构、知识问答结果、身份一致性、可观测思维痕迹和签名指纹等维度综合评分，用于证伪 `gpt-5.4` / `gpt-5.5` 的公开能力契约。

**Architecture:** 保留现有 `proxyRequest()` 被动主链路不变，在 `gateway.mjs` 内新增独立 `active_probe` 运行层和独立 `probeMonitor`。主动探针直接请求上游，不经过本地代理回环，只复用模型信号提取、错误识别、日志与样本保留逻辑，并通过状态接口与 UI 展示独立统计；内部按“结构化探测请求 -> 多维采样 -> 综合评分”运行，其中长上下文与图片输入产出 `violation`，响应结构、身份一致性、训练截止日期 / 知识表现、可观测思维痕迹与签名指纹产出 `warning` 或辅助分数。

**Tech Stack:** Node.js 18+、原生 `fetch`、现有 `gateway.mjs` 单文件架构、内嵌 HTML UI、`scripts/test-gateway-e2e.mjs`

---

### Task 1: 加入主动探针配置与运行期骨架

**Files:**
- Modify: `C:\Users\dashuai\.config\superpowers\worktrees\codex-retry-gateway-git\codex-model-consistency-clean\gateway.mjs`
- Modify: `C:\Users\dashuai\.config\superpowers\worktrees\codex-retry-gateway-git\codex-model-consistency-clean\config.example.json`
- Test: `C:\Users\dashuai\.config\superpowers\worktrees\codex-retry-gateway-git\codex-model-consistency-clean\scripts\test-gateway-e2e.mjs`

- [ ] **Step 1: 先写主动探针配置默认值与加载断言**

```js
const DEFAULT_CONFIG = {
  ...,
  active_probe: {
    enabled: false,
    interval_ms: 15 * 60 * 1000,
    startup_delay_ms: 60 * 1000,
    timeout_ms: 120 * 1000,
    endpoint_candidates: ["/responses", "/v1/responses"],
    image_input: {
      enabled: true,
    },
    response_structure: {
      enabled: false,
      repeat_count: 2,
    },
    identity_consistency: {
      enabled: false,
      repeat_count: 2,
    },
    knowledge_cutoff: {
      enabled: false,
      max_questions: 3,
    },
    long_context: {
      enabled: true,
      target_word_count: 460000,
    },
  },
};
```

```js
assert.equal(config.active_probe.enabled, false);
assert.deepEqual(config.active_probe.endpoint_candidates, ["/responses", "/v1/responses"]);
assert.equal(config.active_probe.long_context.target_word_count, 460000);
assert.equal(config.active_probe.response_structure.repeat_count, 2);
assert.equal(config.active_probe.knowledge_cutoff.max_questions, 3);
```

- [ ] **Step 2: 跑 E2E，确认当前测试因缺少 `active_probe` 结构而失败**

Run:

```powershell
node .\scripts\test-gateway-e2e.mjs
```

Expected:

- 新加的 `active_probe` 相关断言失败

- [ ] **Step 3: 最小实现配置归一化与运行期 monitor 骨架**

```js
function createProbeMonitor() {
  return {
    enabled: false,
    running: false,
    last_started_at: null,
    last_finished_at: null,
    last_target_model: null,
    last_target_family: null,
    total_runs: 0,
    skipped_runs: 0,
    pass_count: 0,
    warning_count: 0,
    violation_count: 0,
    transport_error_count: 0,
    indeterminate_count: 0,
    endpoint_success_counts: {},
    probe_type_counts: {
      long_context: 0,
      image_input: 0,
      response_structure: 0,
      identity_consistency: 0,
      knowledge_cutoff: 0,
    },
    warning_type_counts: {
      probe_response_structure_warning: 0,
      probe_identity_consistency_warning: 0,
      probe_knowledge_cutoff_warning: 0,
    },
    violation_type_counts: {
      probe_low_context_family_violation: 0,
      probe_image_input_violation: 0,
    },
    last_successful_endpoint: null,
    recent_samples: [],
  };
}
```

```js
function normalizeActiveProbeConfig(input = {}) {
  return {
    enabled: Boolean(input.enabled),
    interval_ms: normalizePositiveInteger(input.interval_ms, DEFAULT_CONFIG.active_probe.interval_ms),
    startup_delay_ms: normalizePositiveInteger(input.startup_delay_ms, DEFAULT_CONFIG.active_probe.startup_delay_ms),
    timeout_ms: normalizePositiveInteger(input.timeout_ms, DEFAULT_CONFIG.active_probe.timeout_ms),
    endpoint_candidates: normalizeStringList(
      input.endpoint_candidates,
      DEFAULT_CONFIG.active_probe.endpoint_candidates,
    ).map(normalizePath),
    image_input: {
      enabled: input?.image_input?.enabled !== false,
    },
    response_structure: {
      enabled: Boolean(input?.response_structure?.enabled),
      repeat_count: normalizePositiveInteger(
        input?.response_structure?.repeat_count,
        DEFAULT_CONFIG.active_probe.response_structure.repeat_count,
      ),
    },
    identity_consistency: {
      enabled: Boolean(input?.identity_consistency?.enabled),
      repeat_count: normalizePositiveInteger(
        input?.identity_consistency?.repeat_count,
        DEFAULT_CONFIG.active_probe.identity_consistency.repeat_count,
      ),
    },
    knowledge_cutoff: {
      enabled: Boolean(input?.knowledge_cutoff?.enabled),
      max_questions: normalizePositiveInteger(
        input?.knowledge_cutoff?.max_questions,
        DEFAULT_CONFIG.active_probe.knowledge_cutoff.max_questions,
      ),
    },
    long_context: {
      enabled: input?.long_context?.enabled !== false,
      target_word_count: normalizePositiveInteger(
        input?.long_context?.target_word_count,
        DEFAULT_CONFIG.active_probe.long_context.target_word_count,
      ),
    },
  };
}
```

- [ ] **Step 4: 扩展状态接口快照，但不接入真实调度**

```js
function buildActiveProbeSnapshot(runtime) {
  return {
    ...runtime.probeMonitor,
    endpoint_success_counts: { ...runtime.probeMonitor.endpoint_success_counts },
    probe_type_counts: { ...runtime.probeMonitor.probe_type_counts },
    warning_type_counts: { ...runtime.probeMonitor.warning_type_counts },
    violation_type_counts: { ...runtime.probeMonitor.violation_type_counts },
    recent_samples: runtime.probeMonitor.recent_samples.map((sample) => ({ ...sample })),
  };
}
```

```js
res.end(JSON.stringify({
  ...,
  active_probe: buildActiveProbeSnapshot(runtime),
}));
```

- [ ] **Step 5: 跑 E2E，确认配置与状态结构通过**

Run:

```powershell
node .\scripts\test-gateway-e2e.mjs
```

Expected:

- 新增 `active_probe` 结构断言 PASS
- 现有被动监控断言继续 PASS

- [ ] **Step 6: 提交这一小步**

```bash
git add gateway.mjs config.example.json scripts/test-gateway-e2e.mjs
git commit -m "feat: add active probe runtime skeleton"
```

### Task 2: 实现长上下文主动探针

**Files:**
- Modify: `C:\Users\dashuai\.config\superpowers\worktrees\codex-retry-gateway-git\codex-model-consistency-clean\gateway.mjs`
- Test: `C:\Users\dashuai\.config\superpowers\worktrees\codex-retry-gateway-git\codex-model-consistency-clean\scripts\test-gateway-e2e.mjs`

- [ ] **Step 1: 先写长上下文探针的失败测试**

```js
await runActiveProbeOnce(runtime);
const status = await getGatewayStatus();
assert.equal(status.active_probe.total_runs, 1);
assert.equal(status.active_probe.violation_type_counts.probe_low_context_family_violation, 1);
assert.equal(status.active_probe.violation_count, 1);
assert.equal(status.metrics.total_proxy_request_count, 0);
```

测试场景：

- 本地模型伪装为 `gpt-5.5`
- 假上游对超长输入返回 `context_length_exceeded` + `400000`
- 断言结果进入主动探针统计，而不是普通代理统计

- [ ] **Step 2: 跑测试，确认长上下文探针断言失败**

Run:

```powershell
node .\scripts\test-gateway-e2e.mjs
```

Expected:

- `active_probe.violation_count` 或 `recent_samples` 相关断言失败

- [ ] **Step 3: 实现探针 endpoint 选择、超长文本构造与上游请求**

```js
function buildLongContextProbeText(targetWordCount) {
  const words = [];
  for (let i = 0; i < targetWordCount; i += 1) {
    words.push(`w${String(i).padStart(6, "0")}`);
  }
  words.push("只回复OK");
  return words.join(" ");
}
```

```js
async function runLongContextProbe(runtime, targetModel, targetFamily) {
  const endpointPath = await resolveProbeEndpoint(runtime);
  const inputText = buildLongContextProbeText(runtime.config.active_probe.long_context.target_word_count);
  const payload = {
    model: targetModel,
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: inputText }],
      },
    ],
  };
  return executeProbeRequest(runtime, {
    probeType: "long_context",
    endpointPath,
    payload,
    targetModel,
    targetFamily,
  });
}
```

- [ ] **Step 4: 实现结果分类与样本入库**

```js
function classifyLongContextProbeResult(responseStatus, parsedBody, requestError) {
  if (requestError) {
    return { result: "transport_error", confidence: "low" };
  }
  if (looksLikeLowContextFamilyError(parsedBody)) {
    return {
      result: "violation",
      resultType: "probe_low_context_family_violation",
      confidence: "high",
    };
  }
  if (responseStatus >= 200 && responseStatus < 300) {
    return { result: "pass", confidence: "medium" };
  }
  return { result: "indeterminate", confidence: "low" };
}
```

- [ ] **Step 5: 实现调度入口，只在 `gpt-5.4` / `gpt-5.5` 下运行**

```js
async function runActiveProbeOnce(runtime) {
  const targetModel = await getLocalConfigModel(runtime);
  const targetFamily = normalizeModelFamily(targetModel);
  runtime.probeMonitor.total_runs += 1;
  runtime.probeMonitor.last_target_model = targetModel;
  runtime.probeMonitor.last_target_family = targetFamily;

  if (!TRACKED_LOCAL_MODEL_FAMILIES.has(targetFamily)) {
    runtime.probeMonitor.skipped_runs += 1;
    return;
  }

  if (runtime.config.active_probe.long_context.enabled) {
    await runLongContextProbe(runtime, targetModel, targetFamily);
  }
}
```

- [ ] **Step 6: 跑测试，确认长上下文探针通过且不污染普通代理统计**

Run:

```powershell
node .\scripts\test-gateway-e2e.mjs
```

Expected:

- `probe_low_context_family_violation` 断言 PASS
- `metrics.total_proxy_request_count` 不因主动探针增加

- [ ] **Step 7: 提交这一小步**

```bash
git add gateway.mjs scripts/test-gateway-e2e.mjs
git commit -m "feat: add long-context contract probe"
```

### Task 3: 实现 `gpt-5.5` 图片输入主动探针

**Files:**
- Modify: `C:\Users\dashuai\.config\superpowers\worktrees\codex-retry-gateway-git\codex-model-consistency-clean\gateway.mjs`
- Test: `C:\Users\dashuai\.config\superpowers\worktrees\codex-retry-gateway-git\codex-model-consistency-clean\scripts\test-gateway-e2e.mjs`

- [ ] **Step 1: 先写图片输入探针失败测试**

```js
await runActiveProbeOnce(runtime);
const status = await getGatewayStatus();
assert.equal(status.active_probe.violation_type_counts.probe_image_input_violation, 1);
assert.equal(status.active_probe.recent_samples[0].probe_type, "image_input");
assert.equal(status.active_probe.recent_samples[0].resultType, "probe_image_input_violation");
```

测试场景：

- 本地模型为 `gpt-5.5`
- 假上游对 `input_image` 返回 `does not support image input`

- [ ] **Step 2: 跑测试，确认图片输入探针断言失败**

Run:

```powershell
node .\scripts\test-gateway-e2e.mjs
```

Expected:

- `probe_image_input_violation` 断言失败

- [ ] **Step 3: 增加最小图片载荷与图片探针请求**

```js
const PROBE_IMAGE_DATA_URL =
  "data:image/svg+xml;base64," +
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">' +
    '<rect width="64" height="64" fill="white"/>' +
    '<text x="32" y="42" text-anchor="middle" font-size="32">A</text>' +
    "</svg>",
  ).toString("base64");
```

```js
async function runImageInputProbe(runtime, targetModel, targetFamily) {
  const endpointPath = await resolveProbeEndpoint(runtime);
  const payload = {
    model: targetModel,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: "请只回答图片里的大写字母。" },
          { type: "input_image", image_url: PROBE_IMAGE_DATA_URL },
        ],
      },
    ],
  };
  return executeProbeRequest(runtime, {
    probeType: "image_input",
    endpointPath,
    payload,
    targetModel,
    targetFamily,
  });
}
```

- [ ] **Step 4: 实现图片输入违约分类，严格只认能力拒绝**

```js
function looksLikeImageInputUnsupported(payload) {
  const text = JSON.stringify(payload || {}).toLowerCase();
  return (
    text.includes("does not support image input") ||
    text.includes("image input is not supported") ||
    text.includes("vision is not supported") ||
    text.includes("input_image")
  );
}
```

```js
function classifyImageProbeResult(responseStatus, parsedBody, requestError) {
  if (requestError) {
    return { result: "transport_error", confidence: "low" };
  }
  if (looksLikeImageInputUnsupported(parsedBody)) {
    return {
      result: "violation",
      resultType: "probe_image_input_violation",
      confidence: "high",
    };
  }
  if (responseStatus >= 200 && responseStatus < 300) {
    return { result: "pass", confidence: "medium" };
  }
  return { result: "indeterminate", confidence: "low" };
}
```

- [ ] **Step 5: 把图片探针接入调度，但只限 `gpt-5.5`**

```js
if (
  targetFamily === "gpt-5.5" &&
  runtime.config.active_probe.image_input.enabled
) {
  await runImageInputProbe(runtime, targetModel, targetFamily);
}
```

- [ ] **Step 6: 跑测试，确认只在 `gpt-5.5` 下执行，且违约分类正确**

Run:

```powershell
node .\scripts\test-gateway-e2e.mjs
```

Expected:

- `gpt-5.5` 图片探针断言 PASS
- `gpt-5.4` 不触发图片探针断言 PASS

- [ ] **Step 7: 提交这一小步**

```bash
git add gateway.mjs scripts/test-gateway-e2e.mjs
git commit -m "feat: add gpt-5.5 image-input contract probe"
```

### Task 4: 实现响应结构与身份一致性辅助探针

**Files:**
- Modify: `C:\Users\dashuai\.config\superpowers\worktrees\codex-retry-gateway-git\codex-model-consistency-clean\gateway.mjs`
- Test: `C:\Users\dashuai\.config\superpowers\worktrees\codex-retry-gateway-git\codex-model-consistency-clean\scripts\test-gateway-e2e.mjs`

- [ ] **Step 1: 先写辅助探针 warning 断言**

```js
await runActiveProbeOnce(runtime);
const status = await getGatewayStatus();
assert.equal(status.active_probe.warning_type_counts.probe_response_structure_warning, 1);
assert.equal(status.active_probe.warning_type_counts.probe_identity_consistency_warning, 1);
assert.equal(status.active_probe.warning_count, 2);
assert.equal(status.active_probe.violation_count, 0);
```

测试场景：

- 假上游对结构化探针返回夹带额外文本的错误 JSON
- 对身份探针第一次自报 `gpt-5.5`，第二次自报 `gpt-5.3`

- [ ] **Step 2: 跑测试，确认 warning 统计尚未实现而失败**

Run:

```powershell
node .\scripts\test-gateway-e2e.mjs
```

Expected:

- `warning_count` 或 `warning_type_counts` 相关断言失败

- [ ] **Step 3: 扩展 probe monitor，加入 warning 统计**

```js
function applyProbeResultCounters(probeMonitor, sample) {
  if (sample.result === "warning") {
    probeMonitor.warning_count += 1;
    incrementStringCount(probeMonitor.warning_type_counts, sample.resultType);
  } else if (sample.result === "violation") {
    probeMonitor.violation_count += 1;
    incrementStringCount(probeMonitor.violation_type_counts, sample.resultType);
  }
}
```

- [ ] **Step 4: 实现响应结构辅助探针**

```js
async function runResponseStructureProbe(runtime, targetModel, targetFamily) {
  const payload = {
    model: targetModel,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              '请只输出 JSON，不要额外文本。把 a=1,b=2,c=3 转成 {"items":[{"key":"a","value":1},{"key":"b","value":2},{"key":"c","value":3}]}',
          },
        ],
      },
    ],
  };
  return executeProbeRequest(runtime, {
    probeType: "response_structure",
    endpointPath: await resolveProbeEndpoint(runtime),
    payload,
    targetModel,
    targetFamily,
  });
}
```

```js
function classifyResponseStructureProbeResult(responseText, requestError) {
  if (requestError) {
    return { result: "transport_error", confidence: "low" };
  }
  if (!looksLikeExpectedProbeJson(responseText)) {
    return {
      result: "warning",
      resultType: "probe_response_structure_warning",
      confidence: "medium",
    };
  }
  return { result: "pass", confidence: "medium" };
}
```

- [ ] **Step 5: 实现身份一致性辅助探针**

```js
async function runIdentityConsistencyProbe(runtime, targetModel, targetFamily) {
  const payload = {
    model: targetModel,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              '请只输出 JSON：{"self_reported_model":"...","self_reported_family":"...","claims_image_input":true,"claims_cutoff":"YYYY-MM-DD or unknown"}',
          },
        ],
      },
    ],
  };
  return executeProbeRequest(runtime, {
    probeType: "identity_consistency",
    endpointPath: await resolveProbeEndpoint(runtime),
    payload,
    targetModel,
    targetFamily,
    repeatCount: runtime.config.active_probe.identity_consistency.repeat_count,
  });
}
```

```js
function classifyIdentityConsistencyProbeResult(parsedReports) {
  const families = new Set(parsedReports.map((item) => item.self_reported_family).filter(Boolean));
  if (families.size > 1) {
    return {
      result: "warning",
      resultType: "probe_identity_consistency_warning",
      confidence: "medium",
    };
  }
  return { result: "pass", confidence: "low" };
}
```

- [ ] **Step 6: 跑测试，确认 warning 只进辅助统计，不进 violation**

Run:

```powershell
node .\scripts\test-gateway-e2e.mjs
```

Expected:

- `warning_count` 断言 PASS
- `violation_count` 不因这两类探针增加

- [ ] **Step 7: 提交这一小步**

```bash
git add gateway.mjs scripts/test-gateway-e2e.mjs
git commit -m "feat: add auxiliary structure and identity probes"
```

### Task 5: 实现训练截止日期 / 知识表现辅助探针

**Files:**
- Modify: `C:\Users\dashuai\.config\superpowers\worktrees\codex-retry-gateway-git\codex-model-consistency-clean\gateway.mjs`
- Test: `C:\Users\dashuai\.config\superpowers\worktrees\codex-retry-gateway-git\codex-model-consistency-clean\scripts\test-gateway-e2e.mjs`

- [ ] **Step 1: 先写 cutoff / knowledge warning 断言**

```js
await runActiveProbeOnce(runtime);
const status = await getGatewayStatus();
assert.equal(status.active_probe.warning_type_counts.probe_knowledge_cutoff_warning, 1);
assert.equal(status.active_probe.recent_samples[0].probe_type, "knowledge_cutoff");
assert.equal(status.active_probe.recent_samples[0].result, "warning");
```

- [ ] **Step 2: 跑测试，确认知识辅助探针尚未实现而失败**

Run:

```powershell
node .\scripts\test-gateway-e2e.mjs
```

Expected:

- `probe_knowledge_cutoff_warning` 断言失败

- [ ] **Step 3: 增加极小内置日期锚点题库**

```js
const KNOWLEDGE_CUTOFF_PROBE_QUESTIONS = [
  {
    id: "self_cutoff",
    prompt: '请只输出 JSON：{"claims_cutoff":"YYYY-MM-DD or unknown"}',
  },
  {
    id: "anchor_1",
    prompt: "请只回答一个带明确日期锚点的短事实题。",
  },
  {
    id: "anchor_2",
    prompt: "请只回答另一个带明确日期锚点的短事实题。",
  },
];
```

- [ ] **Step 4: 实现知识辅助探针分类，只产出 warning**

```js
function classifyKnowledgeCutoffProbeResult(summary) {
  if (summary.transportError) {
    return { result: "transport_error", confidence: "low" };
  }
  if (summary.claimsEarlyCutoff || summary.anchorFailureCount >= 2) {
    return {
      result: "warning",
      resultType: "probe_knowledge_cutoff_warning",
      confidence: "low",
    };
  }
  return { result: "pass", confidence: "low" };
}
```

- [ ] **Step 5: 把知识辅助探针接入调度，默认关闭**

```js
if (runtime.config.active_probe.knowledge_cutoff.enabled) {
  await runKnowledgeCutoffProbe(runtime, targetModel, targetFamily);
}
```

- [ ] **Step 6: 跑测试，确认知识探针只产生 warning**

Run:

```powershell
node .\scripts\test-gateway-e2e.mjs
```

Expected:

- `probe_knowledge_cutoff_warning` 断言 PASS
- `violation_count` 不受影响

- [ ] **Step 7: 提交这一小步**

```bash
git add gateway.mjs scripts/test-gateway-e2e.mjs
git commit -m "feat: add auxiliary cutoff and knowledge probes"
```

### Task 6: 接入调度、状态接口、管理页与文档

**Files:**
- Modify: `C:\Users\dashuai\.config\superpowers\worktrees\codex-retry-gateway-git\codex-model-consistency-clean\gateway.mjs`
- Modify: `C:\Users\dashuai\.config\superpowers\worktrees\codex-retry-gateway-git\codex-model-consistency-clean\README.md`
- Modify: `C:\Users\dashuai\.config\superpowers\worktrees\codex-retry-gateway-git\codex-model-consistency-clean\err.md`
- Test: `C:\Users\dashuai\.config\superpowers\worktrees\codex-retry-gateway-git\codex-model-consistency-clean\scripts\test-gateway-e2e.mjs`
- Test: `C:\Users\dashuai\.config\superpowers\worktrees\codex-retry-gateway-git\codex-model-consistency-clean\scripts\test-install-restore.mjs`

- [ ] **Step 1: 先写 UI 与状态接口失败测试**

```js
const html = await getGatewayUiHtml();
assert.match(html, /主动探针/);
assert.match(html, /warning/);

const status = await getGatewayStatus();
assert.ok(status.active_probe);
assert.ok(Array.isArray(status.active_probe.recent_samples));
assert.ok(status.active_probe.warning_type_counts);
```

- [ ] **Step 2: 跑测试，确认 UI 还没有主动探针区域而失败**

Run:

```powershell
node .\scripts\test-gateway-e2e.mjs
```

Expected:

- HTML 不含“主动探针”或 `warning` 展示字段，断言失败

- [ ] **Step 3: 加入探针调度生命周期与日志**

```js
function scheduleActiveProbes(runtime) {
  if (!runtime.config.active_probe.enabled) {
    return;
  }
  setTimeout(async () => {
    await safeRunActiveProbeOnce(runtime);
    runtime.probeTimer = setInterval(() => {
      safeRunActiveProbeOnce(runtime).catch(() => {});
    }, runtime.config.active_probe.interval_ms);
  }, runtime.config.active_probe.startup_delay_ms);
}
```

```js
async function safeRunActiveProbeOnce(runtime) {
  if (runtime.probeMonitor.running) {
    runtime.logger("[probe] skip reason=already_running");
    return;
  }
  runtime.probeMonitor.running = true;
  runtime.probeMonitor.last_started_at = new Date().toISOString();
  try {
    await runActiveProbeOnce(runtime);
  } finally {
    runtime.probeMonitor.running = false;
    runtime.probeMonitor.last_finished_at = new Date().toISOString();
  }
}
```

- [ ] **Step 4: 加入管理页主动探针展示，但不混入现有被动区域**

```html
<section class="card">
  <h2>主动探针</h2>
  <div class="kv-grid">
    <div><span>状态</span><strong id="probeEnabledValue">-</strong></div>
    <div><span>最近目标模型</span><strong id="probeTargetModelValue">-</strong></div>
    <div><span>最近运行</span><strong id="probeLastRunValue">-</strong></div>
    <div><span>通过次数</span><strong id="probePassCountValue">0</strong></div>
    <div><span>warning 次数</span><strong id="probeWarningCountValue">0</strong></div>
    <div><span>违约次数</span><strong id="probeViolationCountValue">0</strong></div>
    <div><span>传输错误</span><strong id="probeTransportErrorCountValue">0</strong></div>
  </div>
  <table>
    <tbody id="probeSamplesBody"></tbody>
  </table>
</section>
```

```js
function fillActiveProbe(probe) {
  refs.probeEnabledValue.textContent = probe?.enabled ? "已开启" : "未开启";
  refs.probeTargetModelValue.textContent = probe?.last_target_model || "-";
  refs.probeLastRunValue.textContent = formatTimestamp(probe?.last_finished_at);
  refs.probePassCountValue.textContent = String(probe?.pass_count ?? 0);
  refs.probeWarningCountValue.textContent = String(probe?.warning_count ?? 0);
  refs.probeViolationCountValue.textContent = String(probe?.violation_count ?? 0);
  refs.probeTransportErrorCountValue.textContent = String(probe?.transport_error_count ?? 0);
}
```

- [ ] **Step 5: 更新 README 与 err.md，写清边界和验证命令**

```md
- 主动探针默认关闭
- 第一阶段对 `gpt-5.4` / `gpt-5.5` 做硬契约探针
- 同时支持训练截止日期、响应结构、知识表现、身份一致性辅助探针
- 主动探针不识别真实底层模型身份
- 辅助探针默认只给 warning，不单独定罪
```

```md
25. 新增主动探针
   - 与普通代理统计隔离
   - 支持长上下文契约探针
   - 支持 `gpt-5.5` 图片输入契约探针
   - 支持响应结构、身份一致性、训练截止日期 / 知识表现辅助探针
```

- [ ] **Step 6: 跑完整验证**

Run:

```powershell
node .\scripts\test-gateway-e2e.mjs
powershell -ExecutionPolicy Bypass -File .\scripts\test-install-restore.ps1
```

Expected:

- `PASS codex-retry-gateway e2e`
- `PASS install-restore flow`

- [ ] **Step 7: 提交收口**

```bash
git add gateway.mjs README.md err.md scripts/test-gateway-e2e.mjs
git commit -m "feat: add active contract falsification probes"
```

## Self-Review

- 规格覆盖：
  - 已覆盖“只证伪不归因”
  - 已覆盖“保留现有被动流式监控为主”
  - 已覆盖“主动探针与普通代理统计隔离”
  - 已覆盖“长上下文 + `gpt-5.5` 图片输入”两类硬契约探针
  - 已覆盖“训练截止日期 / 响应结构 / 知识表现 / 身份一致性”辅助探针
  - 已覆盖“状态接口 / UI / 样本留存 / 日志”
- 占位符检查：
  - 无 `TODO`、`TBD`、`implement later`
- 类型一致性：
  - `active_probe`
  - `probe_low_context_family_violation`
  - `probe_image_input_violation`
  - `probe_response_structure_warning`
  - `probe_identity_consistency_warning`
  - `probe_knowledge_cutoff_warning`
  - `transport_error`
  - `indeterminate`
  - 命名在各任务中保持一致

Plan complete and saved to `docs/superpowers/plans/2026-06-28-model-contract-falsification.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
