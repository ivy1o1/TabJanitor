/*
 * Review edit synchronization.
 *
 * These cases exist for one guardrail: category changes and closure selections must
 * reach the service worker before Apply, and no reply may undo what the user just did.
 * `updatePlan` and `getReviewPlan` are mocked here, so nothing else is needed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { ERROR_CODES } from '../../backend/shared/constants.js';
import { STATUS, createReviewSync } from '../scripts/review-sync.js';
import { recomputePlan } from '../scripts/selectors.js';

const tick = () => new Promise((settle) => setTimeout(settle, 0));

function item(overrides = {}) {
  return {
    tabId: 11,
    ref: 1,
    title: 'React Tutorial',
    domain: 'react.dev',
    url: 'https://react.dev/learn',
    category: 'Study',
    originalCategory: 'Study',
    explanation: 'a tutorial page',
    confidence: 80,
    closeSelected: false,
    userEdited: false,
    ...overrides,
  };
}

function scanWith(items) {
  const scan = {
    sessionId: 's-1',
    windowId: 10,
    scannedCount: items.length,
    eligibleCount: items.length,
    classifiedCount: items.length,
    skippedUnsupported: [],
    unclassified: [],
    truncated: [],
    rejected: [],
    modelMeta: null,
    plan: { sessionId: 's-1', windowId: 10, items, counts: {}, summary: {}, skippedUnsupported: [], unclassified: [] },
  };
  recomputePlan(scan);
  return scan;
}

/** The session echoes back exactly what it accepted, the way UPDATE_REVIEW_PLAN does. */
function confirmed(scan, overrides = {}) {
  return {
    plan: {
      sessionId: 's-1',
      windowId: 10,
      items: scan.plan.items.map((entry) => ({ ...entry })),
      counts: { ...scan.plan.counts },
      summary: { ...scan.plan.summary },
      skippedUnsupported: [],
      unclassified: [],
    },
    rejectedMoves: [],
    rejectedClosures: [],
    ...overrides,
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Records every UPDATE_REVIEW_PLAN call; `respond(call, payload)` decides the reply. */
function harness(scan, respond = () => undefined, options = {}) {
  const calls = [];
  const updatePlan = async (payload) => {
    calls.push(payload);
    const behaviour = respond(calls.length, payload);
    if (behaviour && typeof behaviour.promise === 'function') return behaviour.promise;
    if (behaviour && behaviour.reject) {
      const error = new Error(behaviour.message || 'failed');
      error.code = behaviour.reject;
      throw error;
    }
    return behaviour?.value ?? confirmed(scan);
  };
  const sync = createReviewSync({
    scan,
    sessionId: 's-1',
    updatePlan,
    getReviewPlan: options.getReviewPlan,
    debounceMs: 0,
  });
  return { calls, sync, scan };
}

function states(sync) {
  const seen = [];
  sync.subscribe((snapshot) => seen.push(snapshot));
  return seen;
}

test('an edit repaints at once and is sent as one documented update', async () => {
  const { calls, sync, scan } = harness(scanWith([item()]));
  sync.record({ tabId: 11, category: 'Research' });
  assert.equal(scan.plan.items[0].category, 'Research', 'the table never waits for the backend');
  assert.equal(sync.read().status, STATUS.PENDING);
  assert.equal(sync.read().pendingCount, 1);
  await tick();
  assert.deepEqual(calls, [{ sessionId: 's-1', moves: [{ tabId: 11, category: 'Research' }], closures: [] }]);
  assert.equal(sync.read().status, STATUS.CLEAN);
});

test('rapid edits to one tab coalesce into the last decision', async () => {
  const { calls, sync, scan } = harness(scanWith([item()]));
  sync.record({ tabId: 11, category: 'Research' });
  sync.record({ tabId: 11, category: 'Shopping' });
  sync.record({ tabId: 11, category: 'Other' });
  await tick();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].moves, [{ tabId: 11, category: 'Other' }]);
  assert.equal(scan.plan.items[0].category, 'Other');
  assert.equal(sync.read().status, STATUS.CLEAN);
});

test('a category and a closure decision for one tab travel in a single message', async () => {
  const { calls, sync } = harness(scanWith([item(), item({ tabId: 12, title: 'Cheap flights', category: 'Shopping', originalCategory: 'Shopping' })]));
  sync.record({ tabId: 11, category: 'Research' });
  sync.record({ tabId: 12, closeSelected: true });
  await tick();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].moves, [{ tabId: 11, category: 'Research' }]);
  assert.deepEqual(calls[0].closures, [{ tabId: 12, closeSelected: true }]);
});

test('a closure selection marks the row edited and reaches the session as a closure', async () => {
  const { calls, sync, scan } = harness(scanWith([item()]));
  sync.record({ tabId: 11, closeSelected: true });
  assert.equal(scan.plan.items[0].userEdited, true);
  assert.equal(scan.plan.summary.closureCount, 1, 'the counts the UI reads are recomputed locally');
  await tick();
  assert.deepEqual(calls[0].moves, []);
  assert.deepEqual(calls[0].closures, [{ tabId: 11, closeSelected: true }]);
});

test('an older reply cannot overwrite a newer edit', async () => {
  const scan = scanWith([item()]);
  const first = deferred();
  const calls = [];
  const updatePlan = async (payload) => {
    calls.push(payload);
    return calls.length === 1 ? first.promise : confirmed(scan);
  };
  const sync = createReviewSync({ scan, sessionId: 's-1', updatePlan, debounceMs: 0 });

  sync.record({ tabId: 11, category: 'Research' });
  await tick();
  assert.equal(calls.length, 1, 'the first batch is in flight');
  sync.record({ tabId: 11, category: 'Other' });
  first.resolve(confirmed(scan, { plan: { ...confirmed(scan).plan, items: [item({ category: 'Research', userEdited: true })] } }));
  await tick();
  assert.equal(scan.plan.items[0].category, 'Other', 'the newer decision stands');
  assert.deepEqual(calls[1].moves, [{ tabId: 11, category: 'Other' }], 'and the newer decision is still sent');
  assert.equal(sync.read().status, STATUS.CLEAN);
});

test('a failed update keeps the edit and a retry sends it', async () => {
  const scan = scanWith([item()]);
  let attempt = 0;
  const { calls, sync } = harness(scan, () => {
    attempt += 1;
    if (attempt === 1) return { reject: ERROR_CODES.BROWSER_API_ERROR, message: 'Could not read browser tabs.' };
    return { value: confirmed(scan) };
  });
  sync.record({ tabId: 11, category: 'Research' });
  await tick();
  const failed = sync.read();
  assert.equal(failed.status, STATUS.FAILED);
  assert.equal(failed.pendingCount, 1, 'the decision was not discarded');
  assert.equal(scan.plan.items[0].category, 'Research');
  const flushed = await sync.flush();
  assert.equal(flushed.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(sync.read().status, STATUS.CLEAN);
});

test('a refused edit is reported, not counted as synchronized', async () => {
  const scan = scanWith([item(), item({ tabId: 14, title: 'New Tab', domain: 'chrome' })]);
  const { sync } = harness(scan, () => ({
    value: confirmed(scan, {
      rejectedMoves: [{ tabId: 14, code: ERROR_CODES.UNSUPPORTED_TABS, reason: 'this page cannot be classified or organized by the extension' }],
    }),
  }));
  sync.record({ tabId: 14, category: 'Research' });
  await tick();
  const state = sync.read();
  assert.equal(state.status, STATUS.FAILED);
  assert.equal(state.unsyncedCount, 1);
  assert.equal(state.unsynced[0].title, 'New Tab');
  assert.match(state.message, /refused/i);
  const flushed = await sync.flush();
  assert.equal(flushed.ok, false, 'Apply must stay blocked while a change was refused');
  assert.equal(flushed.state.canApply, false);
});

test('a stale session is marked lost and nothing more is sent against it', async () => {
  const scan = scanWith([item()]);
  const { calls, sync } = harness(scan, () => ({ reject: ERROR_CODES.STALE_TABS, message: 'The sessionId does not match the current scan.' }));
  sync.record({ tabId: 11, category: 'Research' });
  await tick();
  const lost = sync.read();
  assert.equal(lost.status, STATUS.SESSION_LOST);
  assert.equal(lost.sessionLost, true);
  assert.equal(lost.canApply, false);
  sync.record({ tabId: 11, category: 'Other' });
  const flushed = await sync.flush();
  assert.equal(flushed.ok, false);
  assert.equal(calls.length, 1, 'the dead session is not poked again');
});

test('flush sends queued edits immediately and gates Apply', async () => {
  const scan = scanWith([item()]);
  const { calls, sync } = harness(scan);
  sync.record({ tabId: 11, closeSelected: true });
  const flushed = await sync.flush();
  assert.equal(flushed.ok, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].closures, [{ tabId: 11, closeSelected: true }]);
  assert.equal(sync.read().status, STATUS.CLEAN);
  await tick();
  assert.equal(calls.length, 1, 'the cancelled debounce does not send twice');
});

test('reload re-reads the authoritative plan and explains the discarded edits', async () => {
  const scan = scanWith([item()]);
  const getReviewPlan = async (sessionId) => {
    assert.equal(sessionId, 's-1');
    return { plan: { sessionId: 's-1', windowId: 10, items: [item({ category: 'Development', userEdited: true, closeSelected: true })], counts: {}, summary: {}, skippedUnsupported: [], unclassified: [] } };
  };
  const { sync } = harness(scan, () => ({ reject: ERROR_CODES.BROWSER_API_ERROR, message: 'nope' }), { getReviewPlan });
  sync.record({ tabId: 11, category: 'Research' });
  await tick();
  assert.equal(sync.read().status, STATUS.FAILED);
  const result = await sync.reload();
  assert.equal(result.ok, true);
  assert.equal(scan.plan.items[0].category, 'Development', 'the session is the source of truth again');
  assert.equal(sync.read().status, STATUS.CLEAN);
  assert.match(sync.read().message, /discarded/i);
});

test('a new scan retires the review: queued edits are never sent against the old session', async () => {
  const scan = scanWith([item()]);
  const { calls, sync } = harness(scan);
  sync.record({ tabId: 11, category: 'Research' });
  sync.dispose();
  await tick();
  assert.equal(calls.length, 0);
  assert.equal(sync.record({ tabId: 11, category: 'Other' }), false);
  await tick();
  assert.equal(calls.length, 0);
});

test('every state transition is published to the subscriber', async () => {
  const scan = scanWith([item()]);
  const { sync } = harness(scan);
  const seen = states(sync);
  sync.record({ tabId: 11, category: 'Research' });
  await tick();
  const transitions = seen.map((entry) => entry.status).filter((status, index, all) => status !== all[index - 1]);
  assert.deepEqual(transitions, [STATUS.CLEAN, STATUS.PENDING, STATUS.SYNCING, STATUS.CLEAN]);
  assert.equal(seen.at(-1).pendingCount, 0);
});
