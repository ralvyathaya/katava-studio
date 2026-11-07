// Milestone 5: approval-gated content export. Synthetic policy evidence is unit
// evidence only, NEVER proof that an LLM or real human approved a draft. The export
// gate re-validates the exact approved version and fails closed before any file.
import "./load-env";
import { after, afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { issueReviewLink, getClientReview, recordClientDecision, ApprovalError } from "../lib/approval-service";
import { exportApprovedVersion, exportFormatSchema } from "../lib/export-service";
import { contentDigest, sha256, sourceDigest, policyDigest } from "../lib/content-integrity";
import type { Fact } from "../lib/types";

const p = new PrismaClient();
const prefix = `m5-unit-${randomUUID()}`;
const campaigns = new Set<string>();
let policyId: string;
let reviewedPolicyHash: string;
let fallbackPolicy: string | null = null;
before(async () => {
  let policy = await p.rulebookVersion.findFirst({ where: { isActive: true }, include: { rules: true } });
  if (!policy) {
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
    modelId: "synthetic-m5-unit-evidence", outputValid: true, outputRaw: JSON.stringify({ verdict: "PASS", findings: [], summary: "Synthetic unit evidence only", reviewerModelId: "synthetic-m5-unit-evidence", rulebookVersionId: policyId }) } });
  await p.auditEvent.create({ data: { campaignId: c.id, contentItemId: item.id, contentVersionId: v.id,
    actor: "orchestrator", action: "review_passed", verdict: "PASS", rulebookVersion: policyId,
    details: JSON.stringify({ contentVersionId: v.id, contentDigest: contentDigest(text, v.citedFactIds, format), sourceDigest: sourceDigest(facts),
      policyDigest: reviewedPolicyHash, reviewerRunId: reviewer.id, reviewerDigest: sha256(reviewer.outputRaw ?? "") }) } });
  return { c, item, v, fact };
}
async function link(f: Awaited<ReturnType<typeof fixture>>) {
  return issueReviewLink(f.item.id, { contentVersionId: f.v.id, expiresInHours: 1 });
}
async function approve(f: Awaited<ReturnType<typeof fixture>>) {
  const l = await link(f);
  await recordClientDecision({ token: l.token, contentVersionId: f.v.id, decision: "approved" });
  return l;
}
async function expectCode(action: () => Promise<unknown>, code: string) {
  await assert.rejects(action, (e: unknown) => e instanceof ApprovalError && e.code === code);
}
async function cleanup() {
  for (const id of campaigns) {
    const c = await p.campaign.findUnique({ where: { id }, include: { productSource: true, contentItems: true } });
    if (!c) continue;
    assert.equal(c.campaignGoal, prefix, "Never remove user evidence");
    const itemIds = c.contentItems.map(i => i.id);
    const items = { contentItemId: { in: itemIds } };
    await p.exportRecord.deleteMany({ where: items });
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

describe("M5 export gate fails closed without an explicit approved decision (synthetic evidence only)", { concurrency: false }, () => {
  it("refuses export when no human decision exists for the version", async () => {
    const f = await fixture();
    await expectCode(() => exportApprovedVersion({ contentItemId: f.item.id, contentVersionId: f.v.id, format: "markdown", releasedBy: "manager" }), "not_approved");
    assert.equal(await p.exportRecord.count({ where: { contentItemId: f.item.id } }), 0);
  });
  it("refuses export for a rejected or revision-requested decision", async () => {
    const f = await fixture(); const l = await link(f);
    await recordClientDecision({ token: l.token, contentVersionId: f.v.id, decision: "rejected", comment: "Not acceptable." });
    await expectCode(() => exportApprovedVersion({ contentItemId: f.item.id, contentVersionId: f.v.id, format: "markdown", releasedBy: "manager" }), "not_approved");
    const r = await fixture(); const l2 = await link(r);
    await recordClientDecision({ token: l2.token, contentVersionId: r.v.id, decision: "revision_requested", comment: "Change this." });
    await expectCode(() => exportApprovedVersion({ contentItemId: r.item.id, contentVersionId: r.v.id, format: "markdown", releasedBy: "manager" }), "not_approved");
  });
  it("refuses export of a stale version after an edit appends a new draft", async () => {
    const f = await fixture();
    await approve(f);
    await p.contentVersion.create({ data: { contentItemId: f.item.id, versionNumber: 2, revisionOfId: f.v.id,
      draftText: "New unreviewed draft", citedFactIds: f.v.citedFactIds } });
    await expectCode(() => exportApprovedVersion({ contentItemId: f.item.id, contentVersionId: f.v.id, format: "markdown", releasedBy: "manager" }), "stale_version");
    assert.equal(await p.exportRecord.count({ where: { contentItemId: f.item.id } }), 0);
  });
  it("rejects an unknown export format at the boundary", async () => {
    assert.equal(exportFormatSchema.safeParse("html").success, false);
    assert.equal(exportFormatSchema.safeParse("markdown").success, true);
  });
});

describe("M5 approved export produces an audited artifact for the exact version (synthetic evidence only)", { concurrency: false }, () => {
  it("emits markdown/json/text with a SHA-256 filename and records an ExportRecord plus audit event", async () => {
    const f = await fixture();
    await approve(f);
    const results = [];
    for (const format of ["markdown", "json", "text"] as const) {
      const result = await exportApprovedVersion({ contentItemId: f.item.id, contentVersionId: f.v.id, format, releasedBy: "manager" });
      assert.equal(result.contentVersionId, f.v.id);
      assert.equal(result.filename.startsWith(`katava-approved-${f.item.format}-v${f.v.versionNumber}-`), true);
      assert.ok(result.filename.endsWith(`.${format === "markdown" ? "md" : format}`));
      assert.ok(/^[a-f0-9]{64}$/.test(result.contentHash));
      if (format === "text") assert.equal(result.content, f.v.draftText);
      if (format === "markdown") assert.ok(result.content.includes("DISCLAIMER") && result.content.includes(f.v.draftText));
      if (format === "json") {
        const parsed = JSON.parse(result.content);
        assert.equal(parsed.published, false);
        assert.equal(parsed.reviewerVerdict, "PASS");
        assert.ok(parsed.citations.length >= 1);
        assert.equal(parsed.disclaimer.length > 0, true);
      }
      const rec = await p.exportRecord.findUniqueOrThrow({ where: { id: result.exportRecordId } });
      assert.equal(rec.contentItemId, f.item.id); assert.equal(rec.contentVersionId, f.v.id);
      assert.equal(rec.format, format); assert.equal(rec.contentHash, result.contentHash); assert.equal(rec.releasedBy, "manager");
      results.push(result);
    }
    // Cumulative: three exports for this exact version, each audited exactly once.
    assert.equal(results.length, 3);
    assert.equal(await p.exportRecord.count({ where: { contentItemId: f.item.id, contentVersionId: f.v.id } }), 3);
    assert.equal(await p.auditEvent.count({ where: { contentItemId: f.item.id, action: "content_exported", contentVersionId: f.v.id } }), 3);
  });
  it("records the client bearer-link holder as the release actor when exported from the client portal", async () => {
    const f = await fixture();
    await approve(f);
    const result = await exportApprovedVersion({ contentItemId: f.item.id, contentVersionId: f.v.id, format: "json", releasedBy: "client_via_link" });
    const rec = await p.exportRecord.findUniqueOrThrow({ where: { id: result.exportRecordId } });
    assert.equal(rec.releasedBy, "client_via_link");
    assert.equal(await p.exportRecord.count({ where: { contentItemId: f.item.id } }), 1);
  });
  it("retains the original approved draft unchanged after export (immutable history)", async () => {
    const f = await fixture();
    await approve(f);
    await exportApprovedVersion({ contentItemId: f.item.id, contentVersionId: f.v.id, format: "text", releasedBy: "manager" });
    const version = await p.contentVersion.findUniqueOrThrow({ where: { id: f.v.id } });
    assert.equal(version.draftText, f.v.draftText);
    assert.equal((await p.contentItem.findUniqueOrThrow({ where: { id: f.item.id } })).status, "client_approved");
  });
});

describe("M5 HTTP export routes (automated test decisions, not customer approval)", {
  skip: process.env.KATAVA_RUN_LIVE_LLM_TESTS !== "1", concurrency: false,
}, () => {
  it("manager export route returns a file only for an approved version and client export route requires an approved decision", async () => {
    assert.ok((process.env.KATAVA_MANAGER_KEY?.trim().length ?? 0) >= 32, "Configure the separate local manager key first");
    const { POST: manager } = await import("../app/api/approvals/[contentItemId]/route");
    const { POST: clientExport } = await import("../app/api/review/export/route");
    const origin = process.env.KATAVA_PUBLIC_ORIGIN || "http://localhost:3001";
    const managed = (itemId: string, body: unknown) => manager(new Request(origin + `/api/approvals/${itemId}`, {
      method: "POST", headers: { origin, "Content-Type": "application/json", "X-Katava-Manager-Key": process.env.KATAVA_MANAGER_KEY! },
      body: JSON.stringify(body),
    }), { params: Promise.resolve({ contentItemId: itemId }) });
    const exportReq = (body: unknown) => new Request(origin + "/api/review/export", {
      method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const f = await fixture();
    await approve(f);
    const response = await managed(f.item.id, { action: "export", contentVersionId: f.v.id, format: "markdown" });
    assert.equal(response.status, 200);
    assert.ok(response.headers.get("Content-Disposition")?.startsWith('attachment; filename="katava-approved-'));
    assert.equal(response.headers.get("Content-Type")?.startsWith("text/markdown"), true);
    assert.equal(response.headers.get("Cache-Control"), "no-store, private, max-age=0");
    const read = await response.text();
    assert.ok(read.includes(f.v.draftText) && read.includes("DISCLAIMER"));
    // The client bearer-link export route must serve the same file for an approved token.
    const l = await link(f);
    const review = await getClientReview(l.token);
    assert.equal(review.decision?.status, "approved");
    const clientResponse = await clientExport(exportReq({ token: l.token, contentVersionId: f.v.id, format: "markdown" }));
    assert.equal(clientResponse.status, 200);
    assert.ok(clientResponse.headers.get("Content-Disposition")?.startsWith('attachment; filename="katava-approved-'));
    // Reject client export when the decision is missing or not approved.
    const f2 = await fixture();
    const l2 = await link(f2);
    const rejected = await clientExport(exportReq({ token: l2.token, contentVersionId: f2.v.id, format: "markdown" }));
    assert.equal(rejected.status, 409);
    assert.ok(JSON.parse(await rejected.text()).error === "not_approved");
  });
});
