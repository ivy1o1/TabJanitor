import { icon } from '../icons.js';
import { escapeHtml } from '../dom.js';

/**
 * One badge per readiness state. The first four are the values `GET_STATUS` reports;
 * the rest are failures this page saw before the worker could answer, and an unknown
 * reply is shown as unknown rather than rounded up to ready.
 */
const BADGES = {
  ready: { className: 'badge--ok', text: 'Ready' },
  config_missing: { className: 'badge--danger', text: 'No endpoint set' },
  endpoint_unreachable: { className: 'badge--danger', text: 'Endpoint down' },
  model_request_failing: { className: 'badge--warn', text: 'Model failing' },
  checking: { className: 'badge--neutral', text: 'Checking' },
  not_extension: { className: 'badge--neutral', text: 'Not an extension page' },
  worker_unavailable: { className: 'badge--danger', text: 'Worker unreachable' },
  invalid_response: { className: 'badge--danger', text: 'Bad reply' },
  unknown: { className: 'badge--warn', text: 'Unknown state' },
};

/**
 * StatusHeader: the real local-model readiness from `GET_STATUS`, Refresh, and the slogan card.
 *
 * Nothing here is claimed: the badge and the message are exactly what the
 * service worker returned, and a failed check keeps its own error text.
 */
export function renderStatusHeader({ status = {} }) {
  const badge = BADGES[status.status] || BADGES.unknown;
  const canScan = status.canScan === true;
  const gate = canScan
    ? `${icon('check', { size: 14 })}<span>Scanning is available</span>`
    : `${icon('info', { size: 14 })}<span>Scanning is blocked until the model answers</span>`;

  return `
    <section class="surface status-card" aria-labelledby="status-title">
      <span class="status-card__icon" aria-hidden="true">${icon('monitor', { size: 22 })}</span>
      <div class="status-card__text">
        <h2 class="status-card__title" id="status-title">
          Local Model Status
          <span class="badge ${badge.className}"><span class="dot" aria-hidden="true"></span>${badge.text}</span>
        </h2>
        <p class="status-card__meta muted" data-role="status-message">${escapeHtml(status.message || 'No status reported yet.')}</p>
      </div>
      <div class="status-actions">
        <span class="status-gate${canScan ? ' status-gate--ok' : ''}">${gate}</span>
        <button type="button" class="btn" data-action="refresh-status" data-focus-key="refresh-status">
          ${icon('refresh', { size: 18 })}<span>Re-check</span>
        </button>
        <button type="button" class="btn btn--icon" data-action="open-settings" aria-label="Settings"
          title="Settings are not part of this build">${icon('sliders', { size: 18 })}</button>
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
