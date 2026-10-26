import { icon } from '../icons.js';
import { CATEGORY_ICON, cardCategories, categoryClass } from '../selectors.js';
import { escapeHtml } from '../dom.js';

/**
 * Static descriptions of the seven contract categories. `Junk / Review` deliberately
 * says nothing about closing: the backend never infers a closure from a category.
 */
const CATEGORY_BLURBS = {
  Development: 'Docs, code, packages',
  Study: 'Courses, notes, tutorials',
  Research: 'Papers, references, reading',
  Shopping: 'Products, comparisons',
  Entertainment: 'Video, music, feeds',
  Other: 'Real tab, no clear fit',
  'Junk / Review': 'Low signal — never closed for you',
};

/**
 * CategoryCards: folder-shaped cards that double as the category filter.
 * Counts come from the plan, and a card only exists when its category has tabs.
 */
export function renderCategoryCards({ scan, categoryFilter }) {
  const cards = cardCategories(scan);
  return cards
    .map(
      (entry) => `
      <button type="button" class="card ${categoryClass(entry.category)}"
        data-action="filter-category" data-category="${escapeHtml(entry.category)}"
        aria-pressed="${categoryFilter === entry.category}">
        <span class="card__top">
          <span class="card__icon" aria-hidden="true">${icon(CATEGORY_ICON[entry.category] || 'folder', { size: 20 })}</span>
          <span class="card__count">${entry.count}</span>
        </span>
        <span class="card__name">${escapeHtml(entry.category)}</span>
        <span class="card__blurb">${escapeHtml(CATEGORY_BLURBS[entry.category] || '')}</span>
        <span class="visually-hidden">${
          categoryFilter === entry.category ? 'Filtering the list by this category' : 'Filter the list by this category'
        }</span>
      </button>`,
    )
    .join('');
}
