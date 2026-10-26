import { handleMessage, createState } from './message-handler.js';
import { ERROR_CODES } from '../shared/constants.js';
import { appError, err } from '../shared/schemas.js';

const state = createState();

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
