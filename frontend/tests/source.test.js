/*
 * The integration boundary: frontend/scripts/source.js against a mocked
 * chrome.runtime.sendMessage.
 *
 * Every case below is answered with the documented envelope from
 * backend/docs/API_CONTRACT.md — including the failures — because the rule these tests
 * protect is "no false success": the page may only show what the worker really said.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { ERROR_CODES, MESSAGE_TYPES } from '../../backend/shared/constants.js';
import {
  CLIENT_ERROR_CODES,
  SourceError,
  applyOrganization,
  getStatus,
  getReviewPlan,
  isExtensionContext,
  scan,
  updatePlan,
} from '../scripts/source.js';

const fetchCalls = [];
globalThis.fetch = async (url) => {
  fetchCalls.push(String(url));
  throw new Error('the dashboard must never call the inference endpoint itself');
};

/** Installs a fake extension runtime; `responder` decides the envelope for each message. */
function withRuntime(responder) {
  const sent = [];
  globalThis.chrome = {
    runtime: {
      id: 'test-extension',
      getURL: (path = '') => `chrome-extension://test-extension/${path}`,
      onMessage: { addListener: () => {} },
      sendMessage: async (message) => {
        sent.push(message);
        return responder(message, sent.length - 1);
      },
    },
  };
  return sent;
}

function withoutRuntime(fn) {
  return async () => {
    const previous = globalThis.chrome;
    delete globalThis.chrome;
    try {
      return await fn();
    } finally {
      globalThis.chrome = previous;
    }
  };
}

const ok = (data) => ({ ok: true, data });

function item(overrides = {}) {
  return {
    ref: 1,
    tabId: 11,
    title: 'React Tutorial',
    domain: 'react.dev',
    url: 'https://react.dev/learn',
    category: 'Study',
    originalCategory: 'Study',
    explanation: 'a tutorial page',
    confidence: 82,
    closeSelected: false,
    userEdited: false,
    ...overrides,
  };
}

function plan(overrides = {}) {
  const items = overrides.items ?? [item(), item({ tabId: 12, ref: 2, title: 'Cheap flights', domain: 'shop.example.com', category: 'Shopping', originalCategory: 'Shopping', confidence: 61 })];
  return {
    sessionId: 's-1',
    windowId: 10,
    createdAt: 1,
    updatedAt: 1,
    items,
    counts: { Development: 0, Study: 1, Research: 0, Shopping: 1, Entertainment: 0, Other: 0, 'Junk / Review': 0 },
    unclassified: [{ tabId: 15, ref: 3, title: 'Loose tab', domain: 'x.test', reason: 'the model did not answer for this tab' }],
    skippedUnsupported: [{ tabId: 14, reason: 'browser internal page' }],
    summary: { total: items.length, closureCount: 0, editedCount: 0 },
    ...overrides,
  };
}

function scanData(overrides = {}) {
  return {
    sessionId: 's-1',
    windowId: 10,
    scannedCount: 4,
    classifiedCount: 2,
    eligibleCount: 2,
    skippedUnsupported: [{ tabId: 14, reason: 'browser internal page' }],
    unclassified: [{ tabId: 15, ref: 3, title: 'Loose tab', domain: 'x.test', reason: 'the model did not answer for this tab' }],
    truncated: [],
    rejected: [],
    modelMeta: { modelCalled: true, requests: 2, serverModel: 'gemma-3-1b-it', tokensPerSecond: 19.4, finishReason: 'stop', failedRequests: 0 },
    plan: plan(),
    ...overrides,
  };
}

/* ----------------------------------------------------------------------- GET_STATUS */

test('GET_STATUS returns exactly what the worker reported when the model is ready', async () => {
  const sent = withRuntime(() => ok({
    status: 'ready',
    canScan: true,
    endpoint: 'http://127.0.0.1:8080',
    model: 'gemma-3-1b-it',
    message: 'The model is ready for classification.',
    probe: { category: 'Other', confidence: 55, serverModel: 'gemma-3-1b-it', tokensPerSecond: 21 },
  }));
  const status = await getStatus();
  assert.deepEqual(sent, [{ type: MESSAGE_TYPES.GET_STATUS, payload: {} }]);
  assert.equal(status.status, 'ready');
  assert.equal(status.canScan, true);
  assert.equal(status.endpoint, 'http://127.0.0.1:8080');
  assert.equal(status.model, 'gemma-3-1b-it');
  assert.equal(status.probe.category, 'Other');
  assert.equal(fetchCalls.length, 0, 'status is read through the worker, never fetched here');
});

for (const failing of ['config_missing', 'endpoint_unreachable', 'model_request_failing']) {
  test(`GET_STATUS keeps the ${failing} state and its blocked scan`, async () => {
    withRuntime(() => ok({ status: failing, canScan: false, endpoint: 'http://127.0.0.1:8080', model: 'gemma-3-1b-it', message: `real ${failing} reason` }));
    const status = await getStatus();
    assert.equal(status.status, failing);
    assert.equal(status.canScan, false);
    assert.equal(status.message, `real ${failing} reason`);
  });
}

test('a status the contract does not define is shown as unknown, never as ready', async () => {
  withRuntime(() => ok({ status: 'probably_fine', canScan: true, message: 'odd reply' }));
  const status = await getStatus();
  assert.equal(status.status, 'unknown');
  assert.equal(status.canScan, false, 'only the worker can allow a scan');
});

test('a missing endpoint and model stay labelled, they are not invented', async () => {
  withRuntime(() => ok({ status: 'config_missing', canScan: false, message: 'No inference endpoint is configured.' }));
  const status = await getStatus();
  assert.equal(status.endpoint, 'not configured');
  assert.equal(status.model, 'unknown model');
});

test('a GET_STATUS error envelope rejects with the documented code', async () => {
  const sent = withRuntime(() => ({
    ok: false,
    error: { code: ERROR_CODES.MODEL_UNAVAILABLE, message: 'The inference endpoint answered but the model is not loaded.', details: { status: 500 } },
  }));
  await assert.rejects(getStatus, (error) => {
    assert.ok(error instanceof SourceError);
    assert.equal(error.code, ERROR_CODES.MODEL_UNAVAILABLE);
    assert.deepEqual(error.details, { status: 500 });
    return true;
  });
  assert.equal(sent.length, 1);
});

/* -------------------------------------------------------------------------- SCAN_TABS */

test('SCAN_TABS keeps the session and the plan the worker returned', async () => {
  const sent = withRuntime(() => ok(scanData()));
  const result = await scan();
  assert.deepEqual(sent, [{ type: MESSAGE_TYPES.SCAN_TABS, payload: {} }]);
  assert.equal(result.sessionId, 's-1');
  assert.equal(result.windowId, 10);
  assert.equal(result.scannedCount, 4);
  assert.equal(result.plan.items.length, 2);
  assert.deepEqual(result.plan.items[0], item());
  assert.equal(result.plan.counts.Study, 1);
  assert.equal(result.unclassified.length, 1);
  assert.equal(result.skippedUnsupported[0].tabId, 14);
  assert.equal(result.modelMeta.requests, 2);
});

test('SCAN_TABS optional limits are forwarded unchanged', async () => {
  const sent = withRuntime(() => ok(scanData()));
  await scan({ maxTabsPerRequest: 12, timeoutMs: 20000 });
  assert.deepEqual(sent[0].payload, { maxTabsPerRequest: 12, timeoutMs: 20000 });
});

for (const code of [ERROR_CODES.INFERENCE_TIMEOUT, ERROR_CODES.MODEL_UNAVAILABLE, ERROR_CODES.INVALID_MODEL_OUTPUT, ERROR_CODES.BROWSER_API_ERROR]) {
  test(`a failed scan rejects with ${code} and yields no plan`, async () => {
    withRuntime(() => ({ ok: false, error: { code, message: `real ${code}`, details: {} } }));
    await assert.rejects(scan(), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.message, `real ${code}`);
      return true;
    });
  });
}

test('an item the worker cannot map to a tab is dropped, not guessed', async () => {
  withRuntime(() => ok(scanData({
    plan: plan({ items: [item(), { title: 'no tab id', category: 'Study', confidence: 90 }] }),
  })));
  const result = await scan();
  assert.equal(result.plan.items.length, 1);
  assert.equal(result.plan.items[0].tabId, 11);
});

test('model confidence is clamped and only a literal true selects a closure', async () => {
  withRuntime(() => ok(scanData({
    plan: plan({ items: [item({ confidence: 140, closeSelected: 'yes', userEdited: 1 })] }),
  })));
  const [only] = (await scan()).plan.items;
  assert.equal(only.confidence, 100);
  assert.equal(only.closeSelected, false);
  assert.equal(only.userEdited, false);
});

test('counts that contradict the items are recomputed from the items', async () => {
  withRuntime(() => ok(scanData({
    plan: plan({ counts: { Study: 99, Shopping: 42 } }),
  })));
  const result = await scan();
  assert.equal(result.plan.counts.Study, 99, 'a supplied count is trusted as supplied');
  withRuntime(() => ok(scanData({ plan: plan({ counts: {} }) })));
  const recount = await scan();
  assert.equal(recount.plan.counts.Study, 1);
  assert.equal(recount.plan.counts.Shopping, 1);
});

test('a plan with no items is a real empty review, not an error', async () => {
  withRuntime(() => ok(scanData({ plan: plan({ items: [], counts: undefined }), classifiedCount: 0 })));
  const result = await scan();
  assert.equal(result.plan.items.length, 0);
  assert.equal(result.scannedCount, 4);
});

/* ------------------------------------------------------------------ GET_REVIEW_PLAN */

test('GET_REVIEW_PLAN re-reads the authoritative plan for the retained session', async () => {
  const sent = withRuntime(() => ok({ plan: plan({ items: [item({ category: 'Research', userEdited: true })], summary: { total: 1, closureCount: 0, editedCount: 1 } }) }));
  const { plan: reloaded } = await getReviewPlan('s-1');
  assert.deepEqual(sent, [{ type: MESSAGE_TYPES.GET_REVIEW_PLAN, payload: { sessionId: 's-1' } }]);
  assert.equal(reloaded.items[0].category, 'Research');
  assert.equal(reloaded.items[0].userEdited, true);
});

test('a stale session is reported as stale rather than as an empty plan', async () => {
  withRuntime(() => ({ ok: false, error: { code: ERROR_CODES.STALE_TABS, message: 'The sessionId does not match the current scan.', details: { expected: 's-2' } } }));
  await assert.rejects(getReviewPlan('s-1'), (error) => {
    assert.equal(error.code, ERROR_CODES.STALE_TABS);
    assert.equal(error.details.expected, 's-2');
    return true;
  });
});

/* --------------------------------------------------------------- UPDATE_REVIEW_PLAN */

test('UPDATE_REVIEW_PLAN sends the documented moves and closures payload', async () => {
  const sent = withRuntime(() => ok({ plan: plan(), rejectedMoves: [], rejectedClosures: [] }));
  await updatePlan({
    sessionId: 's-1',
    moves: [{ tabId: 11, category: 'Research' }],
    closures: [{ tabId: 12, closeSelected: true }],
  });
  assert.deepEqual(sent, [{
    type: MESSAGE_TYPES.UPDATE_REVIEW_PLAN,
    payload: {
      sessionId: 's-1',
      moves: [{ tabId: 11, category: 'Research' }],
      closures: [{ tabId: 12, closeSelected: true }],
    },
  }]);
});

test('refused edits are returned, not hidden', async () => {
  withRuntime(() => ok({
    plan: plan(),
    rejectedMoves: [{ tabId: 99, code: ERROR_CODES.STALE_TABS, reason: 'tabId is not in the current plan' }],
    rejectedClosures: [{ tabId: 14, code: ERROR_CODES.UNSUPPORTED_TABS, reason: 'this page cannot be classified or organized by the extension' }],
  }));
  const result = await updatePlan({ sessionId: 's-1', moves: [{ tabId: 99, category: 'Study' }], closures: [{ tabId: 14, closeSelected: true }] });
  assert.equal(result.rejectedMoves.length, 1);
  assert.equal(result.rejectedClosures[0].code, ERROR_CODES.UNSUPPORTED_TABS);
});

/* ---------------------------------------------------------------- APPLY_ORGANIZATION */

test('APPLY_ORGANIZATION always carries the explicit approval and the current session', async () => {
  const sent = withRuntime(() => ok({
    sessionId: 's-1',
    windowId: 10,
    groups: [{ category: 'Study', groupId: 101, tabIds: [11], title: 'Study', color: 'yellow', status: 'success' }],
    closures: [{ tabId: 12, status: 'closed' }],
    stale: [],
    failures: [],
    partial: false,
    closureRequested: 1,
    closureCompleted: 1,
    closureFailed: 0,
  }));
  const result = await applyOrganization({ sessionId: 's-1' });
  assert.deepEqual(sent, [{ type: MESSAGE_TYPES.APPLY_ORGANIZATION, payload: { sessionId: 's-1', approve: true } }]);
  assert.equal(result.groups[0].groupId, 101);
  assert.equal(result.partial, false);
});

test('a partial apply surfaces the real result and its failure code', async () => {
  const partial = {
    sessionId: 's-1',
    windowId: 10,
    groups: [{ category: 'Study', groupId: 101, tabIds: [11], title: 'Study', color: 'yellow', status: 'success' }],
    closures: [],
    stale: [{ tabId: 12, reason: 'tab no longer exists in the scanned window' }],
    failures: [{ operation: 'close', tabId: 13, reason: 'close denied' }],
    partial: true,
    closureRequested: 2,
    closureCompleted: 0,
    closureFailed: 2,
  };
  withRuntime(() => ({ ok: false, error: { code: ERROR_CODES.PARTIAL_APPLY_FAILURE, message: 'Some group or close operations did not complete.', details: partial } }));
  await assert.rejects(applyOrganization({ sessionId: 's-1' }), (error) => {
    assert.equal(error.code, ERROR_CODES.PARTIAL_APPLY_FAILURE);
    assert.equal(error.details.partial, true);
    assert.equal(error.details.failures.length, 1);
    assert.equal(error.details.closureCompleted, 0);
    return true;
  });
});

/* ------------------------------------------------------------------- transport lies */

test('outside an extension context there is no fallback to sample data', withoutRuntime(async () => {
  assert.equal(isExtensionContext(), false);
  await assert.rejects(getStatus(), (error) => {
    assert.equal(error.code, CLIENT_ERROR_CODES.NOT_EXTENSION);
    return true;
  });
  await assert.rejects(scan(), { code: CLIENT_ERROR_CODES.NOT_EXTENSION });
  await assert.rejects(applyOrganization({ sessionId: 's-1' }), { code: CLIENT_ERROR_CODES.NOT_EXTENSION });
  assert.equal(fetchCalls.length, 0, 'and no direct call to the inference endpoint either');
}));

test('a worker that does not answer is a failure, not an empty success', async () => {
  withRuntime(() => {
    throw new Error('Extension context invalidated.');
  });
  await assert.rejects(getStatus(), { code: CLIENT_ERROR_CODES.MESSAGING_FAILED });
});

for (const [label, reply] of [
  ['undefined (no listener answered)', undefined],
  ['a bare truthy value', true],
  ['success without data', { ok: true }],
  ['data that is not an object', { ok: true, data: 'ready' }],
  ['a failure without an error object', { ok: false }],
  ['an envelope of the wrong shape', { status: 'ready' }],
]) {
  test(`a reply of ${label} is reported as malformed`, async () => {
    withRuntime(() => reply);
    await assert.rejects(getStatus(), { code: CLIENT_ERROR_CODES.MALFORMED_RESPONSE });
  });
}
