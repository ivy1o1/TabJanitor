// Manual smoke test against a real local endpoint. Not part of `npm test`.
//
//   npm run smoke:live
//   node tests/smoke-live.js --endpoint http://127.0.0.1:8080 --model gemma-3-1b-it
//
// Configuration resolution order: CLI flags, then environment variables
// TABJANITOR_ENDPOINT / TABJANITOR_MODEL, then config/config.local.json
// (gitignored), then config/config.example.json.
//
// The tab metadata here is synthetic fixture data, never real browser tabs.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { checkReadiness, validateEndpoint } from '../background/ai-client.js';
import { classifyTabs } from '../background/classifier.js';
import { buildReviewPlan, summary } from '../background/review-plan.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index].startsWith('--')) {
      args[argv[index].slice(2)] = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

function loadFileConfig() {
  for (const name of ['config/config.local.json', 'config/config.example.json']) {
    const path = join(repoRoot, name);
    if (existsSync(path)) {
      try {
        return { config: JSON.parse(readFileSync(path, 'utf8')), source: name };
      } catch (error) {
        console.error(`Could not parse ${name}: ${error.message}`);
      }
    }
  }
  return { config: {}, source: 'none' };
}

const args = parseArgs(process.argv.slice(2));
const fileConfig = loadFileConfig();

const config = {
  endpoint: validateEndpoint(
    args.endpoint || process.env.TABJANITOR_ENDPOINT || fileConfig.config.inferenceEndpoint || 'http://127.0.0.1:8080',
  ),
  model: args.model || process.env.TABJANITOR_MODEL || fileConfig.config.inferenceModel || 'gemma-3-1b-it',
  timeoutMs: Number(args.timeoutMs) || Number(fileConfig.config.requestTimeoutMs) || 120000,
};

const promptTabs = [
  { ref: 1, title: 'React Tutorial – react.dev', url: 'https://react.dev/learn', domain: 'react.dev' },
  { ref: 2, title: 'Introduction to Algorithms | MIT OCW', url: 'https://ocw.mit.edu/courses/6-006', domain: 'ocw.mit.edu' },
  { ref: 3, title: 'Cheap flights to Lisbon', url: 'https://shop.example.com/flights', domain: 'shop.example.com' },
];

let exitCode = 0;
const report = [];

function record(line) {
  report.push(line);
  console.log(line);
}

try {
  record(`endpoint: ${config.endpoint}`);
  record(`model identifier sent: ${config.model}`);
  record(`config file used: ${fileConfig.source}`);

  const readiness = await checkReadiness({ config, fetchImpl: fetch });
  record(`health check: HTTP OK, status=${readiness.health.status} (no tab metadata sent)`);

  const propsResponse = await fetch(`${config.endpoint}/props`, { signal: AbortSignal.timeout(10000) });
  if (propsResponse.ok) {
    const props = await propsResponse.json();
    record(`server model_path: ${props.model_path || props.model_alias || 'not reported'}`);
    record(`server model_ftype: ${props.model_ftype || 'not reported'}`);
  } else {
    record(`server /props: HTTP ${propsResponse.status} (informational only)`);
  }

  const started = Date.now();
  const result = await classifyTabs({ promptTabs, config, fetchImpl: fetch });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  record(`inference: ${result.modelCalled ? 'REAL MODEL CALL' : 'NO MODEL CALL'} in ${elapsed}s`);
  record(`finish_reason: ${result.finishReason}`);
  if (result.serverModel) record(`server echoed model: ${result.serverModel}`);
  if (result.tokensPerSecond) record(`generation speed: ${result.tokensPerSecond} tokens/s`);

  const fakeSnapshot = {
    sessionId: 'smoke',
    windowId: 1,
    createdAt: Date.now(),
    eligibleTabs: promptTabs.map((tab) => ({ ...tab, id: tab.ref * 100, eligible: true })),
    skippedTabs: [],
  };
  const plan = buildReviewPlan(fakeSnapshot, result);
  record('classifications:');
  for (const item of plan.items) {
    record(`  ref=${item.ref} ${item.domain} -> ${item.category} (confidence ${item.confidence}) "${item.explanation}"`);
  }
  record(`validated plan: ${JSON.stringify(summary(plan))}`);
  if (result.missingRefs.length > 0) record(`missing refs: ${JSON.stringify(result.missingRefs)}`);
  if (result.rejected.length > 0) record(`rejected model entries: ${JSON.stringify(result.rejected)}`);

  if (plan.items.length === 0) {
    record('RESULT: FAIL - the model produced no usable classification.');
    exitCode = 1;
  } else {
    record(`RESULT: PASS - real local Gemma inference returned ${plan.items.length}/${promptTabs.length} parseable classifications.`);
  }
} catch (error) {
  record(`RESULT: FAIL - ${error.code || error.name || 'ERROR'}: ${error.message}`);
  if (error.details && Object.keys(error.details).length > 0) {
    record(`details: ${JSON.stringify(error.details)}`);
  }
  if (error.code === 'MODEL_UNAVAILABLE') {
    record('The endpoint is unreachable. Start llama-server and re-run, or pass --endpoint.');
  }
  if (error.code === 'CONFIG_MISSING') {
    record('Configuration is missing or invalid. Check config/config.local.json or --endpoint/--model.');
  }
  exitCode = 1;
}

process.exitCode = exitCode;
