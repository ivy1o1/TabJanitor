import { captureWindowSnapshot } from '../background/tab-scanner.js';

export function fakeChrome(tabs = [], options = {}) {
  const calls = { grouped: [], groupUpdates: [], removed: [] };
  const fail = options.fail || {};
  let nextGroupId = 100;
  const chromeRef = {
    runtime: { id: 'test-extension', getURL: (path) => `chrome-extension://test-extension/${path}` },
    storage: { local: { get: async () => ({}) } },
    tabs: {
      query: async (query) => {
        if (fail.query) throw new Error('query denied');
        if (query?.windowId !== undefined) return tabs.filter((tab) => tab.windowId === query.windowId);
        if (query?.currentWindow) return tabs;
        return tabs;
      },
      group: async ({ tabIds }) => {
        calls.grouped.push(tabIds);
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
        calls.groupUpdates.push({ groupId, update });
        if (fail.groupUpdate) throw new Error('tabGroups.update denied');
      },
    },
  };
  return { chromeRef, calls };
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
