/*
 * =====================================================================================
 * INTEGRATION BOUNDARY
 * =====================================================================================
 *
 * This is the ONLY frontend module that talks to the extension. Everything else reads what
 * it returns, so all messaging lives here: `chrome.runtime.sendMessage` to the service
 * worker in `backend/background/service-worker.js`, with the message types from
 * `backend/shared/constants.js` and the payloads documented in `backend/docs/API_CONTRACT.md`.
 *
 * Rules this module keeps:
 *   - Every reply is read as the documented envelope `{ ok: true, data }` or
 *     `{ ok: false, error: { code, message, details } }`. A missing `data`, a non-object
 *     reply, or a rejection becomes an error — never a substitute result.
 *   - Nothing is invented: no tab counts, no classifications, no model readiness. If the
 *     service worker does not answer, the caller gets an error and the UI says so.
 *   - There is no `fetch` here, and none is needed: the dashboard never touches the
 *     inference endpoint, only the service worker does.
 *   - `mock-data.js` is not imported by any production path. Outside an extension context
 *     this module refuses instead of falling back to sample data.
 */

import { ERROR_CODES, MESSAGE_TYPES, STATUS_VALUES } from '../../backend/shared/constants.js';
import { isPlainObject } from '../../backend/shared/schemas.js';

/**
 * Codes this page gives to failures that never reached the service worker. Backend replies
 * always carry one of the documented `ERROR_CODES` values instead.
 */
export const CLIENT_ERROR_CODES = {
  NOT_EXTENSION: 'NOT_EXTENSION',
  MESSAGING_FAILED: 'MESSAGING_FAILED',
  MALFORMED_RESPONSE: 'MALFORMED_RESPONSE',
};

const STATUS_ORDER = Object.values(STATUS_VALUES);

export class SourceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'SourceError';
    this.code = code;
    this.details = isPlainObject(details) ? details : {};
  }
}

/** True only when this document is an extension page that can reach its own worker. */
export function isExtensionContext() {
  const runtime = globalThis.chrome?.runtime;
  return Boolean(
    runtime
    && typeof runtime.sendMessage === 'function'
    && typeof runtime.id === 'string'
    && runtime.id.length > 0,
  );
}

function text(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function count(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * Sends one message and unwraps the envelope. The single place that decides what a
 * failure means, so no caller has to guess whether a reply was real.
 */
async function send(type, payload = {}) {
  if (!isExtensionContext()) {
    throw new SourceError(
      CLIENT_ERROR_CODES.NOT_EXTENSION,
      'This page is not running as an extension, so it cannot reach the TabJanitor service worker.',
    );
  }
  let response;
  try {
    response = await globalThis.chrome.runtime.sendMessage({ type, payload });
  } catch (error) {
    throw new SourceError(
      CLIENT_ERROR_CODES.MESSAGING_FAILED,
      `The service worker did not answer: ${text(error?.message, 'unknown error')}`,
    );
  }
  if (!isPlainObject(response) || typeof response.ok !== 'boolean') {
    throw new SourceError(CLIENT_ERROR_CODES.MALFORMED_RESPONSE, 'The service worker replied with an unexpected shape.');
  }
  if (response.ok) {
    if (!isPlainObject(response.data)) {
      throw new SourceError(CLIENT_ERROR_CODES.MALFORMED_RESPONSE, 'The service worker reported success without any data.');
    }
    return response.data;
  }
  const failure = isPlainObject(response.error) ? response.error : {};
  throw new SourceError(
    text(failure.code, CLIENT_ERROR_CODES.MALFORMED_RESPONSE),
    text(failure.message, 'The service worker reported a failure without a message.'),
    failure.details,
  );
}

/* ------------------------------------------------------------------ presentation model */

const CATEGORY_KEYS = [
  'Development',
  'Study',
  'Research',
  'Shopping',
  'Entertainment',
  'Other',
  'Junk / Review',
];

/**
 * The one adapter between the contract and the UI. It keeps every field the backend
 * returns that the dashboard shows, and repairs only what is absent — a missing title
 * becomes an empty string, never a made-up one.
 */
function adaptItem(raw) {
  if (!isPlainObject(raw) || !Number.isFinite(raw.tabId)) return null;
  const confidence = Math.min(100, Math.max(0, count(raw.confidence, 0)));
  const category = text(raw.category, 'Other');
  return {
    tabId: raw.tabId,
    ref: Number.isFinite(raw.ref) ? raw.ref : null,
    title: text(raw.title),
    domain: text(raw.domain),
    url: text(raw.url),
    category,
    originalCategory: text(raw.originalCategory, category),
    explanation: text(raw.explanation),
    confidence,
    closeSelected: raw.closeSelected === true,
    userEdited: raw.userEdited === true,
  };
}

function adaptCounts(raw, items) {
  const counts = Object.fromEntries(CATEGORY_KEYS.map((category) => [category, 0]));
  const provided = isPlainObject(raw) ? raw : {};
  for (const category of CATEGORY_KEYS) counts[category] = count(provided[category], 0);
  // A response with no counts at all still has to agree with the items it carried.
  if (!CATEGORY_KEYS.some((category) => count(provided[category], 0) > 0)) {
    for (const item of items) if (counts[item.category] !== undefined) counts[item.category] += 1;
  }
  return counts;
}

function adaptPlan(raw) {
  if (!isPlainObject(raw)) {
    throw new SourceError(CLIENT_ERROR_CODES.MALFORMED_RESPONSE, 'The service worker returned no review plan.');
  }
  const items = list(raw.items).map(adaptItem).filter(Boolean);
  return {
    sessionId: text(raw.sessionId),
    windowId: Number.isFinite(raw.windowId) ? raw.windowId : null,
    items,
    counts: adaptCounts(raw.counts, items),
    summary: isPlainObject(raw.summary) ? raw.summary : {},
    skippedUnsupported: list(raw.skippedUnsupported),
    unclassified: list(raw.unclassified),
  };
}

function adaptStatus(data) {
  const known = STATUS_ORDER.includes(data.status);
  const status = known ? data.status : 'unknown';
  return {
    status,
    // Only the backend's own flag can enable scanning, and only for a status it defines.
    canScan: known && data.canScan === true,
    endpoint: text(data.endpoint, 'not configured'),
    model: text(data.model, 'unknown model'),
    message: text(data.message, 'The service worker returned no status message.'),
    probe: isPlainObject(data.probe) ? data.probe : null,
  };
}

/* ------------------------------------------------------------------------- operations */

/** Mirrors `GET_STATUS`. Read-only, never touches tabs. */
export async function getStatus() {
  return adaptStatus(await send(MESSAGE_TYPES.GET_STATUS, {}));
}

/** Mirrors `SCAN_TABS`. Optional payload: `{ maxTabsPerRequest, timeoutMs }`. */
export async function scan(payload = {}) {
  const data = await send(MESSAGE_TYPES.SCAN_TABS, payload);
  const plan = adaptPlan(data.plan);
  return {
    sessionId: text(data.sessionId, plan.sessionId),
    windowId: Number.isFinite(data.windowId) ? data.windowId : plan.windowId,
    scannedCount: count(data.scannedCount, plan.items.length),
    eligibleCount: count(data.eligibleCount, plan.items.length),
    classifiedCount: count(data.classifiedCount, plan.items.length),
    skippedUnsupported: list(data.skippedUnsupported),
    unclassified: list(data.unclassified),
    truncated: list(data.truncated),
    rejected: list(data.rejected),
    modelMeta: isPlainObject(data.modelMeta) ? data.modelMeta : null,
    plan,
  };
}

/** Mirrors `GET_REVIEW_PLAN` — the authoritative plan for a session. */
export async function getReviewPlan(sessionId) {
  const data = await send(MESSAGE_TYPES.GET_REVIEW_PLAN, { sessionId });
  return { plan: adaptPlan(data.plan) };
}

/**
 * Mirrors `UPDATE_REVIEW_PLAN` with the documented payload shape: complete `moves` and
 * `closures` arrays of `{ tabId, category }` / `{ tabId, closeSelected }`.
 */
export async function updatePlan({ sessionId, moves = [], closures = [] }) {
  const data = await send(MESSAGE_TYPES.UPDATE_REVIEW_PLAN, { sessionId, moves, closures });
  return {
    plan: adaptPlan(data.plan),
    rejectedMoves: list(data.rejectedMoves),
    rejectedClosures: list(data.rejectedClosures),
  };
}

/**
 * Mirrors `APPLY_ORGANIZATION`. This is the only message that mutates the browser, so
 * `approve: true` is sent here and nowhere else — callers must have shown the dialog.
 * A partial failure arrives as an error envelope whose `details` hold the real result.
 */
export async function applyOrganization({ sessionId }) {
  return send(MESSAGE_TYPES.APPLY_ORGANIZATION, { sessionId, approve: true });
}

export { ERROR_CODES };
