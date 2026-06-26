#!/usr/bin/env node

import http from "node:http";
import net from "node:net";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const scriptsRoot = import.meta.dirname;
const launchScript = path.join(scriptsRoot, "launch-ui.ps1");
const restoreScript = path.join(scriptsRoot, "restore-codex-config.ps1");

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
    throw new Error("Failed to allocate a free port");
  }
  return port;
}

function startFakeUpstream(port) {
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/v1/models") {
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "x-upstream-test": "launch-ui-ok",
      });
      res.end(JSON.stringify({ object: "list", data: [{ id: "launch-ui-test-model" }] }));
      return;
    }

    if (req.method === "POST" && (req.url === "/responses" || req.url === "/v1/responses")) {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        const parsed = JSON.parse(body || "{}");
        const reasoning = parsed.test_reasoning_tokens ?? 128;
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(
          JSON.stringify({
            id: "launch-ui-response",
            usage: {
              output_tokens_details: {
                reasoning_tokens: reasoning,
              },
            },
          }),
        );
      });
      return;
    }

    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

async function runPowerShellScript(scriptPath, args) {
  const child = spawn(
    "powershell",
    ["-ExecutionPolicy", "Bypass", "-File", scriptPath, ...args],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const [exitCode] = await once(child, "exit");
  if (exitCode !== 0) {
    throw new Error(`PowerShell script failed: ${scriptPath}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }

  return { stdout, stderr };
}

async function run() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-retry-gateway-launch-"));
  const codexDir = path.join(tempRoot, ".codex");
  const stateRoot = path.join(tempRoot, ".codex-retry-gateway");
  const codexConfigPath = path.join(codexDir, "config.toml");
  const upstreamPort = await getFreePort();
  const gatewayPort = await getFreePort();
  const gatewayBaseUrl = `http://127.0.0.1:${gatewayPort}`;
  const upstreamBaseUrl = `http://127.0.0.1:${upstreamPort}`;

  await mkdir(codexDir, { recursive: true });
  await writeFile(
    codexConfigPath,
    [
      'model_provider = "custom"',
      "",
      "[model_providers.custom]",
      'name = "Launch UI Test"',
      `base_url = "${upstreamBaseUrl}"`,
      'wire_api = "responses"',
      "",
    ].join("\n"),
    "utf8",
  );

  const upstream = await startFakeUpstream(upstreamPort);

  try {
    await runPowerShellScript(launchScript, [
      "-CodexConfigPath",
      codexConfigPath,
      "-StateRoot",
      stateRoot,
      "-ListenPort",
      String(gatewayPort),
      "-NoOpen",
    ]);

    const installedConfig = await readFile(codexConfigPath, "utf8");
    assert(
      installedConfig.includes(`base_url = "${gatewayBaseUrl}"`),
      "First launch did not redirect the current provider to the local gateway",
    );

    const uiResponse = await fetch(`${gatewayBaseUrl}/__codex_retry_gateway/ui`);
    assert(uiResponse.status === 200, `UI page was not reachable after first launch: ${uiResponse.status}`);

    const statusResponse = await fetch(`${gatewayBaseUrl}/__codex_retry_gateway/api/status`);
    const statusPayload = await statusResponse.json();
    assert(statusResponse.status === 200, `Status API failed after first launch: ${statusResponse.status}`);
    assert(
      statusPayload.state?.original_base_url === upstreamBaseUrl,
      "First launch did not persist the original upstream base URL",
    );

    const firstStateRaw = await readFile(path.join(stateRoot, "state.json"), "utf8");
    const firstState = JSON.parse(firstStateRaw);

    await runPowerShellScript(launchScript, [
      "-CodexConfigPath",
      codexConfigPath,
      "-StateRoot",
      stateRoot,
      "-ListenPort",
      String(gatewayPort),
      "-NoOpen",
    ]);

    const secondStateRaw = await readFile(path.join(stateRoot, "state.json"), "utf8");
    const secondState = JSON.parse(secondStateRaw);
    assert(
      secondState.original_base_url === firstState.original_base_url,
      "Second launch overwrote original_base_url unexpectedly",
    );
    assert(
      secondState.gateway_base_url === gatewayBaseUrl,
      "Second launch did not preserve gateway_base_url",
    );

    const proxiedModels = await fetch(`${gatewayBaseUrl}/v1/models`);
    assert(proxiedModels.status === 200, `/v1/models through launch UI flow failed: ${proxiedModels.status}`);
    assert(
      proxiedModels.headers.get("x-upstream-test") === "launch-ui-ok",
      "Gateway did not preserve upstream headers after second launch",
    );

    const blockedResponse = await fetch(`${gatewayBaseUrl}/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ test_reasoning_tokens: 516 }),
    });
    assert(blockedResponse.status === 502, `Default 516 interception was not active: ${blockedResponse.status}`);

    process.stdout.write("PASS launch-ui flow\n");
  } finally {
    try {
      await runPowerShellScript(restoreScript, [
        "-CodexConfigPath",
        codexConfigPath,
        "-StateRoot",
        stateRoot,
      ]);
    } catch {
      // 测试清理阶段允许忽略恢复失败，避免覆盖主失败原因。
    }
    upstream.close();
    await once(upstream, "close");
    await rm(tempRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exit(1);
});
