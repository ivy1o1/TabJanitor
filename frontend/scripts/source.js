/*
 * =====================================================================================
 * INTEGRATION BOUNDARY
 * =====================================================================================
 *
 * This is the ONLY frontend module that supplies data. Everything else reads what it
 * returns, so phase 2 changes this file and nothing else.
 *
 * Today every function resolves from frontend/scripts/mock-data.js and performs no I/O
 * at all: no fetch(), no chrome.runtime.sendMessage(), no chrome.tabs call.
 *
 * Phase 2 replaces each body with the matching message operation documented in
 * docs/API_CONTRACT.md — the return shapes are already modelled on those payloads:
 *
 *   getStatus()  -> { type: 'GET_STATUS',          payload: {} }
 *   scan()       -> { type: 'SCAN_TABS',           payload: { maxTabsPerRequest?, timeoutMs? } }
 *   updatePlan() -> { type: 'UPDATE_REVIEW_PLAN',  payload: { sessionId, moves, closures } }
 *   apply()      -> { type: 'APPLY_ORGANIZATION',  payload: { sessionId, approve: true } }
 *
 * Keep the guardrails when you do:
 *   - responses arrive as { ok, data } | { ok, error: { code, message, details } };
 *     surface error.code and error.message, never invent a substitute result.
 *   - apply() must only be reachable from the confirmation dialog, and must send
 *     approve: true only after that explicit click.
 *   - closures stay per-tab: send exactly the tabs the user ticked.
 *   - PARTIAL_APPLY_FAILURE is a partial truth to display, not an error to hide:
 *     render details.groups / details.closures / details.failures.
 */

import { buildDemoScanResult, DEMO_STATUS, DEMO_NOTICE } from './mock-data.js';

/** 'demo' until a real backend is wired; the UI labels itself from this value. */
export const DATA_MODE = 'demo';

export function isDemo() {
  return DATA_MODE === 'demo';
}

export function demoNotice() {
  return DEMO_NOTICE;
}

/** Mirrors the GET_STATUS payload. Never claims `ready` while in demo mode. */
export async function getStatus() {
  return { ...DEMO_STATUS };
}

/** Mirrors the SCAN_TABS payload. Demo: returns the sample plan, reads no tabs. */
export async function scan() {
  return buildDemoScanResult();
}

/**
 * Mirrors UPDATE_REVIEW_PLAN. In demo mode the plan lives in memory on this page, so
 * the caller has already mutated it and there is nothing to send.
 */
export async function updatePlan() {
  return { appliedLocally: true, demo: true };
}

/** Mirrors APPLY_ORGANIZATION. Refuses rather than pretending to mutate the browser. */
export async function applyOrganization() {
  return {
    demo: true,
    groups: [],
    closures: [],
    stale: [],
    failures: [],
    message: 'Demo mode: no browser tabs were grouped or closed.',
  };
}
