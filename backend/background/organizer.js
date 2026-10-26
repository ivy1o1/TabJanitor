import { CATEGORY_COLORS, ERROR_CODES } from '../shared/constants.js';
import { appError, isValidCategory } from '../shared/schemas.js';

async function liveTabsById(chromeRef, windowId) {
  let tabs;
  try {
    tabs = await chromeRef.tabs.query({ windowId });
  } catch (error) {
    throw appError(ERROR_CODES.BROWSER_API_ERROR, 'Could not re-read the browser window before applying changes.', {
      cause: String(error?.message || error),
    });
  }
  return new Map(tabs.map((tab) => [tab.id, tab]));
}

// Stale tabs are dropped before any mutation; nothing is invented as successful.
export async function planApplication({ plan, chromeRef }) {
  const windowId = plan.windowId;
  const live = await liveTabsById(chromeRef, windowId);
  const staleTabIds = [];
  const valid = [];
  for (const item of plan.items) {
    const tab = live.get(item.tabId);
    if (!tab || tab.windowId !== windowId) {
      staleTabIds.push(item.tabId);
      continue;
    }
    valid.push({ item, tab });
  }
  return { valid, staleTabIds, windowId };
}

export function groupByCategory(valid) {
  const groups = new Map();
  for (const entry of valid) {
    if (!groups.has(entry.item.category)) groups.set(entry.item.category, []);
    groups.get(entry.item.category).push(entry);
  }
  return groups;
}

export async function applyOrganization({ plan, chromeRef }) {
  if (!plan || !Array.isArray(plan.items)) {
    throw appError(ERROR_CODES.INVALID_REQUEST, 'There is no valid review plan to apply.');
  }
  const { valid, staleTabIds, windowId } = await planApplication({ plan, chromeRef });
  for (const entry of valid) {
    if (!isValidCategory(entry.item.category)) {
      throw appError(ERROR_CODES.INVALID_REQUEST, 'The approved plan contains an invalid category.', { tabId: entry.item.tabId });
    }
  }
  // Closure happens first and only for individually selected tabs.
  const closeEntries = valid.filter((entry) => entry.item.closeSelected === true);
  const closed = [];
  const failures = [];
  for (const entry of closeEntries) {
    try {
      await chromeRef.tabs.remove(entry.item.tabId);
      closed.push({ tabId: entry.item.tabId, status: 'closed' });
    } catch (error) {
      failures.push({ operation: 'close', tabId: entry.item.tabId, reason: String(error?.message || error) });
    }
  }
  const closedIds = new Set(closed.map((entry) => entry.tabId));
  const groupsRequested = groupByCategory(valid.filter((entry) => !closedIds.has(entry.item.tabId)));
  const groups = [];
  for (const [category, entries] of groupsRequested) {
    const tabIds = entries.map((entry) => entry.item.tabId);
    let groupId;
    try {
      groupId = await chromeRef.tabs.group({ tabIds, createProperties: { windowId } });
    } catch (error) {
      failures.push({ operation: 'group', category, tabIds, reason: String(error?.message || error) });
      continue;
    }
    const update = { title: category };
    const color = CATEGORY_COLORS[category];
    if (color) update.color = color;
    try {
      await chromeRef.tabGroups.update(groupId, update);
      groups.push({ category, groupId, tabIds, title: category, color: color || null, status: 'success' });
    } catch (error) {
      // The group exists even if naming or coloring failed; report it as partial.
      failures.push({ operation: 'nameGroup', category, groupId, tabIds, reason: String(error?.message || error) });
      groups.push({ category, groupId, tabIds, title: category, color: null, status: 'partial' });
    }
  }
  return {
    sessionId: plan.sessionId,
    groups,
    closures: closed,
    stale: staleTabIds.map((tabId) => ({ tabId, reason: 'tab no longer exists in the scanned window' })),
    failures,
    partial: failures.length > 0,
    closureRequested: closeEntries.length,
    closureCompleted: closed.length,
    closureFailed: closeEntries.length - closed.length,
    windowId: Number.isFinite(windowId) ? windowId : null,
  };
}
