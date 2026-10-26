import { isPlainObject, isValidCategory } from '../shared/schemas.js';

export const SESSION_STORAGE_KEY = 'tabjanitor.session';

function isTabEntry(value) {
  return isPlainObject(value)
    && Number.isFinite(value.id)
    && Number.isFinite(value.windowId)
    && typeof value.title === 'string'
    && typeof value.url === 'string'
    && typeof value.eligible === 'boolean';
}

function isSnapshot(value, sessionId) {
  if (!isPlainObject(value) || value.sessionId !== sessionId) return false;
  if (!Array.isArray(value.tabs) || !Array.isArray(value.eligibleTabs) || !Array.isArray(value.skippedTabs)) return false;
  return value.tabs.every(isTabEntry) && value.eligibleTabs.every(isTabEntry);
}

function isPlanItem(value) {
  return isPlainObject(value)
    && Number.isFinite(value.tabId)
    && isValidCategory(value.category)
    && isValidCategory(value.originalCategory)
    && typeof value.closeSelected === 'boolean'
    && typeof value.userEdited === 'boolean';
}

function isPlan(value, sessionId) {
  if (!isPlainObject(value) || value.sessionId !== sessionId) return false;
  if (!Array.isArray(value.items) || !value.items.every(isPlanItem)) return false;
  if (!isPlainObject(value.counts) || !Array.isArray(value.unclassified)) return false;
  return Array.isArray(value.skippedUnsupported);
}

/**
 * A stored session is applied to real tabs, so nothing short of a complete, self-consistent
 * entry is restored: a truncated or foreign shape becomes "no session", never a partial plan.
 */
export function parseStoredSession(value) {
  if (!isPlainObject(value)) return null;
  const { sessionId, windowId, snapshot, plan } = value;
  if (typeof sessionId !== 'string' || sessionId.length === 0) return null;
  if (windowId !== undefined && !Number.isFinite(windowId)) return null;
  if (!isSnapshot(snapshot, sessionId) || !isPlan(plan, sessionId)) return null;
  if (plan.windowId !== windowId || snapshot.windowId !== windowId) return null;
  return { sessionId, windowId, snapshot, plan };
}

/**
 * The review session has to outlive the worker that built it: Manifest V3 terminates an idle
 * service worker, and without this the dashboard would keep a plan the organizer cannot apply.
 * `chrome.storage.session` is memory-only and never written to disk, so the snapshot of titles
 * and URLs stays exactly as volatile as it was in memory.
 *
 * Returns null when the API is unavailable — the workflow then keeps the memory-only behaviour
 * it had before, and a failure to persist never fails the request that produced the data.
 */
export function createSessionStore(chromeRef, { log = console } = {}) {
  const area = chromeRef?.storage?.session;
  if (!area || typeof area.get !== 'function' || typeof area.set !== 'function') return null;

  return {
    async load() {
      try {
        const stored = await area.get(SESSION_STORAGE_KEY);
        return parseStoredSession(stored?.[SESSION_STORAGE_KEY]);
      } catch (error) {
        log.warn?.('TabJanitor: the stored review could not be read.', error?.message || error);
        return null;
      }
    },
    async save(entry) {
      try {
        await area.set({ [SESSION_STORAGE_KEY]: entry });
        return true;
      } catch (error) {
        log.warn?.('TabJanitor: the review could not be stored for a worker restart.', error?.message || error);
        return false;
      }
    },
    async clear() {
      try {
        await area.remove(SESSION_STORAGE_KEY);
      } catch (error) {
        log.warn?.('TabJanitor: the stored review could not be cleared.', error?.message || error);
      }
    },
  };
}
