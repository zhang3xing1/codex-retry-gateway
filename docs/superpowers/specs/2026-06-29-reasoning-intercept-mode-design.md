# codex-retry-gateway 流式/非流式独立拦截设计

日期：2026-06-29

状态：已批准，进入实现

关联资料：

- `docs/superpowers/specs/2026-06-28-project-source-of-truth.md`
- `docs/superpowers/specs/2026-06-29-high-risk-logic-checklist.md`

---

## 1. 背景

当前 `codex-retry-gateway` 对 `reasoning_tokens = 516 / 1034 / 1552` 的处理，默认等价于：

- 流式命中：拦截
- 非流式命中：拦截

但现有配置并没有“独立控制流式 / 非流式是否拦截”的能力。

当前只有：

- `reasoning_equals`
- `non_stream_status_code`
- `stream_action`

其中：

- `non_stream_status_code` 只控制非流式命中后返回什么状态码
- `stream_action` 只控制流式命中后怎么拦
- 并不能表达：
  - 只拦流式
  - 只拦非流式
  - 两者都拦

而用户现在明确需要把这 3 种模式都做成正式能力。

---

## 2. 本轮结论

本轮采用：

- 两个布尔开关

而不是单个枚举模式。

最终对外行为仍然只呈现 3 种合法状态：

1. 仅拦流式
2. 仅拦非流式
3. 流式 + 非流式都拦

不允许：

4. 两者都不拦

原因：

- 用户已经明确希望界面上就是两个选择框
- 当前代码里流式与非流式本来就是两条独立链路，布尔开关改动最小
- 后续如果还要做“只检测不拦截”或更细的调试能力，布尔开关更容易扩展

---

## 3. 目标

本轮目标：

1. 支持独立配置“是否拦截流式”
2. 支持独立配置“是否拦截非流式”
3. 默认值保持与当前行为一致
4. 保持命中检测、统计、日志、样本留存继续工作
5. 不因为关闭某一类拦截，就丢失该类命中观测能力
6. 不打坏现有主动探针、模型一致性和严格 `502` 流式逻辑

---

## 4. 非目标

本轮不做：

1. 不新增“命中但只记录 warning”的第四套配置层
2. 不新增新的 `stream_action` 枚举
3. 不把主动探针也并入这套开关
4. 不重构 `gateway.mjs` 文件结构
5. 不顺手改 UI 视觉风格

---

## 5. 配置设计

### 5.1 新增字段

在现有配置上新增：

```json
{
  "intercept_streaming": true,
  "intercept_non_streaming": true
}
```

### 5.2 默认值

默认保持：

```json
{
  "intercept_streaming": true,
  "intercept_non_streaming": true
}
```

这样升级后的默认行为与今天完全一致：

- 流式命中仍拦
- 非流式命中仍拦

### 5.3 合法性约束

配置必须满足：

- 至少一个为 `true`

即：

- `true + true`：合法
- `true + false`：合法
- `false + true`：合法
- `false + false`：非法

非法时：

- UI 不允许保存
- `/api/config` 后端也必须拒绝

---

## 6. 行为规则

### 6.1 非流式

非流式收到完整响应后：

1. 继续提取 `reasoning_tokens`
2. 继续判断是否命中 `reasoning_equals`
3. 继续记录 inspected / observed reasoning / matched 统计
4. 继续收集模型信号

然后分两种情况：

- `intercept_non_streaming = true`
  - 命中后按现有 `non_stream_status_code` 返回
- `intercept_non_streaming = false`
  - 命中后不拦截，正常透传原始响应

重点：

- 即使关闭非流式拦截，命中也仍然要被统计为“规则命中”
- 否则用户只是想临时不拦，但后台会误以为根本没命中

### 6.2 流式

流式处理继续保留当前 `strict_502` / `disconnect` 内部语义。

收到流式 chunk 后：

1. 继续解析 SSE
2. 继续提取 `reasoning_tokens`
3. 继续收集模型/指纹/response id 信号
4. 继续判断是否命中 `reasoning_equals`

然后分两种情况：

- `intercept_streaming = true`
  - 按现有 `stream_action` 逻辑执行拦截
- `intercept_streaming = false`
  - 不拦截
  - 整条流继续正常结束

重点：

- 即使关闭流式拦截，命中也仍然要进入命中统计
- 否则无法用“只观察不拦截”模式排查真实业务流量

---

## 7. 与现有统计的关系

### 7.1 需要保持不变的统计

下面这些统计仍然保留当前语义：

- `inspected_response_count`
- `observed_reasoning_counts`
- `matched_response_count`

其中：

- `matched_response_count` 必须保持表示“命中规则次数”
- 不能偷偷变成“实际被拦截次数”

### 7.2 建议新增的统计

为了避免“命中了但没拦”和“命中了也拦了”混在一起，新增：

```json
{
  "blocked_response_count": 0,
  "blocked_streaming_count": 0,
  "blocked_non_streaming_count": 0
}
```

以及：

```json
{
  "matched_streaming_count": 0,
  "matched_non_streaming_count": 0
}
```

这样状态面板可以明确区分：

- 规则命中次数
- 实际执行拦截次数

### 7.3 旧指标的处理

当前 `reasoning_516_ratio` 仍然只看 `516`。

这轮不强行改它的含义，但需要同步把文案讲清楚：

- 它仍然只是 `516` 专项占比
- 不是当前规则命中总占比

如果这轮顺手改动风险可控，也可以一起升级为：

- 新增 `matched_response_ratio`

但不要求替换掉 `reasoning_516_ratio`

---

## 8. 与模型一致性收口的关系

这轮必须顺手修掉一个高风险口径裂缝：

- 非流式命中拦截后没有进入 `finalizeModelInsights()`

否则一旦用户启用了“非流式也拦截”，

- 被动模型一致性样本会天然漏掉一批已命中的非流式响应

本轮要求：

- 非流式命中后，不管最终是否拦截，都要进入受控的模型一致性收口

但要注意：

- 正常规则命中不能被误判成 `single_request_rebuild_suspected`

---

## 9. UI 设计

### 9.1 控件位置

放在现有“拦截规则”卡片里，紧跟在：

- `reasoning_equals`

下面。

### 9.2 控件形态

使用两个复选框：

- `拦截流式`
- `拦截非流式`

并在旁边或下方加一行只读说明：

- `当前模式：仅流式 / 仅非流式 / 流式+非流式`

### 9.3 非法状态反馈

如果用户把两个都取消：

- 前端立即报错
- 不发送保存请求

错误文案建议：

- `流式与非流式至少选择一个拦截目标。`

### 9.4 不改的控件

下面这些控件仍保留：

- `reasoning_equals`
- `non_stream_status_code`
- `log_match`

其中：

- `non_stream_status_code` 即使在“仅拦流式”模式下也保留
- 因为用户切回“拦非流式”时还需要它

---

## 10. 日志设计

命中日志需要区分：

1. 命中且拦截
2. 命中但未拦截

建议：

- 非流式拦截：
  - `[match] non-stream ... action=status_502`
- 非流式仅记录：
  - `[match] non-stream ... action=observe_only`
- 流式拦截：
  - `[match] stream ... action=strict_502`
- 流式仅记录：
  - `[match] stream ... action=observe_only`

这样从日志上就能一眼看出：

- 是没命中
- 还是命中了但当前配置没拦

---

## 11. 配置保存与兼容性

### 11.1 读配置

老配置文件里没有：

- `intercept_streaming`
- `intercept_non_streaming`

读取时直接补默认值：

- 都为 `true`

### 11.2 写配置

保存时把两个字段写入最终 `config.json`

### 11.3 配置接口

`POST /__codex_retry_gateway/api/config`

新增允许写入：

- `intercept_streaming`
- `intercept_non_streaming`

并做合法性校验。

---

## 12. 测试矩阵

至少覆盖下面这些场景：

### 12.1 配置与 UI

1. 默认配置应为双开
2. UI 应回填两个复选框
3. 两项都取消时前端应拒绝保存
4. 两项都取消时后端也应拒绝非法配置

### 12.2 非流式

1. 双开模式下，非流式命中应返回拦截状态码
2. 仅流式模式下，非流式命中应正常透传
3. 仅流式模式下，非流式命中仍应增长 `matched_response_count`
4. 仅流式模式下，非流式命中仍应进入模型一致性收口

### 12.3 流式

1. 双开模式下，流式命中应按现有严格 `502` 拦截
2. 仅非流式模式下，流式命中应正常透传
3. 仅非流式模式下，流式命中仍应增长 `matched_response_count`
4. 仅非流式模式下，流式命中不应误报 `single_request_rebuild_suspected`

### 12.4 统计

1. `matched_response_count` 表示命中次数，而不是拦截次数
2. 新增 blocked 统计应只在实际拦截时增长
3. `reasoning_516_ratio` 仍维持旧口径或明确新增总命中占比字段

---

## 13. 实施顺序

推荐顺序：

1. 先扩配置模型和配置校验
2. 再改非流式命中逻辑
3. 再改流式命中逻辑
4. 再补统计字段
5. 再接 UI
6. 最后补 E2E 与安装回归

---

## 14. 最终决定

这轮正式采用：

- 两个布尔开关
- 至少一个必须开启
- 默认双开
- 命中检测与证据留存继续工作
- 拦截与统计口径显式分开

一句话总结：

- 我们不是把 `516/1034/1552` 检测关掉，而是把“命中后是否真正拦截”拆成流式和非流式两个独立开关。
