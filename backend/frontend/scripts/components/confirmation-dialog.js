import { icon } from '../icons.js';
import { escapeHtml } from '../dom.js';
import { selectedItems } from '../selectors.js';

/**
 * ConfirmationDialog for "Apply Organization".
 *
 * It states plainly that this is a frontend demonstration. Confirming shows a toast
 * and changes nothing — there is no browser call to make, and the copy never implies
 * that tabs were grouped or closed.
 */
export function renderApplyDialog(scan) {
  const selected = selectedItems(scan);
  const groups = Object.entries(scan.plan.counts || {}).filter(([, count]) => count > 0);
  return `
    <div class="dialog__inner">
      <div class="dialog__head">
        <h2 id="dialog-title">Review before applying</h2>
        <button type="button" class="dialog__close" data-action="close-dialog" aria-label="Close dialog" data-focus-key="dialog-close">
          ${icon('close', { size: 18 })}
        </button>
      </div>
      <div class="dialog__body">
        <p class="badge badge--warn">${icon('info', { size: 14 })}<span>Frontend demonstration only</span></p>
        <p>This preview is built from <strong>sample data</strong>. No browser tabs were read, and confirming will
        not group, close, or reopen anything. The real workflow needs your explicit approval and then runs
        <code>APPLY_ORGANIZATION</code> against the background service worker — that integration is the next phase.</p>
        <h3>Groups that would be created</h3>
        <ul class="dialog__list">
          ${groups
            .map(([category, count]) => `<li><span>${escapeHtml(category)}</span><span class="muted">${count} tabs</span></li>`)
            .join('')}
        </ul>
        <h3>Tabs selected for closure</h3>
        ${
          selected.length
            ? `<ul class="dialog__list">${selected
                .map((item) => `<li><span>${escapeHtml(item.title)}</span><span class="muted">${escapeHtml(item.domain)}</span></li>`)
                .join('')}</ul>`
            : '<p class="muted">None. Nothing would be closed.</p>'
        }
      </div>
      <div class="dialog__foot">
        <button type="button" class="btn" data-action="close-dialog" data-focus-key="dialog-cancel">Cancel</button>
        <button type="button" class="btn btn--primary" data-action="confirm-demo-apply">${icon('sparkle', { size: 17 })}<span>Confirm demo preview</span></button>
      </div>
    </div>
  `;
}
