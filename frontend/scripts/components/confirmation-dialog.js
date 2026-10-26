import { icon } from '../icons.js';
import { escapeHtml } from '../dom.js';
import { planItems, selectedItems } from '../selectors.js';

function listGroups(counts) {
  const groups = Object.entries(counts || {}).filter(([, count]) => count > 0);
  if (!groups.length) return '<p class="muted">None. No tab would move.</p>';
  return `
    <ul class="dialog__list">
      ${groups
        .map(([category, count]) => `<li><span>${escapeHtml(category)}</span><span class="muted">${count} tab${count === 1 ? '' : 's'}</span></li>`)
        .join('')}
    </ul>`;
}

function listClosures(selected) {
  if (!selected.length) return '<p class="muted">None. Nothing will be closed.</p>';
  return `
    <ul class="dialog__list">
      ${selected
        .map((item) => `<li><span>${escapeHtml(item.title)}</span><span class="muted">${escapeHtml(item.domain)}</span></li>`)
        .join('')}
    </ul>`;
}

/**
 * ConfirmationDialog for "Apply Organization".
 *
 * This is the last stop before the browser changes, so it shows the real session: the
 * groups and closures the backend would perform, and it refuses to be confirmable while
 * an edit has not reached that session.
 */
export function renderApplyDialog(scan, syncState = {}) {
  const selected = selectedItems(scan);
  const blocked = syncState.blocked === true;
  const lost = syncState.sessionLost === true;
  const unsaved = (syncState.pendingCount || 0) + (syncState.unsyncedCount || 0);
  const edited = planItems(scan).filter((item) => item.userEdited).length;
  const windowLabel = Number.isFinite(scan.windowId) ? `window ${scan.windowId}` : 'this window';

  const warning = blocked
    ? `<p class="badge badge--danger">${icon('info', { size: 14 })}<span>Blocked: ${
        escapeHtml(syncState.message || `${unsaved} change(s) are not saved to the session.`)
      }</span></p>
       <p>Nothing was applied. Save the pending changes (or reload the session plan) and open this review again.</p>`
    : lost
      ? `<p class="badge badge--danger">${icon('info', { size: 14 })}<span>Session expired</span></p>
         <p>${escapeHtml(syncState.message || 'The service worker no longer holds this session.')} Scan the window again before applying.</p>`
      : `<p class="badge badge--warn">${icon('info', { size: 14 })}<span>This changes real tabs</span></p>
         <p>On confirmation the extension sends <code>APPLY_ORGANIZATION</code> with your approval, and the
         background organizer groups and closes tabs in ${escapeHtml(windowLabel)}. Nothing else can change your browser.</p>`;

  return `
    <div class="dialog__inner">
      <div class="dialog__head">
        <h2 id="dialog-title">Review before applying</h2>
        <button type="button" class="dialog__close" data-action="close-dialog" aria-label="Close dialog" data-focus-key="dialog-close">
          ${icon('close', { size: 18 })}
        </button>
      </div>
      <div class="dialog__body">
        ${warning}
        <h3>Groups to create</h3>
        ${listGroups(scan.plan.counts)}
        <h3>Tabs to close</h3>
        ${listClosures(selected)}
        <p class="muted">${planItems(scan).length} tab(s) in this review, ${edited} of them edited by you.
        ${unsaved ? `${unsaved} change(s) still unsynced.` : 'All changes are saved to the session.'}</p>
      </div>
      <div class="dialog__foot">
        <button type="button" class="btn" data-action="close-dialog" data-focus-key="dialog-cancel">Cancel</button>
        <button type="button" class="btn btn--primary" data-action="confirm-apply" data-focus-key="dialog-confirm" ${blocked || lost ? 'disabled' : ''}>
          ${icon('check', { size: 17 })}<span>Approve and apply</span>
        </button>
      </div>
    </div>
  `;
}

/**
 * The real apply result. A partial apply is reported as partial: the failures and the
 * skipped tabs stay on screen instead of being folded into a success message.
 */
export function renderApplyResult(result = {}, { partial = false, message = '' } = {}) {
  const groups = Array.isArray(result.groups) ? result.groups : [];
  const closures = Array.isArray(result.closures) ? result.closures : [];
  const stale = Array.isArray(result.stale) ? result.stale : [];
  const failures = Array.isArray(result.failures) ? result.failures : [];
  const requested = Number.isFinite(result.closureRequested) ? result.closureRequested : closures.length;

  const headline = partial
    ? { className: 'badge--danger', text: 'Partially applied' }
    : { className: 'badge--ok', text: 'Applied to your browser' };

  const groupWord = groups.length === 1 ? 'group' : 'groups';
  const tabWord = closures.length === 1 ? 'tab' : 'tabs';

  return `
    <div class="dialog__inner">
      <div class="dialog__head">
        <h2 id="dialog-title">Apply result</h2>
        <button type="button" class="dialog__close" data-action="close-dialog" aria-label="Close dialog" data-focus-key="dialog-close">
          ${icon('close', { size: 18 })}
        </button>
      </div>
      <div class="dialog__body">
        <p class="badge ${headline.className}">${icon(partial ? 'info' : 'check', { size: 14 })}<span>${headline.text}</span></p>
        ${message ? `<p>${escapeHtml(message)}</p>` : ''}
        <p>${groups.length} ${groupWord} named, ${closures.length} of ${requested} selected ${tabWord} closed${
          stale.length ? `, ${stale.length} tab(s) skipped as no longer present` : ''
        }${failures.length ? `, ${failures.length} operation(s) failed` : ''}.</p>

        <h3>Groups</h3>
        ${
          groups.length
            ? `<ul class="dialog__list">${groups
                .map(
                  (group) => `<li><span>${escapeHtml(group.title || group.category || 'Group')}</span>
                    <span class="muted">${(group.tabIds || []).length} tab(s)${group.status === 'partial' ? ' — named/colored partially' : ''}</span></li>`,
                )
                .join('')}</ul>`
            : '<p class="muted">No group was created.</p>'
        }

        ${
          stale.length
            ? `<h3>Skipped — tab no longer there</h3>
               <ul class="dialog__list">${stale
                 .map((entry) => `<li><span>tab ${escapeHtml(String(entry.tabId))}</span><span class="muted">${escapeHtml(entry.reason || 'stale')}</span></li>`)
                 .join('')}</ul>`
            : ''
        }

        ${
          failures.length
            ? `<h3>Failed</h3>
               <ul class="dialog__list dialog__list--fail">${failures
                 .map(
                   (failure) => `<li><span>${escapeHtml(failure.operation || 'operation')}${
                     failure.category ? ` — ${escapeHtml(failure.category)}` : ''
                   }${Number.isFinite(failure.tabId) ? ` (tab ${escapeHtml(String(failure.tabId))})` : ''}</span>
                   <span class="muted">${escapeHtml(failure.reason || 'no reason reported')}</span></li>`,
                 )
                 .join('')}</ul>`
            : ''
        }
        <p class="muted">This review is now spent: the browser has changed. Scan the window again for a fresh plan.</p>
      </div>
      <div class="dialog__foot">
        <button type="button" class="btn btn--primary" data-action="close-dialog" data-focus-key="dialog-close">Done</button>
      </div>
    </div>
  `;
}
