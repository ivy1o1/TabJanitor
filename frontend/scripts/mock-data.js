/*
 * =====================================================================================
 * FIXTURE DATA ONLY — NOT IMPORTED BY THE DASHBOARD, NOT CONNECTED TO ANY BROWSER API.
 * =====================================================================================
 *
 * Everything in this module is a hand-written sample that was used to design and review
 * the frontend. Nothing here was read from the browser and no tab in this list is real.
 * It is kept for offline visual checks: `dashboard.js` gets its data from
 * `frontend/scripts/source.js`, and no production path imports this file. If this module
 * ever appears in an import graph of the shipped dashboard, that is a bug.
 *
 * The shapes deliberately mirror `docs/API_CONTRACT.md`:
 *   - `buildDemoScanResult()` matches the `SCAN_TABS` `data` payload.
 *   - its `plan.items[]` matches the review-plan item shape field for field.
 */

/** Shown verbatim wherever demo data is on screen. */
export const DEMO_NOTICE = 'Demo data — no browser tabs were read and nothing was changed.';

/** Category descriptions for the folder cards. Presentation copy, not backend data. */
export const CATEGORY_BLURBS = {
  Development: 'Docs, GitHub, APIs',
  Study: 'Lectures, notes, tutorials',
  Research: 'Papers, references',
  Shopping: 'Products, comparisons',
  Entertainment: 'Videos, social feeds',
  Other: 'Everything else',
  'Junk / Review': 'Probably clutter',
};

/**
 * [title, domain, category, confidence, explanation]
 * The category counts below are what the cards, the distribution panel and the
 * summary all derive from — nothing is hardcoded anywhere else.
 */
const SAMPLE_TABS = [
  // Development — 12
  ['React Documentation', 'react.dev', 'Development', 92, 'Official React docs, hooks reference open.'],
  ['GitHub — TabJanitor', 'github.com', 'Development', 88, 'Repository page for this extension.'],
  ['MDN — Window.fetch()', 'developer.mozilla.org', 'Development', 84, 'Reference for the fetch API.'],
  ['Chrome Extension Samples', 'github.com', 'Development', 79, 'MV3 example extensions.'],
  ['Vite Configuration Options', 'vitejs.dev', 'Development', 74, 'Bundler config reference.'],
  ['Stack Overflow — Service worker lifetime', 'stackoverflow.com', 'Development', 71, 'Question about MV3 worker restarts.'],
  ['Tailwind Play', 'tailwindcss.com', 'Development', 66, 'CSS scratchpad left open.'],
  ['npm — @types/chrome', 'npmjs.com', 'Development', 63, 'Package page for Chrome typings.'],
  ['Postman — Local Inference', 'postman.com', 'Development', 58, 'Saved requests for the local endpoint.'],
  ['ESLint — no-unused-vars', 'eslint.org', 'Development', 55, 'Rule documentation.'],
  ['CodePen — Neo Brutalist Cards', 'codepen.io', 'Development', 47, 'Design inspiration pen.'],
  ['DevTools Protocol — CDP domains', 'chromedevtools.github.io', 'Development', 41, 'Protocol reference.'],

  // Study — 9
  ['DSA Sheet', 'takeforward.org', 'Study', 85, 'Practice problem sheet for the semester.'],
  ['Introduction to Algorithms', 'ocw.mit.edu', 'Study', 82, 'MIT OpenCourseWare course page.'],
  ['React Tutorial', 'react.dev', 'Study', 80, 'Step-by-step tutorial, partway through.'],
  ['Anki — Deck: Computer Networks', 'app.ankiweb.net', 'Study', 72, 'Flashcard review queue.'],
  ['Coursera — Machine Learning', 'coursera.org', 'Study', 68, 'Course with an unfinished assignment.'],
  ['Khan Academy — Linear Algebra', 'khanacademy.org', 'Study', 61, 'Lesson videos on matrices.'],
  ['Notion — Semester Planner', 'notion.so', 'Study', 54, 'Study schedule database.'],
  ['GeeksforGeeks — Graph Traversal', 'geeksforgeeks.org', 'Study', 45, 'Article on BFS and DFS.'],
  ['Quizlet — Old Flashcards', 'quizlet.com', 'Study', 33, 'Deck from a completed course.'],

  // Research — 11
  ['Research Paper — Attention Is All You Need', 'arxiv.org', 'Research', 78, 'Transformer paper PDF.'],
  ['Wikipedia — Tab (graph theory)', 'en.wikipedia.org', 'Research', 76, 'Background reading for the term.'],
  ['Google Scholar — local inference', 'scholar.google.com', 'Research', 73, 'Citation search results.'],
  ['Distill — Visualizing MNIST', 'distill.pub', 'Research', 70, 'Interactive article.'],
  ['Semantic Scholar — Gemma 3', 'semanticscholar.org', 'Research', 67, 'Paper aggregator results.'],
  ['PubMed — Sleep and Attention', 'pubmed.ncbi.nlm.nih.gov', 'Research', 62, 'Journal abstract list.'],
  ['arxiv — Quantization Methods', 'arxiv.org', 'Research', 59, 'Reading on GGUF quantisation.'],
  ['Overleaf — Thesis Draft', 'overleaf.com', 'Research', 52, 'LaTeX document being written.'],
  ['Zenodo — Dataset Record', 'zenodo.org', 'Research', 44, 'Hosted dataset landing page.'],
  ['Crossref — DOI Lookup', 'search.crossref.org', 'Research', 38, 'Metadata search.'],
  ['JSTOR — Archived Journals', 'jstor.org', 'Research', 29, 'Paywalled archive, session expired.'],

  // Shopping — 5
  ['Laptop Deals', 'amazon.in', 'Shopping', 70, 'Filtered laptop listings with a cart open.'],
  ['Mechanical Keyboard — Q1 Pro', 'keychron.com', 'Shopping', 64, 'Product page under comparison.'],
  ['SSD 1TB Price Comparison', 'flipkart.com', 'Shopping', 57, 'Comparison results.'],
  ['Cart (2 items)', 'bestbuy.com', 'Shopping', 48, 'Items left in a cart.'],
  ['Standing Desk', 'ikea.com', 'Shopping', 31, 'Furniture product page.'],

  // Entertainment — 6
  ['Chill Playlist — YouTube', 'youtube.com', 'Entertainment', 88, 'Music playlist left playing.'],
  ['Lo-fi Radio', 'youtube.com', 'Entertainment', 83, '24/7 stream.'],
  ['IMDb — Top 250', 'imdb.com', 'Entertainment', 69, 'Film rankings.'],
  ['Twitch — Live Streams', 'twitch.tv', 'Entertainment', 55, 'Browse page.'],
  ['Spotify — Discover Weekly', 'open.spotify.com', 'Entertainment', 50, 'Web player session.'],
  ['Reddit — r/movies', 'reddit.com', 'Entertainment', 36, 'Thread browsing.'],

  // Junk / Review — 5
  ['Random Forum', 'reddit.com', 'Junk / Review', 34, 'Unclear purpose, opened from a link.'],
  ['Coupon Codes 2026', 'couponsite.example', 'Junk / Review', 27, 'Low-value deal page.'],
  ['Extend Your Car Warranty', 'offers.example', 'Junk / Review', 22, 'Advertising landing page.'],
  ['Free Cloud Storage Trial', 'trials.example', 'Junk / Review', 18, 'Trial signup page.'],
  ['Cookie Consent Test', 'example.com', 'Junk / Review', 12, 'Left open from an earlier test.'],
];

const SAMPLE_UNCLASSIFIED = [
  { title: 'Untitled Dashboard', domain: 'localhost:3000', reason: 'The model returned no usable classification for this tab.' },
  { title: 'New Tab', domain: 'start.example', reason: 'The model response could not be parsed as JSON.' },
];

const SAMPLE_UNSUPPORTED = [
  { reason: 'unsupported scheme' },
  { reason: 'unsupported scheme' },
  { reason: 'unsupported scheme' },
  { reason: 'unsupported scheme' },
  { reason: 'unsupported scheme' },
];

/** How many sample tabs the demo pretends were beyond the per-request cap. */
const SAMPLE_TRUNCATED_COUNT = 3;

const FIRST_TAB_ID = 41;

function slugToUrl(domain) {
  return `https://${domain}/`;
}

function buildItems() {
  return SAMPLE_TABS.map(([title, domain, category, confidence, explanation], index) => ({
    tabId: FIRST_TAB_ID + index,
    ref: index + 1,
    title,
    domain,
    url: slugToUrl(domain),
    category,
    originalCategory: category,
    explanation,
    confidence,
    closeSelected: false,
    userEdited: false,
  }));
}

function buildCounts(items) {
  const counts = {
    Development: 0,
    Study: 0,
    Research: 0,
    Shopping: 0,
    Entertainment: 0,
    Other: 0,
    'Junk / Review': 0,
  };
  for (const item of items) counts[item.category] += 1;
  return counts;
}

/**
 * Mirrors the `SCAN_TABS` `data` payload, including the nested review plan, so the
 * real response can be handed to the same renderers in phase 2.
 */
export function buildDemoScanResult() {
  const items = buildItems();
  const counts = buildCounts(items);
  const base = FIRST_TAB_ID + items.length;
  return {
    sessionId: 'demo-session-not-a-real-scan',
    windowId: null,
    scannedCount: items.length + SAMPLE_UNCLASSIFIED.length + SAMPLE_UNSUPPORTED.length + SAMPLE_TRUNCATED_COUNT,
    eligibleCount: items.length + SAMPLE_UNCLASSIFIED.length,
    classifiedCount: items.length,
    skippedUnsupported: SAMPLE_UNSUPPORTED.map((entry, index) => ({ tabId: base + 100 + index, reason: entry.reason })),
    truncated: Array.from({ length: SAMPLE_TRUNCATED_COUNT }, (_, index) => base + 200 + index),
    modelMeta: {
      modelCalled: false,
      requests: 0,
      serverModel: null,
      tokensPerSecond: null,
      finishReason: null,
      failedRequests: [],
    },
    plan: {
      sessionId: 'demo-session-not-a-real-scan',
      windowId: null,
      items,
      counts,
      summary: {
        sessionId: 'demo-session-not-a-real-scan',
        counts,
        total: items.length,
        closureCount: 0,
        editedCount: 0,
      },
      skippedUnsupported: [],
      unclassified: SAMPLE_UNCLASSIFIED.map((entry, index) => ({
        tabId: base + index,
        ref: items.length + index + 1,
        title: entry.title,
        domain: entry.domain,
        reason: entry.reason,
      })),
    },
    unclassified: SAMPLE_UNCLASSIFIED.map((entry, index) => ({
      tabId: base + index,
      ref: items.length + index + 1,
      title: entry.title,
      domain: entry.domain,
      reason: entry.reason,
    })),
    rejected: [],
  };
}

/**
 * Mirrors the `GET_STATUS` `data` payload. `status` is deliberately NOT one of the
 * backend readiness values: the frontend has not asked anything yet, so it reports a
 * distinct `demo` state instead of implying a live check happened.
 */
export const DEMO_STATUS = {
  status: 'demo',
  canScan: false,
  endpoint: 'not connected',
  model: 'Gemma 3 1B · llama-server · 127.0.0.1:8080',
  message: 'Frontend demo mode. No readiness check has been performed.',
  probe: null,
};
