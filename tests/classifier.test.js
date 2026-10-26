import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUserPrompt, classifyTabs, extractJson, validateClassifications } from '../background/classifier.js';
import { ERROR_CODES } from '../shared/constants.js';
import { chatResponse, chatResponseForPrompt, fakeFetch, fakeChrome, jsonResponse, sampleTabs } from './helpers.js';
import { readConfig } from '../background/ai-client.js';

test('the endpoint and model come from extension storage, not from code', async () => {
  const chromeRef = {
    storage: { local: { get: async () => ({ 'tabjanitor.config': { inferenceEndpoint: 'http://127.0.0.1:9099', inferenceModel: 'my-model.gguf', requestTimeoutMs: 1234 } }) } },
  };
  const config = await readConfig({ chromeRef });
  assert.equal(config.endpoint, 'http://127.0.0.1:9099');
  assert.equal(config.model, 'my-model.gguf');
  assert.equal(config.timeoutMs, 1234);
  assert.equal(config.configured, true);
});

test('storage config is validated before use', async () => {
  const chromeRef = { storage: { local: { get: async () => ({ 'tabjanitor.config': { inferenceEndpoint: 'https://evil.example/key=abc?x=1' } }) } } };
  await assert.rejects(() => readConfig({ chromeRef }), (error) => {
    assert.equal(error.code, 'CONFIG_MISSING');
    return true;
  });
});

test('unconfigured storage falls back to the verified local defaults', async () => {
  const chromeRef = { storage: { local: { get: async () => ({}) } } };
  const config = await readConfig({ chromeRef });
  assert.equal(config.endpoint, 'http://127.0.0.1:8080');
  assert.equal(config.source, 'default');
});
import { captureWindowSnapshot } from '../background/tab-scanner.js';

const CONFIG = { endpoint: 'http://127.0.0.1:8080', model: 'gemma-3-1b-it', timeoutMs: 5000 };

async function snapshotFixture(tabs = sampleTabs()) {
  const { chromeRef } = fakeChrome(tabs);
  return captureWindowSnapshot({ chromeRef });
}

function promptTabs(snapshot) {
  return snapshot.eligibleTabs.map((tab) => ({ ref: tab.ref, title: tab.title, url: tab.url, domain: tab.domain }));
}

test('valid model output is parsed and mapped to refs', async () => {
  const snapshot = await snapshotFixture();
  const tabs = promptTabs(snapshot);
  const content = JSON.stringify({
    tabs: [
      { ref: 1, category: 'Development', explanation: 'Framework documentation.', confidence: 92 },
      { ref: 2, category: 'Study', explanation: 'Reading material.', confidence: 71 },
      { ref: 3, category: 'Shopping', explanation: 'A checkout page.', confidence: 88 },
    ],
  });
  const result = validateClassifications(extractJson(content), tabs);
  assert.equal(result.accepted.length, 3);
  assert.equal(result.missingRefs.length, 0);
  assert.equal(result.accepted[0].category, 'Development');
  assert.equal(result.accepted[0].confidence, 92);
});

test('every eligible tab gets its own request and all are classified', async () => {
  const snapshot = await snapshotFixture();
  const tabs = promptTabs(snapshot);
  const fetchImpl = fakeFetch([['/v1/chat/completions', chatResponseForPrompt((ref) => ({
    category: ['Development', 'Study', 'Shopping'][ref - 1],
    explanation: `reason ${ref}`,
    confidence: 70 + ref,
  }))]]);
  const result = await classifyTabs({ promptTabs: tabs, config: CONFIG, fetchImpl });
  const inferenceRequests = fetchImpl.requests.filter((entry) => entry.url.includes('/v1/chat/completions'));
  assert.equal(inferenceRequests.length, tabs.length);
  assert.deepEqual(result.accepted.map((entry) => [entry.ref, entry.category]), [
    [1, 'Development'],
    [2, 'Study'],
    [3, 'Shopping'],
  ]);
  assert.deepEqual(result.missingRefs, []);
  assert.deepEqual(result.failedRequests, []);
  assert.equal(result.modelCalled, true);
  assert.equal(result.serverModel, 'gemma-3-1b-it-Q4_K_M.gguf');
});

test('one unparsable tab is reported while the others still classify', async () => {
  const snapshot = await snapshotFixture();
  const tabs = promptTabs(snapshot);
  let call = 0;
  const handler = (url, init) => {
    call += 1;
    if (call === 2) return chatResponse('Sorry, I cannot answer that.');
    return chatResponseForPrompt(() => ({ category: 'Other', explanation: 'fallback', confidence: 55 }))(url, init);
  };
  const fetchImpl = fakeFetch([['/v1/chat/completions', handler]]);
  const result = await classifyTabs({ promptTabs: tabs, config: CONFIG, fetchImpl });
  assert.equal(result.accepted.length, 2);
  assert.deepEqual(result.missingRefs, [2]);
  assert.equal(result.failedRequests.length, 1);
  assert.equal(result.failedRequests[0].ref, 2);
  assert.equal(result.failedRequests[0].code, ERROR_CODES.INVALID_MODEL_OUTPUT);
});

test('a schema-invalid classification for one tab does not abort the remaining tabs', async () => {
  const snapshot = await snapshotFixture();
  const tabs = promptTabs(snapshot);
  let call = 0;
  const handler = (url, init) => {
    call += 1;
    if (call === 2) return chatResponse('{"tabs":[{"ref":2,"category":"Gambling","explanation":"not an allowed category","confidence":90}]}');
    if (call === 3) return chatResponse('{"tabs":[{"ref":3,"category":"Study","explanation":"confidence out of range","confidence":140}]}');
    return chatResponse('{"tabs":[{"ref":1,"category":"Development","explanation":"code docs","confidence":91}]}');
  };
  const fetchImpl = fakeFetch([['/v1/chat/completions', handler]]);
  const result = await classifyTabs({ promptTabs: tabs, config: CONFIG, fetchImpl });
  // every tab was still attempted
  assert.equal(fetchImpl.requests.filter((entry) => entry.url.includes('/v1/chat/completions')).length, tabs.length);
  assert.deepEqual(result.accepted.map((entry) => entry.ref), [1]);
  assert.deepEqual(result.missingRefs, [2, 3]);
  assert.equal(result.failedRequests.length, 2);
  assert.deepEqual(result.failedRequests.map((entry) => entry.ref), [2, 3]);
  for (const failure of result.failedRequests) {
    assert.equal(failure.code, ERROR_CODES.INVALID_MODEL_OUTPUT);
  }
});

test('truncated json for one tab is recorded without losing the others', async () => {
  const snapshot = await snapshotFixture();
  const tabs = promptTabs(snapshot);
  let call = 0;
  const handler = (url, init) => {
    call += 1;
    if (call === 1) return chatResponse('{"tabs":[{"ref":1,"category":"Study","expl');
    return chatResponseForPrompt(() => ({ category: 'Other', explanation: 'ok', confidence: 60 }))(url, init);
  };
  const fetchImpl = fakeFetch([['/v1/chat/completions', handler]]);
  const result = await classifyTabs({ promptTabs: tabs, config: CONFIG, fetchImpl });
  assert.deepEqual(result.accepted.map((entry) => entry.ref), [2, 3]);
  assert.deepEqual(result.missingRefs, [1]);
  assert.equal(result.failedRequests[0].code, ERROR_CODES.INVALID_MODEL_OUTPUT);
});

test('a schema entry that answers a different ref is rejected for that tab only', async () => {
  const snapshot = await snapshotFixture();
  const tabs = promptTabs(snapshot);
  let call = 0;
  const handler = (url, init) => {
    call += 1;
    if (call === 1) return chatResponse('{"tabs":[{"ref":7,"category":"Study","explanation":"wrong ref","confidence":50}]}');
    return chatResponseForPrompt(() => ({ category: 'Research', explanation: 'fine', confidence: 65 }))(url, init);
  };
  const fetchImpl = fakeFetch([['/v1/chat/completions', handler]]);
  const result = await classifyTabs({ promptTabs: tabs, config: CONFIG, fetchImpl });
  assert.deepEqual(result.accepted.map((entry) => entry.ref), [2, 3]);
  assert.equal(result.failedRequests.length, 1);
  assert.equal(result.failedRequests[0].ref, 1);
});

test('when no tab validates, the structured error is still returned', async () => {
  const snapshot = await snapshotFixture();
  const tabs = promptTabs(snapshot);
  const fetchImpl = fakeFetch([['/v1/chat/completions', chatResponse('{"tabs":[{"ref":1,"category":"Nope","explanation":"x","confidence":200}]}')]]);
  await assert.rejects(
    () => classifyTabs({ promptTabs: tabs, config: CONFIG, fetchImpl }),
    (error) => {
      assert.equal(error.code, ERROR_CODES.INVALID_MODEL_OUTPUT);
      assert.equal(error.details.requestedCount, tabs.length);
      assert.equal(error.details.failedCount, tabs.length);
      return true;
    },
  );
});

test('a transport failure still aborts the whole scan', async () => {
  const snapshot = await snapshotFixture();
  const tabs = promptTabs(snapshot);
  let call = 0;
  const handler = (url, init) => {
    call += 1;
    if (call === 2) throw new Error('ECONNREFUSED');
    return chatResponseForPrompt()(url, init);
  };
  const fetchImpl = fakeFetch([['/v1/chat/completions', handler]]);
  await assert.rejects(
    () => classifyTabs({ promptTabs: tabs, config: CONFIG, fetchImpl }),
    (error) => {
      assert.equal(error.code, ERROR_CODES.MODEL_UNAVAILABLE);
      return true;
    },
  );
});

test('json wrapped in a markdown fence is still parsed', () => {
  const wrapped = '```json\n{"tabs":[{"ref":1,"category":"Other","explanation":"x","confidence":50}]}\n```';
  const parsed = extractJson(wrapped);
  assert.equal(parsed.tabs[0].ref, 1);
});

test('non-JSON model output raises INVALID_MODEL_OUTPUT', async () => {
  const snapshot = await snapshotFixture();
  const fetchImpl = fakeFetch([['/v1/chat/completions', chatResponse('I cannot classify these tabs.')]]);
  await assert.rejects(
    () => classifyTabs({ promptTabs: promptTabs(snapshot), config: CONFIG, fetchImpl }),
    (error) => {
      assert.equal(error.code, ERROR_CODES.INVALID_MODEL_OUTPUT);
      return true;
    },
  );
});

test('malformed json raises INVALID_MODEL_OUTPUT', async () => {
  const snapshot = await snapshotFixture();
  const fetchImpl = fakeFetch([['/v1/chat/completions', chatResponse('{"tabs": [broken')]]);
  await assert.rejects(
    () => classifyTabs({ promptTabs: promptTabs(snapshot), config: CONFIG, fetchImpl }),
    (error) => {
      assert.equal(error.code, ERROR_CODES.INVALID_MODEL_OUTPUT);
      return true;
    },
  );
});

test('unknown, duplicate and missing tab refs are handled explicitly', async () => {
  const snapshot = await snapshotFixture();
  const tabs = promptTabs(snapshot);
  const result = validateClassifications({
    tabs: [
      { ref: 1, category: 'Development', explanation: 'ok', confidence: 80 },
      { ref: 1, category: 'Study', explanation: 'dupe', confidence: 80 },
      { ref: 99, category: 'Other', explanation: 'unknown ref', confidence: 80 },
    ],
  }, tabs);
  assert.equal(result.accepted.length, 1);
  assert.equal(result.accepted[0].ref, 1);
  assert.deepEqual(result.missingRefs, [2, 3]);
  const reasons = result.rejected.map((entry) => entry.reason);
  assert.ok(reasons.some((reason) => reason.startsWith('duplicate')));
  assert.ok(reasons.some((reason) => reason.startsWith('unknown ref')));
});

test('invalid categories and confidence values are rejected', () => {
  const tabs = [{ ref: 1, title: 'a', url: 'https://a.com', domain: 'a.com' }];
  assert.throws(
    () => validateClassifications({ tabs: [{ ref: 1, category: 'Crypto', explanation: 'x', confidence: 50 }] }, tabs),
    (error) => {
      assert.equal(error.code, ERROR_CODES.INVALID_MODEL_OUTPUT);
      return true;
    },
  );
  assert.throws(
    () => validateClassifications({ tabs: [{ ref: 1, category: 'Study', explanation: 'x', confidence: 140 }] }, tabs),
    (error) => {
      assert.equal(error.code, ERROR_CODES.INVALID_MODEL_OUTPUT);
      return true;
    },
  );
  assert.throws(
    () => validateClassifications({ tabs: [{ ref: 1, category: 'Study', explanation: 'x', confidence: 'high' }] }, tabs),
    (error) => {
      assert.equal(error.code, ERROR_CODES.INVALID_MODEL_OUTPUT);
      return true;
    },
  );
});

test('Junk / Review is accepted as a category', () => {
  const tabs = [{ ref: 1, title: 'a', url: 'https://a.com', domain: 'a.com' }];
  const result = validateClassifications({ tabs: [{ ref: 1, category: 'Junk / Review', explanation: 'looks stale', confidence: 40 }] }, tabs);
  assert.equal(result.accepted[0].category, 'Junk / Review');
});

test('an HTTP error from the endpoint raises MODEL_UNAVAILABLE', async () => {
  const snapshot = await snapshotFixture();
  const fetchImpl = fakeFetch([['/v1/chat/completions', jsonResponse({ error: 'server error' }, 500)]]);
  await assert.rejects(
    () => classifyTabs({ promptTabs: promptTabs(snapshot), config: CONFIG, fetchImpl }),
    (error) => {
      assert.equal(error.code, ERROR_CODES.MODEL_UNAVAILABLE);
      assert.equal(error.details.status, 500);
      return true;
    },
  );
});

test('a connection failure raises MODEL_UNAVAILABLE', async () => {
  const snapshot = await snapshotFixture();
  const fetchImpl = fakeFetch([['/v1/chat/completions', () => { throw new Error('ECONNREFUSED'); }]]);
  await assert.rejects(
    () => classifyTabs({ promptTabs: promptTabs(snapshot), config: CONFIG, fetchImpl }),
    (error) => {
      assert.equal(error.code, ERROR_CODES.MODEL_UNAVAILABLE);
      return true;
    },
  );
});

test('a slow endpoint raises INFERENCE_TIMEOUT', async () => {
  const snapshot = await snapshotFixture();
  const fetchImpl = (url, init = {}) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  await assert.rejects(
    () => classifyTabs({ promptTabs: promptTabs(snapshot), config: { ...CONFIG, timeoutMs: 20 }, fetchImpl }),
    (error) => {
      assert.equal(error.code, ERROR_CODES.INFERENCE_TIMEOUT);
      return true;
    },
  );
});

test('a response without message content raises INVALID_MODEL_OUTPUT', async () => {
  const snapshot = await snapshotFixture();
  const fetchImpl = fakeFetch([['/v1/chat/completions', jsonResponse({ choices: [] })]]);
  await assert.rejects(
    () => classifyTabs({ promptTabs: promptTabs(snapshot), config: CONFIG, fetchImpl }),
    (error) => {
      assert.equal(error.code, ERROR_CODES.INVALID_MODEL_OUTPUT);
      return true;
    },
  );
});

test('no model call happens when every tab is unsupported', async () => {
  const snapshot = await snapshotFixture([
    { id: 4, windowId: 10, title: 'New Tab', url: 'chrome://newtab/', active: true },
  ]);
  const fetchImpl = fakeFetch([['/v1/chat/completions', chatResponse('{"tabs":[]}')]]);
  const result = await classifyTabs({ promptTabs: promptTabs(snapshot), config: CONFIG, fetchImpl });
  assert.equal(result.modelCalled, false);
  assert.equal(fetchImpl.requests.length, 0);
});

test('the prompt sends only ref, title, sanitized url and domain', async () => {
  const snapshot = await snapshotFixture();
  const tabs = promptTabs(snapshot);
  const prompt = buildUserPrompt(tabs);
  assert.ok(!prompt.includes('10'), 'tab IDs must not appear');
  assert.ok(!prompt.includes('?'), 'query parameters must not appear');
  assert.ok(!prompt.includes('#'), 'fragments must not appear');
  assert.ok(prompt.includes('ref=1'));
  assert.ok(prompt.includes('react.dev'));
});
