# codex-retry-gateway 项目真源说明书

日期：2026-06-28

状态：当前代码事实整理稿

适用范围：

- `C:\Users\dashuai\.config\superpowers\worktrees\codex-retry-gateway-git\codex-model-consistency-clean`
- 本文只描述“当前仓库代码已经实现了什么、没实现什么、哪些统计和结论的口径是什么”
- 不替代 `README.md` 的快速使用说明，也不替代 `err.md` 的排错时间线

---

## 1. 这个项目到底是什么

`codex-retry-gateway` 是一个挂在 Codex 本地配置前面的独立本地网关。

它当前的核心定位只有三件事：

1. 接管 Codex 当前 provider 的 `base_url` 到本地 `http://127.0.0.1:4610`
2. 代理 Codex 与上游之间的真实请求
3. 在代理过程中做两类观测与控制：
   - `reasoning_tokens = 516 / 1034 / 1552` 的拦截
   - 模型家族一致性与主动探针证据留存

一句话概括：

- 它是“本地代理 + 响应检查 + 证据面板”，不是协议转换层，也不是模型鉴定器。

---

## 2. 明确职责与非职责

### 2.1 当前职责

当前代码已经明确负责：

- 代理 root 与 `/v1` 两套路径：
  - `/responses`
  - `/chat/completions`
  - `/v1/responses`
  - `/v1/chat/completions`
- 非流式响应里检查 `reasoning_tokens`
- 流式响应里缓存 SSE，再检查 `reasoning_tokens`
- 命中配置集合时返回 `502`
- UI 内查看运行状态、日志、模型一致性、主动探针样本
- 通过脚本安装、启动、恢复当前 Codex provider 配置

### 2.2 当前明确不负责

当前代码没有实现，也不应该被文档表述成已经实现：

- `Responses` 与 `Chat Completions` 协议互转
- 把不兼容的上游修成 Codex 可用
- 识别“真实底层到底是什么模型”
- 用单次样本证明“上游一定掺水”
- 证明 provider 内部一定发生了缓存重建
- 对所有模型家族提供通用探针

这几个边界必须一直记住，否则讨论会非常容易跑偏。

---

## 3. 项目构成

### 3.1 主逻辑

主逻辑几乎全部在 [gateway.mjs](C:/Users/dashuai/.config/superpowers/worktrees/codex-retry-gateway-git/codex-model-consistency-clean/gateway.mjs)。

它同时承载：

- HTTP server
- 普通代理
- `516/1034/1552` 拦截
- 模型一致性统计
- 主动探针
- 管理页 HTML
- 管理接口

这意味着：

- 当前实现非常集中
- 优点是单文件容易追链路
- 缺点是职责密集，任何改动都容易互相影响

### 3.2 管理脚本

脚本层不是业务逻辑核心，但决定“怎么被安装和拉起”：

- [scripts/install-for-current-provider.mjs](C:/Users/dashuai/.config/superpowers/worktrees/codex-retry-gateway-git/codex-model-consistency-clean/scripts/install-for-current-provider.mjs)
  - 负责备份当前 Codex 配置，并把当前 provider 的 `base_url` 改到本地 gateway
- [scripts/launch-ui.mjs](C:/Users/dashuai/.config/superpowers/worktrees/codex-retry-gateway-git/codex-model-consistency-clean/scripts/launch-ui.mjs)
  - 负责一键安装/复用 + 启动 gateway + 打开 UI
- [scripts/start-gateway.mjs](C:/Users/dashuai/.config/superpowers/worktrees/codex-retry-gateway-git/codex-model-consistency-clean/scripts/start-gateway.mjs)
  - 负责启动或重启 gateway
- [scripts/restore-codex-config.mjs](C:/Users/dashuai/.config/superpowers/worktrees/codex-retry-gateway-git/codex-model-consistency-clean/scripts/restore-codex-config.mjs)
  - 负责脚本级回滚

结论：

- 项目有一套完整的安装/运行/恢复闭环
- 这套闭环和 `gateway.mjs` 本身是配套关系，不是两个独立产品

---

## 4. 真实运行链路

### 4.1 安装链路

安装时做的真实动作是：

1. 读取当前 Codex `config.toml`
2. 定位当前 provider
3. 备份原 `config.toml`
4. 生成 gateway 运行配置到用户状态目录
5. 把当前 provider 的 `base_url` 改到本地 gateway
6. 落 `state.json`，供后续启动、恢复、UI 状态读取

这说明：

- 当前项目不是“只在仓库里跑”的临时工具
- 它会真实修改用户机上的 Codex 配置

### 4.2 启动链路

启动时真实发生的是：

1. 启动 Node 进程，监听 `listen_host:listen_port`
2. 读取 gateway 自己的 `config.json`
3. 初始化：
   - `monitor`
   - `probeMonitor`
   - `logger`
   - `runtime.paths`
4. 启动 HTTP server
5. 若 `active_probe.enabled = true`，安排主动探针调度

### 4.3 普通代理链路

真实请求从 Codex 进来后的主链路在 [proxyRequest()](C:/Users/dashuai/.config/superpowers/worktrees/codex-retry-gateway-git/codex-model-consistency-clean/gateway.mjs:4436)：

1. 先判断是否是健康检查或管理接口
2. 如果不是，就计入普通代理：
   - `total_proxy_request_count += 1`
   - `active_proxy_request_count += 1`
3. 读取请求体
4. 解析请求 JSON
5. 记录最近一次真实请求画像：
   - 最近 `User-Agent`
   - 最近 `reasoning.effort`
6. 透传到上游
7. 根据路径决定：
   - 是旁路透传
   - 还是进入检查逻辑
8. 请求结束后：
   - `active_proxy_request_count -= 1`

这个链路说明两个重要事实：

- 普通代理统计是“请求进入普通代理分支就记”，不是“请求成功了才记”
- 主动探针画像来源于“最近一次真实经过 gateway 的 Codex 请求”

---

## 5. `516/1034/1552` 拦截链路

### 5.1 非流式

非流式处理在 [handleNonStreaming()](C:/Users/dashuai/.config/superpowers/worktrees/codex-retry-gateway-git/codex-model-consistency-clean/gateway.mjs:4275)：

1. 读取完整响应体
2. 提取 `reasoning_tokens`
3. 计入：
   - `inspected_response_count`
   - `observed_reasoning_counts`
4. 若命中 `reasoning_equals`
   - 直接返回配置里的 `non_stream_status_code`
   - 默认 `502`
5. 否则正常透传

### 5.2 流式

流式处理在 [handleStreaming()](C:/Users/dashuai/.config/superpowers/worktrees/codex-retry-gateway-git/codex-model-consistency-clean/gateway.mjs:4325)：

1. 如果是 `strict_502`
   - 不先透传 chunk
   - 先缓存上游 SSE chunk
2. 每个 SSE chunk 都尝试提取：
   - `reasoning_tokens`
   - `model`
   - `system_fingerprint`
3. 一旦命中 `reasoning_equals`
   - 中断上游
   - 返回 `502`
4. 如果整条流没命中
   - 再把缓存好的完整流回给客户端

这也是当前“为什么正常 516 命中不会再先露半截流”的代码依据。

### 5.3 当前默认集合

默认不是只有 `516`，而是：

- `516`
- `1034`
- `1552`

这是当前配置默认值，不是 UI 层拼出来的显示文本。

---

## 6. 普通代理统计到底怎么记

这个项目最容易让人误解的就是统计口径。

### 6.1 `total_proxy_request_count`

含义：

- 所有进入普通代理分支的请求数

它不要求：

- 一定是被检查路径
- 一定成功
- 一定有完整响应

### 6.2 `inspected_response_count`

含义：

- 真正进入“检查逻辑”的响应次数

也就是：

- 匹配 `config.endpoints`
- 进入 `handleNonStreaming()` 或 `handleStreaming()`

### 6.3 `bypassed_proxy_request_count`

含义：

- 走了普通代理，但路径没有纳入检查范围

例如：

- `/v1/models`

### 6.4 `failed_proxy_request_count`

含义：

- 已进入普通代理，但最终在代理链路里抛错，且没有完成正常结果归类

### 6.5 `active_proxy_request_count`

含义：

- 当前仍在进行中的普通代理请求数

结论：

- `total_proxy_request_count` 与 `inspected_response_count` 不一致，本身不是 bug
- 它们只要能被“旁路请求 + 失败请求 + 进行中请求”解释，就是合理现象

---

## 7. 模型家族一致性到底在看什么

### 7.1 输入信号

当前模型一致性面板只基于可观测信号：

- 本地配置模型
- 本地请求模型
- 非流式上游响应 `model`
- 流式事件中的 `model`
- `system_fingerprint`
- 响应 ID
- 低上下文错误特征

### 7.2 它能做的判断

当前代码能做的，只是这些：

1. 本地期望家族与上游声明家族是否一致
2. 是否出现疑似 `400K` 家族行为
3. 单请求内是否发生模型漂移
4. 单请求内是否出现指纹漂移
5. 单请求内是否疑似重建/重试

### 7.3 它不能做的判断

当前代码做不到，也不能写成已经做到：

- 证明底层真实一定是 `gpt-5.4-mini`
- 证明底层真实一定不是 `gpt-5.5`
- 证明 provider 一定发生了缓存重建
- 证明 provider 一定掺了某个具体第三方模型

### 7.4 一致率的真实口径

当前一致率不是：

- `matched / total_checked`

而是：

- `matched / (matched + mismatched)`

也就是：

- `unknown` 不进入分母

这个口径是为了避免“没拿到上游声明”把一致率平白拉低。

---

## 8. 主动探针到底是什么

### 8.1 当前角色

主动探针不是主链路。

当前项目里，主动探针是：

- 一个独立于普通代理统计的低频验证层

它的目标不是“鉴定真实底模”，而是：

- 对 `gpt-5.4` / `gpt-5.5` 的声明契约做证伪

### 8.2 当前调度方式

调度逻辑在：

- [scheduleActiveProbes()](C:/Users/dashuai/.config/superpowers/worktrees/codex-retry-gateway-git/codex-model-consistency-clean/gateway.mjs:2395)
- [safeRunActiveProbeOnce()](C:/Users/dashuai/.config/superpowers/worktrees/codex-retry-gateway-git/codex-model-consistency-clean/gateway.mjs:2347)
- [runActiveProbeOnce()](C:/Users/dashuai/.config/superpowers/worktrees/codex-retry-gateway-git/codex-model-consistency-clean/gateway.mjs:2308)

它支持两种触发：

- 自动定时
- 手动 `POST /__codex_retry_gateway/api/probe/run`

### 8.3 当前目标选择

当前主动探针只跟踪：

- `gpt-5.4`
- `gpt-5.5`

如果配置里没选目标家族：

- 自动探测不能开启
- 手动探测如果传覆盖配置，也会按覆盖配置执行

### 8.4 当前探针类型

当前已经实现的探针类型：

- `long_context`
- `image_input`
- `response_structure`
- `identity_consistency`
- `knowledge_cutoff`

### 8.5 当前结论类型

当前主动探针只会产出：

- `pass`
- `warning`
- `violation`
- `transport_error`
- `indeterminate`

其中：

- `long_context`
- `image_input`
  - 可以给 `violation`
- 其余三类
  - 当前设计上属于辅助探针，更偏向 `warning`

---

## 9. 主动探针请求链路

### 9.1 上游路径

主动探针不会回环打自己，而是直接请求上游。

路径来源于：

- `active_probe.endpoint_candidates`

当前默认是：

- `/responses`
- `/v1/responses`

### 9.2 鉴权

主动探针鉴权来自 [buildActiveProbeAuthHeaders()](C:/Users/dashuai/.config/superpowers/worktrees/codex-retry-gateway-git/codex-model-consistency-clean/gateway.mjs:1293)：

它会：

1. 读取安装状态里的 `codex_config_path`
2. 判断当前 provider 是否 `requires_openai_auth`
3. 如果需要
   - 从 `auth.json` 里找 `OPENAI_API_KEY`
   - 带上 `Authorization`

### 9.3 请求画像继承

当前主动探针不是完全裸请求了。

它会优先继承最近一次真实经过网关的 Codex 请求画像：

- `User-Agent`
- `reasoning.effort`

如果还没有真实画像，则回退到默认值。

这意味着：

- 现在主动探针更像真实 Codex 请求
- 但它仍然不是“100% 复刻所有真实请求字段”

### 9.4 为什么后台可能只看到 4.5k

长上下文探针不是一次请求直冲目标，而是分三段：

1. `baseline`
2. `seed`
3. `budget`

目的是：

- 先从上游响应里的 `usage.input_tokens` 拿到校准口径
- 再估算最终预算轮要构造多少输入

所以后台如果只看到几千 token，很可能看到的是前两段校准轮，不是最终预算轮。

这不是文案解释，而是当前代码真实设计。

---

## 10. 主动探针统计与普通代理统计为什么隔离

主动探针不会进入：

- `total_proxy_request_count`
- `inspected_response_count`

原因很明确：

- 主动探针不是用户真实业务流量
- 如果混入普通代理统计，就会把“探针噪音”误当成真实使用情况

因此当前项目实际上维护了两套平行观测：

1. 普通代理观测
2. 主动探针观测

这两套数据只共享基础解析能力，不共享计数口径。

---

## 11. 当前 UI 的真实定位

当前 UI 不是一个“控制全项目一切行为的完整控制台”，它更准确的定位是：

- gateway 当前进程的运行态观测面板 + 少量热配置入口

它能做：

- 看当前接管状态
- 看普通代理统计
- 看模型一致性样本
- 看主动探针状态与样本
- 热更新部分配置
- 触发手动探针
- 恢复原配置并关闭 gateway

它不能做：

- 回放完整请求链路
- 保存长期历史数据库
- 给出底模归因结论
- 替代日志分析

---

## 12. 当前最容易误解的几个点

### 12.1 “声明一致”不等于“证明真实一致”

当前一致性面板看的是：

- 本地期望
- 上游自报
- 流式观测

这只能说明：

- 声明层有没有直接打架

不能说明：

- 真实底层一定没换模

### 12.2 “疑似请求内重建/重试”只是高风险推断

触发依据包括：

- 指纹漂移
- 结束阶段声明不一致
- 同一请求内多个响应 ID

这些都只是“很像”，不是法医学级别的直接证据。

### 12.3 主动探针是证伪，不是归因

当前主动探针最合理的表述应该永远是：

- “不像宣称的 `gpt-5.4/gpt-5.5` 契约”

而不是：

- “已经确认是某个具体替代模型”

### 12.4 后台看到的小上下文不一定是 bug

如果看到的是：

- `baseline`
- `seed`

那本来就会小。

只有当：

- 最终预算轮根本没发出去
- 或预算轮异常早停

这才是问题。

---

## 13. 当前已知逻辑风险

下面这些不是“已经坏了”，而是当前架构里天然容易出问题的点。

### 13.1 单文件职责过重

[gateway.mjs](C:/Users/dashuai/.config/superpowers/worktrees/codex-retry-gateway-git/codex-model-consistency-clean/gateway.mjs) 同时承载：

- HTTP server
- 代理
- UI
- 主动探针
- 统计
- 安全边界判断

风险：

- 改一个地方，很容易顺手打坏别的功能
- 回归测试必须跟得非常紧

### 13.2 统计口径容易被 UI 文案讲错

代码里已经区分：

- 总请求
- 被检查响应
- 旁路
- 失败
- 进行中

但 UI 如果解释不严谨，用户很容易把“不一致”理解成 bug。

### 13.3 主动探针仍然依赖上游可观测信号

即使现在继承了真实请求画像，主动探针仍然受这些限制：

- 上游是否返回 `usage`
- 上游是否返回明确错误文本
- 上游是否暴露 `model`
- 上游是否暴露 `system_fingerprint`

这些都不是本地能强行创造出来的。

### 13.4 模型一致性统计仍然只能看“观测面”

如果 provider 同时：

- 伪造自报模型
- 维持公开能力契约
- 隐藏关键字段

当前项目很难直接抓到铁证。

### 13.5 README 已经偏长，继续堆事实会再次失控

现在 README 已经混了：

- 安装说明
- 功能说明
- 边界说明
- 验证说明

如果再继续把所有事实都往 README 堆，未来口径还是会裂开。

---

## 14. 推荐的后续收敛方式

后面如果继续做这个项目，我建议把讨论顺序固定住：

1. 先问“这属于普通代理、被动检测、主动探针、还是 UI 展示”
2. 再问“它应该影响哪套统计口径”
3. 再问“它是硬证据、辅助证据，还是只是一条线索”
4. 最后才写代码

同时，文档职责建议固定为：

- `README.md`
  - 只保留“怎么用、有什么能力、主要边界”
- `err.md`
  - 只保留时间线式排错记录
- 本文
  - 作为“项目真源说明书”

这样以后讨论时，先对照本文，能少很多“我以为它应该这样”的沟通损耗。

---

## 15. 当前最重要的结论

如果只保留一组最关键结论，那就是这 8 条：

1. 这个项目是本地代理 + 检查层，不是协议转换层。
2. 默认拦截集合已经是 `516/1034/1552`，不只是 `516`。
3. 流式默认是 `strict_502`，先缓存再决定是否返回 `502`。
4. 普通代理统计和主动探针统计是两套完全隔离的口径。
5. 模型一致性面板只能判断“声明与行为是否可疑”，不能证明真实底模。
6. “疑似请求内重建/重试”是高风险推断，不是铁证。
7. 长上下文主动探针是 `baseline -> seed -> budget` 三段，不是一次请求直冲目标。
8. 后续所有改动都应该先明确属于哪条链路，再决定该改哪套统计和文案。

