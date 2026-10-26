import { handleMessage, createState } from './message-handler.js';
import { createSessionStore } from './session-store.js';
import { ERROR_CODES } from '../shared/constants.js';
import { appError, err } from '../shared/schemas.js';

// The review session is kept in memory-only session storage as well as in this worker's state,
// so a plan the dashboard is still showing survives the worker being stopped and restarted.
const state = createState({ store: createSessionStore(chrome) });

// The dashboard lives outside this module's folder, and getURL is always relative to the
// extension root, so the action opens it by its root path.
const DASHBOARD_PATH = 'frontend/dashboard.html';

function isTrustedSender(sender) {
  if (!sender || sender.id !== chrome.runtime.id) return false;
  // Only extension-owned documents may drive the workflow (popup, options page).
  return typeof sender.url === 'string' && sender.url.startsWith(chrome.runtime.getURL(''));
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!isTrustedSender(sender)) {
    respond(err(appError(ERROR_CODES.UNTRUSTED_SENDER, 'The message did not come from a trusted extension context.')));
    return false;
  }
  handleMessage({ message, state, chromeRef: chrome })
    .then((response) => respond(response))
    .catch((error) => respond(err(error?.code
      ? error
      : appError(ERROR_CODES.INVALID_REQUEST, `Unexpected failure: ${error?.message || error}`))));
  return true;
});

// Focus the dashboard that is already open instead of stacking unlimited copies.
async function openDashboard() {
  const url = chrome.runtime.getURL(DASHBOARD_PATH);
  const [existing] = await chrome.tabs.query({ url });
  if (!existing) {
    await chrome.tabs.create({ url });
    return;
  }
  await chrome.tabs.update(existing.id, { active: true });
  if (Number.isFinite(existing.windowId)) await chrome.windows.update(existing.windowId, { focused: true });
}

chrome.action.onClicked.addListener(() => {
  openDashboard().catch(() => {
    // A failed click must not leave an unhandled rejection in the worker.
  });
});
