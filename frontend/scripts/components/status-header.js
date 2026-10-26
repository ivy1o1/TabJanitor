import { icon } from '../icons.js';
import { escapeHtml } from '../dom.js';

const BADGES = {
  demo: { className: 'badge--warn', text: 'Demo Mode' },
  ready: { className: 'badge--ok', text: 'Ready' },
  config_missing: { className: 'badge--danger', text: 'No Endpoint' },
  endpoint_unreachable: { className: 'badge--danger', text: 'Unreachable' },
  model_request_failing: { className: 'badge--warn', text: 'Failing' },
  checking: { className: 'badge--neutral', text: 'Checking' },
};

/**
 * StatusHeader: model status, Refresh action and the slogan card.
 *
 * `status.status` is `demo` until phase 2 wires GET_STATUS, so the badge reads
 * "Demo Mode" and never claims the model is connected or ready.
 */
export function renderStatusHeader({ status }) {
  const badge = BADGES[status.status] || BADGES.demo;
  return `
    <section class="surface status-card" aria-labelledby="status-title">
      <span class="status-card__icon" aria-hidden="true">${icon('monitor', { size: 22 })}</span>
      <div class="status-card__text">
        <h2 class="status-card__title" id="status-title">
          Local Model Status
          <span class="badge ${badge.className}"><span class="dot" aria-hidden="true"></span>${badge.text}</span>
        </h2>
        <p class="status-card__meta">${escapeHtml(status.model)} · <span data-role="endpoint">${escapeHtml(status.endpoint)}</span></p>
        <p class="status-card__meta muted" data-role="status-message">${escapeHtml(status.message)}</p>
      </div>
      <div class="status-actions">
        <span class="demo-flag">${icon('info', { size: 15 })}<span>Not connected</span></span>
        <button type="button" class="btn" data-action="refresh-status" data-focus-key="refresh-status">
          ${icon('refresh', { size: 18 })}<span>Refresh</span>
        </button>
        <button type="button" class="btn btn--icon" data-action="open-settings" aria-label="Settings (placeholder, not wired)"
          title="Settings are not part of this phase">${icon('sliders', { size: 18 })}</button>
      </div>
    </section>
    <aside class="slogan" aria-label="TabJanitor tagline">
      <span class="slogan__pattern" aria-hidden="true"></span>
      <span class="slogan__field" aria-hidden="true">
        ${icon('sparkle', { size: 13 })}${icon('star', { size: 11 })}${icon('star', { size: 12 })}
        ${icon('sparkle', { size: 10 })}
      </span>
      <span class="slogan__text">Clutter Free, Mind Clear</span>
    </aside>
  `;
}
