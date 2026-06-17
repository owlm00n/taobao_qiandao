#!/usr/bin/env node

import { loadCapturedRequest } from './request-loader.js';
import { runCapturedSignin } from './signin-runner.js';
import zuiqingfeng from './stores/zuiqingfeng.js';

const stores = {
  zuiqingfeng
};

async function main(argv) {
  const [storeKey, ...args] = argv;

  if (!storeKey || storeKey === '-h' || storeKey === '--help') {
    printHelp();
    return;
  }

  const store = stores[storeKey];
  if (!store) {
    throw new Error(`Unknown store: ${storeKey}. Available stores: ${Object.keys(stores).join(', ')}`);
  }

  const requestPath = getArg(args, '--request') || `config/${storeKey}.request.json`;
  const dryRun = args.includes('--dry-run');
  const timeoutMs = Number(getArg(args, '--timeout-ms') || 30000);

  const request = loadCapturedRequest(requestPath);
  const result = await runCapturedSignin(request, store, { dryRun, timeoutMs });

  console.log(JSON.stringify(result, null, 2));

  if (!result.ok && !dryRun) {
    process.exitCode = 2;
  }
}

function getArg(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function printHelp() {
  console.log(`Usage:
  node src/cli.js <store> [--request <file>] [--dry-run] [--timeout-ms <ms>]

Stores:
  zuiqingfeng    醉清风旗舰店 / shop_id=116576560

Examples:
  node src/cli.js zuiqingfeng --request config/zuiqingfeng.request.json --dry-run
  node src/cli.js zuiqingfeng --request config/zuiqingfeng.request.json
`);
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
