#!/usr/bin/env node

import http from "node:http";
import net from "node:net";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const gatewayRoot = path.resolve(import.meta.dirname, "..");
const gatewayEntry = path.join(gatewayRoot, "gateway.mjs");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function getFreePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : null;
  server.close();
  await once(server, "close");
  if (!port) {
    throw new Error("无法分配空闲端口");
  }
  return port;
}

function createJsonResponse(res, statusCode, body, extraHeaders = {}) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    ...extraHeaders,
  });
  res.end(JSON.stringify(body));
}

function createSseResponse(res, chunks) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-upstream-test": "sse",
  });

  let index = 0;
  const timer = setInterval(() => {
    if (index >= chunks.length) {
      clearInterval(timer);
      res.end();
      return;
    }
    res.write(chunks[index]);
    index += 1;
  }, 20);

  res.on("close", () => {
    clearInterval(timer);
  });
}

function startFakeUpstream(port) {
  const server = http.createServer((req, res) => {
    const responsePaths = new Set(["/responses", "/v1/responses"]);
    const chatCompletionPaths = new Set(["/chat/completions", "/v1/chat/completions"]);

    if (req.method === "GET" && req.url === "/v1/models") {
      createJsonResponse(
        res,
        200,
        {
          object: "list",
          data: [{ id: "fake-model" }],
        },
        { "x-upstream-test": "models-ok" },
      );
      return;
    }

    if (req.method === "POST" && responsePaths.has(req.url)) {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        const parsed = JSON.parse(body || "{}");
        const reasoning = parsed.test_reasoning_tokens ?? 128;
        createJsonResponse(
          res,
          200,
          {
            id: "resp_test",
            usage: {
              output_tokens_details: {
                reasoning_tokens: reasoning,
              },
            },
          },
          { "x-upstream-test": `responses-${reasoning}` },
        );
      });
      return;
    }

    if (req.method === "POST" && chatCompletionPaths.has(req.url)) {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        const parsed = JSON.parse(body || "{}");
        const reasoning = parsed.test_reasoning_tokens ?? 128;
        if (reasoning === 516) {
          createSseResponse(res, [
            'data: {"id":"chunk-1","choices":[{"delta":{"content":"hello"}}]}\n\n',
            'data: {"usage":{"completion_tokens_details":{"reasoning_tokens":516}}}\n\n',
            "data: [DONE]\n\n",
          ]);
          return;
        }

        createSseResponse(res, [
          'data: {"id":"chunk-1","choices":[{"delta":{"content":"hello"}}]}\n\n',
          'data: {"usage":{"completion_tokens_details":{"reasoning_tokens":128}}}\n\n',
          "data: [DONE]\n\n",
        ]);
      });
      return;
    }

    createJsonResponse(res, 404, { error: "not found" });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

async function waitForHealth(url, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // ignore startup race
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`等待网关健康检查超时: ${url}`);
}

function startGateway(configPath, logPath) {
  const child = spawn(process.execPath, [gatewayEntry, "--config", configPath, "--log", logPath], {
    cwd: gatewayRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  return {
    child,
    getOutput() {
      return { stdout, stderr };
    },
  };
}

async function readSseUntilClose(url, requestBody) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(requestBody),
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf8");
  let text = "";
  let closedByError = false;

  while (true) {
    try {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      text += decoder.decode(value, { stream: true });
    } catch (error) {
      closedByError = true;
      text += `\n[[reader-error:${error?.name || "unknown"}]]`;
      break;
    }
  }

  text += decoder.decode();
  return {
    status: response.status,
    headers: response.headers,
    text,
    closedByError,
  };
}

async function run() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-retry-gateway-"));
  const upstreamPort = await getFreePort();
  const gatewayPort = await getFreePort();
  const configPath = path.join(tempRoot, "config.json");
  const logPath = path.join(tempRoot, "gateway.log");

  const config = {
    listen_host: "127.0.0.1",
    listen_port: gatewayPort,
    upstream_base_url: `http://127.0.0.1:${upstreamPort}`,
    request_body_limit_bytes: 10 * 1024 * 1024,
    endpoints: ["/responses", "/chat/completions", "/v1/responses", "/v1/chat/completions"],
    reasoning_equals: [516],
    non_stream_status_code: 502,
    stream_action: "disconnect",
    log_match: true,
    health_path: "/__codex_retry_gateway/health",
  };

  await writeFile(configPath, JSON.stringify(config, null, 2), "utf8");

  const upstream = await startFakeUpstream(upstreamPort);
  const gateway = startGateway(configPath, logPath);

  try {
    await waitForHealth(`http://127.0.0.1:${gatewayPort}${config.health_path}`);

    const modelsResponse = await fetch(`http://127.0.0.1:${gatewayPort}/v1/models`);
    assert(modelsResponse.status === 200, `/v1/models 透传状态异常: ${modelsResponse.status}`);
    assert(
      modelsResponse.headers.get("x-upstream-test") === "models-ok",
      "/v1/models 未保留上游头",
    );

    for (const responsePath of ["/responses", "/v1/responses"]) {
      const blockedResponse = await fetch(`http://127.0.0.1:${gatewayPort}${responsePath}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ test_reasoning_tokens: 516 }),
      });
      const blockedBody = await blockedResponse.json();
      assert(blockedResponse.status === 502, `${responsePath} 516 未返回 502: ${blockedResponse.status}`);
      assert(
        blockedBody?.error?.code === "reasoning_guard_triggered",
        `${responsePath} 516 返回体不正确`,
      );

      const okResponse = await fetch(`http://127.0.0.1:${gatewayPort}${responsePath}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ test_reasoning_tokens: 128 }),
      });
      const okBody = await okResponse.json();
      assert(okResponse.status === 200, `${responsePath} 128 透传状态异常: ${okResponse.status}`);
      assert(okResponse.headers.get("x-upstream-test") === "responses-128", `${responsePath} 128 未保留头`);
      assert(
        okBody?.usage?.output_tokens_details?.reasoning_tokens === 128,
        `${responsePath} 128 返回体异常`,
      );
    }

    for (const streamPath of ["/chat/completions", "/v1/chat/completions"]) {
      const blockedStream = await readSseUntilClose(
        `http://127.0.0.1:${gatewayPort}${streamPath}`,
        { stream: true, test_reasoning_tokens: 516 },
      );
      assert(blockedStream.status === 200, `${streamPath} 516 首状态异常: ${blockedStream.status}`);
      assert(blockedStream.text.includes('"content":"hello"'), `${streamPath} 流式 516 未先透传正常 chunk`);
      assert(!blockedStream.text.includes("[DONE]"), `${streamPath} 流式 516 不应完整结束`);
      assert(
        blockedStream.closedByError || blockedStream.text.includes("[[reader-error:"),
        `${streamPath} 流式 516 未表现为中途断开`,
      );

      const okStream = await readSseUntilClose(
        `http://127.0.0.1:${gatewayPort}${streamPath}`,
        { stream: true, test_reasoning_tokens: 128 },
      );
      assert(okStream.status === 200, `${streamPath} 128 首状态异常: ${okStream.status}`);
      assert(okStream.text.includes("[DONE]"), `${streamPath} 流式 128 未完整结束`);
      assert(!okStream.closedByError, `${streamPath} 流式 128 不应异常断开`);
    }

    process.stdout.write("PASS codex-retry-gateway e2e\n");
  } finally {
    gateway.child.kill();
    upstream.close();
    await once(upstream, "close");
    await rm(tempRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exit(1);
});
