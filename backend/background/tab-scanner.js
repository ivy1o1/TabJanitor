import { appError } from '../shared/schemas.js';
import { ERROR_CODES, LIMITS } from '../shared/constants.js';
import { buildTabMetadata } from './metadata.js';

function newSessionId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `s-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

export async function captureWindowSnapshot({ chromeRef }) {
  let tabs;
  try {
    tabs = await chromeRef.tabs.query({ currentWindow: true });
  } catch (error) {
    throw appError(ERROR_CODES.BROWSER_API_ERROR, 'Could not read browser tabs.', { cause: String(error?.message || error) });
  }
  const snapshotTabs = tabs.map((tab) => ({
    id: tab.id,
    windowId: tab.windowId,
    title: typeof tab.title === 'string' ? tab.title.slice(0, LIMITS.TITLE_MAX) : '',
    url: typeof tab.url === 'string' ? tab.url : '',
    active: Boolean(tab.active),
  }));
  const sessionId = newSessionId();
  let nextRef = 1;
  const entries = snapshotTabs.map((tab) => {
    const meta = buildTabMetadata(tab, nextRef);
    if (meta.eligible) nextRef += 1;
    return { ...tab, ...meta };
  });
  const windowId = tabs[0]?.windowId;
  return {
    sessionId,
    windowId,
    createdAt: Date.now(),
    tabs: entries,
    eligibleTabs: entries.filter((entry) => entry.eligible),
    skippedTabs: entries.filter((entry) => !entry.eligible).map((entry) => ({ tabId: entry.id, reason: entry.reason })),
  };
}

export function buildPromptTabs(snapshot, maxTabs = LIMITS.DEFAULT_MAX_TABS_PER_REQUEST) {
  const eligible = snapshot.eligibleTabs;
  if (eligible.length === 0) return [];
  const capped = eligible.slice(0, maxTabs);
  return capped.map((entry) => ({
    ref: entry.ref,
    title: entry.title,
    url: entry.url,
    domain: entry.domain,
  }));
}

export function truncatedRefs(snapshot, maxTabs = LIMITS.DEFAULT_MAX_TABS_PER_REQUEST) {
  return snapshot.eligibleTabs.slice(maxTabs).map((entry) => entry.id);
}
