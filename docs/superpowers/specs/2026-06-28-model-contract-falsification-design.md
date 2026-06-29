# codex-retry-gateway 模型声明证伪探针设计

日期：2026-06-28

状态：待主线程审阅，确认后进入实现

关联资料：

- `docs/superpowers/specs/2026-06-28-model-family-consistency-design.md`
- `C:\Users\dashuai\Documents\Playground\gbrain-brain\inbox\2026-06-28-openai-gpt5-probe-doc-summary.md`
- `C:\Users\dashuai\Documents\Playground\gbrain-brain\inbox\2026-06-28-open-source-llm-probe-projects.md`

## 1. 背景

当前 `codex-retry-gateway` 已经具备一套稳定的被动监控链路：

- 代理 Codex 到上游的真实请求
- 检查非流式与流式响应
- 识别 `reasoning_tokens = 516`
- 识别本地模型、上游声明模型、流式声明模型
- 识别 `400K` 家族异常
- 识别单请求模型漂移、`system_fingerprint` 漂移与疑似请求内重建/重试
- 在 UI 中展示统计与最近可疑样本，并保留日志证据

这套被动流式监控已经证明是当前项目的最佳主路径，原因有三点：

1. 它直接观测真实业务流量，证据最贴实战
2. 它已经嵌入当前网关架构，改动成本最低
3. 它不会像重型探针那样持续扰动正常使用链路

但仅靠被动监控也有边界：

- 很多能力违约不会自然撞出来
- 长上下文与图片输入这类契约，只有主动发请求才更容易稳定拿到证据
- 如果上游声明稳定、被动流量又没有覆盖到关键场景，就会长期停留在“证据不足”

因此，本设计的目标不是替换现有被动监控，而是在其上叠加一层低频、可控、证据明确的主动证伪探针。

本轮最终统一定义为一句话：

- 向目标接口发送结构化探测请求，并结合返回协议、响应结构、知识问答结果、身份一致性、可观测思维痕迹和签名指纹等维度综合评分。

## 2. 本轮会话结论

### 2.1 只做声明证伪，不做真实归因

本项目当前没有可信真值源，无法建立可靠的“标准模型响应样本库”。

因此第一期明确采用下面的口径：

- 可以判断：上游表现是否违背其声明的 `gpt-5.4` / `gpt-5.5` 家族契约
- 不判断：上游底层真实到底是 `gpt-5.4-mini`、`gpt-5.3`、`deepseek` 或其他模型

UI 与日志都必须坚持这个口径，避免把“疑似违约”写成“已确认掺水”。

### 2.2 被动流式仍然是主路径

第一期不拆当前被动监控链路，不把主动探针塞进普通代理路径。

主动探针是补充层，作用是：

- 更快撞到公开能力边界
- 形成更硬的反证
- 给 UI 增加“最近一次主动验证结果”

### 2.3 现有源码架构可直接承载主动探针

当前 `gateway.mjs` 已经有下面这些成熟积木：

- `createRequestModelContext()`
- `applyPayloadModelSignals()`
- `finalizeModelInsights()`
- `fetchUpstreamWithRetry()`
- `buildModelInsightsSnapshot()`
- `buildLogsSnapshot()`
- 管理页状态接口、日志接口、可疑样本展示

第一期主动探针应尽量复用这些能力，只补一套“独立 probe runtime + 独立 probe monitor”，避免：

- 影响 `proxyRequest()` 的请求统计
- 干扰现有 `516` 命中逻辑
- 把主动探针流量误算为真实用户流量

## 3. 目标

第一期目标：

1. 保留现有被动流式监控为主
2. 在网关进程内增加低频主动探针调度
3. 主动探针与普通代理统计完全隔离
4. 主动探针的结果可以进入状态接口、UI 与样本留存
5. 只对 `gpt-5.4` / `gpt-5.5` 家族做契约证伪
6. 把训练截止日期、响应结构、知识表现、身份一致性并入辅助探针层
7. 所有结论都保留证据，不只给计数

## 4. 非目标

第一期明确不做：

- 不识别真实底层模型身份
- 不做中文污染、文风、礼貌口吻这类主观探针
- 不引入训练型分类器
- 不做高频持续压测
- 不做复杂多轮链式对话探针
- 不做 PDF / 文件 / prompt caching 主探针
- 不把主动探针请求重新走本地代理回环

## 5. 官方契约矩阵

基于当前已汇总的 OpenAI 官方资料，第一期只采用下面的公开契约：

### 5.1 `gpt-5.5`

第一期采用的硬契约：

- 属于 `1M` 上下文家族
- 支持图片输入

第一期不直接采用的契约：

- prompt caching
- 工具能力细节
- 复杂视觉理解质量

原因：

- 这些能力要么需要更复杂的请求控制，要么容易受中间层包装影响，适合作为第二期补充信号

### 5.2 `gpt-5.4`

第一期采用的硬契约：

- 属于 `1M` 上下文家族

第一期暂不把“图片输入失败”作为 `gpt-5.4` 的硬违约。

原因：

- 官方总览对“最新模型支持 image input”给了总说明
- 但当前单独针对 `gpt-5.4` 的逐项公开材料不如 `gpt-5.5` 明确
- 为了压低误报，第一期对 `gpt-5.4` 主动探针只采用长上下文契约

## 6. 主动探针分层

第一期采用两层探针：

1. `硬契约探针`
   - 可直接产出 `violation`
2. `辅助探针`
   - 只产出 `warning`
   - 默认不单独定罪

这样分层的原因是：

- 长上下文、图片输入这类公开契约更硬
- 训练截止日期、知识表现、自报身份、格式跟随这类信号更容易被上游包装、采样、隐藏检索或系统提示污染

### 6.1 结果等级

主动探针结果统一分为：

- `pass`
- `warning`
- `violation`
- `transport_error`
- `indeterminate`

含义：

- `pass`
  - 当前探针未观察到异常
- `warning`
  - 观察到辅助异常，但不足以单独定罪
- `violation`
  - 命中硬契约反证
- `transport_error`
  - 链路、协议、鉴权、超时等异常
- `indeterminate`
  - 拿到了响应，但无法稳定归类

补充说明：

- 第一阶段虽然仍保留 `warning / violation` 这类离散结论
- 但实现视角会把每次主动探针视为一次“多维采样 + 综合评分”
- 其中硬契约维度优先级最高，辅助维度用于抬高或压低风险等级

## 7. 硬契约探针

### 7.1 长上下文契约探针

适用目标：

- `gpt-5.4`
- `gpt-5.5`

目的：

- 主动撞 `>400K` 且明显 `<1M` 的上下文区间
- 观察是否出现明显低上下文家族错误

判定原则：

- 如果明确出现 `400000`
- 或明显 `400K` 文案
- 或 `context_length_exceeded`
- 且当前本地声明家族为 `gpt-5.4` / `gpt-5.5`

则记为：

- `violation` 级别的 `probe_low_context_family_violation`

说明：

- 这仍然只证明“不像 1M 家族”
- 不证明“真实就是某个具体 mini 模型”

### 7.2 图片输入契约探针

适用目标：

- `gpt-5.5`

目的：

- 主动验证声明为 `gpt-5.5` 的链路是否至少接受图片输入

判定原则：

- 只有在上游明确返回“不支持 image input / vision / input_image”等能力拒绝时，才记为违约
- 如果只是答错图内容、答得含糊、或返回普通推理错误，不记为违约
- 如果是超时、`404`、`401`、路由不支持 `/responses`、网关本身 transport error，只记为 `transport_error`

这样设计的原因是：

- “图内容回答得不好”不等于“不支持图片输入”
- 但“明确不支持图片输入”对 `gpt-5.5` 来说是高价值反证

## 8. 辅助探针

### 8.1 响应结构辅助探针

适用目标：

- `gpt-5.4`
- `gpt-5.5`

目的：

- 检查模型在低复杂度场景下，是否能稳定遵循固定响应结构
- 为“声明是高能力模型，但结构跟随明显异常”的场景提供辅助样本

请求策略：

- 使用一个极短输入
- 要求模型只返回固定 JSON 结构
- 结构中包含：
  - 固定键
  - 固定顺序
  - 一个简单转换任务

判定原则：

- 单次失败不定罪
- 同一轮或连续多轮出现：
  - 非 JSON
  - 关键键缺失
  - 顺序明显漂移
  - 输出夹带大量额外文本

则记为：

- `warning` 级别的 `probe_response_structure_warning`

说明：

- 这不是公开能力硬边界
- 它只用于补充“响应稳定性 / 格式跟随性”证据

### 8.2 身份一致性辅助探针

适用目标：

- `gpt-5.4`
- `gpt-5.5`

目的：

- 收集模型自报身份、家族、是否支持图片输入、是否声称自己具备某些能力
- 观察这些自报是否在固定结构内自相矛盾或反复漂移

请求策略：

- 要求模型只返回固定 JSON，例如：
  - `self_reported_model`
  - `self_reported_family`
  - `claims_image_input`
  - `claims_cutoff`

判定原则：

- 自报字符串本身不作为定罪依据
- 只有当同一轮返回里自相矛盾，或连续多轮自报反复漂移时，才记为：
  - `warning` 级别的 `probe_identity_consistency_warning`

说明：

- 这类信号很容易被系统提示或上游包装影响
- 只能作为辅助证据，不能单独宣布“掺水”

### 8.3 训练截止日期 / 知识表现辅助探针

适用目标：

- `gpt-5.4`
- `gpt-5.5`

目的：

- 记录模型自报 cutoff
- 用极小规模、带日期锚点的问题集观察知识表现是否异常

请求策略：

- 分成两部分：
  1. 让模型自报 cutoff
  2. 询问少量带明确时间锚点的事实题

题目选择原则：

- 日期明确
- 答案短
- 不依赖复杂推理
- 可在本地内置极小题库

判定原则：

- 单题答错不记违约
- 自报 cutoff 偏早、且知识表现异常时，记为：
  - `warning` 级别的 `probe_knowledge_cutoff_warning`

说明：

- 这类信号会受到隐藏检索、系统提示和模型自我描述偏差影响
- 只能作为辅助样本，不进入高风险违约计数

## 9. 不采用的探针方式

第一期明确不采用：

- 中文污染 / 文风分析
- 纯 style fingerprint
- 复杂多轮链式追问
- 工具调用一致性作为主判据
- 任何试图“直接识别真实底层模型是谁”的分类器结论

原因：

- 容易被伪装
- 证据解释性差
- 误报成本高

补充说明：

- “你是什么模型”不再作为独立定罪方式
- 但会被吸收到“身份一致性辅助探针”中，仅作为 `warning` 样本

## 10. 架构设计

### 10.1 总体结构

在现有 `runtime` 上新增一个独立的主动探针运行层：

```js
{
  runtime,
  probeMonitor,
  probeState,
  probeTimer
}
```

关键原则：

- 不经过 `proxyRequest()`
- 不增加 `total_proxy_request_count`
- 不污染 `inspected_response_count`
- 不复用“真实代理请求”的可疑样本列表
- 只共享模型解析、响应解析、错误识别、日志记录这类基础能力

### 10.2 新增配置

在现有 `config.json` 上新增：

```json
{
  "active_probe": {
    "enabled": false,
    "interval_ms": 900000,
    "startup_delay_ms": 60000,
    "timeout_ms": 120000,
    "endpoint_candidates": ["/responses", "/v1/responses"],
    "image_input": {
      "enabled": true
    },
    "response_structure": {
      "enabled": false,
      "repeat_count": 2
    },
    "identity_consistency": {
      "enabled": false,
      "repeat_count": 2
    },
    "knowledge_cutoff": {
      "enabled": false,
      "max_questions": 3
    },
    "long_context": {
      "enabled": true,
      "target_word_count": 460000
    }
  }
}
```

配置语义：

- `enabled`
  - 是否开启主动探针
- `interval_ms`
  - 周期探针间隔
- `startup_delay_ms`
  - gateway 刚启动后等待多久再跑首轮探针
- `timeout_ms`
  - 单次探针超时
- `endpoint_candidates`
  - 探针优先尝试的上游 Responses 路径
- `image_input.enabled`
  - 是否允许 `gpt-5.5` 图片输入探针
- `response_structure.enabled`
  - 是否开启响应结构辅助探针
- `identity_consistency.enabled`
  - 是否开启身份一致性辅助探针
- `knowledge_cutoff.enabled`
  - 是否开启训练截止日期 / 知识表现辅助探针
- `long_context.target_word_count`
  - 长上下文探针的目标伪词数量

### 10.3 为什么要 `endpoint_candidates`

主动探针无法像普通代理请求那样天然继承 Codex 的真实路径，因此需要一个上游探针路径。

第一期不做“自动适配所有协议”，而是：

1. 先按 `["/responses", "/v1/responses"]` 顺序尝试
2. 一旦某个路径成功，优先复用最近成功路径
3. 如果所有候选路径都失败，只记 `transport_error`
4. 不把“探针路径不兼容”误判成模型违约

## 11. 运行逻辑

### 11.1 是否执行主动探针

每轮调度开始时：

1. 读取当前本地顶层 `model`
2. 归一化模型家族
3. 只有家族属于 `gpt-5.4` / `gpt-5.5` 时才继续
4. 若本地模型未知、配置缺失或主动探针关闭，则本轮跳过

### 11.2 调度顺序

每轮主动探针按固定顺序：

1. 读取当前本地模型
2. 先跑长上下文探针
3. 如果当前家族是 `gpt-5.5` 且图片探针开启，再跑图片输入探针
4. 如果响应结构探针开启，再跑响应结构辅助探针
5. 如果身份一致性探针开启，再跑身份一致性辅助探针
6. 如果训练截止日期 / 知识表现探针开启，再跑知识辅助探针
7. 每个探针独立记录结果

### 11.3 探针请求不走流式

第一期主动探针统一使用非流式请求。

原因：

- 主动探针主要目的是撞能力边界，不需要流式首 token 体验
- 非流式更容易收集完整错误体
- 非流式更容易稳定复用现有 `handleNonStreaming()` 的数据提取思路

## 12. 探针请求设计

### 12.1 长上下文探针

请求模型：

- 当前本地配置顶层 `model`

请求接口：

- `endpoint_candidates` 中第一个可用 Responses 路径

请求体策略：

- 构造一段由大量编号伪词组成的长文本
- 例如：
  - `w000001 w000002 ...`
- 在末尾附一条极短指令：
  - `只回复 OK`

设计理由：

- 编号伪词比重复单词更不容易被 tokenizer 高度压缩
- 我们的目标是逼近或超过低上下文家族阈值，而不是做复杂长文理解

### 12.2 图片输入探针

请求模型：

- 当前本地配置顶层 `model`

触发条件：

- 当前家族为 `gpt-5.5`
- `active_probe.image_input.enabled = true`

请求体策略：

- 使用一张仓库内可控的极小图片，以 `data:` URL 形式放入 `input_image`
- 图片内容足够简单，例如：
  - 单色背景 + 单个大字母
- 指令只要求模型做一个极低歧义回答，例如：
  - `请只回答图片中的大写字母`

说明：

- 第一阶段不把“答错字母”视作违约
- 我们只验证“能否接受图片输入”，不验证视觉质量排行榜

### 12.3 响应结构探针

请求体策略：

- 给出极短结构化任务
- 强制只返回 JSON
- 固定键、固定顺序、固定字段类型

### 12.4 身份一致性探针

请求体策略：

- 强制只返回 JSON
- 收集：
  - `self_reported_model`
  - `self_reported_family`
  - `claims_image_input`
  - `claims_cutoff`
- 通过重复请求观察漂移

### 12.5 训练截止日期 / 知识探针

请求体策略：

- 先自报 cutoff
- 再用极小日期锚点题库做补充
- 只收集辅助证据，不做硬定罪

## 13. 数据结构

### 13.1 新增主动探针监控结构

```js
{
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
    knowledge_cutoff: 0
  },
  warning_type_counts: {
    probe_response_structure_warning: 0,
    probe_identity_consistency_warning: 0,
    probe_knowledge_cutoff_warning: 0
  },
  violation_type_counts: {
    probe_low_context_family_violation: 0,
    probe_image_input_violation: 0
  },
  last_successful_endpoint: null,
  recent_samples: []
}
```

### 13.2 主动探针样本结构

```js
{
  ts,
  probe_type,
  target_model,
  target_family,
  endpoint_path,
  result,
  result_type,
  confidence,
  http_status,
  duration_ms,
  error_excerpt,
  upstream_model,
  stream_model,
  final_response_model,
  observed_models,
  observed_fingerprints,
  evidence_logs
}
```

## 14. 日志与证据

主动探针日志统一加 `[probe]` 前缀，例如：

- `[probe] start type=long_context family=gpt-5.5 endpoint=/responses`
- `[probe] pass type=image_input family=gpt-5.5 status=200`
- `[probe] warning type=identity_consistency family=gpt-5.4 reason=self_report_drift`
- `[probe] violation type=long_context family=gpt-5.4 reason=low_context_family`
- `[probe] error type=image_input family=gpt-5.5 category=transport_error`

证据保留原则：

- 每次探针都保留一条样本
- 命中 `warning` 或 `violation` 的样本额外保留相关日志片段
- 不只保留最终结论，也保留：
  - endpoint
  - 状态码
  - 上游声明模型
  - 指纹集合
  - 错误摘录

第一阶段建议保留的评分维度包括：

- 返回协议
- 响应结构
- 知识问答结果
- 身份一致性
- 可观测思维痕迹
- 签名指纹

其中：

- `可观测思维痕迹` 只指外显信号
- 例如 `reasoning_tokens`、SSE 事件形态、拒答模式、声明字段和分段特征
- 不以强行提取完整隐藏思维链文本为目标

## 15. 状态接口与 UI

### 15.1 状态接口

扩展 `GET /__codex_retry_gateway/api/status`：

```json
{
  "active_probe": {
    "enabled": false,
    "running": false,
    "last_started_at": null,
    "last_finished_at": null,
    "last_target_model": null,
    "last_target_family": null,
    "total_runs": 0,
    "skipped_runs": 0,
    "pass_count": 0,
    "warning_count": 0,
    "violation_count": 0,
    "transport_error_count": 0,
    "indeterminate_count": 0,
    "endpoint_success_counts": {},
    "probe_type_counts": {},
    "warning_type_counts": {},
    "violation_type_counts": {},
    "last_successful_endpoint": null,
    "recent_samples": []
  }
}
```

### 15.2 管理页展示

管理页增加一个独立的“主动探针”面板，和当前“模型家族一致性”并列，不混在一起。

概览卡片：

- 主动探针状态
- 最近目标模型
- 最近一次运行时间
- 通过次数
- warning 次数
- 违约次数
- transport error 次数

样本表：

- 时间
- 探针类型
- 目标模型
- endpoint
- 结果
- 结果类型
- 可信度
- 状态码
- 耗时
- 上游模型
- 指纹集合
- 日志证据

说明文案必须明确：

- 主动探针只验证声明契约
- `warning` 代表辅助异常，不代表硬违约
- `violation` 不代表已识别出真实底层模型
- `transport_error` 不计入违约

## 16. 误报抑制

第一期必须遵守以下抑制规则：

1. 探针请求不进入普通代理统计
2. 探针 transport 异常不记为模型违约
3. 图片探针只有“明确不支持图片输入”才记违约
4. 长上下文探针只有“明确 `400K` / `context_length_exceeded`”才记违约
5. 不把普通答错、普通拒答、普通安全拦截直接记为违约
6. 不把当前严格 `502` 的 `516` 正常拦截误并入主动探针异常
7. 训练截止日期、知识表现、身份一致性、响应结构默认只产出 `warning`

## 17. 与现有被动监控的关系

### 17.1 保持不变

现有这些逻辑不改语义：

- `516` 严格 `502`
- 被动声明一致率
- 被动 `400K` 家族异常
- 单请求模型漂移
- 指纹漂移
- 疑似请求内重建/重试

### 17.2 新增但隔离

主动探针：

- 复用模型信号提取逻辑
- 复用错误识别逻辑
- 复用日志与样本保留思路
- 但拥有完全独立的计数、样本和 UI 区块

## 18. 为什么不直接上“模型指纹分类器”

这轮会话已经确认：

- 没有可信基线真值源
- 无法建立可靠“标准响应样本库”

因此第一期不采用：

- embedding 相似度归因
- 小型分类器
- 风格 fingerprint

主动探针只做“契约是否被违背”的证伪。

## 19. 实施顺序

推荐顺序：

1. 先补配置加载与 probe runtime
2. 再补长上下文探针
3. 再补图片输入探针
4. 再补响应结构与身份一致性辅助探针
5. 再补训练截止日期 / 知识表现辅助探针
6. 再补状态接口与 UI
7. 最后补 E2E 与文档

原因：

- 长上下文探针与现有 `400K` 家族异常逻辑最接近
- 图片探针是第二个高价值硬证据
- 其余三类探针更适合做辅助层
- UI 只消费稳定状态接口

## 20. 验证要求

实现后至少验证：

1. 被动统计仍正常
2. 主动探针开启前后不影响真实代理请求总数口径
3. 主动长上下文探针命中低上下文错误时，能单独记录 `probe_low_context_family_violation`
4. 主动图片探针命中“不支持图片输入”时，能单独记录 `probe_image_input_violation`
5. 响应结构、身份一致性、训练截止日期 / 知识表现只进入 `warning`
6. 主动探针 transport error 不会误报为违约
7. UI 能分别看被动样本和主动探针样本

## 21. 风险与边界

- 如果上游同时伪造声明并完整满足公开契约，第一期无法证明掺水
- 长上下文探针的“接近 token 阈值”只能做保守近似，第一期以“明确低上下文错误”为主判据
- 图片探针验证的是“图片输入契约”，不是完整视觉质量
- 训练截止日期、知识表现、身份一致性、响应结构都只是辅助证据
- 若上游根本不支持 Responses 路径，主动探针会长期处于 `transport_error`，但这不是模型违约

## 22. 最终建议

采用“被动流式为主、主动低频证伪为辅”的混合架构：

1. 保留现有被动监控主链路
2. 新增独立主动探针运行层
3. 第一阶段只做：
   - `gpt-5.4` / `gpt-5.5` 的长上下文契约探针
   - `gpt-5.5` 的图片输入契约探针
   - 响应结构、身份一致性、训练截止日期 / 知识表现辅助探针
4. 辅助探针默认只产出 `warning`，不单独定罪
5. 只输出“通过 / 证据不足 / 疑似违约 / 高风险违约”这类契约结论
6. 不输出“真实底层模型是谁”的归因结论
