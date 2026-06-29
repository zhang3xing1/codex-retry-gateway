# codex-retry-gateway 高风险逻辑短清单

日期：2026-06-29

状态：当前代码事实审计稿

适用范围：

- `C:\Users\dashuai\.config\superpowers\worktrees\codex-retry-gateway-git\codex-model-consistency-clean`
- 本文不是实现方案，也不是排错时间线
- 本文只回答一件事：下一轮最容易继续出逻辑问题的点有哪些，为什么危险，先修谁最值

---

## 1. 使用前提

这份短清单基于当前代码事实，不基于“应该如此”的预期。

本轮重点只看三条链路：

1. 普通代理统计口径
2. 模型家族一致性（被动探针）口径
3. 主动探针是否继承了足够真实的 Codex 请求画像

排序规则不是“实现难度”，而是：

- 越容易继续制造误判、误报、返工，优先级越高

---

## 2. 结论先看

当前最值得先清的不是 UI，而是统计与画像口径。

建议优先顺序：

1. 主动探针请求画像污染风险
2. 模型一致性样本池口径裂开
3. 非流式命中拦截后未进入模型一致性收口
4. `516` 指标文案与默认拦截集合错位
5. 主动探针画像继承仍然过薄
6. 空目标家族时的 legacy fallback 边界

如果只允许先做两项，我建议先做：

1. 主动探针请求画像污染风险
2. 模型一致性样本池口径裂开

---

## 3. 高风险点 1：主动探针请求画像会被非目标流量污染

优先级：`P0`

代码位置：

- `gateway.mjs:363-378`
- `gateway.mjs:4468-4475`

当前事实：

- `proxyRequest()` 里只要请求进入普通代理分支，就会执行：
  - 记录 `runtime.lastClientUserAgent`
  - 调用 `buildActiveProbeRequestProfile(runtime, requestJson)`
- 这里不要求：
  - 请求一定是 Codex 真实业务请求
  - 请求一定命中被检查路径
  - 请求体一定带 `model`
  - 请求体一定带 `reasoning`

这意味着什么：

- 任何走到普通代理的请求，都可能刷新主动探针的“最近真实画像”
- 包括：
  - `/v1/models`
  - 手工 curl
  - 其他透传流量
  - 没有 JSON body 的请求

为什么容易继续出错：

- 用户现在本机路由一直在走真实 Codex 请求，画像一旦被别的流量覆盖，就会让主动探针“看起来像复刻了真实请求”，实际却不是
- 这类问题最隐蔽，因为探针仍然会成功发出去，但证据强度已经变差

建议验证方式：

1. 先让一条正常 Codex 请求经过 gateway
2. 再手工发送一个带自定义 `User-Agent` 的 `/v1/models`
3. 立刻点击“现在探测一次”
4. 抓上游请求头，确认主动探针是否继承了手工流量的 `User-Agent`

是否建议立刻修：

- 是

建议修复方向：

- 只从“足够像真实 Codex 业务请求”的样本更新主动探针画像
- 最低限度至少要求同时满足其中一组条件：
  - 命中被检查路径
  - `POST + JSON body`
  - 存在 `model` 或 `reasoning.effort`
- 非合格请求不应覆盖已有画像

---

## 4. 高风险点 2：被动模型一致性样本池会吃进旁路请求

优先级：`P0`

代码位置：

- `gateway.mjs:1094-1165`
- `gateway.mjs:4493-4514`

当前事实：

- 当请求没有命中 `config.endpoints` 时，`proxyRequest()` 会走旁路透传
- 但在这个分支里，仍然会先执行 `finalizeModelInsights(...)`
- `finalizeModelInsights()` 里只要本地模型家族属于 `gpt-5.4` / `gpt-5.5`，就会增长：
  - `model_consistency.total_checked`
  - `family_breakdown.*.consistency.total_checked`
- 同时还可能增长：
  - `local_model_counts`
  - `upstream_model_counts`
  - `stream_model_counts`
  - `unknown / matched / mismatched`

这意味着什么：

- “模型家族一致性（被动探针）”当前不是只看被检查响应
- 旁路请求也可能进入它的样本池

为什么容易继续出错：

- 页面上“被检查响应总数”和“模型一致性”会看起来像在说同一批样本，实际上不是
- 最典型的干扰项就是：
  - `/v1/models`
  - 其他未纳入检查的透传路径

建议验证方式：

1. 记录当前 `metrics.inspected_response_count`
2. 只发送一个不会命中检查路径的请求，例如 `/v1/models`
3. 再看 `model_insights.consistency.total_checked` 是否增长
4. 同时确认 `metrics.inspected_response_count` 不增长

是否建议立刻修：

- 是

建议修复方向：

- 明确决定“模型一致性样本池”到底属于哪一类：
  - 只统计被检查路径
  - 还是统计所有普通代理请求
- 一旦决定，就把 UI 文案、状态字段、测试断言全部对齐，不能一半按 inspected，一半按 all proxy

---

## 5. 高风险点 3：非流式命中拦截后，没有进入模型一致性收口

优先级：`P0`

代码位置：

- `gateway.mjs:4275-4323`
- `gateway.mjs:1094-1165`

当前事实：

- 非流式路径里，`recordInspectedResponse()` 在命中前就会增长：
  - `inspected_response_count`
  - `observed_reasoning_counts`
  - `matched_response_count`
- 但如果命中了 `reasoning_equals`，代码会直接返回 `502`
- 这条分支不会执行 `finalizeModelInsights(...)`

这意味着什么：

- 同样是“被检查并命中规则”的响应：
  - 流式命中会走 `finalizeModelInsights(...)`
  - 非流式命中不会

为什么容易继续出错：

- 这会把“命中拦截统计”和“模型一致性统计”切成两套不一致样本
- 尤其当某些异常刚好总是发生在被拦截的非流式响应上时，面板会天然漏掉它们

建议验证方式：

1. 构造一条非流式命中 `516 / 1034 / 1552` 的请求
2. 响应里同时带可识别的 `model`
3. 比较命中前后：
  - `matched_response_count`
  - `model_insights.consistency.total_checked`
  - 最近可疑样本
4. 确认是否出现“命中了，但模型一致性完全没动”

是否建议立刻修：

- 是

建议修复方向：

- 命中拦截后也应有一条受控的模型一致性收口路径
- 但要注意：
  - 不能因为正常拦截 `516`，反而误触发 `single_request_rebuild_suspected`
  - 需要把“正常规则命中”与“异常漂移”区分清楚

---

## 6. 高风险点 4：`reasoning_516_ratio` 与默认拦截集合已经错位

优先级：`P1`

代码位置：

- `gateway.mjs:1168-1185`

当前事实：

- 当前默认拦截集合已经是：
  - `516`
  - `1034`
  - `1552`
- 但 `buildMetricsSnapshot()` 里仍然只计算：
  - `reasoning_516_count`
  - `reasoning_516_ratio = observed_reasoning_counts["516"] / inspected_response_count`

这意味着什么：

- 页面上的“516 占比”仍然是旧时代指标
- 它不等于“当前规则命中占比”

为什么容易继续出错：

- 后续如果继续围绕“命中率”讨论，很容易拿错数
- 特别是在默认集合已变成三档时，用户直觉会自然把它理解成“总拦截占比”

建议验证方式：

1. 保持默认规则 `516,1034,1552`
2. 分别构造三种命中
3. 观察：
  - `matched_response_count`
  - `observed_reasoning_counts`
  - `reasoning_516_ratio`
4. 确认 `1034 / 1552` 命中不会体现在 `516 占比`

是否建议立刻修：

- 可以紧随前三项之后修

建议修复方向：

- 二选一，必须选清楚：
  - 保留它是“516 专项指标”，那就把 UI 文案讲死
  - 改成“当前规则命中占比”，那就按 `matched_response_count / inspected_response_count` 计算

---

## 7. 高风险点 5：主动探针画像继承仍然过薄，不等于真实请求复刻

优先级：`P1`

代码位置：

- `gateway.mjs:1345-1354`
- `gateway.mjs:1527-1548`

当前事实：

- 当前主动探针只继承：
  - `User-Agent`
  - `reasoning.effort`
- 其他真实请求特征并没有被继承或对齐，例如：
  - 更多请求头
  - 更多 body 字段
  - 其他可能影响上游调度或能力表现的参数

这意味着什么：

- 现在可以说“主动探针比之前更像真实 Codex 请求”
- 但不能说“已经完整复刻真实 Codex 请求画像”

为什么容易继续出错：

- 如果后续把主动探针结果直接拿来和真实业务流量一一对照，会高估证据强度
- 用户已经观察到“后台看到的探测上下文只有 4.5k、没有 user agent、没有推理强度”等现象，这类问题就属于画像继承不完整的典型风险区

建议验证方式：

1. 抓一条真实 Codex 请求的完整上游包
2. 再抓同模型、同阶段的主动探针包
3. 对比：
  - 请求头
  - body 顶层字段
  - `reasoning`
  - 输入结构
4. 列出当前真正做到的“已继承字段清单”

是否建议立刻修：

- 不建议在口径未定前盲目加字段

建议修复方向：

- 先明确“探针最少要拟真到什么程度才够用”
- 再按字段白名单补，不要走“看到缺什么就随手加什么”

---

## 8. 高风险点 6：空目标家族时仍然保留 local model fallback

优先级：`P2`

代码位置：

- `gateway.mjs:2291-2305`
- `gateway.mjs:2543-2545`
- `gateway.mjs:3397-3400`

当前事实：

- `resolveActiveProbeTargets()` 在 `target_families` 为空时，仍会尝试 fallback 到本地模型家族
- 但当前 UI 与配置接口已经明确禁止：
  - 自动探测开启时没有选中任何目标模型

这意味着什么：

- 正常 UI 路径下，这个 fallback 不该经常出现
- 但它仍然会影响：
  - 手工改 `config.json`
  - 旧脏配置
  - 内部或脚本化手动调用

为什么容易继续出错：

- 它不是当下最容易炸的 bug
- 但非常容易在后续讨论时造成“我明明没选目标，它怎么还是跑了”的口径混乱

建议验证方式：

1. 手工把 `active_probe.target_families` 清空
2. 不走 UI，直接重启 gateway 或走手动触发
3. 观察主动探针是否仍按本地模型运行

是否建议立刻修：

- 不建议作为第一优先级

建议修复方向：

- 先决定要不要继续保留这个 legacy fallback
- 如果不要，就彻底删掉
- 如果要保留，就必须在文档和状态里把它讲明白

---

## 9. 这轮不建议误判成 bug 的点

下面这些点当前更适合标成“边界复杂”，不建议直接当现网 bug 定性：

1. `total_proxy_request_count` 与 `inspected_response_count` 不一致
   - 只要能被旁路请求、失败请求、进行中请求解释，就不是 bug
2. 主动探针看到几千 token
   - 如果看到的是 `baseline / seed` 校准轮，不一定是 bug
3. `warning`、`violation`、`transport_error` 的分层本身
   - 这是设计选择，不是天然逻辑错

---

## 10. 推荐的下一轮收口顺序

推荐按下面顺序推进，而不是继续同时改很多点：

1. 先收紧主动探针画像采样条件
2. 再统一模型一致性样本池口径
3. 再补非流式命中后的模型一致性收口
4. 再决定 `516` 指标是保留专项，还是升级为“当前规则命中占比”
5. 最后再讨论主动探针还需要继承哪些真实请求字段

这样做的原因：

- 前三项决定“现在面板上的数到底能不能信”
- 后两项才是“怎么让探针更像真实请求”

---

## 11. 当前一句话结论

当前最危险的不是“某个按钮没对齐”，而是：

- 主动探针可能拿错画像
- 被动模型一致性可能没在看同一批样本

如果这两个口径不先钉死，后面继续加探针、加指标、加 UI，只会越改越乱。
