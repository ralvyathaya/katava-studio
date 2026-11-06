# Katava Studio — LLM Setup

The LLM adapter uses the standard **OpenAI-compatible** chat completions contract. All secrets stay server-side in environment variables — no key is hardcoded, logged, or sent to the browser. There is exactly one provider configuration: `LLM_PROVIDER="openai"`.

> **Local integration verified on 2026-11-06:** the user-selected OpenAI-compatible gateway and `glm-5.3-flash` returned a real non-empty completion and passed live end-to-end testing. This is historical verification, not a promise of ongoing availability. Keep the current `.env` values; the template's blank key/default endpoint must not overwrite a working setup. Current access is checked with `npm run verify:llm` or `/api/health?verify=1`.

---

## 1. Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `LLM_PROVIDER` | yes | `openai` | Must be `openai`. Any other value fails closed. |
| `OPENAI_API_KEY` | yes | *(blank)* | Bearer key. Never commit or log it. |
| `OPENAI_BASE_URL` | no | `https://api.openai.com/v1` | Base URL of any OpenAI-compatible gateway. |
| `OPENAI_MODEL` | no | `gpt-4o-mini` | Model ID. |
| `LLM_TIMEOUT_MS` | no | `20000` | Per-call timeout; failure → `review_incomplete`. |

`.env` is gitignored. `.env.example` is the safe, commit-ready template with the same contract.

## 2. Exact setup steps

1. For a new installation only, copy `.env.example` to `.env` **only if `.env` does not already exist**. Do not overwrite existing credentials or gateway choices.
2. Create a key at <https://platform.openai.com/api-keys>. If you use another OpenAI-compatible gateway, obtain the key from that provider instead.
3. Paste the full key into `OPENAI_API_KEY` — no spaces, inline comments, or nested quotes. It is shown only once by most providers.
4. Set `OPENAI_BASE_URL` and `OPENAI_MODEL` to match that provider. Leave them at the defaults for plain OpenAI.
5. Verify with a real call: `npm run verify:llm`.
6. Only after step 5 succeeds, run the live integration test: `KATAVA_RUN_LIVE_LLM_TESTS=1 npm test`.

Any OpenAI-compatible gateway can be used by changing `OPENAI_BASE_URL` and `OPENAI_MODEL` — no code changes required. The adapter always issues `POST {baseUrl}/chat/completions` with `Authorization: Bearer <key>`.

## 3. Real verification

```bash
npm run verify:llm                     # uses .env values
npx tsx scripts/verify-llm.ts <baseUrl> <model>   # one-off override
```

The script:

- Prints only the key length and a 4-character prefix — never the key itself.
- STEP 1 (informational): `GET {baseUrl}/models` to confirm the key is accepted and the model is listed. Some gateways do not expose this route; that alone is not a failure.
- STEP 2 (decisive): `POST {baseUrl}/chat/completions` with a minimal prompt. Exit code `0` **only** when a real, non-empty completion is received. The probe allows a larger token budget because reasoning models emit `reasoning_content` before visible `content`; a tiny budget can otherwise return HTTP 200 with an empty string, which the adapter would correctly reject as malformed.
- Prints HTTP status, error code/message and `request_id` on failure. Exits `1` on a blank key, HTTP error, timeout, or malformed response.

The same check is available from the running app: `GET /api/health?verify=1`. `/api/health` without `verify` reports configuration only.

## 4. Configured ≠ accessible

`GET /api/health` and the UI banner deliberately separate two states:

- **configured / key present** — a non-empty `OPENAI_API_KEY` exists in the environment.
- **accessible** — a real chat completion was actually received.

A key can be present and still be invalid, out of quota, or pointed at the wrong gateway. The UI shows an amber warning in that case. No successful call is ever simulated.

## 5. Fail-closed behaviour

The pipeline returns `review_incomplete` and writes the failure to the audit trail for every one of these:

| Condition | Behaviour |
|---|---|
| No / blank `OPENAI_API_KEY` | `review_incomplete`, key never logged |
| Unsupported `LLM_PROVIDER` | `review_incomplete` |
| HTTP error (401, 403, 429, 5xx, …) | `review_incomplete`, error recorded in audit |
| Timeout (`LLM_TIMEOUT_MS`) | `review_incomplete`, error recorded in audit |
| Network error | `review_incomplete`, error recorded in audit |
| Empty or malformed response body | `review_incomplete`, error recorded in audit |
| Malformed JSON from an agent | `review_incomplete`, no fabricated parse |
| Invalid rule citation / Rule Engine hard block | `REJECT` or escalation; a Reviewer `PASS` cannot override a hard block |

`response_format: { type: "json_object" }` is sent when an agent requests JSON mode. If the gateway explicitly rejects that field, the adapter retries once without it, within the same per-call timeout. There is no automatic retry for 429/5xx/timeouts.

### Quick Test and multi-format execution

`POST /api/generate` accepts either `format` (single item, backward-compatible) or `formats` (one to three supported formats: `instagram`, `reels`, `marketplace`), never both. Inputs are runtime-validated. All requested formats share one campaign, one source, and the exact same persisted fact IDs used by agent citations. Normal generation and Quick Test use the same orchestrator.

- With `Accept: application/x-ndjson`, the endpoint streams `started`, actual per-item `progress`, independent `result`, and final `complete` events. Without that header it returns JSON, including `results`; single-item fields remain available.
- Concurrency is bounded to **two items per request**, not globally across users. The third format waits for a complete item to release a slot. This local MVP has no authentication, global rate limiting or durable queue; do not expose it publicly without those controls.
- `timeoutMs` defaults to `90000`, accepts integers from `1000` to `180000`, and is a **per-item execution deadline** starting after queue admission. Queue time and persistence overhead are additional; a 90-second deadline is not a guarantee of complete results within 90 seconds.
- Deadline/cancellation aborts in-flight model requests. Terminal PASS status and audit are committed in one transaction: cancellation wins through the final signal check after both writes; a later disconnect does not revoke an already finalized decision. Failed siblings cannot erase completed results or written versions. API missing configuration is rejected with HTTP 503 before preparing a campaign; orchestrator-level service errors fail closed with `review_incomplete`.
- The stream is request-bound: disconnects request cancellation, not detached work. If the process or hosting platform kills the request, there is no durable resume/guaranteed cleanup; the UI retains received results and labels unfinished cards **interrupted / not verified**, not as a server-confirmed verdict. Persisted audits can be inspected separately.
- Reels requires two or more numbered Scene blocks with Visual, VO and Overlay. Invalid format/empty citations fail closed; shape validation is not a compliance rule or substitute for review. Human approval and publication are not implemented in Milestone 3.

## 6. Test isolation (important)

`tests/milestone2.test.ts` and deterministic tests in `tests/milestone3.test.ts` inject a **scripted transport** through `__setLLMTransportForTests()` to exercise the bounded loop, escalation and fail-closed branches deterministically. That seam is forbidden when `NODE_ENV=production` and is **never** used by the running application. Scripted output is unit/contract evidence only — it is **not** evidence of a working LLM integration.

Live test T02 in `tests/pipeline.test.ts` and the two-format live test in `tests/milestone3.test.ts` are gated behind `KATAVA_RUN_LIVE_LLM_TESTS=1`. T02 checks the pipeline does not fail closed; Milestone 3 additionally requires real reviewed Instagram/Reels output, actual model IDs, and resolved persisted citations through the streaming route source. This route-handler test is **not** proof of a production build, browser rendering or socket-level HTTP delivery. Do not enable live tests until `npm run verify:llm` returns a real completion. Test files run serially to avoid unrelated live suites competing for the same gateway and SQLite resources; the multi-format test itself still exercises concurrent formats.

## 7. Compliance wording

The rulebook is an **internal demo policy** (`KATAVA-DEMO-GUARDRAILS` v0.1 / `Katava demo policy v0.1`). It is not Indonesian law, a BPOM regulation, a halal certification standard, or legal advice. Never claim statutory compliance in the UI, docs, or demo.
