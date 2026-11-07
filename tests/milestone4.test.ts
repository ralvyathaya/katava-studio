// Milestone 4 deterministic storage/security contracts. Synthetic policy evidence
// is unit evidence only, NEVER proof that an LLM or real human approved a draft.
import "./load-env";
import { after, afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { approvalOverview, issueReviewLink, revokeReviewLink, getClientReview, recordClientDecision,
  editDraft, decisionSchema, ApprovalError } from "../lib/approval-service";
import { contentDigest, sha256, sourceDigest, policyDigest } from "../lib/content-integrity";
import { assertApprovalOrigin, assertManager, approvalBody, approvalFailure } from "../lib/approval-http";
import type { Fact } from "../lib/types";
import { planManagerSetup } from "../scripts/setup-approval";

const p = new PrismaClient();
const prefix = `m4-unit-${randomUUID()}`;
const campaigns = new Set<string>();
let policyId: string;
let reviewedPolicyHash: string;
let fallbackPolicy: string | null = null;
before(async () => {
  let policy = await p.rulebookVersion.findFirst({ where: { isActive: true }, include: { rules: true } });
  if (!policy) {
    // Restore the real seeded policy when present; only create a synthetic
    // fallback for a database with no rulebook at all, and clean it up later.
    const seeded = await p.rulebookVersion.findFirst({ where: { rulebookId: "KATAVA-DEMO-GUARDRAILS" }, include: { rules: true } });
    if (seeded && seeded.rules.length === 6) {
      policy = await p.rulebookVersion.update({ where: { id: seeded.id }, data: { isActive: true }, include: { rules: true } });
    } else {
      policy = await p.rulebookVersion.create({ data: { rulebookId: prefix, version: "0.1", authority: "Synthetic unit policy only; not law.", isActive: true,
        rules: { create: Array.from({ length: 6 }, (_, i) => ({ ruleId: `DEMO-GUARD-${String(i + 1).padStart(3, "0")}`, policyText: "Unit policy", requiredEvidence: "Unit evidence only" })) } }, include: { rules: true } });
      fallbackPolicy = policy.id;
    }
  }
  policyId = policy.id;
  reviewedPolicyHash = policyDigest(policy);
});
async function fixture(status = "review_passed", format = "instagram") {
  const c = await p.campaign.create({ data: { name: prefix, brandName: "CalmLeaf", campaignGoal: prefix, audience: "Unit audience" } });
  campaigns.add(c.id);
  const source = await p.productSource.create({ data: { campaignId: c.id, rawText: "Ingredients: Chamomile\nPackage: 20 tea bags" } });
  const fact = await p.productFact.create({ data: { productSourceId: source.id, factKey: "ingredients", statement: "Contains chamomile.",
    status: "source_backed", sourceExcerpt: "Ingredients: Chamomile" } });
  const item = await p.contentItem.create({ data: { campaignId: c.id, status, format } });
  const text = format === "reels" ? "Scene 1 (0-10s)\nVisual: Tea on a table.\nVO: Kenali teh chamomile.\nOverlay: Chamomile.\nScene 2 (10-20s)\nVisual: A cup of tea.\nVO: Yuk kenali bahannya.\nOverlay: Kenali bahannya." : "Kenali teh dengan chamomile. Yuk, kenali bahan-bahannya.";
  const v = await p.contentVersion.create({ data: { contentItemId: item.id, draftText: text, citedFactIds: JSON.stringify([fact.id]) } });
  const facts: Fact[] = [{ id: fact.id, factKey: fact.factKey, statement: fact.statement, status: "source_backed", sourceExcerpt: fact.sourceExcerpt! }];
  const reviewer = await p.agentRun.create({ data: { contentItemId: item.id, contentVersionId: v.id, agentName: "reviewer", agentRole: "reviewer", inputSummary: "Synthetic fixture only",
    modelId: "synthetic-m4-unit-evidence", outputValid: true, outputRaw: JSON.stringify({ verdict: "PASS", findings: [], summary: "Synthetic unit evidence only", reviewerModelId: "synthetic-m4-unit-evidence", rulebookVersionId: policyId }) } });
  await p.auditEvent.create({ data: { campaignId: c.id, contentItemId: item.id, contentVersionId: v.id,
    actor: "orchestrator", action: "review_passed", verdict: "PASS", rulebookVersion: policyId,
    details: JSON.stringify({ contentVersionId: v.id, contentDigest: contentDigest(text, v.citedFactIds, format), sourceDigest: sourceDigest(facts),
      policyDigest: reviewedPolicyHash, reviewerRunId: reviewer.id, reviewerDigest: sha256(reviewer.outputRaw ?? "") }) } });
  return { c, item, v, fact };
}
async function link(f: Awaited<ReturnType<typeof fixture>>) {
  return issueReviewLink(f.item.id, { contentVersionId: f.v.id, expiresInHours: 1 });
}
async function expectCode(action: () => Promise<unknown>, code: string) {
  await assert.rejects(action, (e: unknown) => e instanceof ApprovalError && e.code === code);
}
async function count(itemId: string) { return p.approval.count({ where: { contentItemId: itemId } }); }
async function cleanup() {
  for (const id of campaigns) {
    const c = await p.campaign.findUnique({ where: { id }, include: { productSource: true, contentItems: true } });
    if (!c) continue;
    assert.equal(c.campaignGoal, prefix, "Never remove user evidence");
    const itemIds = c.contentItems.map(i => i.id);
    const items = { contentItemId: { in: itemIds } };
    await p.approval.deleteMany({ where: items });
    await p.reviewLink.deleteMany({ where: { campaignId: id } });
    await p.auditEvent.deleteMany({ where: { campaignId: id } });
    await p.agentRun.deleteMany({ where: items });
    await p.reviewFinding.deleteMany({ where: items });
    await p.contentVersion.deleteMany({ where: items });
    await p.contentItem.deleteMany({ where: { campaignId: id } });
    if (c.productSource) { await p.productFact.deleteMany({ where: { productSourceId: c.productSource.id } }); await p.productSource.delete({ where: { id: c.productSource.id } }); }
    await p.campaign.delete({ where: { id } });
  }
  campaigns.clear();
}
afterEach(cleanup);
after(async () => {
  await cleanup();
  if (fallbackPolicy) { await p.ruleEntry.deleteMany({ where: { rulebookVersionId: fallbackPolicy } }); await p.rulebookVersion.delete({ where: { id: fallbackPolicy } }); }
  await p.$disconnect();
});

describe("M4 version-bound review links (synthetic evidence only)", { concurrency: false }, () => {
  it("stores only a token hash, binds exact version, GET/read never approves, and exposes a minimal client DTO", async () => {
    const f = await fixture(); const l = await link(f);
    assert.equal(l.token.length, 43);
    const stored = await p.reviewLink.findUniqueOrThrow({ where: { id: l.link.id } });
    assert.equal(stored.tokenHash, sha256(l.token));
    assert.ok(!JSON.stringify(stored).includes(l.token));
    const r = await getClientReview(l.token);
    assert.equal(r.contentVersionId, f.v.id); assert.equal(r.canDecide, true);
    assert.equal(r.citations.length, 1); assert.equal(r.citations[0].sourceExcerpt, f.fact.sourceExcerpt);
    assert.equal(await count(f.item.id), 0);
    assert.ok(!("agentRuns" in r) && !("tokenHash" in r) && !("rawText" in r));
    const audit = await p.auditEvent.findMany({ where: { contentItemId: f.item.id } });
    assert.ok(!JSON.stringify(audit).includes(l.token));
    assert.equal((await p.contentItem.findUniqueOrThrow({ where: { id: f.item.id } })).status, "awaiting_client_approval");
  });
  it("requires an explicit action before client_approved; atomically appends approval and audit", async () => {
    const f = await fixture(); const l = await link(f);
    const result = await recordClientDecision({ token: l.token, contentVersionId: f.v.id, decision: "approved" });
    assert.equal(result.status, "client_approved"); assert.equal(result.published, false); assert.equal(result.approval.approvedBy, "client_via_link");
    const overview = await approvalOverview(f.item.id);
    assert.equal(overview.currentApproval?.contentVersionId, f.v.id);
    assert.equal(overview.links[0].state, "consumed"); assert.equal(overview.eligible, false);
    assert.equal((await getClientReview(l.token)).canDecide, false);
    assert.equal(await p.auditEvent.count({ where: { contentItemId: f.item.id, action: "client_approved", contentVersionId: f.v.id } }), 1);
  });
  for (const action of ["rejected", "revision_requested"] as const) it(`persists ${action} with mandatory feedback; never marks client_approved`, async () => {
    const f = await fixture(); const l = await link(f);
    assert.equal(decisionSchema.safeParse({ token: l.token, contentVersionId: f.v.id, decision: action }).success, false);
    const result = await recordClientDecision({ token: l.token, contentVersionId: f.v.id, decision: action, comment: "Please revise this exact draft." });
    assert.equal(result.approval.status, action); assert.notEqual(result.status, "client_approved");
    assert.equal((await approvalOverview(f.item.id)).currentApproval, null);
  });
  it("rejects decision replay and conflicting actions without duplicate evidence", async () => {
    const f = await fixture(); const l = await link(f);
    await recordClientDecision({ token: l.token, contentVersionId: f.v.id, decision: "approved" });
    await expectCode(() => recordClientDecision({ token: l.token, contentVersionId: f.v.id, decision: "rejected", comment: "Change vote" }), "consumed");
    assert.equal(await count(f.item.id), 1);
  });
  it("permits only one winner when approval and rejection race", async () => {
    const f = await fixture(); const l = await link(f);
    const results = await Promise.allSettled([
      recordClientDecision({ token: l.token, contentVersionId: f.v.id, decision: "approved" }),
      recordClientDecision({ token: l.token, contentVersionId: f.v.id, decision: "rejected", comment: "Race fixture" }),
    ]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(await count(f.item.id), 1);
    assert.equal(await p.auditEvent.count({ where: { contentItemId: f.item.id, action: { in: ["client_approved", "client_rejected"] } } }), 1);
  });
  it("blocks expired tokens without approval or status changes", async () => {
    const f = await fixture(); const l = await link(f);
    await p.reviewLink.update({ where: { id: l.link.id }, data: { expiresAt: new Date(0) } });
    await expectCode(() => getClientReview(l.token), "expired");
    await expectCode(() => recordClientDecision({ token: l.token, contentVersionId: f.v.id, decision: "approved" }), "expired");
    assert.equal(await count(f.item.id), 0);
  });
  it("blocks revoked and replaced links without affecting sibling items", async () => {
    const f = await fixture(); const sibling = await fixture(); const l = await link(f); const other = await link(sibling);
    const replacement = await link(f);
    await expectCode(() => getClientReview(l.token), "revoked");
    assert.equal((await getClientReview(other.token)).canDecide, true);
    await revokeReviewLink(f.item.id, replacement.link.id);
    await expectCode(() => getClientReview(replacement.token), "revoked");
    await expectCode(() => revokeReviewLink(f.item.id, other.link.id), "not_found");
  });
  it("blocks tampered token, cross-item/cross-version decisions and unknown operations", async () => {
    const f = await fixture(); const other = await fixture(); const l = await link(f);
    const bad = (l.token[0] === "A" ? "B" : "A") + l.token.slice(1);
    await expectCode(() => getClientReview(bad), "invalid_link");
    await expectCode(() => recordClientDecision({ token: l.token, contentVersionId: other.v.id, decision: "approved" }), "stale_version");
    assert.equal(await count(f.item.id), 0); assert.equal(await count(other.item.id), 0);
  });
  it("fails closed for malformed, cross-campaign and legacy scope", async () => {
    const f = await fixture(); const other = await fixture(); const l = await link(f);
    const row = await p.reviewLink.findUniqueOrThrow({ where: { id: l.link.id } });
    await p.reviewLink.update({ where: { id: row.id }, data: { scope: "[\"legacy-item\"]" } });
    await expectCode(() => getClientReview(l.token), "invalid_scope");
    await p.reviewLink.update({ where: { id: row.id }, data: { scope: row.scope, campaignId: other.c.id } });
    await expectCode(() => getClientReview(l.token), "invalid_scope");
  });
  it("rejects older M3 PASS without version/integrity binding, preserves audit", async () => {
    const f = await fixture();
    await p.auditEvent.updateMany({ where: { contentItemId: f.item.id }, data: { contentVersionId: null, details: "{\"verdict\":\"PASS\"}" } });
    await expectCode(() => link(f), "review_required");
    assert.equal(await p.auditEvent.count({ where: { contentItemId: f.item.id } }), 1);
  });
  for (const status of ["created", "reviewing", "review_incomplete", "escalated", "client_approved"]) it(`rejects link issuance for ${status}`, async () => {
    const f = await fixture(status);
    await expectCode(() => link(f), "not_eligible");
    assert.equal(await p.reviewLink.count({ where: { campaignId: f.c.id } }), 0);
  });
  it("invalidates a link when a later unreviewed version is appended", async () => {
    const f = await fixture(); const l = await link(f);
    await p.contentVersion.create({ data: { contentItemId: f.item.id, versionNumber: 2, revisionOfId: f.v.id,
      draftText: "New unreviewed draft", citedFactIds: f.v.citedFactIds } });
    await expectCode(() => getClientReview(l.token), "stale_version");
    assert.equal(await count(f.item.id), 0);
  });
  it("detects in-place content and source evidence tampering", async () => {
    const f = await fixture(); const l = await link(f);
    await p.contentVersion.update({ where: { id: f.v.id }, data: { draftText: "Changed chamomile caption without review." } });
    await expectCode(() => getClientReview(l.token), "evidence_changed");
    await p.contentVersion.update({ where: { id: f.v.id }, data: { draftText: f.v.draftText } });
    await p.productFact.update({ where: { id: f.fact.id }, data: { statement: "Changed source evidence." } });
    await expectCode(() => getClientReview(l.token), "evidence_changed");
  });
  it("format tampering invalidates previously reviewed content", async () => {
    const f = await fixture(); const l = await link(f);
    await p.contentItem.update({ where: { id: f.item.id }, data: { format: "marketplace" } });
    await expectCode(() => getClientReview(l.token), "evidence_changed");
  });
  it("tampering with canonical Reviewer evidence cannot authorize approval", async () => {
    const f = await fixture(); const l = await link(f);
    await p.agentRun.updateMany({ where: { contentItemId: f.item.id }, data: { outputRaw: "{\"verdict\":\"PASS\"}" } });
    await expectCode(() => getClientReview(l.token), "review_required");
  });
  it("an in-place edit after approval removes current certification but preserves history", async () => {
    const f = await fixture(); const l = await link(f);
    await recordClientDecision({ token: l.token, contentVersionId: f.v.id, decision: "approved" });
    await p.contentVersion.update({ where: { id: f.v.id }, data: { draftText: "Changed draft after human approval." } });
    const overview = await approvalOverview(f.item.id);
    assert.equal(overview.currentApproval, null); assert.equal(overview.approvals.length, 1);
  });
  it("complete canonical Reviewer output beyond 4000 characters is accepted", async () => {
    const f = await fixture();
    const run = await p.agentRun.findFirstOrThrow({ where: { contentItemId: f.item.id } });
    const data = JSON.parse(run.outputRaw!); data.summary = "Synthetic-only long validated summary. ".repeat(200);
    const raw = JSON.stringify(data);
    assert.ok(raw.length > 4000);
    await p.agentRun.update({ where: { id: run.id }, data: { outputRaw: raw } });
    const pass = await p.auditEvent.findFirstOrThrow({ where: { contentItemId: f.item.id } });
    const details = JSON.parse(pass.details); details.reviewerDigest = sha256(raw);
    await p.auditEvent.update({ where: { id: pass.id }, data: { details: JSON.stringify(details) } });
    const l = await link(f); assert.equal((await getClientReview(l.token)).canDecide, true);
  });
  it("human actions cannot override deterministic hard blocks even with synthetic Reviewer PASS", async () => {
    const f = await fixture();
    await p.contentVersion.update({ where: { id: f.v.id }, data: { draftText: "This tea cures insomnia and is halal certified." } });
    await expectCode(() => link(f), "hard_block");
    assert.equal(await count(f.item.id), 0);
  });
  it("editing an approved version appends history, revokes links, and requires review again", async () => {
    const f = await fixture(); const l = await link(f);
    await recordClientDecision({ token: l.token, contentVersionId: f.v.id, decision: "approved" });
    const edited = await editDraft(f.item.id, { contentVersionId: f.v.id, draftText: "Kenali teh chamomile dalam draft baru yang belum ditinjau." });
    assert.equal(edited.status, "review_incomplete"); assert.equal(edited.versionNumber, 2);
    const overview = await approvalOverview(f.item.id);
    assert.equal(overview.currentApproval, null); assert.equal(overview.approvals.length, 1); assert.equal(overview.eligible, false);
    assert.equal((await p.contentVersion.findUniqueOrThrow({ where: { id: f.v.id } })).draftText, f.v.draftText);
    await expectCode(() => getClientReview(l.token), "revoked");
    assert.equal(await p.auditEvent.count({ where: { contentItemId: f.item.id, action: "draft_edited_review_required" } }), 1);
  });
  it("redacts the link credential from submitted comments", async () => {
    const f = await fixture(); const l = await link(f);
    await recordClientDecision({ token: l.token, contentVersionId: f.v.id, decision: "revision_requested", comment: `Please fix this. ${l.token}` });
    const approvals = await p.approval.findMany({ where: { contentItemId: f.item.id } });
    assert.ok(!JSON.stringify(approvals).includes(l.token)); assert.match(approvals[0].comment!, /REDACTED/);
  });
  it("rolls back approval, item state and link consumption if audit insertion fails", async () => {
    const f = await fixture(); const l = await link(f);
    const trigger = `m4_fail_${randomUUID().replace(/-/g, "")}`;
    await p.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON AuditEvent WHEN NEW.contentItemId = '${f.item.id}' AND NEW.action = 'client_approved' BEGIN SELECT RAISE(ABORT, 'synthetic owned test failure'); END`);
    try {
      await assert.rejects(() => recordClientDecision({ token: l.token, contentVersionId: f.v.id, decision: "approved" }));
      assert.equal(await count(f.item.id), 0);
      assert.equal((await p.contentItem.findUniqueOrThrow({ where: { id: f.item.id } })).status, "awaiting_client_approval");
      assert.equal((await getClientReview(l.token)).canDecide, true);
    } finally { await p.$executeRawUnsafe(`DROP TRIGGER ${trigger}`); }
  });
});

describe("M4 LIVE gateway and approval route handlers (automated test decisions, not customer approval)", {
  skip: process.env.KATAVA_RUN_LIVE_LLM_TESTS !== "1", concurrency: false,
}, () => {
  it("connects fresh real Instagram/Reels PASS evidence to version-bound links, explicit test decisions, replay rejection and edit invalidation", async () => {
    const { __setLLMTransportForTests } = await import("../lib/llm-adapter");
    __setLLMTransportForTests(null); // Never simulate provider success.
    assert.ok((process.env.KATAVA_MANAGER_KEY?.trim().length ?? 0) >= 32, "Configure the separate local manager key first");
    const { NextRequest } = await import("next/server");
    const { POST: generate } = await import("../app/api/generate/route");
    const { POST: manager } = await import("../app/api/approvals/[contentItemId]/route");
    const { POST: session } = await import("../app/api/review/session/route");
    const { POST: decide } = await import("../app/api/review/decision/route");
    const origin = process.env.KATAVA_PUBLIC_ORIGIN || "http://localhost:3001";
    const request = (path: string, body: unknown, authorized = false) => new Request(origin + path, {
      method: "POST", headers: { origin, "Content-Type": "application/json",
        ...(authorized ? { "X-Katava-Manager-Key": process.env.KATAVA_MANAGER_KEY! } : {}) }, body: JSON.stringify(body),
    });
    const managed = (itemId: string, body: unknown, authorized = true) => manager(request(`/api/approvals/${itemId}`, body, authorized), {
      params: Promise.resolve({ contentItemId: itemId }),
    });
    const productSheet = `Product name: CalmLeaf Chamomile & Lemongrass Herbal Tea
Brand: CalmLeaf (fictional)
Category: Packaged herbal tea beverage/food
Ingredients: Chamomile, lemongrass
Package: 20 tea bags
Serving suggestion: Steep one bag in hot water.
Brand tone: Warm, straightforward, informative.
Supported product facts: Contains chamomile and lemongrass; sold in a box with 20 tea bags.
Claims NOT supplied as verified: organic certification; halal certification; BPOM registration; clinically proven effects; sleep/insomnia cure; testimonials; price.`;
    const started = Date.now();
    let batch: { results: Array<{ contentItemId: string; format: string; status: string; failureReason?: string; reviewCycles: number }> };
    try {
      const response = await generate(new NextRequest(origin + "/api/generate", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productSheet, creativeBrief: "Announce the tea in Indonesian using ingredients and preparation only. Avoid all efficacy and certification claims.",
          campaignGoal: prefix, audience: "Automated M4 acceptance fixture only; not customer content", formats: ["instagram", "reels"] }) }));
      assert.equal(response.status, 200);
      batch = await response.json();
    } finally {
      // Even a failed generation is owned by this unique test prefix. No user rows.
      const owned = await p.campaign.findMany({ where: { campaignGoal: prefix } });
      for (const c of owned) campaigns.add(c.id);
    }
    assert.equal(batch.results.length, 2);
    const summaries = [];
    for (const result of batch.results) {
      assert.equal(result.status, "review_passed", result.failureReason ?? "A real policy PASS is required, not just HTTP 200");
      assert.equal((await managed(result.contentItemId, { action: "overview" }, false)).status, 401);
      const context = await (await managed(result.contentItemId, { action: "overview" })).json();
      assert.equal(context.eligible, true); assert.equal(context.currentApproval, null);
      const issue = await managed(result.contentItemId, { action: "issue", contentVersionId: context.currentVersionId, expiresInHours: 1 });
      assert.equal(issue.status, 201);
      const issued = await issue.json();
      const read = await session(request("/api/review/session", { token: issued.token }));
      assert.equal(read.status, 200); assert.equal(read.headers.get("Referrer-Policy"), "no-referrer");
      const view = await read.json();
      assert.equal(view.decision, null); assert.equal(await count(result.contentItemId), 0);
      assert.ok(view.citations.length > 0 && view.citations.every((f: Fact) => f.status === "source_backed" && f.sourceExcerpt));
      const action = result.format === "instagram" ? "approved" : "revision_requested";
      const decision = { token: issued.token, contentVersionId: context.currentVersionId, decision: action,
        comment: "Automated acceptance test decision only; not genuine customer sign-off." };
      const saved = await decide(request("/api/review/decision", decision));
      assert.equal(saved.status, 200); assert.equal((await saved.json()).published, false);
      assert.equal((await decide(request("/api/review/decision", decision))).status, 409);
      const after = await (await managed(result.contentItemId, { action: "overview" })).json();
      assert.equal(after.currentApproval !== null, action === "approved"); assert.equal(after.approvals.length, 1);
      const agents = await p.agentRun.findMany({ where: { contentItemId: result.contentItemId } });
      assert.ok(agents.filter(a => ["planner", "writer", "reviewer"].includes(a.agentName)).every(a => a.modelId && !/scripted|synthetic/i.test(a.modelId)));
      const edited = await managed(result.contentItemId, { action: "edit", contentVersionId: context.currentVersionId,
        draftText: view.draftText + "\nCatatan: draft revisi untuk pengujian saja." });
      assert.equal(edited.status, 200); assert.equal((await edited.json()).status, "review_incomplete");
      assert.equal((await session(request("/api/review/session", { token: issued.token }))).status, 410);
      const final = await (await managed(result.contentItemId, { action: "overview" })).json();
      assert.equal(final.currentApproval, null); assert.equal(final.eligible, false); assert.equal(final.approvals.length, 1);
      const evidence = await p.auditEvent.findMany({ where: { contentItemId: result.contentItemId } });
      assert.ok(!JSON.stringify(evidence).includes(issued.token));
      summaries.push({ format: result.format, cycles: result.reviewCycles, realAgentRuns: agents.length, citations: view.citations.length,
        testDecision: action, replayBlocked: true, editInvalidated: true, published: false });
    }
    console.log("LIVE_M4_EVIDENCE " + JSON.stringify({ elapsedMs: Date.now() - started, results: summaries,
      mode: "real gateway and source route handlers; automated fixture decisions, not real customer approval; not browser/socket/build evidence" }));
  });
});

describe("M4 safe manager setup (pure planning; no local .env writes)", () => {
  const generated = "synthetic-manager-setup-key-32-plus";
  it("appends only an absent assignment and is idempotent", () => {
    const original = 'OPENAI_API_KEY="synthetic-unchanged-model-key"\r\nOPENAI_MODEL="unchanged-model"\r\n';
    const first = planManagerSetup(original, () => generated);
    assert.equal(first.changed, true); assert.ok(first.content.startsWith(original));
    assert.deepEqual(planManagerSetup(first.content, () => { throw new Error("Must not rotate"); }), { changed: false, content: first.content });
  });
  it("fills a copied blank template, preserving all other bytes and comments", () => {
    for (const assignment of ['KATAVA_MANAGER_KEY=""', "KATAVA_MANAGER_KEY=''", "KATAVA_MANAGER_KEY=", 'export KATAVA_MANAGER_KEY="" # a long configuration comment']) {
      const original = `OPENAI_MODEL="unchanged"\r\n${assignment}\r\nDATABASE_URL="file:./dev.db"\r\n`;
      const plan = planManagerSetup(original, () => generated);
      assert.equal(plan.changed, true); assert.ok(plan.content.includes(`KATAVA_MANAGER_KEY="${generated}"`));
      assert.equal(plan.content.split("\r\n")[0], original.split("\r\n")[0]);
      assert.equal(plan.content.split("\r\n")[2], original.split("\r\n")[2]);
      if (assignment.includes("#")) assert.ok(plan.content.includes("# a long configuration comment"));
    }
  });
  it("never treats an inline comment as credential length or overwrites a short nonempty key", () => {
    assert.throws(() => planManagerSetup('KATAVA_MANAGER_KEY="short" # a sufficiently long configuration comment'), /too short/);
    assert.throws(() => planManagerSetup("KATAVA_MANAGER_KEY=short # a sufficiently long configuration comment"), /too short/);
    const original = `KATAVA_MANAGER_KEY="${generated}" # preserved comment`;
    assert.equal(planManagerSetup(original).changed, false);
  });
  it("rejects duplicate, unterminated or interpolated assignments without creating a key", () => {
    for (const original of ['KATAVA_MANAGER_KEY=""\nKATAVA_MANAGER_KEY=""', 'KATAVA_MANAGER_KEY="unterminated', 'KATAVA_MANAGER_KEY="${OTHER_SECRET}"']) {
      assert.throws(() => planManagerSetup(original, () => { throw new Error("Must not generate"); }), /Duplicate|one-line literal|interpolation/);
    }
  });
});

describe("M4 HTTP authorization boundaries", () => {
  let deployedPublicOrigin: string | undefined;
  before(() => {
    // Local deployment configuration must not change the default-origin
    // contract under test. The explicit-origin case below sets its own value.
    deployedPublicOrigin = process.env.KATAVA_PUBLIC_ORIGIN;
    delete process.env.KATAVA_PUBLIC_ORIGIN;
  });
  after(() => {
    if (deployedPublicOrigin === undefined) delete process.env.KATAVA_PUBLIC_ORIGIN;
    else process.env.KATAVA_PUBLIC_ORIGIN = deployedPublicOrigin;
  });

  it("fails closed without manager configuration and rejects a missing/wrong key", () => {
    const original = process.env.KATAVA_MANAGER_KEY;
    try {
      delete process.env.KATAVA_MANAGER_KEY;
      assert.throws(() => assertManager(new Request("http://localhost:3000/api")), /Set a separate/);
      process.env.KATAVA_MANAGER_KEY = "synthetic-manager-unit-credential-32-plus";
      assert.throws(() => assertManager(new Request("http://localhost:3000/api")), /authorization required/);
      assert.throws(() => assertManager(new Request("http://localhost:3000/api", { headers: { "x-katava-manager-key": "wrong" } })), /authorization required/);
      assertManager(new Request("http://localhost:3000/api", { headers: { "x-katava-manager-key": process.env.KATAVA_MANAGER_KEY } }));
    } finally { if (original === undefined) delete process.env.KATAVA_MANAGER_KEY; else process.env.KATAVA_MANAGER_KEY = original; }
  });
  it("requires same-origin JSON and rejects absent Origin, foreign Origin and form bodies", () => {
    const request = (origin?: string, type = "application/json") => new Request("http://localhost:3000/api", { method: "POST", headers: { ...(origin ? { origin } : {}), "content-type": type }, body: "{}" });
    assert.throws(() => assertApprovalOrigin(request()), /same-origin/);
    assert.throws(() => assertApprovalOrigin(request("https://attacker.example")), /same-origin/);
    assert.throws(() => assertApprovalOrigin(request("http://localhost:3000", "text/plain")), /application\/json/);
    assert.throws(() => assertApprovalOrigin(request("http://localhost:3000", "application/json-evil")), /application\/json/);
    assertApprovalOrigin(request("http://localhost:3000"));
  });
  it("keeps exactly one active real demo policy, never a synthetic test policy", async () => {
    const active = await p.rulebookVersion.findMany({ where: { isActive: true }, include: { rules: true } });
    assert.equal(active.length, 1, "Exactly one active policy must govern real generation");
    assert.equal(active[0].rulebookId, "KATAVA-DEMO-GUARDRAILS");
    assert.equal(active[0].rules.length, 6);
    assert.ok(!/TEST|FALLBACK|m4-unit/i.test(active[0].rulebookId));
  });
  it("never trusts Host or x-forwarded-* headers; only an exact configured origin can change the default", () => {
    const request = (host: string, origin: string, forwardedProto?: string) => new Request("http://localhost:3001/api", { method: "POST",
      headers: { host, origin, "content-type": "application/json", ...(forwardedProto ? { "x-forwarded-proto": forwardedProto } : {}) }, body: "{}" });
    assertApprovalOrigin(request("localhost:3001", "http://localhost:3001"));
    // Next.js can normalize request.url to localhost even on a 127.0.0.1 bind.
    // That alias is NOT implicitly trusted: set KATAVA_PUBLIC_ORIGIN explicitly.
    assert.throws(() => assertApprovalOrigin(request("127.0.0.1:3001", "http://127.0.0.1:3001")), /same-origin/);
    assert.throws(() => assertApprovalOrigin(request("attacker.example", "http://attacker.example")), /same-origin/);
    assert.throws(() => assertApprovalOrigin(request("localhost:3001", "https://localhost:3001", "https")), /same-origin/);
  });
  it("uses an explicit canonical origin when configured and rejects all other origins", () => {
    const original = process.env.KATAVA_PUBLIC_ORIGIN;
    try {
      process.env.KATAVA_PUBLIC_ORIGIN = "http://127.0.0.1:3001";
      const request = (host: string, origin: string) => new Request("http://localhost:3001/api", { method: "POST",
        headers: { host, origin, "content-type": "application/json" }, body: "{}" });
      assertApprovalOrigin(request("127.0.0.1:3001", "http://127.0.0.1:3001"));
      assert.throws(() => assertApprovalOrigin(request("127.0.0.1:3001", "http://localhost:3001")), /same-origin/);
      assert.throws(() => assertApprovalOrigin(request("127.0.0.1:3001", "http://attacker.example")), /same-origin/);
    } finally { if (original === undefined) delete process.env.KATAVA_PUBLIC_ORIGIN; else process.env.KATAVA_PUBLIC_ORIGIN = original; }
  });
  it("rejects oversize/malformed JSON bodies and never echoes raw storage diagnostics", async () => {
    await assert.rejects(() => approvalBody(new Request("http://localhost", { method: "POST", body: "x".repeat(90001) })), /too large/);
    await assert.rejects(() => approvalBody(new Request("http://localhost", { method: "POST", body: "{" })), /Invalid JSON/);
    const response = approvalFailure(new Error("secret storage diagnostic"));
    assert.equal(response.status, 503); assert.equal(response.headers.get("Cache-Control"), "no-store, private, max-age=0");
    assert.ok(!(await response.text()).includes("secret storage diagnostic"));
  });
});
