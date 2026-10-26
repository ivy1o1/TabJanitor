import { icon, logoMark } from '../icons.js';
import { escapeHtml } from '../dom.js';

/**
 * Sidebar: branding, navigation and the light/dark switch.
 * The decorative grid, sticker and doodles are aria-hidden so they never reach
 * the accessibility tree of the navigation landmark.
 */
export function renderSidebar({ theme }) {
  const options = [
    { value: 'light', label: 'Light theme', glyph: 'sun' },
    { value: 'dark', label: 'Dark theme', glyph: 'moon' },
  ];
  return `
    <div class="brand">
      <span class="brand-mark">${logoMark({ size: 27, label: 'TabJanitor logo' })}</span>
      <div>
        <div class="brand-name">TabJanitor</div>
      </div>
    </div>
    <p class="brand-sub">AI-powered browser tab organization</p>

    <nav class="nav" aria-label="Primary">
      <button type="button" class="nav-item" aria-current="page" data-action="nav-home">
        ${icon('home')}<span>Home</span>
      </button>
    </nav>

    <div class="sidebar-foot">
      <div class="theme-toggle" role="group" aria-label="Colour theme">
        ${options
          .map(
            (option) => `
          <button type="button" class="theme-option" data-action="set-theme" data-theme-value="${option.value}"
            aria-pressed="${theme === option.value}" aria-label="${escapeHtml(option.label)}">
            ${icon(option.glyph, { size: 17 })}
          </button>`,
          )
          .join('<span class="theme-toggle__divider" aria-hidden="true"></span>')}
      </div>
      <span class="sticker" aria-hidden="true">Less clutter, more focus.</span>
      <div class="checker" style="width:64px" aria-hidden="true"></div>
      <div class="doodles" aria-hidden="true">${icon('star', { size: 22 })}${icon('arrow', { size: 22 })}${icon('sparkle', { size: 18 })}</div>
    </div>
  `;
}
