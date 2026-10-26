/*
 * The review session that has to outlive the worker that made it.
 *
 * A stored session is what a restarted worker applies to real tabs, so these tests check both
 * halves: the entry the organizer can act on comes back unchanged, and anything that is not
 * provably such an entry is refused instead of half-restored.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildReviewPlan } from '../background/review-plan.js';
import { createSessionStore, parseStoredSession, SESSION_STORAGE_KEY } from '../background/session-store.js';
import { fakeChrome, sampleSnapshot } from './helpers.js';

async function realSession() {
  const snapshot = await sampleSnapshot();
  const classifications = {
    accepted: snapshot.eligibleTabs.map((tab) => ({
      ref: tab.ref,
      category: 'Study',
      explanation: 'fixture reason',
      confidence: 80,
    })),
    rejected: [],
  };
  return {
    sessionId: snapshot.sessionId,
    windowId: snapshot.windowId,
    snapshot,
    plan: buildReviewPlan(snapshot, classifications),
  };
}

test('a stored session comes back exactly as the organizer built it', async () => {
  const entry = await realSession();
  const store = createSessionStore(fakeChrome().chromeRef);
  assert.equal(await store.save(entry), true);
  const restored = await store.load();
  assert.deepEqual(restored, entry);
  assert.equal(restored.plan.items.length, entry.plan.items.length);
  assert.ok(restored.snapshot.eligibleTabs.length > 0, 'the snapshot a later apply is checked against');
});

test('clearing removes only the stored session', async () => {
  const chromeRef = fakeChrome().chromeRef;
  const store = createSessionStore(chromeRef);
  await store.save(await realSession());
  await store.clear();
  assert.equal(await store.load(), null);
  assert.deepEqual(Object.keys(chromeRef.storage.session.area), []);
});

test('a session stored by an older or foreign shape is refused, not partially restored', async () => {
  const entry = await realSession();
  const broken = [
    undefined,
    null,
    'session',
    42,
    [],
    { ...entry, sessionId: '' },
    { ...entry, sessionId: 7 },
    { ...entry, windowId: 'ten' },
    { ...entry, snapshot: undefined },
    { ...entry, snapshot: { ...entry.snapshot, tabs: 'all of them' } },
    { ...entry, snapshot: { ...entry.snapshot, sessionId: 'other-scan' } },
    { ...entry, snapshot: { ...entry.snapshot, tabs: [{ id: 1, windowId: 10, eligible: true }] } },
    { ...entry, plan: undefined },
    { ...entry, plan: { ...entry.plan, sessionId: 'other-scan' } },
    { ...entry, plan: { ...entry.plan, items: [{ ...entry.plan.items[0], tabId: '1' }] } },
    { ...entry, plan: { ...entry.plan, items: [{ ...entry.plan.items[0], category: 'Nonsense' }] } },
    { ...entry, plan: { ...entry.plan, items: [{ ...entry.plan.items[0], closeSelected: 'yes' }] } },
    { ...entry, plan: { ...entry.plan, counts: null } },
  ];
  for (const value of broken) {
    assert.equal(parseStoredSession(value), null, `${JSON.stringify(value)} must not restore`);
  }
  assert.deepEqual(parseStoredSession(entry), entry, 'the unbroken entry is the control for that list');
});

test('a refused stored session is reported as no session at all', async () => {
  const chromeRef = fakeChrome().chromeRef;
  chromeRef.storage.session.area[SESSION_STORAGE_KEY] = { sessionId: 'half-written' };
  const store = createSessionStore(chromeRef);
  assert.equal(await store.load(), null);
});

test('without chrome.storage.session there is no store, and the worker keeps working', () => {
  assert.equal(createSessionStore({}), null);
  assert.equal(createSessionStore({ storage: {} }), null);
  assert.equal(createSessionStore(undefined), null);
  const entry = createSessionStore({ storage: { session: { get: async () => ({}) } } });
  assert.equal(entry, null, 'a session area that cannot write is not a session area');
});

test('a failing session area is a warning, never a thrown request', async () => {
  const warnings = [];
  const chromeRef = {
    storage: {
      session: {
        get: async () => { throw new Error('area unavailable'); },
        set: async () => { throw new Error('quota reached'); },
        remove: async () => { throw new Error('area unavailable'); },
      },
    },
  };
  const store = createSessionStore(chromeRef, { log: { warn: (...args) => warnings.push(args[0]) } });
  assert.equal(await store.load(), null);
  assert.equal(await store.save(await realSession()), false);
  await store.clear();
  assert.equal(warnings.length, 3);
});
