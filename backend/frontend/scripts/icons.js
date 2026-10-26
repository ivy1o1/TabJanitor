/*
 * Inline SVG icon set. Stroke-based 24x24 glyphs that inherit `currentColor`, so they
 * follow the active theme without a second asset. Emoji are not used as interface icons.
 */

const PATHS = {
  home: '<path d="M3 10.6 12 3l9 7.6V20a1 1 0 0 1-1 1h-5.5v-6.5h-5V21H4a1 1 0 0 1-1-1z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  monitor: '<rect x="2.5" y="3.5" width="19" height="13" rx="2"/><path d="M8.5 20.5h7M12 16.5v4"/>',
  refresh: '<path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1"/><path d="M20.5 4v5h-5"/>',
  sliders: '<path d="M5 21v-7M5 10V3M12 21v-4M12 13V3M19 21v-9M19 8V3"/><path d="M2.5 14h5M9.5 17h5M16.5 12h5"/>',
  sparkle: '<path d="M12 2.5 14.4 9l6.6 2.4L14.4 14 12 21l-2.4-7L3 11.4 9.6 9z"/><path d="M19 3.5v3M17.5 5h3"/>',
  play: '<path d="M7 4.5 19.5 12 7 19.5z"/>',
  inbox: '<path d="M21.5 12.5h-5l-1.7 2.6H9.2L7.5 12.5h-5"/><path d="M5.5 4.5h13l3 8v6.5a1 1 0 0 1-1 1h-17a1 1 0 0 1-1-1V12.5z"/>',
  code: '<path d="M15.5 7.5 20.5 12l-5 4.5M8.5 7.5 3.5 12l5 4.5M13.5 4.5l-3 15"/>',
  graduation: '<path d="M21.5 9.5 12 5 2.5 9.5 12 14z"/><path d="M6.5 11.6V17c0 1.4 2.5 2.9 5.5 2.9s5.5-1.5 5.5-2.9v-5.4"/><path d="M21.5 9.5V15"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M16.2 16.2 21 21"/>',
  bag: '<path d="M5 7.5h14l1.5 12a1 1 0 0 1-1 1.2h-15a1 1 0 0 1-1-1.2z"/><path d="M8.5 7.5a3.5 3.5 0 0 1 7 0"/>',
  film: '<rect x="2.5" y="4.5" width="19" height="15" rx="2"/><path d="M7.5 4.5v15M16.5 4.5v15M2.5 12h19"/>',
  folder: '<path d="M3 6.5a2 2 0 0 1 2-2h4l2 2.2h8a2 2 0 0 1 2 2v9.3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  trash: '<path d="M4 6.5h16M9.5 6.5V4h5v2.5M6.5 6.5 7.6 20a1 1 0 0 0 1 .9h6.8a1 1 0 0 0 1-.9L17.5 6.5"/><path d="M10.5 10.5v6.5M13.5 10.5v6.5"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.3l2.8 2.9L16.2 9.5"/>',
  chart: '<path d="M4 20V11M10 20V4M16 20v-6M22 20H2"/>',
  chevron: '<path d="M6 9.5 12 15.5 18 9.5"/>',
  dots: '<circle cx="12" cy="5.5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="18.5" r="1.6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  arrow: '<path d="M4 12h15M13.5 6.5 20 12l-6.5 5.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.9"/>',
  plug: '<path d="M9 3.5V8M15 3.5V8M6.5 8h11v3.5a5.5 5.5 0 0 1-11 0z"/><path d="M12 17v4"/>',
  star: '<path d="M12 3.8l2.4 5.1 5.6.7-4.1 3.9 1.1 5.6L12 16.4l-5 2.7 1.1-5.6L4 9.6l5.6-.7z"/>',
};

/**
 * @param {keyof typeof PATHS} name
 * @param {{size?: number, label?: string}} [options] pass `label` for a meaningful
 * icon; without it the SVG is hidden from assistive tech as a decorative element.
 */
export function icon(name, options = {}) {
  const body = PATHS[name];
  if (!body) return '';
  const size = options.size || 20;
  const aria = options.label ? ` role="img" aria-label="${options.label}"` : ' aria-hidden="true" focusable="false"';
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"${aria}>${body}</svg>`;
}

export const ICON_NAMES = Object.keys(PATHS);

/*
 * Brand mark, traced from assets/tabjanitor-logo-source.jpg. Unlike the interface
 * glyphs above it is a filled silhouette, so it keeps the reference's weight at
 * small sizes; `fill-rule: evenodd` renders the dust dots and the slit between the
 * ferrule and the bristles as the source image does.
 */
const LOGO_PATH =
  'M9.46 9.87 L9.95 9.93 L19.58 16.45 L19.86 16.84 L18.75 18.39 L17.03 20.1 L15.37 21.1 L14.6 21.32 ' +
  'L12.28 21.32 L11.06 20.99 L10.56 20.6 L12.06 20.1 L12.61 19.66 L11.61 19.88 L9.51 19.88 L8.63 19.66 ' +
  'L7.46 18.94 L7.52 18.78 L8.85 18.44 L10.62 17.67 L11.28 17.23 L11.78 16.73 L11.72 16.56 L11.06 17.12 ' +
  'L8.85 18 L6.86 18 L5.42 17.34 L5.03 16.95 L5.09 16.79 L5.97 16.79 L7.46 16.4 L6.08 16.34 L4.53 16.01 ' +
  'L4.09 15.79 L2.82 14.52 L1.82 12.41 L1.6 10.31 L1.99 10.26 L2.98 10.7 L5.31 11.14 L7.08 10.92 L9.4 9.93Z' +
  'M21.07 2.68 L21.79 2.73 L22.29 3.23 L22.4 3.9 L18.42 9.98 L18.58 10.37 L20.8 11.81 L21.4 12.64 L21.4 13.41 ' +
  'L21.07 14.41 L20.3 15.84 L20.02 16.12 L10.29 9.59 L10.23 9.32 L13.16 6.83 L13.71 6.83 L16.15 8.6 L20.41 3.12 ' +
  'L21.02 2.73Z' +
  'M5.91 7.21 L6.74 7.16 L7.24 7.66 L7.13 8.65 L6.63 9.04 L6.08 9.04 L5.58 8.76 L5.36 7.88 L5.47 7.55 L5.86 7.27Z' +
  'M3.7 4.67 L4.42 4.73 L4.7 5.11 L4.7 5.67 L4.31 6.05 L3.43 5.94 L3.15 5.33 L3.26 5 L3.65 4.73Z';

/**
 * @param {{size?: number, label?: string}} [options]
 */
export function logoMark(options = {}) {
  const size = options.size || 24;
  const aria = options.label
    ? ` role="img" aria-label="${options.label}"`
    : ' aria-hidden="true" focusable="false"';
  return (
    `<svg class="logo-mark" width="${size}" height="${size}" viewBox="0 0 24 24" ` +
    `fill="currentColor" fill-rule="evenodd" xmlns="http://www.w3.org/2000/svg"${aria}>` +
    `<path d="${LOGO_PATH}"/></svg>`
  );
}
