import test from 'node:test';
import assert from 'node:assert/strict';
import { getDomain, isUnsupportedScheme, sanitizeUrl } from '../background/metadata.js';
import { buildPromptTabs, captureWindowSnapshot, truncatedRefs } from '../background/tab-scanner.js';
import { fakeChrome, sampleTabs } from './helpers.js';

test('sanitization removes query parameters and fragments', () => {
  assert.equal(
    sanitizeUrl('https://react.dev/learn?ref=nav&utm=x#install'),
    'https://react.dev/learn',
  );
  assert.equal(sanitizeUrl('https://ex.com/a/b'), 'https://ex.com/a/b');
});

test('sanitization strips credentials and non-http schemes', () => {
  assert.equal(sanitizeUrl('https://user:pass@ex.com/x'), 'https://ex.com/x');
  assert.equal(sanitizeUrl('chrome://settings'), '');
  assert.equal(sanitizeUrl('file:///C:/secret.html'), '');
  assert.equal(sanitizeUrl('not a url'), '');
});

test('sanitization enforces the URL length limit', () => {
  const long = `https://ex.com/${'a'.repeat(900)}`;
  assert.ok(sanitizeUrl(long).length <= 500);
});

test('domain extraction uses the sanitized hostname only', () => {
  assert.equal(getDomain('https://shop.example.com/cart?sku=1'), 'shop.example.com');
  assert.equal(getDomain('chrome://newtab/'), '');
});

test('browser-internal and unsupported pages are excluded from AI classification', () => {
  for (const url of ['chrome://newtab/', 'edge://settings', 'chrome-extension://abc/x.html', 'about:blank', 'devtools://devtools/b/']) {
    assert.equal(isUnsupportedScheme(url), true, url);
  }
  assert.equal(isUnsupportedScheme('https://ex.com'), false);
  assert.equal(isUnsupportedScheme('http://localhost:3000'), false);
});

test('the snapshot keeps real tab IDs and separates unsupported tabs', async () => {
  const { chromeRef } = fakeChrome(sampleTabs());
  const snapshot = await captureWindowSnapshot({ chromeRef });
  assert.equal(snapshot.tabs.length, 4);
  assert.equal(snapshot.windowId, 10);
  assert.deepEqual(snapshot.eligibleTabs.map((tab) => tab.id), [1, 2, 3]);
  assert.deepEqual(snapshot.skippedTabs, [{ tabId: 4, reason: 'unsupported scheme' }]);
  assert.deepEqual(snapshot.eligibleTabs.map((tab) => tab.ref), [1, 2, 3]);
  assert.equal(snapshot.eligibleTabs[0].url, 'https://react.dev/learn/tutorial-tutorial');
});

test('an empty window produces an empty snapshot without error', async () => {
  const { chromeRef } = fakeChrome([]);
  const snapshot = await captureWindowSnapshot({ chromeRef });
  assert.equal(snapshot.tabs.length, 0);
  assert.equal(snapshot.eligibleTabs.length, 0);
});

test('a failing tabs.query is reported as a browser API error', async () => {
  const { chromeRef } = fakeChrome([], { fail: { query: true } });
  await assert.rejects(() => captureWindowSnapshot({ chromeRef }), (error) => {
    assert.equal(error.code, 'BROWSER_API_ERROR');
    return true;
  });
});

test('prompt input is capped and the remainder is reported as truncated', async () => {
  const many = Array.from({ length: 5 }, (_, index) => ({
    id: 100 + index, windowId: 1, title: `Tab ${index}`, url: `https://ex${index}.com/`,
  }));
  const { chromeRef } = fakeChrome(many);
  const snapshot = await captureWindowSnapshot({ chromeRef });
  const promptTabs = buildPromptTabs(snapshot, 2);
  assert.deepEqual(promptTabs.map((tab) => tab.ref), [1, 2]);
  assert.deepEqual(truncatedRefs(snapshot, 2), [102, 103, 104]);
  for (const tab of promptTabs) {
    assert.deepEqual(Object.keys(tab).sort(), ['domain', 'ref', 'title', 'url']);
  }
});
