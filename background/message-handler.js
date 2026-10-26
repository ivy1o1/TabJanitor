import { MESSAGE_TYPES, ERROR_CODES, STATUS_VALUES, LIMITS } from '../shared/constants.js';
import { appError, boundedInt, err, ok, isPlainObject } from '../shared/schemas.js';
import { captureWindowSnapshot, buildPromptTabs, truncatedRefs } from './tab-scanner.js';
import { classifyTabs } from './classifier.js';
import { applyPlanEdits, buildReviewPlan, summary } from './review-plan.js';
import { applyOrganization } from './organizer.js';
import { checkReadiness, readConfig } from './ai-client.js';

// Only this session's plan is addressable, so a stale request cannot apply an old plan.
export function createState() {
  return { current: null };
}

function requireSession(state, sessionId) {
  if (!state.current) {
    throw appError(ERROR_CODES.INVALID_REQUEST, 'No scan has been run yet.');
  }
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw appError(ERROR_CODES.INVALID_REQUEST, 'A sessionId is required for this request.');
  }
  if (sessionId !== state.current.sessionId) {
    throw appError(ERROR_CODES.STALE_TABS, 'The sessionId does not match the current scan.', {
      expected: state.current.sessionId,
    });
  }
  return state.current;
}

async function handleScan({ payload, state, chromeRef, config, fetchImpl }) {
  const maxTabs = boundedInt(payload.maxTabsPerRequest, {
    name: 'maxTabsPerRequest',
    min: 1,
    max: LIMITS.MAX_TABS_PER_REQUEST,
    fallback: LIMITS.DEFAULT_MAX_TABS_PER_REQUEST,
  });
  const timeoutMs = boundedInt(payload.timeoutMs, {
    name: 'timeoutMs',
    min: LIMITS.MIN_REQUEST_TIMEOUT_MS,
    max: LIMITS.MAX_REQUEST_TIMEOUT_MS,
    fallback: undefined,
  });
  const snapshot = await captureWindowSnapshot({ chromeRef });
  const promptTabs = buildPromptTabs(snapshot, maxTabs);
  const result = await classifyTabs({
    promptTabs,
    config,
    chromeRef,
    fetchImpl,
    timeoutMs,
  });
  const plan = buildReviewPlan(snapshot, result);
  const stateEntry = {
    sessionId: snapshot.sessionId,
    windowId: snapshot.windowId,
    snapshot,
    plan,
  };
  state.current = stateEntry;
  return {
    data: {
      sessionId: snapshot.sessionId,
      windowId: snapshot.windowId,
      scannedCount: snapshot.tabs.length,
      classifiedCount: plan.items.length,
      eligibleCount: snapshot.eligibleTabs.length,
      skippedUnsupported: snapshot.skippedTabs,
      unclassified: plan.unclassified,
      truncated: truncatedRefs(snapshot, maxTabs),
      rejected: result.rejected,
      modelMeta: {
        modelCalled: result.modelCalled,
        requests: result.requests,
        serverModel: result.serverModel || null,
        tokensPerSecond: result.tokensPerSecond || null,
        finishReason: result.finishReason || null,
        failedRequests: result.failedRequests,
      },
      plan: { ...plan, summary: summary(plan) },
    },
  };
}

async function handleStatus({ chromeRef, config, fetchImpl }) {
  const resolved = config || await readConfig({ chromeRef });
  if (!resolved.endpoint) {
    return { data: { status: STATUS_VALUES.CONFIG_MISSING, canScan: false, message: 'No inference endpoint is configured.' } };
  }
  try {
    const readiness = await checkReadiness({ config: resolved, fetchImpl });
    // Deliberately synthetic fixture metadata - no browser tab data is ever sent here.
    const probeTabs = [{ ref: 1, title: 'Example Domain', domain: 'example.invalid', url: 'http://example.invalid' }];
    try {
      const probe = await classifyTabs({
        promptTabs: probeTabs,
        config: resolved,
        chromeRef,
        fetchImpl,
        timeoutMs: LIMITS.STATUS_PROBE_TIMEOUT_MS,
      });
      return {
        data: {
          status: STATUS_VALUES.READY,
          canScan: true,
          endpoint: readiness.endpoint,
          model: readiness.model,
          message: 'The model is ready for classification.',
          probe: {
            category: probe.accepted[0]?.category ?? null,
            confidence: probe.accepted[0]?.confidence ?? null,
            serverModel: probe.serverModel || null,
            tokensPerSecond: probe.tokensPerSecond || null,
          },
        },
      };
    } catch (error) {
      if (error.code === ERROR_CODES.MODEL_UNAVAILABLE || error.code === ERROR_CODES.INFERENCE_TIMEOUT) throw error;
      return {
        data: {
          status: STATUS_VALUES.MODEL_REQUEST_FAILING,
          canScan: false,
          endpoint: readiness.endpoint,
          model: readiness.model,
          message: 'The endpoint is reachable but the classification request failed.',
          detail: error.message,
        },
      };
    }
  } catch (error) {
    if (error.code === ERROR_CODES.CONFIG_MISSING) {
      return { data: { status: STATUS_VALUES.CONFIG_MISSING, canScan: false, message: error.message } };
    }
    return {
      data: {
        status: STATUS_VALUES.ENDPOINT_UNREACHABLE,
        canScan: false,
        endpoint: resolved.endpoint,
        model: resolved.model,
        message: error.message,
      },
    };
  }
}

export async function handleMessage({ message, state, chromeRef, config, fetchImpl }) {
  try {
    if (!isPlainObject(message) || typeof message.type !== 'string') {
      throw appError(ERROR_CODES.INVALID_REQUEST, 'The message must be an object with a string type.');
    }
    const payload = message.payload ?? {};
    if (!isPlainObject(payload)) throw appError(ERROR_CODES.INVALID_REQUEST, 'The message payload must be an object.');
    switch (message.type) {
      case MESSAGE_TYPES.SCAN_TABS: {
        const { data } = await handleScan({ payload, state, chromeRef, config, fetchImpl });
        return ok(data);
      }
      case MESSAGE_TYPES.GET_REVIEW_PLAN: {
        const entry = requireSession(state, payload.sessionId);
        return ok({ plan: { ...entry.plan, summary: summary(entry.plan) } });
      }
      case MESSAGE_TYPES.UPDATE_REVIEW_PLAN: {
        const entry = requireSession(state, payload.sessionId);
        const { plan, rejectedMoves, rejectedClosures } = applyPlanEdits(entry.plan, payload);
        entry.plan = plan;
        return ok({ plan: { ...plan, summary: summary(plan) }, rejectedMoves, rejectedClosures });
      }
      case MESSAGE_TYPES.APPLY_ORGANIZATION: {
        const entry = requireSession(state, payload.sessionId);
        if (payload.approve !== true) {
          throw appError(ERROR_CODES.INVALID_REQUEST, 'Applying organization requires an explicit approve: true.');
        }
        const result = await applyOrganization({ plan: entry.plan, chromeRef });
        if (result.partial) {
          // Some operations failed: the frontend needs both the result and the failure code.
          throw appError(ERROR_CODES.PARTIAL_APPLY_FAILURE, 'Some group or close operations did not complete.', result);
        }
        return ok(result);
      }
      case MESSAGE_TYPES.GET_STATUS: {
        const { data } = await handleStatus({ chromeRef, config, fetchImpl });
        return ok(data);
      }
      default:
        throw appError(ERROR_CODES.INVALID_REQUEST, `Unknown message type: ${message.type}`);
    }
  } catch (error) {
    if (error?.code) return err(error);
    return err(appError(ERROR_CODES.INVALID_REQUEST, `Unexpected failure: ${error?.message || error}`));
  }
}
