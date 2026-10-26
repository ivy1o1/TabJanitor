import { icon } from '../icons.js';
import { deriveMetrics } from '../selectors.js';

/**
 * ScanSummary: counts derived from the sample plan, never hardcoded here.
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
        <span class="scan-summary__time" data-role="last-scan">${lastScanLabel}</span>
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
      <p class="scan-summary__time" style="margin-top:12px">Sample figures — not live browser statistics.</p>
    </section>
  `;
}
