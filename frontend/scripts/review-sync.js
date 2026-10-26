/*
 * Review edit synchronization.
 *
 * The dashboard owns what is on screen; this module owns the promise that the service
 * worker agrees with it. It is deliberately free of DOM and of `chrome.*` so the whole
 * policy can be tested with a mocked `updatePlan`.
 *
 * The rules it exists to keep:
 *   - A user edit is applied locally at once, so the table never waits for the backend.
 *   - Edits are coalesced per tab and sent as one `UPDATE_REVIEW_PLAN`, not one message
 *     per keystroke; a newer edit is never lost by an in-flight request.
 *   - One request at a time. A reply is adopted only while nothing newer is pending,
 *     so an older response can never overwrite a newer edit.
 *   - A failed request keeps its edits queued. Rejected edits are reported, never
 *     quietly dropped, and never counted as synchronized.
 *   - Apply must call `flush()` and may only proceed when it reports success.
 */

import { ERROR_CODES } from '../../backend/shared/constants.js';
import { recomputePlan } from './selectors.js';

const STATUS = {
  CLEAN: 'clean',
  PENDING: 'pending',
  SYNCING: 'syncing',
  FAILED: 'failed',
  SESSION_LOST: 'session_lost',
};

export { STATUS };

/** The two error codes that mean "this session is gone, scan again". */
const SESSION_GONE = new Set([ERROR_CODES.STALE_TABS, ERROR_CODES.INVALID_REQUEST]);

function sameEdit(a, b) {
  return Boolean(a && b)
    && (!('category' in a) || a.category === b.category)
    && (!('closeSelected' in a) || a.closeSelected === b.closeSelected);
}

function titleOf(scan, tabId) {
  return scan.plan.items.find((item) => item.tabId === tabId)?.title || `tab ${tabId}`;
}

/**
 * @param {object} options
 * @param {object} options.scan       the live scan result; `scan.plan.items` is mutated in place.
 * @param {string} options.sessionId  the session every edit belongs to.
 * @param {Function} options.updatePlan  sends `UPDATE_REVIEW_PLAN` and returns its promise.
 * @param {Function} [options.getReviewPlan]  re-reads the authoritative plan for recovery.
 * @param {number} [options.debounceMs]
 */
export function createReviewSync({
  scan,
  sessionId,
  updatePlan,
  getReviewPlan,
  debounceMs = 350,
}) {
  // tabId -> { tabId, category?, closeSelected? } — what the backend has not confirmed.
  const pending = new Map();
  // Edits the session refused outright, kept so the UI can name them.
  const unsynced = [];
  const listeners = new Set();

  let status = STATUS.CLEAN;
  let message = '';
  // Bumped by every local edit; a reply is adopted only while it has not moved.
  let revision = 0;
  let timer = null;
  let running = null;
  let disposed = false;

  function read() {
    return {
      status,
      message,
      pendingCount: pending.size,
      unsyncedCount: unsynced.length,
      unsynced: unsynced.slice(),
      sessionLost: status === STATUS.SESSION_LOST,
      // Apply is only honest while nothing diverges from the session.
      canApply: status !== STATUS.SESSION_LOST && pending.size === 0 && unsynced.length === 0,
    };
  }

  function notify() {
    for (const listener of [...listeners]) listener(read());
  }

  function setStatus(next, text = '') {
    status = next;
    message = text;
    notify();
  }

  function queue(tabId, patch) {
    const entry = pending.get(tabId) || { tabId };
    if ('category' in patch) entry.category = patch.category;
    if ('closeSelected' in patch) entry.closeSelected = patch.closeSelected;
    pending.set(tabId, entry);
  }

  /** Records a decision and repaints immediately; the send itself is debounced. */
  function record(patch) {
    if (disposed) return false;
    const item = scan.plan.items.find((entry) => entry.tabId === patch.tabId);
    if (!item) return false;
    revision += 1;
    if ('category' in patch) {
      item.category = patch.category;
      item.userEdited = item.category !== item.originalCategory;
    }
    if ('closeSelected' in patch) {
      item.closeSelected = patch.closeSelected;
      // A closure choice is a user decision too, so the row shows as edited.
      item.userEdited = true;
    }
    recomputePlan(scan);
    for (let index = unsynced.length - 1; index >= 0; index -= 1) {
      if (unsynced[index].tabId === patch.tabId) unsynced.splice(index, 1);
    }
    if (status === STATUS.SESSION_LOST) {
      // The review is dead. Keep the change on screen so the table stays honest, but
      // never queue a message against a session the worker has already dropped.
      notify();
      return true;
    }
    queue(patch.tabId, patch);
    setStatus(STATUS.PENDING);
    schedule();
    return true;
  }

  function recordMany(patches) {
    let changed = 0;
    for (const patch of patches) if (record(patch)) changed += 1;
    return changed;
  }

  function batchFrom(entries) {
    const moves = [];
    const closures = [];
    for (const entry of entries) {
      if ('category' in entry) moves.push({ tabId: entry.tabId, category: entry.category });
      if ('closeSelected' in entry) closures.push({ tabId: entry.tabId, closeSelected: entry.closeSelected });
    }
    return { moves, closures };
  }

  function rememberRejections(rejected, kind) {
    for (const entry of rejected) {
      unsynced.push({
        tabId: entry.tabId,
        kind,
        title: titleOf(scan, entry.tabId),
        code: entry.code,
        reason: entry.reason,
      });
    }
  }

  /**
   * Drops the queued edits this reply settled — but only the ones still equal to what was
   * sent. An edit changed while the request was in flight stays queued and goes next.
   */
  function settle(sent, refused) {
    for (const entry of sent) {
      if (refused.has(entry.tabId)) {
        pending.delete(entry.tabId);
        continue;
      }
      if (sameEdit(pending.get(entry.tabId), entry)) pending.delete(entry.tabId);
    }
  }

  async function sendOnce() {
    const sent = [...pending.values()].map((entry) => ({ ...entry }));
    const sentRevision = revision;
    const { moves, closures } = batchFrom(sent);
    setStatus(STATUS.SYNCING);
    let response;
    try {
      response = await updatePlan({ sessionId, moves, closures });
    } catch (error) {
      // The edits stay queued: a failed request must never discard what the user decided.
      setStatus(
        SESSION_GONE.has(error?.code) ? STATUS.SESSION_LOST : STATUS.FAILED,
        error?.message || 'The changes could not be saved.',
      );
      return false;
    }
    const rejectedMoves = response.rejectedMoves || [];
    const rejectedClosures = response.rejectedClosures || [];
    rememberRejections(rejectedMoves, 'category');
    rememberRejections(rejectedClosures, 'closure');
    const refused = new Set([...rejectedMoves, ...rejectedClosures].map((entry) => entry.tabId));
    settle(sent, refused);
    // Adopt the confirmed plan only while the screen still shows exactly what was sent.
    if (sentRevision === revision && Array.isArray(response.plan?.items)) {
      scan.plan = { ...scan.plan, ...response.plan };
      recomputePlan(scan);
    }
    if (refused.size > 0) {
      setStatus(STATUS.FAILED, `${refused.size} change(s) were refused by the session and are not applied.`);
      return false;
    }
    // An earlier refusal still stands: the session never took it, so this review is not clean.
    if (unsynced.length > 0) {
      setStatus(STATUS.FAILED, `${unsynced.length} change(s) were refused by the session and are not applied.`);
      return false;
    }
    setStatus(pending.size === 0 ? STATUS.CLEAN : STATUS.PENDING);
    return true;
  }

  /** Serial: never two updates in flight, so replies cannot land out of order. */
  function pump() {
    if (disposed) return Promise.resolve(false);
    if (running) return running;
    running = (async () => {
      let ok = true;
      while (pending.size > 0) {
        ok = await sendOnce();
        if (!ok) break;
      }
      running = null;
      notify();
      return ok && pending.size === 0;
    })();
    return running;
  }

  function schedule() {
    if (timer !== null || status === STATUS.SESSION_LOST) return;
    timer = setTimeout(() => {
      timer = null;
      pump();
    }, debounceMs);
  }

  /** Apply Organization must pass through here: nothing applies while edits are queued. */
  function flush() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    // A dead session cannot accept edits, and re-poking it would only produce a second error.
    if (status === STATUS.SESSION_LOST) return Promise.resolve({ ok: false, state: read() });
    return pump().then((done) => ({
      ok: done && pending.size === 0 && unsynced.length === 0,
      state: read(),
    }));
  }

  /** Re-reads the authoritative plan after a failure; unconfirmed local edits are dropped. */
  async function reload() {
    if (!getReviewPlan) return { ok: false, message: 'Plan recovery is not available.' };
    try {
      const { plan } = await getReviewPlan(sessionId);
      pending.clear();
      unsynced.length = 0;
      revision += 1;
      scan.plan = plan;
      recomputePlan(scan);
      setStatus(STATUS.CLEAN, 'The plan was re-read from the session. Unsaved local edits were discarded.');
      return { ok: true };
    } catch (error) {
      setStatus(STATUS.FAILED, error?.message || 'The session could not be re-read.');
      return { ok: false, message: error?.message };
    }
  }

  /** Marks this review as dead — used when a later request reports a stale session. */
  function loseSession(text) {
    setStatus(STATUS.SESSION_LOST, text);
  }

  /** A new scan retires this review: its queued edits must never be sent against it again. */
  function dispose() {
    disposed = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    pending.clear();
    listeners.clear();
  }

  return {
    read,
    record,
    recordMany,
    flush,
    reload,
    loseSession,
    dispose,
    subscribe(listener) {
      listeners.add(listener);
      listener(read());
      return () => listeners.delete(listener);
    },
    /** Test hook: sends queued edits immediately instead of waiting for the debounce. */
    pump,
  };
}
