import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, handleMessage } from '../background/message-handler.js';
import { MESSAGE_TYPES, STATUS_VALUES } from '../shared/constants.js';
import { chatResponse, chatResponseForPrompt, fakeChrome, fakeFetch, jsonResponse, sampleTabs } from './helpers.js';

const CONFIG = { endpoint: 'http://127.0.0.1:8080', model: 'gemma-3-1b-it', timeoutMs: 5000, configured: true, source: 'test' };

const fixtureReply = () => chatResponseForPrompt((ref) => ({
  category: ['Development', 'Study', 'Shopping'][ref - 1] || 'Other',
  explanation: `reason ${ref}`,
  confidence: 75 + ref,
}));

function scanFixture(tabs = sampleTabs(), options = {}) {
  const { chromeRef, calls } = fakeChrome(tabs, options);
  const fetchImpl = fakeFetch([['/health', jsonResponse({ status: 'ok' })], ['/v1/chat/completions', options.reply || fixtureReply()]]);
  const state = createState();
  return { state, chromeRef, calls, fetchImpl };
}

test('SCAN_TABS returns a reviewable plan built from real tabs', async () => {
  const fixture = scanFixture();
  const fetchImpl = fakeFetch([['/v1/chat/completions', fixtureReply()]]);
  const response = await handleMessage({
    message: { type: MESSAGE_TYPES.SCAN_TABS, payload: {} },
    state: fixture.state,
    chromeRef: fixture.chromeRef,
    config: CONFIG,
    fetchImpl,
  });
  assert.equal(response.ok, true);
  assert.equal(response.data.scannedCount, 4);
  assert.equal(response.data.classifiedCount, 3);
  assert.deepEqual(response.data.skippedUnsupported, [{ tabId: 4, reason: 'unsupported scheme' }]);
  assert.equal(response.data.modelMeta.modelCalled, true);
  assert.deepEqual(response.data.plan.items.map((item) => item.title), [
    'React Tutorial – react.dev',
    'Notebook LM',
    'Cheap flights',
  ]);
  // scanning must not mutate the browser
  assert.deepEqual(fixture.calls.grouped, []);
  assert.deepEqual(fixture.calls.removed, []);
});

test('GET_REVIEW_PLAN and UPDATE_REVIEW_PLAN do not touch the browser', async () => {
  const fixture = scanFixture();
  const fetchImpl = fakeFetch([['/v1/chat/completions', fixtureReply()]]);
  const scan = await handleMessage({
    message: { type: MESSAGE_TYPES.SCAN_TABS, payload: {} },
    state: fixture.state,
    chromeRef: fixture.chromeRef,
    config: CONFIG,
    fetchImpl,
  });
  const sessionId = scan.data.sessionId;
  const getResponse = await handleMessage({
    message: { type: MESSAGE_TYPES.GET_REVIEW_PLAN, payload: { sessionId } },
    state: fixture.state,
    chromeRef: fixture.chromeRef,
    config: CONFIG,
    fetchImpl,
  });
  assert.equal(getResponse.ok, true);
  assert.equal(getResponse.data.plan.sessionId, sessionId);
  const update = await handleMessage({
    message: {
      type: MESSAGE_TYPES.UPDATE_REVIEW_PLAN,
      payload: { sessionId, moves: [{ tabId: 1, category: 'Other' }], closures: [{ tabId: 3, closeSelected: true }] },
    },
    state: fixture.state,
    chromeRef: fixture.chromeRef,
    config: CONFIG,
    fetchImpl,
  });
  assert.equal(update.ok, true);
  assert.equal(update.data.plan.items.find((item) => item.tabId === 1).category, 'Other');
  assert.equal(update.data.plan.summary.closureCount, 1);
  assert.deepEqual(fixture.calls.grouped, []);
  assert.deepEqual(fixture.calls.removed, []);
});

test('a stale or missing sessionId is rejected', async () => {
  const fixture = scanFixture();
  const missing = await handleMessage({
    message: { type: MESSAGE_TYPES.GET_REVIEW_PLAN, payload: {} },
    state: fixture.state,
    chromeRef: fixture.chromeRef,
    config: CONFIG,
    fetchImpl: fixture.fetchImpl,
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, 'INVALID_REQUEST');

  const scan = await handleMessage({
    message: { type: MESSAGE_TYPES.SCAN_TABS, payload: {} },
    state: fixture.state,
    chromeRef: fixture.chromeRef,
    config: CONFIG,
    fetchImpl: fakeFetch([['/v1/chat/completions', fixtureReply()]]),
  });
  const stale = await handleMessage({
    message: { type: MESSAGE_TYPES.APPLY_ORGANIZATION, payload: { sessionId: 'other-session', approve: true } },
    state: fixture.state,
    chromeRef: fixture.chromeRef,
    config: CONFIG,
    fetchImpl: fixture.fetchImpl,
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.error.code, 'STALE_TABS');
  assert.equal(scan.data.sessionId.length > 0, true);
  assert.deepEqual(fixture.calls.grouped, []);
});

test('APPLY_ORGANIZATION requires an explicit approval flag', async () => {
  const fixture = scanFixture();
  const fetchImpl = fakeFetch([['/v1/chat/completions', fixtureReply()]]);
  const scan = await handleMessage({
    message: { type: MESSAGE_TYPES.SCAN_TABS, payload: {} },
    state: fixture.state,
    chromeRef: fixture.chromeRef,
    config: CONFIG,
    fetchImpl,
  });
  const sessionId = scan.data.sessionId;
  const rejected = await handleMessage({
    message: { type: MESSAGE_TYPES.APPLY_ORGANIZATION, payload: { sessionId } },
    state: fixture.state,
    chromeRef: fixture.chromeRef,
    config: CONFIG,
    fetchImpl,
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, 'INVALID_REQUEST');
  assert.deepEqual(fixture.calls.grouped, []);

  const applied = await handleMessage({
    message: { type: MESSAGE_TYPES.APPLY_ORGANIZATION, payload: { sessionId, approve: true } },
    state: fixture.state,
    chromeRef: fixture.chromeRef,
    config: CONFIG,
    fetchImpl,
  });
  assert.equal(applied.ok, true);
  assert.equal(applied.data.groups.length, 3);
  assert.equal(applied.data.closures.length, 0);
});

test('a partially failed apply reports PARTIAL_APPLY_FAILURE with the real result', async () => {
  const fixture = scanFixture();
  const fetchImpl = fakeFetch([['/v1/chat/completions', fixtureReply()]]);
  const scan = await handleMessage({
    message: { type: MESSAGE_TYPES.SCAN_TABS, payload: {} },
    state: fixture.state,
    chromeRef: fixture.chromeRef,
    config: CONFIG,
    fetchImpl,
  });
  fixture.chromeRef.tabs.group = async () => { throw new Error('grouping denied'); };
  const applied = await handleMessage({
    message: { type: MESSAGE_TYPES.APPLY_ORGANIZATION, payload: { sessionId: scan.data.sessionId, approve: true } },
    state: fixture.state,
    chromeRef: fixture.chromeRef,
    config: CONFIG,
    fetchImpl,
  });
  assert.equal(applied.ok, false);
  assert.equal(applied.error.code, 'PARTIAL_APPLY_FAILURE');
  assert.equal(applied.error.details.groups.length, 0);
  assert.equal(applied.error.details.failures.length, 3);
});

test('a partially failed apply reports which operations succeeded and which failed', async () => {
  const fixture = scanFixture();
  const fetchImpl = fakeFetch([['/v1/chat/completions', fixtureReply()]]);
  const scan = await handleMessage({
    message: { type: MESSAGE_TYPES.SCAN_TABS, payload: {} },
    state: fixture.state,
    chromeRef: fixture.chromeRef,
    config: CONFIG,
    fetchImpl,
  });
  const sessionId = scan.data.sessionId;
  // One tab selected for closure, one tab disappears before apply.
  await handleMessage({
    message: { type: MESSAGE_TYPES.UPDATE_REVIEW_PLAN, payload: { sessionId, closures: [{ tabId: 1, closeSelected: true }] } },
    state: fixture.state,
    chromeRef: fixture.chromeRef,
    config: CONFIG,
    fetchImpl,
  });
  fixture.chromeRef.tabs.remove = async (tabId) => {
    if (tabId === 1) throw new Error('close denied by the browser');
    fixture.calls.removed.push(tabId);
  };
  const applied = await handleMessage({
    message: { type: MESSAGE_TYPES.APPLY_ORGANIZATION, payload: { sessionId, approve: true } },
    state: fixture.state,
    chromeRef: fixture.chromeRef,
    config: CONFIG,
    fetchImpl,
  });
  assert.equal(applied.ok, false);
  assert.equal(applied.error.code, 'PARTIAL_APPLY_FAILURE');
  assert.equal(applied.error.details.closureRequested, 1);
  assert.equal(applied.error.details.closureCompleted, 0);
  assert.deepEqual(applied.error.details.closures, []);
  assert.deepEqual(applied.error.details.failures, [{ operation: 'close', tabId: 1, reason: 'close denied by the browser' }]);
  // the tabs that still exist were grouped and reported honestly, including the
  // tab whose close failed — it is still in the window, so grouping it is real
  assert.equal(applied.error.details.groups.length, 3);
  assert.deepEqual(applied.error.details.groups.map((group) => group.status), ['success', 'success', 'success']);
  assert.deepEqual(applied.error.details.groups.map((group) => group.tabIds).flat().sort((a, b) => a - b), [1, 2, 3]);
  // tab 2 and 3 were never selected for closure, so nothing else was removed
  assert.deepEqual(fixture.calls.removed, []);
});

test('an unavailable endpoint surfaces MODEL_UNAVAILABLE instead of fake results', async () => {  const fixture = scanFixture();
  const fetchImpl = fakeFetch([['/v1/chat/completions', () => { throw new Error('ECONNREFUSED'); }]]);
  const response = await handleMessage({
    message: { type: MESSAGE_TYPES.SCAN_TABS, payload: {} },
    state: fixture.state,
    chromeRef: fixture.chromeRef,
    config: CONFIG,
    fetchImpl,
  });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'MODEL_UNAVAILABLE');
  assert.equal(fixture.state.current, null);
});

test('GET_STATUS distinguishes the four documented states', async () => {
  const unreachable = await handleMessage({
    message: { type: MESSAGE_TYPES.GET_STATUS, payload: {} },
    state: createState(),
    chromeRef: fakeChrome([]).chromeRef,
    config: CONFIG,
    fetchImpl: fakeFetch([['/health', () => { throw new Error('ECONNREFUSED'); }]]),
  });
  assert.equal(unreachable.data.status, STATUS_VALUES.ENDPOINT_UNREACHABLE);
  assert.equal(unreachable.data.canScan, false);

  const healthy = fixtureReply();
  const ready = await handleMessage({
    message: { type: MESSAGE_TYPES.GET_STATUS, payload: {} },
    state: createState(),
    chromeRef: fakeChrome([]).chromeRef,
    config: CONFIG,
    fetchImpl: fakeFetch([['/health', jsonResponse({ status: 'ok' })], ['/v1/chat/completions', healthy]]),
  });
  assert.equal(ready.data.status, STATUS_VALUES.READY);
  assert.equal(ready.data.canScan, true);

  const failing = await handleMessage({
    message: { type: MESSAGE_TYPES.GET_STATUS, payload: {} },
    state: createState(),
    chromeRef: fakeChrome([]).chromeRef,
    config: CONFIG,
    fetchImpl: fakeFetch([['/health', jsonResponse({ status: 'ok' })], ['/v1/chat/completions', chatResponse('not json at all')]]),
  });
  assert.equal(failing.data.status, STATUS_VALUES.MODEL_REQUEST_FAILING);
  assert.equal(failing.data.canScan, false);

  const missing = await handleMessage({
    message: { type: MESSAGE_TYPES.GET_STATUS, payload: {} },
    state: createState(),
    chromeRef: fakeChrome([]).chromeRef,
    config: { endpoint: '', model: '', timeoutMs: 5000 },
    fetchImpl: fakeFetch([]),
  });
  assert.equal(missing.ok, true);
  assert.equal(missing.data.status, STATUS_VALUES.CONFIG_MISSING);
  assert.equal(missing.data.canScan, false);
});

test('readiness and status checks send no tab metadata', async () => {
  const fetchImpl = fakeFetch([['/health', jsonResponse({ status: 'ok' })], ['/v1/chat/completions', fixtureReply()]]);
  await handleMessage({
    message: { type: MESSAGE_TYPES.GET_STATUS, payload: {} },
    state: createState(),
    chromeRef: fakeChrome(sampleTabs()).chromeRef,
    config: CONFIG,
    fetchImpl,
  });
  const healthCall = fetchImpl.requests.find((entry) => entry.url.includes('/health'));
  assert.equal(healthCall.init.body, undefined);
  assert.equal(healthCall.init.method, 'GET');
});

test('malformed requests are rejected without side effects', async () => {
  const fixture = scanFixture();
  for (const message of [null, 'scan', { type: 5 }, { type: 'NOPE' }, { type: MESSAGE_TYPES.SCAN_TABS, payload: 'x' }]) {
    const response = await handleMessage({
      message,
      state: fixture.state,
      chromeRef: fixture.chromeRef,
      config: CONFIG,
      fetchImpl: fixture.fetchImpl,
    });
    assert.equal(response.ok, false);
    assert.equal(response.error.code, 'INVALID_REQUEST');
  }
  assert.deepEqual(fixture.calls.grouped, []);
});

test('SCAN_TABS rejects out-of-range or non-integer limits before doing any work', async () => {
  for (const bad of [0, -1, 1.5, '10', Number.NaN, 101, 1e9, true, {}, []]) {
    const fixture = scanFixture();
    const response = await handleMessage({
      message: { type: MESSAGE_TYPES.SCAN_TABS, payload: { maxTabsPerRequest: bad } },
      state: fixture.state,
      chromeRef: fixture.chromeRef,
      config: CONFIG,
      fetchImpl: fixture.fetchImpl,
    });
    assert.equal(response.ok, false, `maxTabsPerRequest=${JSON.stringify(bad)}`);
    assert.equal(response.error.code, 'INVALID_REQUEST');
    assert.equal(response.error.details.min, 1);
    assert.equal(response.error.details.max, 100);
    // rejected before the window was read or the model was called
    assert.equal(fixture.fetchImpl.requests.length, 0);
    assert.equal(fixture.state.current, null);
  }
});

test('SCAN_TABS rejects invalid timeout values with a structured error', async () => {
  for (const bad of [0, -5, '60000', 2.5, 300001, Number.POSITIVE_INFINITY]) {
    const fixture = scanFixture();
    const response = await handleMessage({
      message: { type: MESSAGE_TYPES.SCAN_TABS, payload: { timeoutMs: bad } },
      state: fixture.state,
      chromeRef: fixture.chromeRef,
      config: CONFIG,
      fetchImpl: fixture.fetchImpl,
    });
    assert.equal(response.ok, false, `timeoutMs=${JSON.stringify(bad)}`);
    assert.equal(response.error.code, 'INVALID_REQUEST');
    assert.equal(response.error.details.min, 1000);
    assert.equal(response.error.details.max, 300000);
    assert.equal(fixture.fetchImpl.requests.length, 0);
  }
});

test('valid limits are honoured and omitted fields use the documented defaults', async () => {
  const many = Array.from({ length: 6 }, (_, index) => ({
    id: 200 + index, windowId: 7, title: `Tab ${index}`, url: `https://ex${index}.com/`,
  }));
  const capped = scanFixture(many);
  const cappedResponse = await handleMessage({
    message: { type: MESSAGE_TYPES.SCAN_TABS, payload: { maxTabsPerRequest: 2, timeoutMs: 5000 } },
    state: capped.state,
    chromeRef: capped.chromeRef,
    config: CONFIG,
    fetchImpl: fakeFetch([['/v1/chat/completions', fixtureReply()]]),
  });
  assert.equal(cappedResponse.ok, true);
  assert.equal(cappedResponse.data.classifiedCount, 2);
  assert.deepEqual(cappedResponse.data.truncated, [202, 203, 204, 205]);
  assert.equal(cappedResponse.data.modelMeta.requests, 2);

  const defaulted = scanFixture(many);
  const defaultResponse = await handleMessage({
    message: { type: MESSAGE_TYPES.SCAN_TABS, payload: {} },
    state: defaulted.state,
    chromeRef: defaulted.chromeRef,
    config: CONFIG,
    fetchImpl: fakeFetch([['/v1/chat/completions', fixtureReply()]]),
  });
  assert.equal(defaultResponse.ok, true);
  assert.equal(defaultResponse.data.modelMeta.requests, 6);
  assert.deepEqual(defaultResponse.data.truncated, []);
});

test('a non-loopback endpoint is refused before any tab data is sent', async () => {
  const fixture = scanFixture();
  const fetchImpl = fakeFetch([['/v1/chat/completions', fixtureReply()]]);
  const response = await handleMessage({
    message: { type: MESSAGE_TYPES.SCAN_TABS, payload: {} },
    state: fixture.state,
    chromeRef: fixture.chromeRef,
    config: { ...CONFIG, endpoint: 'https://cloud.example.com' },
    fetchImpl,
  });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'CONFIG_MISSING');
  assert.equal(fetchImpl.requests.length, 0);
});
