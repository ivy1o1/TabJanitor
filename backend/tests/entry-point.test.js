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

const ROOT = resolve(fileURLToPath(import.meta.url), '../../..');
const DASHBOARD_URL = 'chrome-extension://test-extension/frontend/dashboard.html';

function createWorkerEnv(initialDashboardTabs = []) {
  const listeners = { message: [], clicked: [] };
  const calls = { created: [], updated: [], focused: [], fetched: [] };
  const world = { dashboardTabs: initialDashboardTabs, listeners, calls };

  world.chrome = {
    runtime: {
      id: 'test-extension',
      getURL: (path = '') => `chrome-extension://test-extension/${path}`,
      onMessage: { addListener: (fn) => listeners.message.push(fn) },
    },
    action: { onClicked: { addListener: (fn) => listeners.clicked.push(fn) } },
    storage: { local: { get: async () => ({}) } },
    tabs: {
      query: async (query = {}) => {
        if ('url' in query) return world.dashboardTabs.filter((tab) => tab.url === query.url);
        return [{ id: 1, windowId: 10, title: 'A page', url: 'https://example.invalid/' }];
      },
      create: async (props) => {
        calls.created.push(props);
        return { id: 77, ...props };
      },
      update: async (tabId, props) => {
        calls.updated.push({ tabId, props });
        return { id: tabId };
      },
    },
    windows: {
      update: async (windowId, props) => {
        calls.focused.push({ windowId, props });
        return { id: windowId };
      },
    },
  };

  // The worker resolves its fetch from this runtime; failing it keeps the test offline.
  world.fetch = async (url) => {
    calls.fetched.push(String(url));
    throw new Error('connect refused');
  };
  return world;
}

async function loadServiceWorker(world) {
  globalThis.chrome = world.chrome;
  globalThis.fetch = world.fetch;
  await import('../background/service-worker.js');
  return world;
}

const worker = await loadServiceWorker(createWorkerEnv());

function respondTo(message, sender) {
  return new Promise((resolvePromise) => worker.listeners.message[0](message, sender, resolvePromise));
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

test('the manifest exposes the dashboard through the action, with no popup', () => {
  const manifest = JSON.parse(readFileSync(resolve(ROOT, 'manifest.json'), 'utf8'));
  assert.equal(manifest.background.service_worker, 'backend/background/service-worker.js');
  assert.ok(readFileSync(resolve(ROOT, manifest.background.service_worker), 'utf8').length > 0);
  assert.ok(manifest.action.default_title, 'the toolbar icon needs a title');
  assert.equal(manifest.action.default_popup, undefined, 'a popup would swallow action.onClicked');
  assert.ok(readFileSync(resolve(ROOT, 'frontend/dashboard.html'), 'utf8').includes('scripts/dashboard.js'));
});

test('the manifest keeps minimal permissions and loopback-only host permissions', () => {
  const manifest = JSON.parse(readFileSync(resolve(ROOT, 'manifest.json'), 'utf8'));
  assert.deepEqual([...manifest.permissions].sort(), ['storage', 'tabGroups', 'tabs']);
  for (const pattern of manifest.host_permissions) {
    assert.match(pattern, /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/\*$/, `${pattern} is not a loopback pattern`);
  }
});
