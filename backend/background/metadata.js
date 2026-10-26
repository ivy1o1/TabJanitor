import { LIMITS } from '../shared/constants.js';
import { clampString } from '../shared/schemas.js';

const UNSUPPORTED_SCHEMES = [
  'chrome:', 'chrome-extension:', 'edge:', 'brave:', 'vivaldi:', 'opera:',
  'about:', 'devtools:', 'view-source:', 'file:',
];

export function isUnsupportedScheme(url) {
  if (typeof url !== 'string' || url.length === 0) return true;
  const lower = url.toLowerCase();
  if (UNSUPPORTED_SCHEMES.some((scheme) => lower.startsWith(scheme))) return true;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return true;
  }
  return parsed.protocol !== 'http:' && parsed.protocol !== 'https:';
}

export function sanitizeUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) return '';
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return '';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
  parsed.username = '';
  parsed.password = '';
  parsed.search = '';
  parsed.hash = '';
  return clampString(parsed.toString(), LIMITS.URL_MAX);
}

export function getDomain(rawUrl) {
  const sanitized = sanitizeUrl(rawUrl);
  if (!sanitized) return '';
  try {
    return clampString(new URL(sanitized).hostname, LIMITS.DOMAIN_MAX);
  } catch {
    return '';
  }
}

// Builds the only metadata allowed to reach the inference endpoint:
// a local ref, a clamped title, and a query/fragment-free URL.
export function buildTabMetadata(tab, ref) {
  const eligible = tab.status !== 'unreadable' && !isUnsupportedScheme(tab.url);
  if (!eligible) return { eligible: false, reason: 'unsupported scheme' };
  return {
    eligible: true,
    ref,
    title: clampString(tab.title || '', LIMITS.TITLE_MAX),
    url: sanitizeUrl(tab.url),
    domain: getDomain(tab.url),
  };
}
