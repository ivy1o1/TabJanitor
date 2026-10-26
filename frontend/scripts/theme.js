/*
 * Theme state, isolated behind one controller so phase 2 can keep using it unchanged.
 *
 * Persistence order:
 *   1. `chrome.storage.local` when the page runs as an extension page — the durable,
 *      extension-compatible store the backend also uses.
 *   2. `localStorage` when the page is served standalone during development.
 * A synchronous `localStorage` mirror is always written as well, because the boot
 * script in dashboard.html has to know the choice before the first paint.
 */

export const THEME_STORAGE_KEY = 'tabjanitor.theme';

function hasChromeStorage() {
  return Boolean(globalThis.chrome?.storage?.local?.get && globalThis.chrome?.storage?.local?.set);
}

function readMirror() {
  try {
    return globalThis.localStorage?.getItem(THEME_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

function writeMirror(value) {
  try {
    globalThis.localStorage?.setItem(THEME_STORAGE_KEY, value);
  } catch {
    // Private mode or disabled storage: the theme still works for this visit.
  }
}

export async function loadThemePreference() {
  if (hasChromeStorage()) {
    try {
      const result = await chrome.storage.local.get(THEME_STORAGE_KEY);
      const stored = result?.[THEME_STORAGE_KEY];
      if (stored === 'light' || stored === 'dark') return stored;
    } catch {
      // Fall through to the mirror.
    }
  }
  const mirrored = readMirror();
  return mirrored === 'light' || mirrored === 'dark' ? mirrored : null;
}

export async function saveThemePreference(theme) {
  writeMirror(theme);
  if (hasChromeStorage()) {
    try {
      await chrome.storage.local.set({ [THEME_STORAGE_KEY]: theme });
    } catch {
      // The mirror already holds the choice.
    }
  }
}

export function systemTheme() {
  return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? 'dark' : 'light');
  return theme;
}

/**
 * @returns {{ theme: () => string, preference: () => string|null, set: (t: 'light'|'dark') => void, toggle: () => void, onChange: (fn) => () => void }}
 */
export function createThemeController() {
  let preference = null;
  let theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  const listeners = new Set();

  function commit(nextPreference, persist) {
    preference = nextPreference;
    theme = nextPreference === 'system' || nextPreference === null ? systemTheme() : nextPreference;
    applyTheme(theme);
    if (persist) saveThemePreference(theme);
    for (const listener of listeners) listener(theme);
  }

  loadThemePreference().then((stored) => {
    // Only adopt a stored choice when it differs from what the boot script painted.
    if ((stored === 'light' || stored === 'dark') && stored !== theme) commit(stored, false);
    else preference = stored;
  });

  globalThis.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (preference !== 'light' && preference !== 'dark') commit('system', false);
  });

  return {
    theme: () => theme,
    preference: () => preference,
    set: (next) => commit(next, true),
    toggle: () => commit(theme === 'dark' ? 'light' : 'dark', true),
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
