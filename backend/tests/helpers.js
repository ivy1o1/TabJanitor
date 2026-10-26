import { captureWindowSnapshot } from '../background/tab-scanner.js';

/**
 * A `chrome.storage.session` stand-in. Values pass through JSON both ways, because the real
 * area serializes: a session that cannot survive this fake cannot survive a worker restart.
 * Pass the same `area` to a second fake chrome to keep storage alive across a restarted worker.
 */
export function fakeSessionStorage(area = {}) {
  return {
    area,
    get: async (key) => (key in area ? JSON.parse(JSON.stringify({ [key]: area[key] })) : {}),
    set: async (items) => {
      for (const [key, value] of Object.entries(items)) area[key] = JSON.parse(JSON.stringify(value));
    },
    remove: async (keys) => {
      for (const key of [keys].flat()) delete area[key];
    },
  };
}

/**
 * Chrome rejects unknown keys in the `tabs.group` options object rather than ignoring them,
 * so a mistyped property name has to fail here too instead of only in a real browser.
 */
export function groupOptionsError(options) {
  const unknown = Object.keys(options ?? {}).filter((key) => key !== 'tabIds' && key !== 'createProperties');
  if (!unknown.length) return null;
  return new Error(
    `Error in invocation of tabs.group(object options, optional function callback): Error at parameter 'options': Unexpected property: '${unknown[0]}'.`,
  );
}

/** Chrome's `tabGroups.Color` enum, in Chrome's own spelling. */
export const GROUP_COLORS = ['blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange', 'grey'];

/** The same for `tabGroups.update`: an unknown property or an off-enum colour throws in the browser. */
export function groupUpdateError(update) {
  const unknown = Object.keys(update ?? {}).filter((key) => key !== 'title' && key !== 'color');
  if (unknown.length) {
    return new Error(
      `Error in invocation of tabGroups.update(integer groupId, object updateProperties, optional function callback): Unexpected property: '${unknown[0]}'.`,
    );
  }
  if (update?.color !== undefined && !GROUP_COLORS.includes(update.color)) {
    return new Error(
      `Error in invocation of tabGroups.update(integer groupId, object updateProperties, optional function callback): Value must be one of: ${GROUP_COLORS.join(', ')}.`,
    );
  }
  return null;
}

export function fakeChrome(tabs = [], options = {}) {
  const calls = { grouped: [], groupOptions: [], groupUpdates: [], removed: [] };
  const fail = options.fail || {};
  const session = fakeSessionStorage(options.sessionStorage);
  let nextGroupId = 100;
  const chromeRef = {
    runtime: { id: 'test-extension', getURL: (path) => `chrome-extension://test-extension/${path}` },
    storage: { local: { get: async () => ({}) }, session },
    tabs: {
      query: async (query) => {
        if (fail.query) throw new Error('query denied');
        if (query?.windowId !== undefined) return tabs.filter((tab) => tab.windowId === query.windowId);
        if (query?.currentWindow) return tabs;
        return tabs;
      },
      group: async (options) => {
        const error = groupOptionsError(options);
        if (error) throw error;
        calls.grouped.push(options.tabIds);
        calls.groupOptions.push(options);
        if (fail.group) throw new Error('group denied');
        nextGroupId += 1;
        return nextGroupId;
      },
      remove: async (tabId) => {
        calls.removed.push(tabId);
        if (fail.remove?.includes(tabId)) throw new Error(`close denied for ${tabId}`);
      },
    },
    tabGroups: {
      update: async (groupId, update) => {
        const error = groupUpdateError(update);
        if (error) throw error;
        calls.groupUpdates.push({ groupId, update });
        if (fail.groupUpdate) throw new Error('tabGroups.update denied');
      },
    },
  };
  return { chromeRef, calls, sessionArea: session.area };
}

export function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (typeof body === 'function') return body();
      return body;
    },
  };
}

export function chatResponse(content, model = 'gemma-3-1b-it-Q4_K_M.gguf') {
  return jsonResponse({
    choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
    model,
    timings: { predicted_per_second: 18.9 },
  });
}

// Mirrors the verified per-tab request shape: the reply contains exactly the refs
// mentioned in the prompt, so tests stay valid when the client changes batching.
export function chatResponseForPrompt(entry = () => ({ category: 'Study', explanation: 'fixture reason', confidence: 80 })) {
  return (url, init) => {
    const body = JSON.parse(init.body);
    const userContent = body.messages[body.messages.length - 1].content;
    const refs = [...userContent.matchAll(/ref=(\d+)/g)].map((match) => Number(match[1]));
    return chatResponse(JSON.stringify({ tabs: refs.map((ref) => ({ ref, ...entry(ref) })) }));
  };
}

export function fakeFetch(handlers) {
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    requests.push({ url, init, body: init?.body ? JSON.parse(init.body) : undefined });
    for (const [pattern, handler] of handlers) {
      if (String(url).includes(pattern)) {
        return typeof handler === 'function' ? handler(url, init) : handler;
      }
    }
    throw new Error(`unhandled fetch: ${url}`);
  };
  fetchImpl.requests = requests;
  return fetchImpl;
}

export function sampleTabs() {
  return [
    { id: 1, windowId: 10, title: 'React Tutorial – react.dev', url: 'https://react.dev/learn/tutorial-tutorial?ref=nav#start', active: false },
    { id: 2, windowId: 10, title: 'Notebook LM', url: 'https://notebooklm.google.com/notebook/abc123', active: false },
    { id: 3, windowId: 10, title: 'Cheap flights', url: 'https://shop.example.com/checkout?sku=99', active: false },
    { id: 4, windowId: 10, title: 'New Tab', url: 'chrome://newtab/', active: true },
  ];
}

export async function sampleSnapshot(tabs = sampleTabs(), options = {}) {
  const { chromeRef } = fakeChrome(tabs, options);
  return captureWindowSnapshot({ chromeRef });
}
