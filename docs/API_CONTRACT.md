# TabJanitor backend API contract

Protocol version: `1` (`PROTOCOL_VERSION` in `shared/constants.js`).

All requests go to the background service worker through `chrome.runtime.sendMessage`.
Only extension-owned contexts may send messages; any other sender gets `UNTRUSTED_SENDER`.

## Envelope

```json
{ "type": "SCAN_TABS", "payload": {} }
```

Success:

```json
{ "ok": true, "data": {} }
```

Error:

```json
{ "ok": false, "error": { "code": "MODEL_UNAVAILABLE", "message": "...", "details": {} } }
```

`error.code` is always one of the stable codes below. `error.details` is an object and may be empty.
The frontend never needs to know how a model request is built or how model output is validated.

## Error codes

| Code | Meaning |
| --- | --- |
| `INVALID_REQUEST` | Unknown message type, malformed payload, missing `sessionId`, or an apply request without `approve: true`. |
| `UNTRUSTED_SENDER` | The message did not come from an extension page of this extension ID. |
| `UNSUPPORTED_TABS` | A requested operation targeted a tab the extension may not classify or mutate (`chrome://` and similar). |
| `CONFIG_MISSING` | No inference endpoint configured, or the configured value is not a valid http(s) base URL. |
| `MODEL_UNAVAILABLE` | The endpoint could not be reached, refused the connection, or returned a non-2xx status. |
| `INFERENCE_TIMEOUT` | A request exceeded the configured timeout. |
| `INVALID_MODEL_OUTPUT` | The model reply was not parseable JSON, or produced no valid classification for any tab. |
| `STALE_TABS` | The `sessionId` does not match the current scan, or the targeted tabs no longer exist in the scanned window. |
| `BROWSER_API_ERROR` | A browser API call failed (for example `chrome.tabs.query` threw). |
| `PARTIAL_APPLY_FAILURE` | Some grouping or closure operations failed; see `data.failures`. |

## 1. `SCAN_TABS`

Captures a snapshot of the **current window only** and classifies eligible tabs with Gemma.
It never closes tabs and never creates groups.

Request payload:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `maxTabsPerRequest` | integer | no | Upper bound on tabs offered to the model. Default `40`. |
| `timeoutMs` | integer | no | Per-request inference timeout override. |

`data`:

| Field | Type | Notes |
| --- | --- | --- |
| `sessionId` | string | Required on every later request. |
| `windowId` | integer | The window that was scanned. |
| `scannedCount` | integer | All tabs in the window. |
| `eligibleCount` | integer | Tabs allowed into classification. |
| `classifiedCount` | integer | Tabs with a validated classification. |
| `skippedUnsupported` | array | `[{ tabId, reason: "unsupported scheme" }]` for `chrome://` and similar. |
| `truncated` | array of tabId | Eligible tabs beyond `maxTabsPerRequest`; they are **not** classified. |
| `modelMeta` | object | `{ modelCalled, requests, serverModel, tokensPerSecond, finishReason, failedRequests }`. `requests` is the number of inference calls, one per eligible tab. `failedRequests` lists `[{ ref, code, message }]` for tabs whose reply could not be used. |
| `plan` | object | The review plan (see below) plus `plan.summary`. |
| `unclassified` | array | Eligible tabs the model did not answer: `[{ tabId, ref, title, domain, reason }]`. |
| `rejected` | array | Model entries dropped by validation: `[{ ref, reason, received }]`. |

## 2. `GET_REVIEW_PLAN`

Payload: `{ sessionId }`. Returns `{ plan }` for the current scan. Read-only.

## 3. `UPDATE_REVIEW_PLAN`

Applies user corrections. It never touches the browser.

Payload:

```json
{
  "sessionId": "...",
  "moves": [{ "tabId": 41, "category": "Other" }],
  "closures": [{ "tabId": 42, "closeSelected": true }]
}
```

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `moves[].category` | enum | yes | Must be one of the seven categories. |
| `closures[].closeSelected` | boolean | yes | Only these tabs may ever be closed. |

`data`: `{ plan, rejectedMoves, rejectedClosures }`. Entries that are not in the plan are rejected with
`{ tabId, code, reason }` (`UNSUPPORTED_TABS` for a skipped browser page, `STALE_TABS` for an unknown tab),
never applied. `plan.summary` reports `{ sessionId, counts, total, closureCount, editedCount }`.
`plan.items[].originalCategory` always keeps the AI's first answer, so user edits are never overwritten.

## 4. `APPLY_ORGANIZATION`

Payload: `{ sessionId, approve: true }`. Without a literal `approve: true` the request fails with
`INVALID_REQUEST` and nothing changes.

Behaviour: re-reads the live window, drops tabs that disappeared or moved window, closes only
`closeSelected` tabs, then groups the remaining tabs by validated category with `chrome.tabs.group`
and names/colours them with `chrome.tabGroups.update`.

`data`:

| Field | Type | Notes |
| --- | --- | --- |
| `groups` | array | `[{ category, groupId, tabIds, color, status }]`, `status` is `success` or `partial`. |
| `closures` | array | `[{ tabId, status: 'closed' }]`. |
| `stale` | array | `[{ tabId, reason }]` — tabs no longer present, nothing was invented for them. |
| `failures` | array | `[{ operation, ...context, reason }]`. |
| `closureRequested`, `closureCompleted`, `closureFailed` | integer | Explicit counts. |
A group is only reported after the browser API resolved it. Nothing is reported as successful before that.
If any operation failed, the response is the error envelope with `code: "PARTIAL_APPLY_FAILURE"` and
`details` containing the full result table above, so the frontend can show exactly what succeeded and what did not.

## 5. `GET_STATUS`

Read-only. Never sends tab metadata.

`data`:

| Field | Type | Notes |
| --- | --- | --- |
| `status` | enum | `config_missing` \| `endpoint_unreachable` \| `model_request_failing` \| `ready` |
| `canScan` | boolean | Whether `SCAN_TABS` is expected to work. |
| `endpoint` | string | The configured base URL (no credentials). |
| `model` | string | The configured model identifier. |
| `message` | string | Human-readable reason. |
| `probe` | object | On `ready`: the result of one minimal synthetic classification (`{ category, confidence, serverModel, tokensPerSecond }`). The probe contains fixture data only, never browser data. |

### Review plan shape

```json
{
  "sessionId": "…",
  "windowId": 12,
  "items": [{
    "tabId": 41, "ref": 1, "title": "…", "domain": "…", "url": "https://…",
    "category": "Development", "originalCategory": "Development",
    "explanation": "…", "confidence": 92,
    "closeSelected": false, "userEdited": false
  }],
  "counts": { "Development": 1, "Study": 0, "Research": 0, "Shopping": 0, "Entertainment": 0, "Other": 0, "Junk / Review": 0 },
  "summary": { "total": 1, "closureCount": 0, "editedCount": 0 },
  "skippedUnsupported": [{ "tabId": 44, "reason": "unsupported scheme" }],
  "unclassified": []
}
```

`counts` and `summary` are always computed locally from validated items, never taken from the model.
`confidence` is an integer 0–100. `explanation` is truncated to 280 characters. Titles are capped at 300
characters, sanitized URLs at 500, hostnames at 200.

### Categories

`Development`, `Study`, `Research`, `Shopping`, `Entertainment`, `Other`, `Junk / Review`.
`Junk / Review` is a suggestion for human inspection; it never implies automatic closure.
Internal group colours: Development `cyan`, Study `blue`, Research `purple`, Shopping `orange`,
Entertainment `yellow`, Other `gray`, Junk / Review `red`.

## What is sent to the inference endpoint

Per eligible tab, one request, containing exactly: a locally assigned `ref` (an untrusted position
reference, not the browser tab ID), the truncated title, the sanitized URL (query string, fragment,
and credentials removed), and the hostname.

Not sent: browser tab IDs, window IDs, page contents, cookies, storage, history, and any other browsing data.
