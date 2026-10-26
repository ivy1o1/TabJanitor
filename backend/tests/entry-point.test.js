/*
 * Dashboard extension entry point.
 *
 * Covers spec section 4: clicking the toolbar icon opens (or focuses) the dashboard at
 * the extension-owned URL, and adding that listener must not disturb the message
 * listener or its trusted-sender check.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ERROR_CODES, MESSAGE_TYPES } from '../shared/constants.js';
import { SESSION_STORAGE_KEY } from '../background/session-store.js';
import { chatResponseForPrompt, fakeFetch, fakeSessionStorage, groupOptionsError, groupUpdateError, jsonResponse } from './helpers.js';

const ROOT = resolve(fileURLToPath(import.meta.url), '../../..');
const DASHBOARD_URL = 'chrome-extension://test-extension/frontend/dashboard.html';

function createWorkerEnv(initialDashboardTabs = [], options = {}) {
  const listeners = { message: [], clicked: [] };
  const calls = { created: [], updated: [], focused: [], fetched: [], grouped: [], groupUpdates: [], removed: [] };
  const world = { dashboardTabs: initialDashboardTabs, listeners, calls };
  const session = fakeSessionStorage(options.sessionArea);
  world.sessionArea = session.area;

  const groupState = { nextId: 100 };
  world.chrome = {
    runtime: {
      id: 'test-extension',
      getURL: (path = '') => `chrome-extension://test-extension/${path}`,
      onMessage: { addListener: (fn) => listeners.message.push(fn) },
    },
    action: { onClicked: { addListener: (fn) => listeners.clicked.push(fn) } },
    storage: { local: { get: async () => ({}) }, session },
    tabs: {
      query: async (query = {}) => {
        if ('url' in query) return world.dashboardTabs.filter((tab) => tab.url === query.url);
        if (query.windowId !== undefined) return world.liveTabs.filter((tab) => tab.windowId === query.windowId);
        return world.liveTabs;
      },
      create: async (props) => {
        calls.created.push(props);
        return { id: 77, ...props };
      },
      update: async (tabId, props) => {
        calls.updated.push({ tabId, props });
        return { id: tabId };
      },
      group: async (options) => {
        const error = groupOptionsError(options);
        if (error) throw error;
        calls.grouped.push(options.tabIds);
        groupState.nextId += 1;
        return groupState.nextId;
      },
      remove: async (tabId) => { calls.removed.push(tabId); },
    },
    tabGroups: {
      update: async (groupId, update) => {
        const error = groupUpdateError(update);
        if (error) throw error;
        calls.groupUpdates.push({ groupId, update });
      },
    },
    windows: {
      update: async (windowId, props) => {
        calls.focused.push({ windowId, props });
        return { id: windowId };
      },
    },
  };
  world.liveTabs = [{ id: 1, windowId: 10, title: 'A page', url: 'https://example.invalid/' }];

  // The worker resolves its fetch from this runtime; without a stub it keeps the test offline.
  world.fetch = async (url, init) => {
    calls.fetched.push(String(url));
    if (options.fetchImpl) return options.fetchImpl(url, init);
    throw new Error('connect refused');
  };
  return world;
}

async function loadServiceWorker(world, instance = 'default') {
  globalThis.chrome = world.chrome;
  globalThis.fetch = world.fetch;
  // A query string gives this test a second, freshly evaluated instance of the same worker:
  // that is a service-worker restart, because the browser keeps nothing of the old module.
  await import(`../background/service-worker.js?instance=${instance}`);
  return world;
}

const worker = await loadServiceWorker(createWorkerEnv());

function respondTo(message, sender, env = worker) {
  const listener = env.listeners.message.at(-1);
  return new Promise((resolvePromise) => listener(message, sender, resolvePromise));
}

async function clickIcon() {
  await worker.listeners.clicked[0]();
  // openDashboard() runs in the background; let its promise chain settle.
  await new Promise((settle) => setTimeout(settle, 0));
}

const trusted = { id: 'test-extension', url: DASHBOARD_URL };

test('the worker registers one message listener and one action listener', () => {
  assert.equal(worker.listeners.message.length, 1);
  assert.equal(worker.listeners.clicked.length, 1);
});

test('clicking the toolbar icon opens the dashboard at the extension URL', async () => {
  worker.calls.created.length = 0;
  await clickIcon();
  assert.deepEqual(worker.calls.created, [{ url: DASHBOARD_URL }]);
  assert.equal(worker.calls.updated.length, 0);
});

test('clicking again focuses the dashboard that is already open', async () => {
  worker.dashboardTabs = [{ id: 77, windowId: 10, url: DASHBOARD_URL }];
  worker.calls.created.length = 0;
  await clickIcon();
  assert.equal(worker.calls.created.length, 0, 'no second dashboard tab');
  assert.deepEqual(worker.calls.updated, [{ tabId: 77, props: { active: true } }]);
  assert.deepEqual(worker.calls.focused, [{ windowId: 10, props: { focused: true } }]);
  worker.dashboardTabs = [];
});

test('the message listener still answers a trusted status request with real readiness', async () => {
  worker.calls.fetched.length = 0;
  const response = await respondTo({ type: MESSAGE_TYPES.GET_STATUS, payload: {} }, trusted);
  assert.equal(response.ok, true);
  // The stubbed loopback endpoint refuses the connection, so the worker must say so.
  assert.equal(response.data.status, 'endpoint_unreachable');
  assert.equal(response.data.canScan, false);
  assert.ok(worker.calls.fetched.length > 0, 'the worker, not the page, performs the probe');
  assert.deepEqual(worker.calls.created, [], 'a message must never open a tab');
});

test('an untrusted sender is still refused, without touching the network', async () => {
  worker.calls.fetched.length = 0;
  const response = await respondTo({ type: MESSAGE_TYPES.GET_STATUS, payload: {} }, { id: 'someone-else', url: 'https://example.invalid/' });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, ERROR_CODES.UNTRUSTED_SENDER);
  assert.equal(worker.calls.fetched.length, 0);
});

test('a sender from another origin of the same id is refused', async () => {
  const response = await respondTo({ type: MESSAGE_TYPES.SCAN_TABS, payload: {} }, { id: 'test-extension', url: 'https://evil.example/' });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, ERROR_CODES.UNTRUSTED_SENDER);
});

test('a restarted worker still applies the review it kept in session storage', async () => {
  const model = fakeFetch([
    ['/health', jsonResponse({ status: 'ok' })],
    ['/v1/chat/completions', chatResponseForPrompt(() => ({ category: 'Study', explanation: 'fixture reason', confidence: 80 }))],
  ]);
  const first = createWorkerEnv([], { fetchImpl: model });
  await loadServiceWorker(first, 'before-restart');
  const scan = await respondTo({ type: MESSAGE_TYPES.SCAN_TABS, payload: {} }, trusted, first);
  assert.equal(scan.ok, true, JSON.stringify(scan.error));
  assert.equal(first.sessionArea[SESSION_STORAGE_KEY].sessionId, scan.data.sessionId, 'the review was stored for a restart');

  // The browser and its session storage survive; the restarted worker remembers nothing.
  const restarted = createWorkerEnv([], { fetchImpl: model, sessionArea: first.sessionArea });
  await loadServiceWorker(restarted, 'after-restart');
  const applied = await respondTo(
    { type: MESSAGE_TYPES.APPLY_ORGANIZATION, payload: { sessionId: scan.data.sessionId, approve: true } },
    trusted,
    restarted,
  );
  assert.equal(applied.ok, true, JSON.stringify(applied.error));
  assert.deepEqual(applied.data.groups.map((group) => group.category), ['Study']);
  assert.deepEqual(restarted.calls.grouped, [[1]], 'the tab was really grouped after the restart');
  assert.deepEqual(restarted.calls.removed, [], 'nothing was closed without a selection');
  assert.equal(restarted.sessionArea[SESSION_STORAGE_KEY], undefined, 'a spent review is not kept for a later restart');
});

test('the manifest exposes the dashboard through the action, with no popup', () => {
  const manifest = JSON.parse(readFileSync(resolve(ROOT, 'manifest.json'), 'utf8'));
  assert.equal(manifest.background.service_worker, 'backend/background/service-worker.js');
  assert.ok(readFileSync(resolve(ROOT, manifest.background.service_worker), 'utf8').length > 0);
  assert.ok(manifest.action.default_title, 'the toolbar icon needs a title');
  assert.equal(manifest.action.default_popup, undefined, 'a popup would swallow action.onClicked');
  // A path that does not resolve ships an unbranded extension, so check the real files.
  for (const group of [manifest.icons, manifest.action.default_icon]) {
    assert.ok(group && Object.keys(group).length >= 4, 'both icon sets need 16/32/48/128');
    for (const [size, path] of Object.entries(group)) {
      const png = readFileSync(resolve(ROOT, path));
      assert.equal(png.readUInt32BE(16), Number(size), `${path} is not ${size}px wide`);
      assert.equal(png.readUInt32BE(20), Number(size), `${path} is not ${size}px tall`);
      assert.equal(png[25], 6, `${path} is not an RGBA PNG`);
    }
  }
  assert.ok(readFileSync(resolve(ROOT, 'frontend/dashboard.html'), 'utf8').includes('scripts/dashboard.js'));
});

test('the manifest keeps minimal permissions and loopback-only host permissions', () => {
  const manifest = JSON.parse(readFileSync(resolve(ROOT, 'manifest.json'), 'utf8'));
  assert.deepEqual([...manifest.permissions].sort(), ['storage', 'tabGroups', 'tabs']);
  for (const pattern of manifest.host_permissions) {
    assert.match(pattern, /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/\*$/, `${pattern} is not a loopback pattern`);
  }
});
