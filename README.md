# Katava Studio

Source-grounded creator agents for multi-format marketing content, with deterministic guardrails, bounded review cycles, and an append-only audit trail.

Built for **Tencent Cloud Hackathon Indonesia 2026 — Challenge C: The Creator Agent**.

> **Prototype status (2026-11-06):** Milestones 1–3 are implemented and locally verified. Human approval / client review portal (Milestone 4) and deployment are **not** implemented. A `PASS` here is a demo policy verdict only — it is not approval, publication, certification, or legal advice.

## What it does

Katava Studio takes a product sheet as its single source of truth and produces content for **Instagram captions, TikTok/Reels scripts, and Marketplace listings**:

- **Planner → Writer → Reviewer** are distinct LLM calls with Zod-validated structured output.
- A deterministic **Rule Engine** checks claims and citations. Its hard blocks cannot be overridden by a Reviewer `PASS`.
- The review loop is bounded to **3 cycles**; non-remediable demands escalate at preflight before any model call.
- Any missing key, HTTP error, timeout, malformed JSON, or invalid citation fails closed as `review_incomplete`. No successful agent run is ever simulated.
- Every version, agent message, finding, and decision is persisted as an append-only audit trail with resolved source excerpts.
- Formats share one campaign and the exact same persisted fact IDs. Two items run concurrently per request; a third is queued.
- `POST /api/generate` streams real NDJSON progress events (`started`, `progress`, `result`, `complete`) for the Quick Test UI.

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
npm run db:push
npm run db:seed
npm run verify:llm          # real API call; must return a non-empty completion
npm run dev
```

Open <http://localhost:3000>. Detailed LLM configuration, verification, and fail-closed behaviour are documented in [`docs/LLM_SETUP.md`](docs/LLM_SETUP.md).

**Never commit `.env`.** The repository contains no credentials; `.env*` is gitignored except `.env.example`.

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
| `npm run db:push` / `db:seed` | Create / seed the local SQLite database |

## Verification notes

- `configured` (key present) is deliberately distinguished from `accessible` (a real completion was received).
- Deterministic tests inject a **scripted transport** that is forbidden in production. They are contract evidence only, never proof of a working LLM integration.
- Live tests are gated behind `KATAVA_RUN_LIVE_LLM_TESTS=1` and require a verified gateway first.
- The 90-second budget is a **per-item execution deadline** after queue admission, not a whole-batch completion guarantee.
- This local MVP has no authentication, global rate limiting, or durable queue. Do not expose it publicly without adding those controls.

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
| `prisma/` | Schema and demo seed data |
| `tests/` | Pipeline, Milestone 2 and Milestone 3 suites |
