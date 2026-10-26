import { on, preservingFocus } from './dom.js';
import { createStore } from './store.js';
import { createThemeController } from './theme.js';
import {
  CATEGORY_ORDER,
  filterItems,
  findItem,
  planItems,
  recomputePlan,
} from './selectors.js';
import { renderSidebar } from './components/sidebar.js';
import { renderStatusHeader } from './components/status-header.js';
import { renderScanBanner } from './components/scan-banner.js';
import { renderScanSummary } from './components/scan-summary.js';
import { renderCategoryCards } from './components/category-cards.js';
import { renderRows, renderUnclassified } from './components/tab-table.js';
import { renderApplySummary, renderDistribution, renderSelectedPanel, renderSyncPanel } from './components/side-panels.js';
import { renderApplyDialog, renderApplyResult } from './components/confirmation-dialog.js';
import { renderFooter } from './components/footer.js';
import { STATUS, createReviewSync } from './review-sync.js';
import {
  CLIENT_ERROR_CODES,
  ERROR_CODES,
  applyOrganization,
  getReviewPlan,
  getStatus,
  isExtensionContext,
  scan as requestScan,
  updatePlan,
} from './source.js';

const el = (id) => document.getElementById(id);
const els = {
  sidebar: el('sidebar'),
  statusbar: el('statusbar'),
  banner: el('scan-banner'),
  summary: el('scan-summary'),
  cards: el('category-cards'),
  viewSelect: el('view-select'),
  search: el('search'),
  rows: el('rows'),
  rowCount: el('row-count'),
  unclassifiedPanel: el('unclassified-panel'),
  unclassifiedList: el('unclassified-list'),
  distribution: el('distribution'),
  selectedCount: el('selected-count'),
  selectedTotal: el('selected-total'),
  selectedList: el('selected-list'),
  applySummary: el('apply-summary'),
  syncPanel: el('sync-state'),
  selectAll: el('select-all'),
  clearClosures: document.querySelector('[data-action="clear-closures"]'),
  applyButton: document.querySelector('[data-action="open-apply-dialog"]'),
  footer: el('footer'),
  dialog: el('apply-dialog'),
  toast: el('toast'),
};

const theme = createThemeController();

/** A review that has not been scanned yet: every renderer works on this, nothing invented. */
function emptyScan() {
  const counts = Object.fromEntries(CATEGORY_ORDER.map((category) => [category, 0]));
  return {
    sessionId: '',
    windowId: null,
    scannedCount: 0,
    eligibleCount: 0,
    classifiedCount: 0,
    skippedUnsupported: [],
    unclassified: [],
    truncated: [],
    rejected: [],
    modelMeta: null,
    plan: {
      sessionId: '',
      windowId: null,
      items: [],
      counts,
      summary: { total: 0, closureCount: 0, editedCount: 0 },
      skippedUnsupported: [],
      unclassified: [],
    },
  };
}

const state = createStore({
  scan: emptyScan(),
  sessionId: '',
  status: {
    status: 'checking',
    canScan: false,
    endpoint: 'not connected',
    model: 'unknown model',
    message: 'Asking the extension whether the local model is ready.',
    probe: null,
  },
  sync: { status: STATUS.CLEAN, message: '', pendingCount: 0, unsyncedCount: 0, sessionLost: false, canApply: true },
  search: '',
  categoryFilter: null,
  openMenuTabId: null,
  scanning: false,
  applying: false,
  applied: false,
  lastScanLabel: 'Last scan: none yet',
});

/** The live edit synchronizer for the current session; rebuilt on every scan. */
let sync = null;

/** The two replies that mean "this review is not live any more". */
const SESSION_LOST_CODES = new Set([ERROR_CODES.STALE_TABS, ERROR_CODES.INVALID_REQUEST]);

let toastTimer = null;
function showToast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, 6000);
}

/* ---------------------------------------------------------------- status mapping */

function statusFromError(error) {
  const known = {
    [CLIENT_ERROR_CODES.NOT_EXTENSION]: 'not_extension',
    [CLIENT_ERROR_CODES.MESSAGING_FAILED]: 'worker_unavailable',
    [CLIENT_ERROR_CODES.MALFORMED_RESPONSE]: 'invalid_response',
  };
  return {
    status: known[error?.code] || 'endpoint_unreachable',
    canScan: false,
    endpoint: 'not connected',
    model: 'unknown model',
    message: error?.message || 'The status check failed.',
    probe: null,
  };
}

/* --------------------------------------------------------------- rendering */

function renderChrome() {
  /* The theme switch re-renders with the rest of the chrome, so focus has to survive
     it or a keyboard user is thrown back to the top of the page on every toggle. */
  preservingFocus(els.sidebar, () => {
    els.sidebar.innerHTML = renderSidebar({ theme: theme.theme() });
  });
  const snapshot = state.get();
  els.banner.innerHTML = renderScanBanner({
    scanning: snapshot.scanning,
    status: snapshot.status,
    hasSession: Boolean(snapshot.sessionId) && !snapshot.sync.sessionLost,
  });
  els.footer.innerHTML = renderFooter({ version: 'v0.1.0' });
}

function renderStatus() {
  els.statusbar.innerHTML = renderStatusHeader({ status: state.get().status });
}

function renderData() {
  const snapshot = state.get();
  const { scan } = snapshot;
  els.summary.innerHTML = renderScanSummary({ scan, lastScanLabel: snapshot.lastScanLabel });
  els.cards.innerHTML = renderCategoryCards({ scan, categoryFilter: snapshot.categoryFilter });
  renderViewOptions(scan);
  renderRowsRegion(scan);
  els.distribution.innerHTML = renderDistribution(scan);

  const selected = renderSelectedPanel(scan);
  els.selectedCount.textContent = String(selected.count);
  els.selectedTotal.textContent = `of ${selected.total} classified tabs`;
  els.selectedList.innerHTML =
    selected.list + (selected.more ? `<li class="muted">+${selected.more} more</li>` : '');
  els.applySummary.innerHTML = renderApplySummary(scan);
  els.clearClosures.disabled = selected.count === 0 || snapshot.sync.sessionLost;

  const unclassified = scan.unclassified || [];
  els.unclassifiedPanel.hidden = unclassified.length === 0;
  els.unclassifiedList.innerHTML = renderUnclassified(scan);

  renderSyncRegion();
}

function renderSyncRegion() {
  const snapshot = state.get();
  els.syncPanel.innerHTML = renderSyncPanel(snapshot);
  els.applyButton.disabled =
    snapshot.scanning
    || snapshot.applying
    || snapshot.applied
    || snapshot.sync.sessionLost
    || planItems(snapshot.scan).length === 0;
}

function renderViewOptions(scan) {
  const counts = scan.plan.counts || {};
  const total = planItems(scan).length;
  const options = [
    `<option value="">All Tabs (${total})</option>`,
    ...CATEGORY_ORDER.filter((category) => (counts[category] || 0) > 0).map(
      (category) => `<option value="${category}"${category === state.get().categoryFilter ? ' selected' : ''}>${category} (${counts[category]})</option>`,
    ),
  ];
  els.viewSelect.innerHTML = options.join('');
  if (!state.get().categoryFilter) els.viewSelect.value = '';
}

function renderRowsRegion(scan) {
  const snapshot = state.get();
  const visible = filterItems(scan, { search: snapshot.search, category: snapshot.categoryFilter });
  const empty = planItems(scan).length === 0;
  preservingFocus(els.rows, () => {
    els.rows.innerHTML = empty
      ? `<tr><td colspan="7"><p class="empty-state">${emptyMessage(snapshot)}</p></td></tr>`
      : renderRows(snapshot);
  });
  els.rowCount.textContent = empty
    ? `${planItems(scan).length} tabs in this review`
    : `${visible.length} of ${planItems(scan).length} classified tabs shown · ${
        visible.filter((item) => item.closeSelected).length
      } selected for closure in view`;
  const allSelected = visible.length > 0 && visible.every((item) => item.closeSelected);
  els.selectAll.checked = allSelected;
  els.selectAll.indeterminate = !allSelected && visible.some((item) => item.closeSelected);
  els.selectAll.disabled = visible.length === 0;
}

function emptyMessage(snapshot) {
  if (snapshot.applied) {
    return 'This review was applied to your browser. Scan the window again to review what is left.';
  }
  if (snapshot.sync.sessionLost) {
    return 'This review is no longer live, so there is nothing to apply. Scan the window again.';
  }
  if (snapshot.scanning) return 'Reading the current window…';
  return 'No scan yet. Nothing has been read from your browser. Use Scan Window to build a review plan.';
}

function renderAll() {
  renderChrome();
  renderStatus();
  renderData();
}

function commit(patch) {
  state.set(patch);
}

/* ------------------------------------------------------------------ actions */

async function refreshStatus({ announce = false } = {}) {
  commit({ status: { ...state.get().status, status: 'checking', message: 'Checking the local model…' } });
  renderChrome();
  renderStatus();
  try {
    const status = await getStatus();
    commit({ status });
  } catch (error) {
    commit({ status: statusFromError(error) });
  }
  renderChrome();
  renderStatus();
  if (announce) {
    const { status } = state.get();
    showToast(
      status.status === 'ready'
        ? `Status: ${status.message}`
        : `Status check failed: ${status.message}`,
    );
  }
}

async function runScan() {
  const snapshot = state.get();
  if (snapshot.scanning) return;
  if (!snapshot.status.canScan) {
    showToast(`Scanning is not available: ${snapshot.status.message}`);
    return;
  }
  commit({ scanning: true });
  renderChrome();
  let result;
  try {
    result = await requestScan();
  } catch (error) {
    commit({ scanning: false });
    renderChrome();
    showToast(`Scan failed: ${error.message}`);
    // The previous review stays exactly as it was; nothing is invented to replace it.
    return;
  }
  recomputePlan(result);
  // A new scan ends the old review: its queued edits must never be sent against a dead session.
  sync?.dispose();
  sync = createReviewSync({
    scan: result,
    sessionId: result.sessionId,
    updatePlan,
    getReviewPlan,
  });
  sync.subscribe((next) => {
    commit({ sync: next });
    renderSyncRegion();
  });
  commit({
    scanning: false,
    scan: result,
    sessionId: result.sessionId,
    applied: false,
    search: '',
    categoryFilter: null,
    openMenuTabId: null,
    sync: sync.read(),
    lastScanLabel: `Scanned ${result.scannedCount} tabs at ${new Date().toLocaleTimeString()}`,
  });
  els.search.value = '';
  renderChrome();
  renderData();
  showToast(scanReport(result));
}

function scanReport(result) {
  const parts = [`${result.plan.items.length} classified`];
  if (result.unclassified.length) parts.push(`${result.unclassified.length} not classified`);
  if (result.skippedUnsupported.length) parts.push(`${result.skippedUnsupported.length} unsupported`);
  if (result.truncated.length) parts.push(`${result.truncated.length} beyond the per-request cap`);
  if (result.rejected.length) parts.push(`${result.rejected.length} model answers rejected`);
  const meta = result.modelMeta?.requests ? ` · ${result.modelMeta.requests} model request(s)` : '';
  return `Scan complete: ${parts.join(', ')}${meta}. Review it, then apply.`;
}

/** Any edit path funnels through the synchronizer, so the session always learns about it. */
function recordEdits(patches) {
  if (!sync) {
    showToast('There is no active session to edit.');
    return false;
  }
  const list = Array.isArray(patches) ? patches : [patches];
  const changed = sync.recordMany(list);
  if (!changed) return false;
  commit({ sync: sync.read() });
  renderData();
  return true;
}

/**
 * The review never reached the browser: keep the dialog open and unconfirmed, with the reason the
 * worker or this page actually reported. `expired` is the case only a fresh scan can fix.
 */
function showBlockedDialog({ expired = false, message }) {
  if (expired) sync?.loseSession(message);
  commit({ applying: false, sync: sync ? sync.read() : state.get().sync });
  const { scan, sync: syncState } = state.get();
  els.dialog.innerHTML = renderApplyDialog(
    scan,
    expired ? { ...syncState, sessionLost: true } : { ...syncState, blocked: true, message },
  );
  els.dialog.querySelector('[data-focus-key="dialog-cancel"]')?.focus();
  showToast(`Not applied: ${message}`);
  renderData();
}

async function openApplyDialog() {
  const snapshot = state.get();
  if (snapshot.applied) {
    showToast('This review has already been applied. Scan the window again.');
    return;
  }
  if (!snapshot.sessionId || planItems(snapshot.scan).length === 0) {
    showToast('Nothing to apply yet — scan a window first.');
    return;
  }
  if (snapshot.sync.sessionLost) {
    showToast('This session has expired. Scan the window again before applying.');
    return;
  }
  els.dialog.innerHTML = renderApplyDialog(snapshot.scan, snapshot.sync);
  if (!els.dialog.open) els.dialog.showModal();
  els.dialog.querySelector('[data-focus-key="dialog-cancel"]')?.focus();
}

async function confirmApply() {
  const snapshot = state.get();
  if (snapshot.applying || snapshot.applied) return;
  if (!snapshot.sessionId) {
    showToast('There is no review to apply.');
    return;
  }
  commit({ applying: true });
  const confirm = els.dialog.querySelector('[data-action="confirm-apply"]');
  confirm?.setAttribute('disabled', '');

  // Nothing is applied while an edit has not reached the session.
  const flushed = sync ? await sync.flush() : { ok: true, state: snapshot.sync };
  if (!flushed.ok) {
    commit({ applying: false, sync: flushed.state });
    els.dialog.innerHTML = renderApplyDialog(state.get().scan, { ...flushed.state, blocked: true });
    els.dialog.querySelector('[data-focus-key="dialog-cancel"]')?.focus();
    showToast(`Not applied: ${flushed.state.message || 'your changes have not been saved to the review.'}`);
    renderData();
    return;
  }

  // The review can have outlived the background that built it, so ask it to confirm the review
  // is still there before anything is approved — a late failure is a confusing one.
  try {
    await getReviewPlan(snapshot.sessionId);
  } catch (error) {
    showBlockedDialog({ expired: SESSION_LOST_CODES.has(error.code), message: error.message });
    return;
  }

  let result;
  try {
    result = await applyOrganization({ sessionId: snapshot.sessionId });
  } catch (error) {
    if (error.code === ERROR_CODES.PARTIAL_APPLY_FAILURE) {
      // A partial truth: show exactly what the browser did and what it did not.
      const done = (error.details?.groups?.length || 0) + (error.details?.closures?.length || 0);
      sync?.loseSession(
        done
          ? 'Part of this review was applied. Scan the window again to continue.'
          : 'Nothing was applied, so your tabs are unchanged. Scan the window again to continue.',
      );
      els.dialog.innerHTML = renderApplyResult(error.details, { partial: true, message: error.message });
      els.dialog.querySelector('[data-focus-key="dialog-close"]')?.focus();
      commit({ applied: true, sync: sync ? sync.read() : state.get().sync });
      renderData();
      return;
    }
    if (SESSION_LOST_CODES.has(error.code)) {
      showBlockedDialog({ expired: true, message: error.message });
      return;
    }
    commit({ applying: false });
    showToast(`Apply failed: ${error.message}`);
    els.dialog.close();
    renderData();
    return;
  }
  // The session is spent: the browser has changed, so this review can not be applied twice.
  sync?.loseSession('This review has been applied. Scan the window again to organize anything else.');
  commit({
    applying: false,
    applied: true,
    sync: sync ? sync.read() : state.get().sync,
    lastScanLabel: `Applied ${new Date().toLocaleTimeString()} · scan again for a fresh review`,
  });
  els.dialog.innerHTML = renderApplyResult(result, { partial: false });
  els.dialog.querySelector('[data-focus-key="dialog-close"]')?.focus();
  renderChrome();
  renderData();
}

/* ------------------------------------------------------------------ events */

on(els.sidebar, 'click', '[data-action="set-theme"]', (event, target) => {
  theme.set(target.dataset.themeValue);
  renderChrome();
});

on(els.sidebar, 'click', '[data-action="nav-home"]', () => {
  commit({ categoryFilter: null, search: '' });
  els.search.value = '';
  renderData();
  showToast('Home is the only view in this build. Filters were reset.');
});

on(els.statusbar, 'click', '[data-action="refresh-status"]', () => refreshStatus({ announce: true }));

on(els.statusbar, 'click', '[data-action="open-settings"]', () => {
  showToast('Settings are not part of this build.');
});

on(els.banner, 'click', '[data-action="scan"]', () => runScan());

on(els.cards, 'click', '[data-action="filter-category"]', (event, target) => {
  const category = target.dataset.category;
  commit({ categoryFilter: state.get().categoryFilter === category ? null : category, openMenuTabId: null });
  renderData();
});

on(els.cards, 'keydown', 'button', (event) => {
  const buttons = [...els.cards.querySelectorAll('button')];
  const index = buttons.indexOf(document.activeElement);
  if (index === -1) return;
  let next = null;
  if (event.key === 'ArrowRight') next = buttons[(index + 1) % buttons.length];
  if (event.key === 'ArrowLeft') next = buttons[(index - 1 + buttons.length) % buttons.length];
  if (next) {
    event.preventDefault();
    next.focus();
  }
});

els.search.addEventListener('input', () => {
  commit({ search: els.search.value, openMenuTabId: null });
  renderRowsRegion(state.get().scan);
});

els.viewSelect.addEventListener('change', () => {
  commit({ categoryFilter: els.viewSelect.value || null, openMenuTabId: null });
  renderData();
});

els.selectAll.addEventListener('change', () => {
  const snapshot = state.get();
  const visible = filterItems(snapshot.scan, { search: snapshot.search, category: snapshot.categoryFilter });
  const wanted = els.selectAll.checked;
  recordEdits(visible.filter((item) => item.closeSelected !== wanted).map((item) => ({
    tabId: item.tabId,
    closeSelected: wanted,
  })));
});

document.addEventListener('click', (event) => {
  const trigger = event.target.closest('[data-action="clear-closures"]');
  if (!trigger) return;
  const snapshot = state.get();
  recordEdits(planItems(snapshot.scan)
    .filter((item) => item.closeSelected)
    .map((item) => ({ tabId: item.tabId, closeSelected: false })));
  showToast('Closure selection cleared. The session was told.');
});

on(els.rows, 'change', '[data-action="toggle-close"]', (event, target) => {
  recordEdits({ tabId: Number(target.dataset.tabId), closeSelected: target.checked });
});

on(els.rows, 'click', 'button[data-action="toggle-close"]', (event, target) => {
  const item = findItem(state.get().scan, Number(target.dataset.tabId));
  if (!item) return;
  recordEdits({ tabId: item.tabId, closeSelected: !item.closeSelected });
});

on(els.rows, 'change', '[data-action="change-category"]', (event, target) => {
  recordEdits({ tabId: Number(target.dataset.tabId), category: target.value });
});

on(els.rows, 'click', '[data-action="toggle-menu"]', (event, target) => {
  const tabId = Number(target.dataset.tabId);
  commit({ openMenuTabId: state.get().openMenuTabId === tabId ? null : tabId });
  renderRowsRegion(state.get().scan);
});

on(els.rows, 'click', '[data-action="reset-category"]', (event, target) => {
  const item = findItem(state.get().scan, Number(target.dataset.tabId));
  if (!item) return;
  commit({ openMenuTabId: null });
  recordEdits({ tabId: item.tabId, category: item.originalCategory });
});

on(els.rows, 'click', '[data-action="keep-open"]', (event, target) => {
  const item = findItem(state.get().scan, Number(target.dataset.tabId));
  if (!item) return;
  commit({ openMenuTabId: null });
  recordEdits({ tabId: item.tabId, closeSelected: false });
});

document.addEventListener('click', (event) => {
  if (state.get().openMenuTabId === null) return;
  if (event.target.closest('.menu')) return;
  commit({ openMenuTabId: null });
  renderRowsRegion(state.get().scan);
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || state.get().openMenuTabId === null) return;
  commit({ openMenuTabId: null });
  renderRowsRegion(state.get().scan);
});

on(els.syncPanel, 'click', '[data-action="retry-sync"]', async () => {
  if (!sync) return;
  const flushed = await sync.flush();
  commit({ sync: flushed.state });
  renderData();
  showToast(flushed.ok ? 'All changes are saved to the session.' : `Still not saved: ${flushed.state.message}`);
});

on(els.syncPanel, 'click', '[data-action="reload-plan"]', async () => {
  if (!sync) return;
  const result = await sync.reload();
  commit({ sync: sync.read() });
  renderData();
  showToast(result.ok ? 'Re-read the plan from the session.' : `Could not re-read the plan: ${result.message}`);
});

document.addEventListener('click', (event) => {
  if (event.target.closest('[data-action="open-apply-dialog"]')) {
    openApplyDialog();
    return;
  }
  if (event.target.closest('[data-action="confirm-apply"]')) {
    confirmApply();
  }
});

on(els.dialog, 'click', '[data-action="close-dialog"]', () => {
  els.dialog.close();
});

/* ------------------------------------------------------------------- start */

async function start() {
  renderAll();
  if (!isExtensionContext()) {
    commit({
      status: statusFromError({
        code: CLIENT_ERROR_CODES.NOT_EXTENSION,
        message: 'This dashboard is not running as an extension page, so it cannot read your tabs. Load TabJanitor unpacked and open the dashboard from its toolbar icon.',
      }),
    });
    renderChrome();
    renderStatus();
    return;
  }
  await refreshStatus();
}

start();
