#!/usr/bin/env node

import {
  DEFAULT_CODEX_CONFIG_PATH,
  DEFAULT_LISTEN_HOST,
  DEFAULT_LISTEN_PORT,
  DEFAULT_STATE_ROOT,
  installForCurrentProvider,
  parseOptions,
} from "./admin-lib.mjs";

async function main() {
  const options = parseOptions(process.argv);
  const result = await installForCurrentProvider({
    codexConfigPath: options.codexConfigPath || DEFAULT_CODEX_CONFIG_PATH,
    stateRoot: options.stateRoot || DEFAULT_STATE_ROOT,
    listenHost: options.listenHost || DEFAULT_LISTEN_HOST,
    listenPort: options.listenPort ? Number.parseInt(`${options.listenPort}`, 10) : DEFAULT_LISTEN_PORT,
  });

  process.stdout.write("Installed Codex Retry Gateway\n");
  process.stdout.write(`provider=${result.provider}\n`);
  process.stdout.write(`upstream=${result.upstream}\n`);
  process.stdout.write(`gateway=${result.gateway}\n`);
  process.stdout.write(`config=${result.configPath}\n`);
  process.stdout.write(`backup=${result.backupPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exit(1);
});
