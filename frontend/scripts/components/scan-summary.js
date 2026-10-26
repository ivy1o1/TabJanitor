import { icon } from '../icons.js';
import { deriveMetrics } from '../selectors.js';
import { escapeHtml } from '../dom.js';

/** The model's own report for the last scan — absent until a scan has really run. */
function modelLine(scan) {
  const meta = scan.modelMeta;
  if (!meta) return 'No scan of this window yet. These figures stay at zero until one runs.';
  if (meta.modelCalled !== true) return 'The model was not called — no eligible tab needed classifying.';
  const parts = [`${meta.requests ?? 0} request${meta.requests === 1 ? '' : 's'}`];
  if (meta.serverModel) parts.push(escapeHtml(String(meta.serverModel)));
  if (meta.tokensPerSecond) parts.push(`${Math.round(meta.tokensPerSecond)} tok/s`);
  if (meta.finishReason) parts.push(`finished: ${escapeHtml(String(meta.finishReason))}`);
  if (meta.failedRequests) parts.push(`${meta.failedRequests} failed request(s)`);
  return `Model — ${parts.join(' · ')}`;
}

/**
 * ScanSummary: counts derived from the live SCAN_TABS response, never hardcoded here.
 * The panel stays dark in both themes, with its own token set for contrast.
 */
export function renderScanSummary({ scan, lastScanLabel }) {
  const metrics = deriveMetrics(scan);
  const cells = [
    { key: 'total', label: 'Total Tabs', value: metrics.total, dot: false },
    { key: 'classified', label: 'Classified', value: metrics.classified, dot: true },
    { key: 'unclassified', label: 'Unclassified', value: metrics.unclassified, dot: true },
    { key: 'unsupported', label: 'Unsupported', value: metrics.unsupported, dot: true },
    { key: 'truncated', label: 'Truncated', value: metrics.truncated, dot: true },
  ];
  return `
    <section class="surface scan-summary" aria-labelledby="summary-title">
      <div class="scan-summary__head">
        <h2 class="panel-title" id="summary-title">${icon('inbox', { size: 20 })}<span>Scan Summary</span></h2>
        <span class="scan-summary__time" data-role="last-scan">${escapeHtml(lastScanLabel)}</span>
      </div>
      <div class="metric-grid">
        ${cells
          .map(
            (cell) => `
        <div class="metric metric--${cell.key}">
          <p class="metric__value">${cell.dot ? '<span class="dot" aria-hidden="true"></span>' : ''}<span>${cell.value}</span></p>
          <p class="metric__label">${cell.label}</p>
        </div>`,
          )
          .join('')}
      </div>
      <p class="scan-summary__time" style="margin-top:12px">${modelLine(scan)}</p>
    </section>
  `;
}
