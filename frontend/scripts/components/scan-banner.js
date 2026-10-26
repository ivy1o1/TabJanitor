import { icon } from '../icons.js';

/**
 * ScanBanner: the primary call to action.
 * `scanning` is a local demo flag only — it never means a browser scan is running.
 */
export function renderScanBanner({ scanning }) {
  return `
    <section class="surface scan-banner" aria-labelledby="scan-title">
      <div class="scan-banner__text">
        <h2 id="scan-title">Scan your current window</h2>
        <p>We&rsquo;ll analyze your tabs and suggest how to organize them.</p>
        <p class="demo-flag" style="margin-top:6px">${icon('info', { size: 14 })}<span>Demo only: this loads sample data, it never reads your browser.</span></p>
      </div>
      <button type="button" class="btn btn--dark" data-action="scan" data-focus-key="scan" ${scanning ? 'disabled' : ''}>
        ${icon('play', { size: 18 })}<span>${scanning ? 'Loading sample data…' : 'Scan Window'}</span>
      </button>
    </section>
  `;
}
