# Katava Studio

Source-grounded creator agents for multi-format marketing content, with deterministic guardrails, bounded review cycles, and an append-only audit trail.

Built for **Tencent Cloud Hackathon Indonesia 2026 — Challenge C: The Creator Agent**.

> **Prototype status (2026-11-07):** Generation, deterministic review, three output formats, exact-version human approval and approval-gated export are implemented. The app is deployed through WorkBuddy App Publishing with SQLite. Real gateway, route-handler and browser acceptance evidence is recorded below. AI `PASS` is an internal demo-policy verdict, not human approval. Approval and export apply only to an exact reviewed version; neither publishes content. Browser approvals recorded during acceptance are **automated test decisions**, not genuine customer sign-off.

## What it does

Katava Studio takes a product sheet as its single source of truth and produces content for **Instagram captions, TikTok/Reels scripts, and Marketplace listings**:

- **Planner → Writer → Reviewer** are distinct LLM calls with Zod-validated structured output.
- A deterministic **Rule Engine** checks claims and citations. Its hard blocks cannot be overridden by a Reviewer `PASS`.
- The review loop is bounded to **3 cycles**; non-remediable demands escalate at preflight before any model call.
- Any missing key, HTTP error, timeout, malformed JSON, or invalid citation fails closed as `review_incomplete`. No successful agent run is ever simulated.
- Every version, agent message, finding, and decision is persisted as an append-only audit trail with resolved source excerpts.
- Formats share one campaign and the exact same persisted fact IDs. Two items run concurrently per request; a third is queued.
- `POST /api/generate` streams real NDJSON progress events (`started`, `progress`, `result`, `complete`) for the Quick Test UI.
- A separate manager credential authorizes version-bound review-link issuance, replacement/revocation and draft edits.
- `/review` shows the exact draft and cited source excerpts. Opening/refreshing never approves; approve/reject/request-changes requires explicit confirmation.
- Review credentials are random, hash-only in storage, expiring and consumed by one final decision. Content, format, citations, source facts, policy and canonical Reviewer evidence are fingerprint-bound.
- Editing appends an unreviewed version, revokes old links and retains prior decisions as history only. No publication endpoint or external publisher is implemented.
- Approved exact versions can be exported as Markdown, JSON or plain text. Every export is integrity-checked and recorded; export is not publication.
- Public health and generation responses expose only infrastructure-neutral AI availability, never provider, model, endpoint or credential-presence details.

The rulebook (`KATAVA-DEMO-GUARDRAILS` v0.1) is an **internal demo policy**. It is **not** Indonesian law, a BPOM regulation, a halal certification standard, or legal advice.

## Stack

Next.js 16 (App Router, Webpack) · React 19 · TypeScript strict · Tailwind CSS 4 · Prisma 6 / SQLite · Zod · Node built-in test runner via `tsx`.

## Requirements

- Node.js 20+ and npm
- An OpenAI-compatible API key (plain OpenAI or any compatible gateway)

## Local setup

```bash
npm install
cp .env.example .env        # only if .env does not already exist
# fill in OPENAI_API_KEY; optionally OPENAI_BASE_URL / OPENAI_MODEL
npm run db:push              # fresh databases only; do not reset existing data
npm run db:seed              # once for a fresh database; seed is not idempotent
npm run setup:approval       # generate a separate manager key, never prints it
npm run verify:llm          # real API call; must return a non-empty completion
npm run dev
```

Open <http://localhost:3000>. Detailed LLM configuration, verification, and fail-closed behaviour are documented in [`docs/LLM_SETUP.md`](docs/LLM_SETUP.md).

**Never commit `.env`.** `.env*` is gitignored except the blank `.env.example` template.

### Human approval / client review (M4)

1. Run `npm run setup:approval`, then restart Next. It fills an absent/blank `KATAVA_MANAGER_KEY`, preserving all other settings. It never rotates a valid existing key and refuses ambiguous or short nonempty values.
2. Copy that separate key from your local `.env` into the **manager password** input. Never use your model API key here. Clear it when finished; the app does not persist it in browser storage.
3. Generate a **fresh** policy-passed draft, inspect approval state and issue a review link (1, 24 or 72 hours). Older M3 evidence is preserved but lacks M4 integrity bindings and cannot authorize links.
4. Open the private client link. Its credential is in a URL fragment, cleared before API requests, retained only in memory and never persisted raw in the database. A full page reload requires reopening the original link. Treat the link and clipboard as sensitive.
5. Select approve, request changes or reject, then confirm. Feedback is mandatory for changes/rejection. This is a final decision for that version; reading never approves, replay never overwrites, and no action publishes.
6. Refresh manager approval state to see the decision. Edits create a new `review_incomplete` version and invalidate current approval; previous drafts/decisions remain immutable history. Generate a fresh policy-reviewed item before requesting approval again; in-place re-review is not implemented.

Manager routes use a separate secret plus exact same-origin JSON requests; client routes accept only their scoped bearer credential. Client identity is recorded as a **link holder**, not a verified person. A network/commit failure does not imply approval: refresh persisted evidence before retrying. Expiry is checked at the final authorization cutoff inside the transaction, not a promised physical commit timestamp.

**Exact-origin requirement:** keep using `http://localhost:<port>` for local review. Next.js may normalize `request.url` to `localhost`, so a browser opened at `http://127.0.0.1:<port>` sends an `Origin` header that the strict check correctly rejects. If you must use another host, set `KATAVA_PUBLIC_ORIGIN` to that exact origin (for example `KATAVA_PUBLIC_ORIGIN="http://127.0.0.1:3001"`) and restart Next. The app never infers trust from `Host` or `x-forwarded-*` headers.

**Demo policy state:** exactly one active rulebook must be `KATAVA-DEMO-GUARDRAILS` v0.1 with six rules. Earlier unit-test fallbacks could leave a synthetic `KATAVA-TEST-GUARDRAILS` active, which made real generations show test policy text; the suites now restore the seeded policy instead and clean up only their own uniquely tagged fallback. A deterministic regression check enforces this. If an older local database still has a synthetic active rulebook, re-run `npm run db:seed` only on a fresh database, or explicitly reactivate the seeded version. Never delete existing campaign/approval evidence.

### Approval-gated export (M5)

After the exact current version receives explicit approval, manager and client controls can download Markdown, JSON or plain-text artifacts. The server rechecks content, source, policy, Reviewer and approval integrity before every export, then appends an `ExportRecord` and `content_exported` audit event. Rejected, revision-requested, stale, missing or tampered versions cannot export. Files are release artifacts only; Katava has no social-media publisher.

### Build environment limitation

The agent-managed Windows environment can block Next's generated-file cleanup with `SAFE_DELETE_BULK_CONFIRM_REQUIRED` at `.next/trace-build`. Do not disable the safety guard or manually delete project data. Run `npm run build` in an external terminal from `katava-studio`, then `npm start -- -p 3001` and open `http://localhost:3001`. Native Windows SWC warnings are expected here; Webpack/WASM is the established fallback. The M4 production build passed: compiled in 24.6s, TypeScript in 6.9s, 5 static pages, and 9 routes including the four M4 endpoints and `/review`.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server (`next dev --webpack`) |
| `npm run build` | Production build (`next build --webpack`) |
| `npm start` | Serve the production build |
| `npm test` | Deterministic contract/regression suites |
| `KATAVA_RUN_LIVE_LLM_TESTS=1 npm test` | Also run gated live LLM integration tests |
| `npx tsc --noEmit` | Strict TypeScript check |
| `npm run verify:llm` | Real HTTP verification of LLM access |
| `npm run setup:approval` | Safely configure the separate local manager key |
| `npm run test:m4` | M4 storage/security/setup contracts |
| `KATAVA_RUN_LIVE_LLM_TESTS=1 npm run test:m4` | Also verify real generation through approval route handlers |
| `npm run db:push` / `db:seed` | Create / seed the local SQLite database |

## Verification notes

- `configured` (key present) is deliberately distinguished from `accessible` (a real completion was received).
- Deterministic tests inject a **scripted transport** that is forbidden in production. They are contract evidence only, never proof of a working LLM integration.
- Live tests are gated behind `KATAVA_RUN_LIVE_LLM_TESTS=1` and require a verified gateway first.
- The 90-second budget is a **per-item execution deadline** after queue admission, not a whole-batch completion guarantee.
- Current deterministic verification: **116 tests passed**, including public infrastructure-disclosure regression coverage; strict TypeScript, ESLint and `git diff --check` passed. The gated M4 suite passed **37/37**, including fresh real Instagram/Reels generation, hash-bound link issuance, explicit **automated fixture decisions**, replay rejection and edit invalidation. Those route-handler tests are not customer-sign-off evidence.
- Latest real two-format rehearsal took **26.049 seconds**: both PASS in one cycle, four real agent/rule-engine runs each, five Instagram/four Reels resolved citations. All test decisions are explicitly labeled automated and their uniquely owned fixtures cleaned up.
- M5 live deployment acceptance verified fresh real generation, review-link issuance, explicit automated approval, manager Markdown export, client JSON export, and invalid-token rejection. Exported artifacts retained `published: false`.
- **Production HTTP acceptance:** a fresh real Instagram PASS (1 cycle, 457-character Indonesian draft, five resolved citations) was generated through the running compiled server. Manager overview was eligible only after that PASS; link issuance returned 201; a real browser opened `/review#token=…`, cleared the fragment before API calls, kept no credential in localStorage/sessionStorage/DOM, showed the exact version and `KATAVA-DEMO-GUARDRAILS`, then required select → confirm to approve. Replay returned 409; manager overview showed `client_approved` with one consumed link; edit produced a new unreviewed v2 and the old session returned 410. Unauthorized 401, foreign origin 403 and cross-site 403 were verified. Nothing was published. These are automated browser/HTTP decisions, **not real customer approval**.
- **Browser layout:** desktop 1440px and mobile 390px rendered with no horizontal overflow; `/review` served `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, CSP `frame-ancestors 'none'`, `X-Robots-Tag: noindex, nofollow` and `Cache-Control: no-store`.
- **Gateway residual risk:** earlier fresh generations encountered a timeout and an invalid Reviewer severity; both correctly failed closed as `review_incomplete`, with no fabricated PASS. Transient timeout/network/selected HTTP failures now receive at most one bounded retry under the caller's deadline. Invalid output is never retried into a fabricated PASS. Before the surprise test, verify `npm run verify:llm` and keep the demo policy active.
- This prototype has manager-key authorization and token-scoped client review, but **no general multi-user authentication, tenant isolation, global rate limiting or durable queue**. The public sandbox is demonstration hosting, not a production multi-tenant deployment; open generation can consume the configured AI quota, and redeployment may start with a fresh SQLite database.

## Repository layout

| Path | Responsibility |
| --- | --- |
| `app/page.tsx` | Quick Test UI: truth sheet, live progress, per-format results and audits |
| `app/api/generate/route.ts` | JSON and NDJSON generation endpoint |
| `app/api/audit/[contentItemId]/route.ts` | Persisted audit trail |
| `lib/generation.ts` | Bounded multi-format batch orchestration |
| `lib/generation-stream.ts` | NDJSON stream decoder |
| `lib/orchestrator.ts` | Bounded review loop, escalation, atomic PASS persistence |
| `lib/agents/` | Planner, Writer, Reviewer prompts and output contracts |
| `lib/rules/` | Deterministic rule engine and brief preflight guard |
| `lib/ingestion.ts` | Source-backed fact extraction with excerpts |
| `lib/llm-adapter.ts` | OpenAI-compatible adapter, timeouts, redaction |
| `lib/approval-service.ts` / `content-integrity.ts` | Exact-version evidence, links, atomic decisions and edit invalidation |
| `lib/export-service.ts` / `ExportRecord` | Integrity-gated artifacts and append-only export evidence |
| `lib/approval-http.ts` | Manager authorization, same-origin validation and safe errors |
| `app/approval-controls.tsx` | Manager link/decision/edit controls |
| `app/review/` | Minimal client review and explicit confirmation UI |
| `app/api/approvals/` / `app/api/review/` | Manager operations and token-scoped client routes |
| `scripts/setup-approval.ts` | Safe idempotent local manager credential setup |
| `prisma/` | Existing schema and demo seed; M4 requires no migration |
| `tests/` | Pipeline and Milestones 2–5 contract/gated live suites |
