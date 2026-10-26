import { icon, logoMark } from '../icons.js';

/**
 * Sidebar: branding, navigation and the light/dark switch.
 * The decorative grid, checker and doodles are aria-hidden so they never reach
 * the accessibility tree of the navigation landmark.
 */
export function renderSidebar({ theme }) {
  const dark = theme === 'dark';
  const caption = dark ? 'Dark Mode' : 'Light Mode';
  const next = dark ? 'light' : 'dark';
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
      <div class="sidebar-foot__deco" aria-hidden="true">
        <div class="checker" style="width:64px"></div>
        <div class="doodles">${icon('star', { size: 22 })}${icon('arrow', { size: 22 })}${icon('sparkle', { size: 18 })}</div>
      </div>
      <button type="button" class="theme-switch" data-mode="${theme}" data-action="set-theme"
        data-focus-key="theme" data-theme-value="${next}">
        <span class="theme-switch__track" aria-hidden="true">
          <span class="theme-switch__knob">${icon(dark ? 'moon-stars' : 'sun', { size: 15 })}</span>
        </span>
        <span class="theme-switch__caption">${caption}<span class="visually-hidden"> — switch to ${next} mode</span></span>
      </button>
    </div>
  `;
}
