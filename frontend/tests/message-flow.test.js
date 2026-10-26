/*
 * The whole message flow A–E, end to end.
 *
 * Unlike source.test.js, the mock here is the real backend: `chrome.runtime.sendMessage`
 * is bridged to `handleMessage` with a fake `chromeRef` and a fake `fetch`, so the page's
 * adapter is checked against the responses the extension actually produces — the same
 * session id, the same plan, the same partial-failure envelope. No browser mutation is
 * performed; every tab API call goes through the test fake.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createState, handleMessage } from '../../backend/background/message-handler.js';
import { ERROR_CODES, MESSAGE_TYPES } from '../../backend/shared/constants.js';
import { chatResponse, chatResponseForPrompt, fakeChrome, fakeFetch, jsonResponse, sampleTabs } from '../../backend/tests/helpers.js';
import { applyOrganization, getStatus, getReviewPlan, scan, updatePlan } from '../scripts/source.js';
import { createReviewSync } from '../scripts/review-sync.js';

const CONFIG = { endpoint: 'http://127.0.0.1:8080', model: 'gemma-3-1b-it', timeoutMs: 5000, configured: true, source: 'test' };

const reply = () => chatResponseForPrompt((ref) => ({
  category: ['Development', 'Study', 'Shopping'][ref - 1] || 'Other',
  explanation: `reason ${ref}`,
  confidence: 75 + ref,
}));

/** Installs the bridge and returns the pieces a test needs to inspect. */
function wire(options = {}) {
  const chrome = fakeChrome(options.tabs ?? sampleTabs(), options);
  const fetchImpl = fakeFetch([
    ['/health', options.health ?? jsonResponse({ status: 'ok' })],
    ['/v1/chat/completions', options.reply ?? reply()],
  ]);
  const state = createState();
  const sent = [];
  globalThis.chrome = {
    runtime: {
      id: 'test-extension',
      getURL: (path = '') => `chrome-extension://test-extension/${path}`,
      sendMessage: async (message) => {
        sent.push(message);
        return handleMessage({ message, state, chromeRef: chrome.chromeRef, config: CONFIG, fetchImpl });
      },
    },
  };
  return { ...chrome, state, sent, fetchImpl };
}

const tick = () => new Promise((settle) => setTimeout(settle, 0));

test('GET_STATUS through the real handler reports the ready model', async () => {
  const world = wire();
  const status = await getStatus();
  assert.equal(world.sent[0].type, MESSAGE_TYPES.GET_STATUS);
  assert.equal(status.status, 'ready');
  assert.equal(status.canScan, true);
  assert.equal(status.endpoint, 'http://127.0.0.1:8080');
  assert.equal(status.model, 'gemma-3-1b-it');
  assert.equal(status.probe.confidence, 76, 'the probe answer came back through the adapter');
  assert.deepEqual(world.calls.grouped, [], 'a status check never touches the browser');
});

test('an unreachable model server is reported as a blocked scan, not a silent ready', async () => {
  const world = wire({ health: async () => { throw new Error('connect refused'); } });
  const status = await getStatus();
  assert.equal(status.status, 'endpoint_unreachable');
  assert.equal(status.canScan, false);
  assert.ok(status.message.length > 0);
  assert.equal(world.sent.length, 1);
});

test('SCAN_TABS keeps its session and every later request uses it', async () => {
  const world = wire();
  const result = await scan();
  const sessionId = result.sessionId;
  assert.ok(typeof sessionId === 'string' && sessionId.length > 0);
  assert.equal(result.windowId, 10);
  assert.equal(result.scannedCount, 4);
  assert.equal(result.plan.items.length, 3);
  assert.deepEqual(result.plan.items.map((item) => item.category), ['Development', 'Study', 'Shopping']);
  assert.equal(result.plan.items[0].confidence, 76);
  assert.equal(result.skippedUnsupported[0].tabId, 4);

  const updated = await updatePlan({ sessionId, moves: [{ tabId: 1, category: 'Research' }], closures: [] });
  assert.equal(world.state.current.sessionId, sessionId, 'the session the worker holds is the one shown');
  assert.equal(updated.plan.items.find((item) => item.tabId === 1).category, 'Research');

  const reloaded = await getReviewPlan(sessionId);
  assert.equal(reloaded.plan.items.find((item) => item.tabId === 1).userEdited, true);

  await applyOrganization({ sessionId });
  assert.deepEqual(world.sent.map((message) => message.type), [
    MESSAGE_TYPES.SCAN_TABS,
    MESSAGE_TYPES.UPDATE_REVIEW_PLAN,
    MESSAGE_TYPES.GET_REVIEW_PLAN,
    MESSAGE_TYPES.APPLY_ORGANIZATION,
  ]);
  for (const message of world.sent.slice(1)) assert.equal(message.payload.sessionId, sessionId);
  assert.equal(world.sent.at(-1).payload.approve, true);
});

test('applying without the literal approval is refused by the worker', async () => {
  const world = wire();
  const result = await scan();
  const response = await handleMessage({
    message: { type: MESSAGE_TYPES.APPLY_ORGANIZATION, payload: { sessionId: result.sessionId } },
    state: world.state,
    chromeRef: world.chromeRef,
    config: CONFIG,
    fetchImpl: world.fetchImpl,
  });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, ERROR_CODES.INVALID_REQUEST);
  assert.deepEqual(world.calls.grouped, []);
  assert.deepEqual(world.calls.removed, []);
});

test('an edit from the review table lands in the worker session before apply', async () => {
  const world = wire();
  const result = await scan();
  const sync = createReviewSync({ scan: result, sessionId: result.sessionId, updatePlan, debounceMs: 0 });
  sync.record({ tabId: 1, category: 'Junk / Review' });
  sync.record({ tabId: 2, closeSelected: true });
  await tick();
  assert.equal(sync.read().status, 'clean');
  assert.equal(sync.read().pendingCount, 0);

  const flushed = await sync.flush();
  assert.equal(flushed.ok, true);
  const applied = await applyOrganization({ sessionId: result.sessionId });
  assert.equal(applied.partial, false);
  assert.deepEqual(applied.groups.map((group) => group.category).sort(), ['Junk / Review', 'Shopping']);
  assert.deepEqual(applied.closures, [{ tabId: 2, status: 'closed' }]);
  assert.equal(applied.closureRequested, 1);
  assert.equal(applied.closureCompleted, 1);
  assert.deepEqual(world.calls.removed, [2], 'only the individually selected tab closed');
});

test('a partial apply arrives as a failure that keeps the real result', async () => {
  const world = wire({ fail: { group: true } });
  const result = await scan();
  await assert.rejects(applyOrganization({ sessionId: result.sessionId }), (error) => {
    assert.equal(error.code, ERROR_CODES.PARTIAL_APPLY_FAILURE);
    assert.equal(error.details.partial, true);
    assert.equal(error.details.failures.length, 3, 'every category group failed');
    assert.equal(error.details.closureRequested, 0);
    return true;
  });
  assert.equal(world.state.current.sessionId, result.sessionId, 'the session survives a partial apply');
});

test('a scan the model cannot answer fails without becoming a half-built review', async () => {
  const unusable = wire({ reply: () => chatResponse('not json at all') });
  await assert.rejects(scan(), (error) => {
    assert.equal(error.code, ERROR_CODES.INVALID_MODEL_OUTPUT);
    assert.equal(error.details.failedCount, 3);
    return true;
  });
  assert.equal(unusable.state.current, null);
  assert.deepEqual(unusable.calls.grouped, []);
  assert.equal(unusable.sent.length, 1, 'one failed scan, no retry invented by the page');

  const offline = wire({ reply: () => jsonResponse({ error: 'model not loaded' }, 500) });
  await assert.rejects(scan(), (error) => {
    assert.equal(error.code, ERROR_CODES.MODEL_UNAVAILABLE);
    return true;
  });
  assert.equal(offline.state.current, null);
});

test('a session that no longer exists is recoverable: re-scan and start over', async () => {
  const world = wire();
  const result = await scan();
  world.state.current = null; // the worker restarted, or a newer scan replaced it

  const sync = createReviewSync({ scan: result, sessionId: result.sessionId, updatePlan, getReviewPlan, debounceMs: 0 });
  sync.record({ tabId: 1, category: 'Research' });
  await tick();
  assert.equal(sync.read().sessionLost, true);
  assert.equal(sync.read().canApply, false);
  const flushed = await sync.flush();
  assert.equal(flushed.ok, false);

  await assert.rejects(applyOrganization({ sessionId: result.sessionId }), { code: ERROR_CODES.INVALID_REQUEST });

  const fresh = await scan();
  assert.notEqual(fresh.sessionId, result.sessionId);
  assert.equal(fresh.plan.items.length, 3);
  assert.equal(world.state.current.sessionId, fresh.sessionId);

  // The old review is now definitively stale: the worker names the session it holds.
  await assert.rejects(applyOrganization({ sessionId: result.sessionId }), (error) => {
    assert.equal(error.code, ERROR_CODES.STALE_TABS);
    assert.equal(error.details.expected, fresh.sessionId);
    return true;
  });
});
