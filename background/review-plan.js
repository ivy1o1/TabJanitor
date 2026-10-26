import { CATEGORIES, ERROR_CODES } from '../shared/constants.js';
import { appError, isValidCategory } from '../shared/schemas.js';

function countBy(items) {
  const counts = {};
  for (const category of CATEGORIES) counts[category] = 0;
  for (const item of items) counts[item.category] += 1;
  return counts;
}

// The review plan is built only from validated classifications mapped back to the
// trusted local snapshot; model-supplied totals or IDs are never used.
export function buildReviewPlan(snapshot, classifications) {
  const byRef = new Map(classifications.accepted.map((entry) => [entry.ref, entry]));
  const items = [];
  for (const tab of snapshot.eligibleTabs) {
    const classification = byRef.get(tab.ref);
    if (!classification) continue;
    items.push({
      ref: tab.ref,
      tabId: tab.id,
      title: tab.title,
      domain: tab.domain,
      url: tab.url,
      category: classification.category,
      originalCategory: classification.category,
      explanation: classification.explanation,
      confidence: classification.confidence,
      closeSelected: false,
      userEdited: false,
    });
  }
  const unclassified = snapshot.eligibleTabs
    .filter((tab) => !byRef.has(tab.ref))
    .map((tab) => ({ tabId: tab.id, ref: tab.ref, title: tab.title, domain: tab.domain, reason: 'the model did not answer for this tab' }));
  return {
    sessionId: snapshot.sessionId,
    windowId: snapshot.windowId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    items,
    counts: countBy(items),
    unclassified,
    skippedUnsupported: snapshot.skippedTabs,
  };
}

export function applyPlanEdits(plan, edits) {
  if (!plan) throw appError(ERROR_CODES.INVALID_REQUEST, 'There is no review plan to update.');
  if (!edits || typeof edits !== 'object') throw appError(ERROR_CODES.INVALID_REQUEST, 'The plan update payload is invalid.');
  const moves = edits.moves ?? [];
  const closureChanges = edits.closures ?? [];
  if (!Array.isArray(moves) || !Array.isArray(closureChanges)) {
    throw appError(ERROR_CODES.INVALID_REQUEST, 'moves and closures must be arrays.');
  }
  const byTabId = new Map(plan.items.map((item) => [item.tabId, item]));
  const unsupported = new Set((plan.skippedUnsupported || []).map((entry) => entry.tabId));
  const rejectedMoves = [];
  const rejectedClosures = [];
  const rejectReason = (tabId) => (unsupported.has(tabId)
    ? { code: ERROR_CODES.UNSUPPORTED_TABS, reason: 'this page cannot be classified or organized by the extension' }
    : { code: ERROR_CODES.STALE_TABS, reason: 'tabId is not in the current plan' });
  for (const move of moves) {
    const item = byTabId.get(move?.tabId);
    if (!item) {
      rejectedMoves.push({ tabId: move?.tabId, ...rejectReason(move?.tabId) });
      continue;
    }
    if (!isValidCategory(move?.category)) {
      throw appError(ERROR_CODES.INVALID_REQUEST, 'An invalid category was requested for a tab.', { tabId: move.tabId, category: move?.category });
    }
    item.category = move.category;
    item.userEdited = true;
  }
  for (const change of closureChanges) {
    const item = byTabId.get(change?.tabId);
    if (!item) {
      rejectedClosures.push({ tabId: change?.tabId, ...rejectReason(change?.tabId) });
      continue;
    }
    if (typeof change?.closeSelected !== 'boolean') {
      throw appError(ERROR_CODES.INVALID_REQUEST, 'closeSelected must be a boolean.', { tabId: change.tabId });
    }
    item.closeSelected = change.closeSelected;
    item.userEdited = true;
  }
  plan.counts = countBy(plan.items);
  plan.updatedAt = Date.now();
  return { plan, rejectedMoves, rejectedClosures };
}

export function summary(plan) {
  return {
    sessionId: plan.sessionId,
    counts: plan.counts,
    total: plan.items.length,
    closureCount: plan.items.filter((item) => item.closeSelected).length,
    editedCount: plan.items.filter((item) => item.userEdited).length,
  };
}
