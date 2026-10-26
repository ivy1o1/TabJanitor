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
import { renderApplySummary, renderDistribution, renderSelectedPanel } from './components/side-panels.js';
import { renderApplyDialog } from './components/confirmation-dialog.js';
import { renderFooter } from './components/footer.js';
import { applyOrganization, demoNotice, getStatus, scan as requestScan } from './source.js';

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
  selectAll: el('select-all'),
  clearClosures: document.querySelector('[data-action="clear-closures"]'),
  footer: el('footer'),
  dialog: el('apply-dialog'),
  toast: el('toast'),
};

const theme = createThemeController();

const state = createStore({
  scan: null,
  status: { status: 'checking', canScan: false, endpoint: 'not connected', model: 'Loading…', message: 'Reading demo status.' },
  search: '',
  categoryFilter: null,
  openMenuTabId: null,
  scanning: false,
  lastScanLabel: 'Last scan: none — sample data',
});

let toastTimer = null;
function showToast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, 4200);
}

/* --------------------------------------------------------------- rendering */

function renderChrome() {
  els.sidebar.innerHTML = renderSidebar({ theme: theme.theme() });
  els.banner.innerHTML = renderScanBanner({ scanning: state.get().scanning });
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
  els.selectedTotal.textContent = `of ${selected.total} sample tabs`;
  els.selectedList.innerHTML =
    selected.list + (selected.more ? `<li class="muted">+${selected.more} more</li>` : '');
  els.applySummary.innerHTML = renderApplySummary(scan);
  els.clearClosures.disabled = selected.count === 0;

  const unclassified = scan.unclassified || [];
  els.unclassifiedPanel.hidden = unclassified.length === 0;
  els.unclassifiedList.innerHTML = renderUnclassified(scan);
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
  preservingFocus(els.rows, () => {
    els.rows.innerHTML = renderRows(snapshot);
  });
  els.rowCount.textContent = `${visible.length} of ${planItems(scan).length} sample tabs shown · ${
    visible.filter((item) => item.closeSelected).length
  } selected for closure in view`;
  const allSelected = visible.length > 0 && visible.every((item) => item.closeSelected);
  els.selectAll.checked = allSelected;
  els.selectAll.indeterminate = !allSelected && visible.some((item) => item.closeSelected);
  els.selectAll.disabled = visible.length === 0;
}

function renderAll() {
  renderChrome();
  renderStatus();
  renderData();
}

/* ------------------------------------------------------------------ events */

function commit(patch) {
  state.set(patch);
}

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

on(els.statusbar, 'click', '[data-action="refresh-status"]', async () => {
  commit({ status: { ...state.get().status, status: 'checking', message: 'Demo mode: no request is made.' } });
  renderStatus();
  const status = await getStatus();
  commit({ status });
  renderStatus();
  showToast('Demo mode: no readiness check was performed. Backend integration is the next phase.');
});

on(els.statusbar, 'click', '[data-action="open-settings"]', () => {
  showToast('Settings are not part of this phase. Endpoint and model live in chrome.storage.local.');
});

on(els.banner, 'click', '[data-action="scan"]', async () => {
  commit({ scanning: true });
  renderChrome();
  const next = await requestScan();
  recomputePlan(next);
  // Give the disabled state a beat so the button visibly responds.
  await new Promise((resolve) => setTimeout(resolve, 350));
  commit({
    scanning: false,
    scan: next,
    categoryFilter: null,
    openMenuTabId: null,
    lastScanLabel: `Sample data loaded ${new Date().toLocaleTimeString()} · demo`,
  });
  renderChrome();
  renderData();
  showToast(demoNotice());
});

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
  for (const item of visible) item.closeSelected = els.selectAll.checked;
  recomputePlan(snapshot.scan);
  renderData();
});

document.addEventListener('click', (event) => {
  const trigger = event.target.closest('[data-action="clear-closures"]');
  if (!trigger) return;
  const snapshot = state.get();
  for (const item of planItems(snapshot.scan)) item.closeSelected = false;
  recomputePlan(snapshot.scan);
  renderData();
  showToast('Closure selection cleared (demo state only).');
});

on(els.rows, 'change', '[data-action="toggle-close"]', (event, target) => {
  const snapshot = state.get();
  const item = findItem(snapshot.scan, Number(target.dataset.tabId));
  if (!item) return;
  item.closeSelected = target.checked;
  recomputePlan(snapshot.scan);
  renderData();
});

on(els.rows, 'click', 'button[data-action="toggle-close"]', (event, target) => {
  const snapshot = state.get();
  const item = findItem(snapshot.scan, Number(target.dataset.tabId));
  if (!item) return;
  item.closeSelected = !item.closeSelected;
  recomputePlan(snapshot.scan);
  renderData();
});

on(els.rows, 'change', '[data-action="change-category"]', (event, target) => {
  const snapshot = state.get();
  const item = findItem(snapshot.scan, Number(target.dataset.tabId));
  if (!item) return;
  item.category = target.value;
  item.userEdited = item.category !== item.originalCategory;
  recomputePlan(snapshot.scan);
  renderData();
});

on(els.rows, 'click', '[data-action="toggle-menu"]', (event, target) => {
  const tabId = Number(target.dataset.tabId);
  commit({ openMenuTabId: state.get().openMenuTabId === tabId ? null : tabId });
  renderRowsRegion(state.get().scan);
});

on(els.rows, 'click', '[data-action="reset-category"]', (event, target) => {
  const snapshot = state.get();
  const item = findItem(snapshot.scan, Number(target.dataset.tabId));
  if (!item) return;
  item.category = item.originalCategory;
  item.userEdited = false;
  commit({ openMenuTabId: null });
  recomputePlan(snapshot.scan);
  renderData();
});

on(els.rows, 'click', '[data-action="keep-open"]', (event, target) => {
  const snapshot = state.get();
  const item = findItem(snapshot.scan, Number(target.dataset.tabId));
  if (!item) return;
  item.closeSelected = false;
  commit({ openMenuTabId: null });
  recomputePlan(snapshot.scan);
  renderData();
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

document.addEventListener('click', (event) => {
  if (!event.target.closest('[data-action="open-apply-dialog"]')) return;
  els.dialog.innerHTML = renderApplyDialog(state.get().scan);
  if (!els.dialog.open) els.dialog.showModal();
  els.dialog.querySelector('[data-focus-key="dialog-cancel"]')?.focus();
});

on(els.dialog, 'click', '[data-action="close-dialog"]', () => {
  els.dialog.close();
});

on(els.dialog, 'click', '[data-action="confirm-demo-apply"]', async () => {
  els.dialog.close();
  const result = await applyOrganization();
  showToast(result.message);
});

/* ------------------------------------------------------------------- start */

async function start() {
  const initial = await requestScan();
  recomputePlan(initial);
  state.set({ scan: initial });
  commit({ status: await getStatus() });
  renderAll();
}

start();
