/*
 * DOM helpers shared by the render functions.
 *
 * escapeHtml matters beyond this phase: tab titles and domains come from the browser
 * and model output, so they are untrusted text and must never be interpolated raw into
 * markup. Keep every render path going through it.
 */

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeAttr(value) {
  return escapeHtml(value);
}

/** Two-letter monogram used instead of a network favicon request. */
export function monogram(domain) {
  const host = String(domain || '').replace(/^www\./, '');
  const letter = host.charAt(0) || '?';
  const second = host.charAt(host.indexOf('.') + 1) || '';
  return (letter + second).toUpperCase();
}

/**
 * Runs `mutate` while keeping keyboard focus on the same control if it is inside
 * `root`, so rebuilding a list does not throw the user back to the top of the page.
 */
export function preservingFocus(root, mutate) {
  const active = document.activeElement;
  const token = active?.dataset?.focusKey;
  mutate();
  if (!token || !root.contains(document.activeElement) || document.activeElement === document.body) {
    const replacement = root.querySelector(`[data-focus-key="${CSS.escape(token)}"]`);
    if (replacement) {
      replacement.focus();
      if (replacement.select && active?.selectionStart != null) {
        try {
          replacement.setSelectionRange(active.selectionStart, active.selectionEnd);
        } catch {
          // Not a text field.
        }
      }
    }
  }
}

export function on(root, type, selector, handler) {
  root.addEventListener(type, (event) => {
    const target = event.target.closest(selector);
    if (target && root.contains(target)) handler(event, target);
  });
}
