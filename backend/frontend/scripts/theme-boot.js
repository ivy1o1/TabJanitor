/*
 * Runs synchronously before the first paint so the correct theme is already applied
 * when the stylesheet resolves. Classic script (not a module) on purpose: modules are
 * deferred, which would let the wrong theme flash. Kept in sync with THEME_STORAGE_KEY
 * in theme.js; it only reads the mirror, it never writes.
 */
(function () {
  var KEY = 'tabjanitor.theme';
  var stored = null;
  try {
    stored = window.localStorage.getItem(KEY);
  } catch (error) {
    stored = null;
  }
  var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  var theme = stored === 'dark' || stored === 'light' ? stored : prefersDark ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.style.colorScheme = theme;
})();
