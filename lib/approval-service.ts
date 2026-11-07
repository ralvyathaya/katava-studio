// Milestone 4: use existing ReviewLink / Approval tables; no destructive migration.
// Scope is a strictly validated, version-bound snapshot. Raw bearer tokens NEVER
// enter the database/audit/logs; a persisted Approval consumes a link permanently.
import { randomBytes } from "node:crypto";
import { Prisma, PrismaClient, type Approval, type ContentItem, type ContentVersion, type ReviewLink } from "@prisma/client";
import { z } from "zod";
import { contentDigest, sha256, sourceDigest, policyDigest } from "./content-integrity";
import { reviewerOutputSchema, safeParseJson, writerOutputSchema, validateReelsStructure } from "./schemas";
import { runRuleEngine } from "./rules/engine";
import { redactLLMDiagnostic } from "./llm-adapter";
import type { Fact } from "./types";
import type { ApprovalOverview, ClientReview, HumanApproval, ReviewLinkSummary } from "./approval-types";

const prisma = new PrismaClient();
type Tx = Prisma.TransactionClient;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const scopeSchema = z.object({
  v: z.literal(1), contentItemId: z.string().min(1), contentVersionId: z.string().min(1),
  contentDigest: hash, sourceDigest: hash, policyPassEventId: z.string().min(1),
  rulebookVersionId: z.string().min(1), policyDigest: hash, reviewerRunId: z.string().min(1), reviewerDigest: hash,
}).strict();
type Scope = z.infer<typeof scopeSchema>;
export const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, "Invalid review credential");
export const issueLinkSchema = z.object({
  contentVersionId: z.string().min(1).max(150), expiresInHours: z.number().int().min(1).max(72).default(24),
}).strict();
export const decisionSchema = z.object({
  token: tokenSchema, contentVersionId: z.string().min(1).max(150),
  decision: z.enum(["approved", "rejected", "revision_requested"]),
  comment: z.string().trim().max(2000).default(""),
}).strict().refine((d) => d.decision === "approved" || d.comment.length > 0, {
  message: "Explain the rejection or requested changes.", path: ["comment"],
});
export const editDraftSchema = z.object({
  contentVersionId: z.string().min(1).max(150), draftText: z.string().trim().min(10).max(20000),
}).strict();
export class ApprovalError extends Error {
  constructor(public code: string, public httpStatus: number, message: string) { super(message); }
}
const fail = (code: string, status: number, message: string): never => { throw new ApprovalError(code, status, message); };
const viewApproval = (a: Approval): HumanApproval => ({
  id: a.id, contentVersionId: a.contentVersionId, status: a.status as HumanApproval["status"],
  approvedBy: a.approvedBy, comment: a.comment, createdAt: a.createdAt.toISOString(),
});
function scopeOf(link: ReviewLink): Scope {
  try { return scopeSchema.parse(JSON.parse(link.scope)); }
  catch { return fail("invalid_scope", 409, "This legacy or invalid link cannot authorize a decision. Ask the manager for a new review link."); }
}
async function latest(tx: Tx, itemId: string) {
  return tx.contentVersion.findFirst({ where: { contentItemId: itemId }, orderBy: [
    { versionNumber: "desc" }, { createdAt: "desc" }, { id: "desc" },
  ] });
}

// Authoritative evidence; neither a client-supplied PASS nor item status alone suffices.
async function evidence(tx: Tx, item: ContentItem, version: ContentVersion) {
  const current = await latest(tx, item.id);
  if (!current || current.id !== version.id) fail("stale_version", 409, "The draft version has changed. A new policy review and link are required.");
  const source = await tx.productSource.findUnique({ where: { campaignId: item.campaignId }, include: { facts: true } });
  if (!source) fail("missing_source", 409, "No source evidence is available for human approval.");
  const facts: Fact[] = source!.facts.map(f => ({ id: f.id, factKey: f.factKey, statement: f.statement,
    status: f.status as Fact["status"], sourceExcerpt: f.sourceExcerpt ?? undefined }));
  let ids: unknown;
  try { ids = JSON.parse(version.citedFactIds); } catch { fail("invalid_citations", 409, "The draft has invalid citations."); }
  const draft = writerOutputSchema.safeParse({ format: item.format, draftText: version.draftText, citedFactIds: ids });
  if (!draft.success || (item.format === "reels" && !validateReelsStructure(version.draftText))) {
    fail("invalid_draft", 409, "The exact draft does not meet its format or citation contract.");
  }
  const output = draft.success ? draft.data : fail("invalid_draft", 409, "Invalid draft");
  if (output.citedFactIds.some(id => !facts.some(f => f.id === id && f.status === "source_backed"))) {
    fail("invalid_citations", 409, "Some citations are unresolved or not source-backed.");
  }
  if (runRuleEngine(output, facts, facts.filter(f => f.status === "source_backed").map(f => f.id)).hardBlocks.length) {
    fail("hard_block", 409, "The deterministic policy hard-blocks this draft. A human cannot override it here.");
  }
  const pass = await tx.auditEvent.findFirst({ where: {
    contentItemId: item.id, contentVersionId: version.id, action: "review_passed", actor: "orchestrator", verdict: "PASS",
  }, orderBy: { createdAt: "desc" } });
  if (!pass) fail("review_required", 409, "This version has no integrity-bound policy PASS. Generate a fresh reviewed draft (older M3 evidence is preserved but cannot authorize M4 approval).");
  let details: Record<string, unknown>;
  try { details = JSON.parse(pass!.details); } catch { return fail("review_required", 409, "Policy evidence is invalid."); }
  const digest = contentDigest(version.draftText, version.citedFactIds, item.format);
  const sourceHash = sourceDigest(facts);
  if (details.contentDigest !== digest || details.sourceDigest !== sourceHash || details.contentVersionId !== version.id) {
    fail("evidence_changed", 409, "Content or source evidence changed after policy review. Review again before approval.");
  }
  const rulebook = await tx.rulebookVersion.findUnique({ where: { id: pass!.rulebookVersion ?? "" }, include: { rules: true } });
  if (!rulebook?.isActive || !rulebook.rules.some(r => r.ruleId === "DEMO-GUARD-005")) {
    fail("policy_changed", 409, "The reviewed policy is unavailable or inactive. A new review is required.");
  }
  const policyHash = policyDigest(rulebook!);
  if (details.policyDigest !== policyHash) fail("policy_changed", 409, "Policy contents changed after review. A new review is required.");
  const reviewer = await tx.agentRun.findFirst({ where: { id: typeof details.reviewerRunId === "string" ? details.reviewerRunId : "",
    contentItemId: item.id, contentVersionId: version.id, agentName: "reviewer", outputValid: true } });
  if (!reviewer || details.reviewerDigest !== sha256(reviewer.outputRaw ?? "")) fail("review_required", 409, "Reviewer evidence changed or is missing.");
  const parsed = safeParseJson(reviewer?.outputRaw ?? "");
  const reviewed = parsed.ok ? reviewerOutputSchema.safeParse(parsed.value) : null;
  if (!reviewed?.success || reviewed.data.verdict !== "PASS" || reviewed.data.rulebookVersionId !== rulebook!.id ||
    reviewed.data.findings.some(f => f.severity === "block" || !rulebook!.rules.some(r => r.ruleId === f.ruleId))) {
    fail("review_required", 409, "No valid Reviewer PASS exists for this exact version and policy.");
  }
  const blocks = await tx.reviewFinding.count({ where: { contentVersionId: version.id, severity: "block" } });
  if (blocks) fail("hard_block", 409, "Blocking findings prevent human approval.");
  return { facts, ids: output.citedFactIds, pass: pass!, rulebook: rulebook!, reviewed: reviewed!.success ? reviewed!.data : null,
    scope: { v: 1 as const, contentItemId: item.id, contentVersionId: version.id,
      contentDigest: digest, sourceDigest: sourceHash, policyPassEventId: pass!.id, rulebookVersionId: rulebook!.id,
      policyDigest: policyHash, reviewerRunId: reviewer!.id, reviewerDigest: sha256(reviewer!.outputRaw ?? "") } };
}
async function audit(tx: Tx, item: ContentItem, versionId: string, action: string, details: Record<string, unknown>, actor = "manager") {
  await tx.auditEvent.create({ data: { campaignId: item.campaignId, contentItemId: item.id,
    contentVersionId: versionId, actor, action, details: JSON.stringify(details) } });
}
function summary(link: ReviewLink, versionId: string | null, approvals: Approval[], now: Date): ReviewLinkSummary {
  let scope: Scope | null = null;
  try { scope = scopeOf(link); } catch { /* legacy link visibly stale */ }
  const consumed = approvals.some(a => a.reviewLinkId === link.id);
  const state = link.revokedAt ? "revoked" : link.expiresAt <= now ? "expired" :
    !scope || scope.contentVersionId !== versionId ? "stale" : consumed ? "consumed" : "active";
  return { id: link.id, contentVersionId: scope?.contentVersionId ?? "legacy", createdAt: link.createdAt.toISOString(),
    expiresAt: link.expiresAt.toISOString(), state };
}
export async function approvalOverview(itemId: string): Promise<ApprovalOverview> {
  return prisma.$transaction(async tx => {
    const item = await tx.contentItem.findUnique({ where: { id: itemId } });
    if (!item) return fail("not_found", 404, "Content item not found.");
    const version = await latest(tx, itemId);
    const approvals = await tx.approval.findMany({ where: { contentItemId: itemId }, orderBy: { createdAt: "desc" } });
    const links = await tx.reviewLink.findMany({ where: { campaignId: item.campaignId }, orderBy: { createdAt: "desc" } });
    let reason: string | null = null;
    if (!version || !["review_passed", "awaiting_client_approval"].includes(item.status)) reason = "Only a current policy-passed draft awaiting human approval can receive a link.";
    else try { await evidence(tx, item, version); } catch (e) { if (e instanceof ApprovalError) reason = e.message; else throw e; }
    const relevant = links.filter(l => { try { return scopeOf(l).contentItemId === itemId; } catch { return false; } });
    // Historical approvals never certify the currently edited version.
    let currentApproval = version && item.status === "client_approved" ? approvals.find(a => a.contentVersionId === version.id && a.status === "approved") : null;
    if (currentApproval && version) {
      try {
        const proof = await evidence(tx, item, version);
        const bound = links.find(l => l.id === currentApproval!.reviewLinkId);
        if (!bound || JSON.stringify(scopeOf(bound)) !== JSON.stringify(proof.scope)) currentApproval = undefined;
      } catch (e) { if (e instanceof ApprovalError) { currentApproval = undefined; reason = e.message; } else throw e; }
    }
    return { contentItemId: item.id, currentVersionId: version?.id ?? null, versionNumber: version?.versionNumber ?? null,
      draftText: version?.draftText ?? null,
      status: item.status, eligible: reason === null, eligibilityReason: reason,
      currentApproval: currentApproval ? viewApproval(currentApproval) : null,
      approvals: approvals.map(viewApproval), links: relevant.map(l => summary(l, version?.id ?? null, approvals, new Date())) };
  });
}
export async function issueReviewLink(itemId: string, input: z.input<typeof issueLinkSchema>) {
  const request = issueLinkSchema.parse(input);
  const token = randomBytes(32).toString("base64url");
  return prisma.$transaction(async tx => {
    const item = await tx.contentItem.findUnique({ where: { id: itemId } });
    if (!item) return fail("not_found", 404, "Content item not found.");
    if (!["review_passed", "awaiting_client_approval"].includes(item.status)) fail("not_eligible", 409, "AI review must PASS before requesting human approval. A completed human decision cannot be overwritten.");
    const version = await latest(tx, itemId);
    if (!version || version.id !== request.contentVersionId) return fail("stale_version", 409, "The selected draft is not current.");
    const proof = await evidence(tx, item, version);
    const now = new Date();
    const oldLinks = await tx.reviewLink.findMany({ where: { campaignId: item.campaignId, revokedAt: null } });
    for (const old of oldLinks) {
      let oldScope: Scope; try { oldScope = scopeOf(old); } catch { continue; }
      if (oldScope.contentItemId === item.id) {
        await tx.reviewLink.update({ where: { id: old.id }, data: { revokedAt: now } });
        await audit(tx, item, oldScope.contentVersionId, "review_link_revoked", { linkId: old.id, reason: "replaced" });
      }
    }
    const link = await tx.reviewLink.create({ data: { campaignId: item.campaignId, tokenHash: sha256(token),
      scope: JSON.stringify(proof.scope), expiresAt: new Date(now.getTime() + request.expiresInHours * 3600000) } });
    const changed = await tx.contentItem.updateMany({ where: { id: itemId, status: item.status }, data: { status: "awaiting_client_approval" } });
    if (changed.count !== 1) fail("conflict", 409, "The draft changed while issuing the link.");
    await audit(tx, item, version.id, "review_link_issued", { linkId: link.id, expiresAt: link.expiresAt.toISOString(), policyPassEventId: proof.pass.id });
    return { token, link: summary(link, version.id, [], now), status: "awaiting_client_approval" };
  });
}
export async function revokeReviewLink(itemId: string, linkId: string) {
  return prisma.$transaction(async tx => {
    const item = await tx.contentItem.findUnique({ where: { id: itemId } });
    const link = await tx.reviewLink.findUnique({ where: { id: linkId } });
    if (!item || !link || link.campaignId !== item.campaignId || scopeOf(link).contentItemId !== itemId) return fail("not_found", 404, "Review link not found for this item.");
    if (await tx.approval.count({ where: { reviewLinkId: link.id } })) fail("consumed", 409, "This link already has a final human decision; that evidence is immutable.");
    if (!link.revokedAt) {
      await tx.reviewLink.update({ where: { id: link.id }, data: { revokedAt: new Date() } });
      await audit(tx, item, scopeOf(link).contentVersionId, "review_link_revoked", { linkId: link.id, reason: "manager" });
    }
    return { revoked: true };
  });
}
async function resolveLink(tx: Tx, rawToken: string) {
  tokenSchema.parse(rawToken);
  const matches = await tx.reviewLink.findMany({ where: { tokenHash: sha256(rawToken) }, take: 2 });
  if (matches.length !== 1) return fail("invalid_link", 404, "Invalid review link.");
  const link = matches[0];
  if (link.revokedAt) fail("revoked", 410, "This review link was revoked. Ask the manager for a new link.");
  if (link.expiresAt <= new Date()) fail("expired", 410, "This review link has expired. Ask the manager for a new link.");
  const scope = scopeOf(link);
  const item = await tx.contentItem.findUnique({ where: { id: scope.contentItemId } });
  const version = await tx.contentVersion.findUnique({ where: { id: scope.contentVersionId } });
  if (!item || !version || item.campaignId !== link.campaignId || version.contentItemId !== item.id) return fail("invalid_scope", 409, "Invalid review scope.");
  const proof = await evidence(tx, item, version);
  if (JSON.stringify(proof.scope) !== JSON.stringify(scope)) fail("stale_evidence", 409, "This link no longer matches the reviewed evidence.");
  const approvals = await tx.approval.findMany({ where: { reviewLinkId: link.id }, take: 2 });
  if (approvals.length > 1) fail("conflict", 409, "Conflicting approval evidence; manager inspection is required.");
  return { link, scope, item, version, proof, approval: approvals[0] ?? null };
}
export async function getClientReview(rawToken: string): Promise<ClientReview> {
  return prisma.$transaction(async tx => {
    const ctx = await resolveLink(tx, rawToken);
    if (!ctx.approval && ctx.item.status !== "awaiting_client_approval") fail("not_awaiting", 409, "This draft is not awaiting a client decision.");
    const campaign = await tx.campaign.findUniqueOrThrow({ where: { id: ctx.item.campaignId } });
    return { linkId: ctx.link.id, campaignName: campaign.name, format: ctx.item.format,
      contentItemId: ctx.item.id, contentVersionId: ctx.version.id, versionNumber: ctx.version.versionNumber,
      draftText: ctx.version.draftText, citations: ctx.proof.facts.filter(f => ctx.proof.ids.includes(f.id)),
      findings: ctx.proof.reviewed?.findings ?? [],
      policy: { rulebookId: ctx.proof.rulebook.rulebookId, version: ctx.proof.rulebook.version,
        authority: ctx.proof.rulebook.authority, reviewedAt: ctx.proof.pass.createdAt.toISOString() },
      expiresAt: ctx.link.expiresAt.toISOString(), decision: ctx.approval ? viewApproval(ctx.approval) : null,
      canDecide: !ctx.approval && ctx.item.status === "awaiting_client_approval",
      disclaimer: "Policy PASS is internal demo policy only, not statutory compliance or certification. Your explicit decision applies only to this exact version. Approval does not publish content. Bearer-link access does not verify a person's identity.",
    };
  });
}
export async function recordClientDecision(input: z.input<typeof decisionSchema>) {
  const request = decisionSchema.parse(input);
  return prisma.$transaction(async tx => {
    const ctx = await resolveLink(tx, request.token);
    if (ctx.version.id !== request.contentVersionId) fail("stale_version", 409, "The submitted version does not match this link.");
    if (ctx.approval) fail("consumed", 409, "A final decision has already been recorded. This link cannot be replayed or overwrite it.");
    const status = request.decision === "approved" ? "client_approved" : request.decision === "rejected" ? "client_rejected" : "client_revision_requested";
    // Conditional update is a compare-and-set. The item/link/evidence reads and
    // writes all share one SQLite transaction, so racing requests cannot both win.
    const changed = await tx.contentItem.updateMany({ where: { id: ctx.item.id, status: "awaiting_client_approval" }, data: { status } });
    if (changed.count !== 1) fail("conflict", 409, "The item is no longer awaiting this decision.");
    const comment = request.comment.split(request.token).join("[REDACTED]");
    const approval = await tx.approval.create({ data: { contentItemId: ctx.item.id, contentVersionId: ctx.version.id,
      reviewLinkId: ctx.link.id, approvedBy: "client_via_link", status: request.decision,
      comment: redactLLMDiagnostic(comment) || null } });
    await audit(tx, ctx.item, ctx.version.id, status, { linkId: ctx.link.id, approvalId: approval.id,
      decision: request.decision, policyPassEventId: ctx.proof.pass.id, noPublication: true }, `client-link:${ctx.link.id}`);
    // Authorization cutoff is the final check INSIDE the transaction; a DB COMMIT
    // may physically finish afterwards. Expiry before this cutoff rolls back all writes.
    const authorizedAt = new Date();
    if (ctx.link.expiresAt <= authorizedAt) fail("expired", 410, "The link expired before final authorization. No approval was committed.");
    return { status, approval: viewApproval(approval), published: false };
  });
}
export async function editDraft(itemId: string, input: z.input<typeof editDraftSchema>) {
  const request = editDraftSchema.parse(input);
  return prisma.$transaction(async tx => {
    const item = await tx.contentItem.findUnique({ where: { id: itemId } });
    const version = await latest(tx, itemId);
    if (!item || !version) return fail("not_found", 404, "Draft not found.");
    if (version.id !== request.contentVersionId) fail("stale_version", 409, "The selected draft is not current.");
    if (!["review_passed", "awaiting_client_approval", "client_approved", "client_rejected", "client_revision_requested", "review_incomplete", "escalated"].includes(item.status)) {
      fail("running", 409, "A running generation cannot be edited.");
    }
    if (version.draftText === request.draftText) fail("unchanged", 400, "No draft changes supplied.");
    const next = await tx.contentVersion.create({ data: { contentItemId: item.id, versionNumber: version.versionNumber + 1,
      draftText: redactLLMDiagnostic(request.draftText), citedFactIds: version.citedFactIds,
      revisionOfId: version.id, reviewCycle: 0 } });
    await tx.contentItem.update({ where: { id: item.id }, data: { status: "review_incomplete" } });
    const links = await tx.reviewLink.findMany({ where: { campaignId: item.campaignId, revokedAt: null } });
    for (const link of links) {
      let scope: Scope; try { scope = scopeOf(link); } catch { continue; }
      if (scope.contentItemId === item.id) {
        await tx.reviewLink.update({ where: { id: link.id }, data: { revokedAt: new Date() } });
        await audit(tx, item, scope.contentVersionId, "review_link_revoked", { linkId: link.id, reason: "draft_edited" });
      }
    }
    await audit(tx, item, next.id, "draft_edited_review_required", { revisionOfId: version.id, previousStatus: item.status,
      approvalsRetainedAsHistory: true, noPublication: true });
    return { contentVersionId: next.id, versionNumber: next.versionNumber, status: "review_incomplete",
      message: "Edited draft saved as a new, unreviewed version. Prior approvals remain history only. Generate a new policy-reviewed item before requesting approval; this endpoint never pretends to re-review an edit." };
  });
}

// Milestone 5: an export is only permitted for an explicit APPROVED decision that
// binds the exact current version. Re-runs the same integrity evidence used for
// approval, so stale or tampered drafts fail closed before any file is produced.
export async function approvedExportable(itemId: string, versionId: string) {
  return prisma.$transaction(async tx => {
    const item = await tx.contentItem.findUnique({ where: { id: itemId } });
    if (!item) fail("not_found", 404, "Content item not found.");
    const version = await latest(tx, itemId);
    if (!version || version.id !== versionId) fail("stale_version", 409, "The selected draft is not the current version. Export requires the exact approved version.");
    const approval = await tx.approval.findFirst({ where: { contentItemId: itemId, contentVersionId: versionId, status: "approved" }, orderBy: { createdAt: "desc" } });
    if (!approval) fail("not_approved", 409, "No human approval exists for this exact version. Human approval is required before any export.");
    // The four guards above throw via fail(); the non-null assertions document that.
    const proof = await evidence(tx, item!, version!);
    return { item: item!, version: version!, approval: approval!, proof };
  });
}
