import { appError } from '../shared/schemas.js';
import { DEFAULT_INFERENCE_ENDPOINT, ERROR_CODES, LIMITS } from '../shared/constants.js';

export const CONFIG_STORAGE_KEY = 'tabjanitor.config';

// Must stay in sync with manifest.json host_permissions, which are loopback-only.
// A non-loopback endpoint could not be reached by the service worker anyway, and the
// agreed architecture is local-only Gemma inference with no cloud fallback.
const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost'];

export function validateEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length === 0) {
    throw appError(ERROR_CODES.CONFIG_MISSING, 'No inference endpoint is configured.');
  }
  let parsed;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw appError(ERROR_CODES.CONFIG_MISSING, 'The configured inference endpoint is not a valid URL.', { endpoint });
  }
  if (parsed.protocol !== 'http:') {
    throw appError(ERROR_CODES.CONFIG_MISSING, 'The inference endpoint must use http on a loopback address.', { endpoint });
  }
  if (parsed.username || parsed.password) {
    throw appError(ERROR_CODES.CONFIG_MISSING, 'The inference endpoint must not embed credentials.');
  }
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    throw appError(ERROR_CODES.CONFIG_MISSING, 'The inference endpoint must be a base URL without a path.', { endpoint });
  }
  if (!LOOPBACK_HOSTS.includes(parsed.hostname)) {
    throw appError(ERROR_CODES.CONFIG_MISSING, 'TabJanitor only supports a local model: the inference endpoint must be 127.0.0.1 or localhost.', {
      hostname: parsed.hostname,
      allowedHosts: LOOPBACK_HOSTS,
    });
  }
  return parsed.origin;
}

// Configuration is read from the extension's own storage (chrome.storage.local),
// so the endpoint and model identifier can change without touching code.
// When nothing is configured, the verified local llama-server defaults apply.
export async function readConfig({ chromeRef } = {}) {
  let stored = {};
  if (chromeRef?.storage?.local) {
    const result = await chromeRef.storage.local.get(CONFIG_STORAGE_KEY);
    stored = result?.[CONFIG_STORAGE_KEY] || {};
  }
  const endpoint = validateEndpoint(stored.inferenceEndpoint || DEFAULT_INFERENCE_ENDPOINT);
  return {
    endpoint,
    model: typeof stored.inferenceModel === 'string' && stored.inferenceModel.length > 0
      ? stored.inferenceModel
      : 'gemma-3-1b-it',
    timeoutMs: Number.isFinite(stored.requestTimeoutMs) && stored.requestTimeoutMs > 0
      ? stored.requestTimeoutMs
      : LIMITS.DEFAULT_REQUEST_TIMEOUT_MS,
    configured: Boolean(stored.inferenceEndpoint),
    source: stored.inferenceEndpoint ? 'storage' : 'default',
  };
}

async function fetchWithTimeout(url, init, timeoutMs, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw appError(ERROR_CODES.INFERENCE_TIMEOUT, `The inference request exceeded the ${timeoutMs}ms timeout.`, { url });
    }
    throw appError(ERROR_CODES.MODEL_UNAVAILABLE, 'The inference endpoint could not be reached.', {
      url,
      cause: String(error?.message || error),
    });
  } finally {
    clearTimeout(timer);
  }
}

export function buildChatRequest({ model, messages, maxTokens, temperature = 0 }) {
  return {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: false,
  };
}

function extractContent(payload) {
  const choice = Array.isArray(payload?.choices) ? payload.choices[0] : undefined;
  const content = choice?.message?.content ?? choice?.text;
  if (typeof content !== 'string' || content.length === 0) {
    throw appError(ERROR_CODES.INVALID_MODEL_OUTPUT, 'The model response did not contain message content.', {
      keys: Object.keys(payload || {}),
    });
  }
  return { content, finishReason: typeof choice.finish_reason === 'string' ? choice.finish_reason : null };
}

// Readiness check only: no browser tab metadata is sent.
export async function checkReadiness({ chromeRef, fetchImpl = globalThis.fetch, config } = {}) {
  const resolved = config || await readConfig({ chromeRef });
  const endpoint = validateEndpoint(resolved.endpoint);
  const health = await fetchWithTimeout(`${endpoint}/health`, { method: 'GET' }, LIMITS.HEALTH_TIMEOUT_MS, fetchImpl);
  if (!health.ok) {
    throw appError(ERROR_CODES.MODEL_UNAVAILABLE, `The inference endpoint returned HTTP ${health.status} for its readiness check.`, {
      status: health.status,
    });
  }
  let healthPayload;
  try {
    healthPayload = await health.json();
  } catch {
    throw appError(ERROR_CODES.MODEL_UNAVAILABLE, 'The inference readiness response was not valid JSON.');
  }
  if (!healthPayload || typeof healthPayload !== 'object') {
    throw appError(ERROR_CODES.MODEL_UNAVAILABLE, 'The inference readiness response had an unexpected shape.');
  }
  return { endpoint: resolved.endpoint, model: resolved.model, health: healthPayload };
}

export async function chatCompletion({ messages, maxTokens, config, chromeRef, fetchImpl = globalThis.fetch, timeoutMs }) {
  if (typeof fetchImpl !== 'function') {
    throw appError(ERROR_CODES.MODEL_UNAVAILABLE, 'No fetch implementation is available in this runtime.');
  }
  const resolved = config || await readConfig({ chromeRef });
  const endpoint = validateEndpoint(resolved.endpoint);
  const response = await fetchWithTimeout(
    `${endpoint}/v1/chat/completions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildChatRequest({
        model: resolved.model,
        messages,
        maxTokens,
      })),
    },
    timeoutMs || resolved.timeoutMs,
    fetchImpl,
  );
  if (!response.ok) {
    throw appError(ERROR_CODES.MODEL_UNAVAILABLE, `The inference endpoint rejected the request with HTTP ${response.status}.`, {
      status: response.status,
    });
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw appError(ERROR_CODES.INVALID_MODEL_OUTPUT, 'The inference response was not valid JSON.');
  }
  const { content, finishReason } = extractContent(payload);
  const classification = { finishReason };
  if (typeof payload.model === 'string') {
    const parts = payload.model.split(/[\\/]/);
    classification.serverModel = parts[parts.length - 1] || payload.model;
  }
  if (payload.timings && typeof payload.timings.predicted_per_second === 'number') {
    classification.tokensPerSecond = Math.round(payload.timings.predicted_per_second);
  }
  return { content, raw: payload, ...classification };
}
