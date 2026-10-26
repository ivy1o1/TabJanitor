import { icon } from '../icons.js';
import { categoryClass, deriveMetrics, distribution, planItems, selectedItems } from '../selectors.js';
import { STATUS } from '../review-sync.js';
import { escapeHtml } from '../dom.js';

/** CategoryDistribution: bar widths are computed from the plan counts. */
export function renderDistribution(scan) {
  const rows = distribution(scan);
  const total = deriveMetrics(scan).classified;
  return rows
    .map(
      (row) => `
      <li class="dist__row ${categoryClass(row.category)}">
        <span class="dist__name"><span class="dist__swatch" aria-hidden="true"></span>
          <span>${escapeHtml(row.category)}</span></span>
        <span class="dist__count">${row.count}</span>
        <span class="dist__bar" role="img" aria-label="${escapeHtml(`${row.count} of ${total} classified tabs are ${row.category}`)}">
          <i style="width:${row.width}%"></i>
        </span>
      </li>`,
    )
    .join('');
}

/** SelectedForClosure: live count of individually selected tabs. */
export function renderSelectedPanel(scan) {
  const selected = selectedItems(scan);
  const metrics = deriveMetrics(scan);
  return {
    count: selected.length,
    total: metrics.classified,
    list: selected
      .slice(0, 4)
      .map((item) => `<li class="dist__row"><span class="dist__name">${escapeHtml(item.title)}</span><span class="muted">${escapeHtml(item.domain)}</span></li>`)
      .join(''),
    more: selected.length > 4 ? selected.length - 4 : 0,
  };
}

/** ApplyOrganizationPanel copy — what the service worker would do on approval. */
export function renderApplySummary(scan) {
  const selected = selectedItems(scan).length;
  const groups = Object.values(scan.plan.counts || {}).filter((count) => count > 0).length;
  if (planItems(scan).length === 0) {
    return `${icon('info', { size: 16 })}<span>No review plan yet. Scan a window to build one.</span>`;
  }
  const tabWord = selected === 1 ? 'tab' : 'tabs';
  const groupWord = groups === 1 ? 'group' : 'groups';
  return `${icon('check', { size: 16 })}<span>Will create ${groups} ${groupWord} and close ${selected} selected ${tabWord} in this window, after your approval.</span>`;
}

const SYNC_TONE = {
  [STATUS.CLEAN]: { tone: 'ok', icon: 'check' },
  [STATUS.PENDING]: { tone: 'warn', icon: 'info' },
  [STATUS.SYNCING]: { tone: 'busy', icon: 'refresh' },
  [STATUS.FAILED]: { tone: 'danger', icon: 'info' },
  [STATUS.SESSION_LOST]: { tone: 'danger', icon: 'close' },
};

function syncLine(tone, iconName, text, extra = '') {
  return `
    <div class="sync sync--${tone}" role="status" aria-live="polite">
      <span class="sync__row">${icon(iconName, { size: 15 })}<span>${escapeHtml(text)}</span></span>
      ${extra}
    </div>`;
}

/**
 * SynchronizationState: whether the service worker agrees with this screen.
 *
 * It is the honest counterpart of the Apply button — while edits are queued, refused,
 * or the session is gone, it says so here and Apply is disabled rather than half-right.
 */
export function renderSyncPanel(snapshot) {
  const sync = snapshot.sync || {};
  if (snapshot.applied) {
    return syncLine('idle', 'check', sync.message || 'This review was applied. Scan the window again to organize anything else.');
  }
  if (!snapshot.sessionId) {
    return syncLine('idle', 'info', 'No review in progress. Once you scan, your changes are saved to that session.');
  }

  const meta = SYNC_TONE[sync.status] || SYNC_TONE[STATUS.CLEAN];
  const edited = planItems(snapshot.scan).filter((item) => item.userEdited).length;
  const pending = sync.pendingCount || 0;

  let text;
  if (sync.status === STATUS.SYNCING) text = `Saving ${pending} change${pending === 1 ? '' : 's'} to the session…`;
  else if (sync.status === STATUS.PENDING) text = `${pending} change${pending === 1 ? '' : 's'} not saved yet.`;
  else if (sync.status === STATUS.FAILED) text = sync.message || 'Some changes were not saved to the session.';
  else if (sync.status === STATUS.SESSION_LOST) text = sync.message || 'This review is no longer live.';
  else text = sync.message || (edited ? `${edited} change${edited === 1 ? '' : 's'} saved to the session.` : 'In sync with the session — no changes yet.');

  const refused = (sync.unsynced || [])
    .slice(0, 3)
    .map(
      (entry) => `<li class="sync__refused"><span>${escapeHtml(entry.title)}</span>
        <span class="sync__refused-reason">${escapeHtml(entry.reason || 'refused by the session')}</span></li>`,
    )
    .join('');

  const actions = [];
  if (sync.sessionLost) {
    actions.push('<span class="sync__hint">Use Scan Window to start a fresh review.</span>');
  } else {
    if (pending > 0 || sync.status === STATUS.FAILED) {
      actions.push(`<button type="button" class="btn btn--sm" data-action="retry-sync" data-focus-key="retry-sync">${icon('refresh', { size: 15 })}<span>Save now</span></button>`);
    }
    if (sync.status === STATUS.FAILED) {
      actions.push(`<button type="button" class="btn btn--sm" data-action="reload-plan" data-focus-key="reload-plan">${icon('arrow', { size: 15 })}<span>Reload the session plan</span></button>`);
    }
  }

  return syncLine(
    meta.tone,
    meta.icon,
    text,
    `${refused ? `<ul class="sync__refused-list">${refused}</ul>` : ''}
     ${actions.length ? `<span class="sync__actions">${actions.join('')}</span>` : ''}`,
  );
}
