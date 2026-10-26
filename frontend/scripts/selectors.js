/*
 * Derived data. Every number shown in the UI is computed here from the plan, so the
 * cards, the table, the distribution panel and the summary can never disagree — and so
 * phase 2 can point the same selectors at a real SCAN_TABS response.
 */

export const CATEGORY_ORDER = [
  'Development',
  'Study',
  'Research',
  'Shopping',
  'Entertainment',
  'Other',
  'Junk / Review',
];

export const CATEGORY_CLASS = {
  Development: 'cat-development',
  Study: 'cat-study',
  Research: 'cat-research',
  Shopping: 'cat-shopping',
  Entertainment: 'cat-entertainment',
  Other: 'cat-other',
  'Junk / Review': 'cat-junk',
};

export const CATEGORY_ICON = {
  Development: 'code',
  Study: 'graduation',
  Research: 'search',
  Shopping: 'bag',
  Entertainment: 'film',
  Other: 'folder',
  'Junk / Review': 'trash',
};

export function categoryClass(category) {
  return CATEGORY_CLASS[category] || 'cat-other';
}

export function planItems(scan) {
  return scan?.plan?.items ?? [];
}

/** Recomputes counts and summary from items, mirroring how the backend does it. */
export function recomputePlan(scan) {
  const items = planItems(scan);
  const counts = Object.fromEntries(CATEGORY_ORDER.map((category) => [category, 0]));
  let closureCount = 0;
  let editedCount = 0;
  for (const item of items) {
    if (counts[item.category] !== undefined) counts[item.category] += 1;
    if (item.closeSelected) closureCount += 1;
    if (item.userEdited) editedCount += 1;
  }
  scan.plan.counts = counts;
  scan.plan.summary = { ...scan.plan.summary, counts, total: items.length, closureCount, editedCount };
  return scan;
}

export function deriveMetrics(scan) {
  const items = planItems(scan);
  return {
    total: scan.scannedCount ?? items.length,
    classified: items.length,
    unclassified: scan.unclassified?.length ?? 0,
    unsupported: scan.skippedUnsupported?.length ?? 0,
    truncated: scan.truncated?.length ?? 0,
    eligible: scan.eligibleCount ?? items.length,
  };
}

export function distribution(scan) {
  const counts = scan.plan.counts || {};
  const max = Math.max(1, ...CATEGORY_ORDER.map((category) => counts[category] || 0));
  return CATEGORY_ORDER.map((category) => ({
    category,
    count: counts[category] || 0,
    width: Math.round(((counts[category] || 0) / max) * 100),
  }));
}

export function cardCategories(scan) {
  const counts = scan.plan.counts || {};
  return CATEGORY_ORDER.filter((category) => (counts[category] || 0) > 0).map((category) => ({
    category,
    count: counts[category],
  }));
}

export function filterItems(scan, { search, category }) {
  const needle = search.trim().toLowerCase();
  return planItems(scan).filter((item) => {
    if (category && item.category !== category) return false;
    if (!needle) return true;
    return (
      item.title.toLowerCase().includes(needle) ||
      item.domain.toLowerCase().includes(needle) ||
      item.category.toLowerCase().includes(needle)
    );
  });
}

export function selectedItems(scan) {
  return planItems(scan).filter((item) => item.closeSelected);
}

export function findItem(scan, tabId) {
  return planItems(scan).find((item) => item.tabId === tabId);
}

export function confidenceBand(value) {
  if (value >= 75) return 'high';
  if (value >= 50) return 'medium';
  return 'low';
}
