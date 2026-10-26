import { icon } from '../icons.js';
import { CATEGORY_ORDER, confidenceBand, categoryClass, filterItems } from '../selectors.js';
import { escapeHtml, monogram } from '../dom.js';

/**
 * TabRow — one review-plan item.
 *
 * Column order mirrors the contract's item fields: title/domain are the sanitized
 * snapshot values, `category` is editable and reset to the model's answer from the
 * overflow menu, and `closeSelected` is the only field that becomes a real closure — on
 * apply, in the background organizer, never from here.
 */
function renderRow(item, openMenuTabId) {
  const band = confidenceBand(item.confidence);
  const menuOpen = openMenuTabId === item.tabId;
  const options = CATEGORY_ORDER.map(
    (category) => `<option value="${escapeHtml(category)}"${category === item.category ? ' selected' : ''}>${escapeHtml(category)}</option>`,
  ).join('');
  const closeLabel = item.closeSelected ? 'Undo closure selection for' : 'Mark for closure:';

  return `
    <tr data-tab-id="${item.tabId}" data-close-selected="${item.closeSelected}">
      <td class="col-check" data-label="Close">
        <input type="checkbox" class="check" data-action="toggle-close" data-tab-id="${item.tabId}"
          data-focus-key="close-${item.tabId}" ${item.closeSelected ? 'checked' : ''}
          aria-label="${escapeHtml(`${closeLabel} ${item.title}`)}">
      </td>
      <td data-label="Tab">
        <div class="tab-cell">
          <span class="favicon" aria-hidden="true">${escapeHtml(monogram(item.domain))}</span>
          <span class="tab-cell__text">
            <span class="tab-cell__title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</span>
            <span class="tab-cell__reason" title="${escapeHtml(item.explanation || '')}">${escapeHtml(item.explanation || '')}</span>
          </span>
        </div>
      </td>
      <td data-label="Domain"><span class="domain">${escapeHtml(item.domain)}</span></td>
      <td data-label="Category" class="col-category">
        <select class="cat-select ${categoryClass(item.category)}" data-action="change-category" data-tab-id="${item.tabId}"
          data-focus-key="category-${item.tabId}" aria-label="${escapeHtml(`Category for ${item.title}`)}">
          ${options}
        </select>
      </td>
      <td data-label="Confidence" class="col-confidence">
        <span class="confidence confidence--${band}">
          <span class="dot" aria-hidden="true"></span>
          <span>${item.confidence}%</span>
          <span class="confidence__meter" aria-hidden="true"><i style="width:${item.confidence}%"></i></span>
        </span>
      </td>
      <td data-label="Close" class="col-close">
        <button type="button" class="btn btn--ghost btn--sm" data-action="toggle-close" data-tab-id="${item.tabId}"
          data-focus-key="closebtn-${item.tabId}" aria-pressed="${item.closeSelected}"
          aria-label="${escapeHtml(`${closeLabel} ${item.title}`)}">${icon('close', { size: 16 })}</button>
      </td>
      <td class="col-menu">
        <div class="menu">
          <button type="button" class="btn btn--ghost btn--icon btn--sm" data-action="toggle-menu" data-tab-id="${item.tabId}"
            aria-expanded="${menuOpen}" aria-haspopup="true" aria-label="${escapeHtml(`More actions for ${item.title}`)}">
            ${icon('dots', { size: 16 })}
          </button>
          <ul class="menu__list" ${menuOpen ? '' : 'hidden'}>
            <li><button type="button" class="menu__item" data-action="reset-category" data-tab-id="${item.tabId}">
              ${icon('refresh', { size: 15 })}<span>Reset to AI suggestion</span></button></li>
            <li><button type="button" class="menu__item" data-action="keep-open" data-tab-id="${item.tabId}">
              ${icon('check', { size: 15 })}<span>Keep this tab open</span></button></li>
            <li class="menu__note">${escapeHtml(item.explanation || 'No reason recorded.')}</li>
            <li class="menu__note">Saved to the review session only. Your browser changes when you apply.</li>
          </ul>
        </div>
      </td>
    </tr>
  `;
}

/** TabTable body: only the filtered rows are rebuilt, so the search box keeps focus. */
export function renderRows(state) {
  const rows = filterItems(state.scan, { search: state.search, category: state.categoryFilter });
  if (!rows.length) {
    const filterWord = state.categoryFilter ? ` in ${escapeHtml(state.categoryFilter)}` : '';
    const needle = state.search ? `“${escapeHtml(state.search)}”` : 'any filter';
    return `<tr><td colspan="7"><p class="empty-state">No classified tab matches ${needle}${filterWord}.</p></td></tr>`;
  }
  return rows.map((item) => renderRow(item, state.openMenuTabId)).join('');
}

/**
 * Unclassified tabs stay listed rather than being invented into a category, matching
 * the backend rule in docs/API_CONTRACT.md.
 */
export function renderUnclassified(scan) {
  const items = scan.unclassified ?? [];
  if (!items.length) return '';
  return `
    <ul class="dist">
      ${items
        .map(
          (item) => `<li class="dist__row">
        <span class="dist__name"><span class="dist__swatch cat-other" aria-hidden="true"></span>
        <span class="tab-cell__title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</span></span>
        <span class="badge badge--neutral">Not classified</span>
        <span class="muted" style="grid-column:1/-1;font-size:var(--text-xs)">${escapeHtml(item.reason)}</span>
      </li>`,
        )
        .join('')}
    </ul>
  `;
}
