import { icon } from '../icons.js';
import { escapeHtml } from '../dom.js';

/**
 * ScanBanner: the entry point to a real `SCAN_TABS` request.
 *
 * The button is only enabled when the service worker itself reported `canScan`, so a
 * cold endpoint or a missing model config explains itself instead of failing later.
 */
export function renderScanBanner({ scanning, status = {}, hasSession }) {
  const canScan = status.canScan === true;
  const disabled = scanning || !canScan;
  const label = scanning ? 'Scanning…' : 'Scan Window';
  const note = scanning
    ? 'Reading this window and asking the local model to classify it.'
    : canScan
      ? ''
      : escapeHtml(status.message || 'The service worker has not reported a ready model yet.');

  return `
    <section class="surface scan-banner" aria-labelledby="scan-title">
      <div class="scan-banner__text">
        <h2 id="scan-title">Scan your current window</h2>
        <p>Reads your open tabs, classifies them with the local model, and builds a review plan. Nothing changes until you approve it.</p>
        ${note ? `<p class="banner-note${scanning || canScan ? '' : ' banner-note--blocked'}">${icon(canScan || scanning ? 'info' : 'plug', { size: 14 })}<span>${note}</span></p>` : ''}
        ${hasSession ? `<p class="banner-note">${icon('check', { size: 14 })}<span>A review session is open below. Scanning again replaces it.</span></p>` : ''}
      </div>
      <button type="button" class="btn btn--dark" data-action="scan" data-focus-key="scan" ${disabled ? 'disabled' : ''}>
        ${icon('play', { size: 18 })}<span>${label}</span>
      </button>
    </section>
  `;
}
