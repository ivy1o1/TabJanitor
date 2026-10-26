# TabJanitor

AI-powered browser tab organization for Chrome (Manifest V3). TabJanitor reads the tabs in the
current window, classifies them with a **local Gemma model**, lets a human review and correct the
result, and only then creates native tab groups and closes explicitly selected tabs.

**Status: backend done, frontend in demo mode.** The service worker and its message contract are
implemented and tested. The dashboard UI exists and is fully interactive, but it renders **sample
data** — it is not wired to the backend yet, and it never reads or changes real tabs. Connecting the
two is the next phase; see [Frontend](#frontend-demo-mode) and
[`frontend/scripts/source.js`](frontend/scripts/source.js).

## Workflow

1. **Start scan** — the frontend asks for `SCAN_TABS`. Only the current window is read.
2. **Minimal metadata** — per tab: a local reference number, a truncated title, the sanitized URL
   (query, fragment and credentials removed) and the hostname. `chrome://` and similar pages are
   excluded from classification. No page content, cookies, storage or history is read.
3. **Classify with Gemma** — one chat-completions request per eligible tab against the configured
   local endpoint; the reply must be JSON.
4. **Validate and build the review plan** — categories, confidence range, ref correspondence,
   duplicates and unknown refs are checked against the trusted local snapshot; counts are computed
   locally. Nothing changes in the browser during this stage.
5. **User review** — the plan is editable: move tabs between categories, tick individual tabs for
   closure. The AI's original answer stays in `originalCategory`.
6. **Apply** — only after `APPLY_ORGANIZATION` with an explicit `approve: true`. Tabs are re-checked
   against the live window, groups are created with `chrome.tabs.group` / `chrome.tabGroups.update`,
   and only individually selected tabs are closed.

`Junk / Review` is a hint for a human to look at, never an automatic close.

## Architecture

```
manifest.json              MV3, service worker as an ES module
background/
  service-worker.js        message entry point, trusted-sender check, in-memory session state
  message-handler.js       SCAN_TABS / GET_REVIEW_PLAN / UPDATE_REVIEW_PLAN / APPLY_ORGANIZATION / GET_STATUS
  tab-scanner.js           current-window snapshot, local refs, session id
  metadata.js              scheme filtering, URL sanitization, length limits
  ai-client.js             configuration, validation, readiness, OpenAI-compatible chat completions
  classifier.js            prompt, JSON extraction, model-output validation
  review-plan.js           plan construction, user edits, local counts
  organizer.js             live re-validation, grouping, naming, explicit closures
shared/
  constants.js             categories, colours, limits, message types, error codes, status values
  schemas.js               envelope helpers and field validators
frontend/
  dashboard.html           the dashboard page (extension page path for phase 2)
  styles/tokens.css        design tokens: light + dark themes, nothing else holds a colour
  styles/dashboard.css     layout and components, mobile-first
  scripts/dashboard.js     controller: state -> render, event wiring
  scripts/source.js        THE INTEGRATION BOUNDARY: the only module that supplies data
  scripts/mock-data.js     sample plan shaped exactly like the SCAN_TABS payload
  scripts/selectors.js     derived counts, filtering, distribution
  scripts/theme.js         theme state, chrome.storage.local with a localStorage mirror
  scripts/components/      sidebar, status header, banner, summary, cards, table, panels, dialog
  scripts/{store,dom,icons}.js  tiny state container, DOM helpers, inline SVG icons + brand mark
  assets/tabjanitor-logo-source.jpg  brand artwork; the SVG in icons.js is traced from it
tools/serve-frontend.js    dev-only static server so the page can run over http://
tools/logo-trace.html      re-traces the logo artwork into the icons.js path (open it in a browser)
tests/                     mocked unit tests + a manual live smoke test
docs/API_CONTRACT.md       request/response contract for the frontend
config/config.example.json example inference configuration
```

The frontend talks only to `message-handler.js` through the documented envelope
(`{ ok: true, data }` / `{ ok: false, error: { code, message, details } }`).

## Model endpoint (verified on this machine, 2026-10-26)

Verified facts, not assumptions:

| Item | Value |
| --- | --- |
| Server binary | `llama-server.exe` from winget package `ggml.llamacpp` |
| Version | `0.5.0-dev (build 11382, commit 11fe02151)` |
| Model file (already on disk, not downloaded) | `~/.cache/huggingface/hub/models--ggml-org--gemma-3-1b-it-GGUF/snapshots/f9c28bcd85737ffc5aef028638d3341d49869c27/gemma-3-1b-it-Q4_K_M.gguf` (768.7 MB, Q4_K - Medium) |
| Endpoint used for verification | `http://127.0.0.1:8080` |
| Readiness | `GET /health` → `200 {"status":"ok"}` |
| Server-reported model | `/props` → `model_alias` = the full `.gguf` path above |
| Real inference | `POST /v1/chat/completions` returned parseable JSON classifications; ~19 tokens/s, ~2 s per tab |

Not verified / previously not present: no server process was running, nothing listened on any
common LLM port, no startup entry or scheduled task started one, and no model-related environment
variable existed. The server was started manually for verification:

```powershell
& "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\ggml.llamacpp_Microsoft.Winget.Source_8wekyb3d8bbwe\llama-server.exe" `
  --model "$env:USERPROFILE\.cache\huggingface\hub\models--ggml-org--gemma-3-1b-it-GGUF\snapshots\f9c28bcd85737ffc5aef028638d3341d49869c27\gemma-3-1b-it-Q4_K_M.gguf" `
  --host 127.0.0.1 --port 8080 --ctx-size 4096
```

The endpoint interface is llama.cpp's OpenAI-compatible chat completions (`/v1/chat/completions`),
which is exactly what `background/ai-client.js` calls. Ollama is not used and not required.

### Configuration

The endpoint and model identifier are **not** hardcoded into the logic. The service worker reads
them from `chrome.storage.local` under the key `tabjanitor.config`:

```js
chrome.storage.local.set({ tabjanitor.config: {
  inferenceEndpoint: 'http://127.0.0.1:8080',
  inferenceModel: 'gemma-3-1b-it',
  requestTimeoutMs: 60000
} });
```

- `inferenceEndpoint` must be an `http` base URL on `127.0.0.1` or `localhost`, with no path, query or
  credentials. It is validated before any request, and a non-loopback value is refused with
  `CONFIG_MISSING` — the extension cannot be pointed at a cloud endpoint by configuration alone.
- `inferenceModel` is the identifier sent in the request. llama.cpp reports the loaded model at
  `/props` (`model_alias` / `model_path`). `gemma-3-1b-it` was verified to be accepted by this
  server; check `/props` after loading a different model.
- If nothing is stored, the code falls back to the verified local defaults (`http://127.0.0.1:8080`,
  `gemma-3-1b-it`). That default is a convenience for this local setup, still overridable at runtime.
- `config/config.example.json` mirrors the same shape for the Node smoke test. Machine-specific
  values belong in `config/config.local.json`, which is gitignored.

### Readiness check

```powershell
Invoke-RestMethod http://127.0.0.1:8080/health   # expect: status ok
Invoke-RestMethod http://127.0.0.1:8080/props | Select-Object model_alias, model_ftype
```

`GET_STATUS` performs both kinds of check at runtime and reports one of:
`config_missing`, `endpoint_unreachable`, `model_request_failing`, `ready`.
Readiness never sends tab metadata; the `ready` state is confirmed with one synthetic fixture tab.

## Permissions

- `tabs` — read the current window's tab titles and URLs, and create/close tabs.
- `tabGroups` — create and name native groups.
- `storage` — read the inference endpoint/model from `chrome.storage.local`.
- `host_permissions: http://127.0.0.1/*, http://localhost/*` — loopback only, so the service worker
  may reach a local inference server on any port. No broad host permissions are requested.

llama.cpp answers CORS with `--cors-origins` defaulting to `*`, which works from the extension
origin. If you restrict it, include `chrome-extension://<your unpacked extension id>`.

Privacy note: the validation above and the loopback-only `host_permissions` together mean tab
metadata cannot be sent anywhere but this machine — a remote `inferenceEndpoint` is rejected by the
client before a request is made, and the manifest does not grant the extension any other host. No key is
needed for the local path, and no credential is ever committed.

## Frontend (demo mode)

The dashboard recreates the reference design: cream graph-paper surfaces, neo-brutalist borders and
hard offset shadows, a Bodoni-class display serif over Inter, pastel folder cards, and a real light
and dark theme.

```bash
npm run serve:frontend   # http://127.0.0.1:4173/frontend/dashboard.html
```

It is a plain HTML + CSS + ES-module page with no build step and no dependencies, matching the rest
of the repository.

**What works locally, on sample data:** search, category filtering (cards and the view selector stay
in sync), per-row category edits with the AI's original answer preserved, individual closure
selection with live counts, select-all over the visible rows, Clear All, the row overflow menu, the
theme toggle with persistence, and the Apply confirmation dialog.

**What deliberately does not happen:** no `fetch`, no `chrome.runtime.sendMessage`, no `chrome.tabs`
call. The status badge reads **Demo Mode / Not connected** rather than "Ready", the summary numbers
are labelled sample figures, and confirming the apply dialog only shows a toast that nothing changed.

Everything the UI shows is derived from one object. `frontend/scripts/mock-data.js` builds a sample
plan that matches the `SCAN_TABS` payload from `docs/API_CONTRACT.md` field for field, and
`frontend/scripts/source.js` is the only module that hands it to the page. Phase 2 replaces the four
function bodies in `source.js` with the four message calls; no component changes.

## Tests

```bash
node --version    # v24.x
npm test          # 69 mocked unit tests, no network, no model required
```

`npm test` runs `node --test "tests/*.test.js"` (Node's built-in runner; no dependencies added).
Coverage includes URL sanitization, unsupported-page handling, prompt content, JSON extraction,
invalid/duplicate/unknown/missing refs, invalid categories and confidence, per-tab request count,
per-tab failure isolation when the model answers one tab with unusable JSON, endpoint validation
(loopback-only), bounded `maxTabsPerRequest` / `timeoutMs` arguments, timeout and unavailable-endpoint
handling, local counts, user edits, closure selection, stale sessions, vanished tabs, partial browser
failures, and "no browser mutation before approval".

`tests/helpers.js` injects a fake `chrome` object and a fake `fetch`; nothing real is touched.

## Manual smoke tests

1. Live model inference (uses the verified local endpoint, synthetic fixture metadata only):

   ```bash
   npm run smoke:live
   # or: node tests/smoke-live.js --endpoint http://127.0.0.1:8080 --model gemma-3-1b-it
   ```

   It prints the health result, the server-reported model path, timing, and either
   `RESULT: PASS - real local Gemma inference returned N/N parseable classifications.` or
   `RESULT: FAIL - <code>: <message>` with a non-zero exit code. A failure is reported as a failure;
   nothing is simulated.

2. In-browser backend smoke (no UI yet — drive the service worker from
   `chrome://extensions` → TabJanitor → "Inspect views: service worker"):

   ```js
   chrome.runtime.sendMessage({ type: 'GET_STATUS', payload: {} }, console.log);
   const r = await chrome.runtime.sendMessage({ type: 'SCAN_TABS', payload: {} });
   console.log(r.data.sessionId, r.data.plan.items);
   await chrome.runtime.sendMessage({ type: 'UPDATE_REVIEW_PLAN', payload: {
     sessionId: r.data.sessionId, closures: [{ tabId: 42, closeSelected: true }] } });
   await chrome.runtime.sendMessage({ type: 'APPLY_ORGANIZATION', payload: {
     sessionId: r.data.sessionId, approve: true } });
   ```

## Load the unpacked extension

1. Start `llama-server` (command above) and confirm `/health`.
2. Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → select this repository folder.
3. Open a window with several http/https tabs, then use the console snippets above.
   Until the frontend exists there is no popup, so this is the only way to exercise the workflow.

## Known limitations

- The frontend is not connected to anything. It renders sample data, so the workflow still cannot be
  completed end to end by a person.
- The dashboard has no manifest entry point yet (`action` / `chrome.tabs.create`), which is a manifest
  change and therefore belongs to the integration phase. Until then it is opened over `http://` or as
  `chrome-extension://<id>/frontend/dashboard.html`.
- `dashboard.html` loads its two webfonts from Google Fonts, which is the one remote request the page
  makes. Self-host the woff2 files before shipping so the interface keeps the project's
  no-network-by-default property.
- On phones the table header is hidden, so select-all is desktop-only; per-row closure selection and
  Clear All remain available.
- Scan state lives in the service worker's memory only (no persistence was approved), so a worker
  eviction clears the current session; the frontend must re-scan. `STALE_TABS` guards against
  applying an old plan.
- Classification is one request per tab: the verified 1B model drops refs and returns prose when
  given a batch, so batching was measured and rejected. Expect roughly 2 s per tab.
- The 1B model mislabels generic pages (for example `react.dev` came back as `Study`), which is why
  human review is mandatory and confidence is informational.
- A scan is capped at 40 tabs per request cycle (configurable up to 100 via `maxTabsPerRequest`);
  the rest are reported as `truncated` and left unclassified rather than guessed.
- A model server on another machine (for example `http://192.168.1.20:8080`) is refused by design:
  the local-only rule keeps the endpoint check and the loopback `host_permissions` in agreement, so
  tab metadata has no configuration path off this device. Serving the model from a different host
  would require an explicit change to both, and that has not been approved.
- Edge compatibility is not assessed yet; browser API usage is confined to
  `tab-scanner.js` and `organizer.js` behind an injected `chromeRef`.
