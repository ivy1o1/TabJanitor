import { icon } from '../icons.js';
import { categoryClass, deriveMetrics, distribution, selectedItems } from '../selectors.js';
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
        <span class="dist__bar" role="img" aria-label="${escapeHtml(`${row.count} of ${total} classified sample tabs are ${row.category}`)}">
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

/** ApplyOrganizationPanel copy. The button opens a dialog; it never mutates anything. */
export function renderApplySummary(scan) {
  const selected = selectedItems(scan).length;
  const groups = Object.values(scan.plan.counts || {}).filter((count) => count > 0).length;
  const tabWord = selected === 1 ? 'tab' : 'tabs';
  const groupWord = groups === 1 ? 'group' : 'groups';
  return `${icon('check', { size: 16 })}<span>Would create ${groups} ${groupWord} and close ${selected} selected ${tabWord} — in the real extension, after your approval.</span>`;
}
