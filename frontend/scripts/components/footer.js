import { icon, logoMark } from '../icons.js';

/** DashboardFooter: branding, version placeholder and the motto. */
export function renderFooter({ version }) {
  return `
    <div class="footer__rule" aria-hidden="true"></div>
    <div class="footer__body">
      <p class="footer__brand">${logoMark({ size: 19 })}<span>TabJanitor</span>
        <span class="muted" style="font-family:var(--font-ui);font-size:var(--text-xs)">${version} · Chrome Extension (Manifest V3)</span>
      </p>
      <p class="footer__motto"><span>Organize</span>${icon('arrow', { size: 18 })}<span>Focus</span>${icon('arrow', { size: 18 })}<em>Do More</em></p>
      <span class="footer__deco" aria-hidden="true">
        <span class="checker" style="flex:1"></span>
        ${icon('star', { size: 18 })}
        ${icon('sparkle', { size: 18 })}
      </span>
    </div>
  `;
}
