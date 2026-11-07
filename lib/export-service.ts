// Milestone 5: approval-gated content export.
// The only downstream action after human approval is a downloadable artifact. This
// module NEVER publishes to any social platform; "approval" is not "publication".
// Every export re-validates the exact approved version (fail-closed) and writes an
// append-only ExportRecord plus an audit event, so the deliverable is auditable.
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { sha256 } from "./content-integrity";
import { approvedExportable, ApprovalError } from "./approval-service";

const prisma = new PrismaClient();
export const exportFormatSchema = z.enum(["markdown", "json", "text"]);
export type ExportFormat = z.infer<typeof exportFormatSchema>;
type Evidence = Awaited<ReturnType<typeof approvedExportable>>["proof"];

const DISCLAIMER =
  "This file is a creator work artifact exported after explicit human approval of one exact version. " +
  "Katava Studio does not publish content to any platform; approval is not publication. " +
  "Policy PASS is internal demo policy only, not statutory compliance or certification. " +
  "Source-backed facts are supported by the supplied sheet, not independently verified.";

interface BuildInput {
  item: { id: string; format: string; campaignId: string };
  version: { id: string; versionNumber: number; draftText: string };
  approval: { id: string; status: string; approvedBy: string; comment: string | null; createdAt: Date };
  proof: Evidence;
  format: ExportFormat;
}
interface BuiltExport { content: string; filename: string; mimeType: string; contentHash: string }

function buildExport({ item, version, approval, proof, format }: BuildInput): BuiltExport {
  const facts = proof.facts.filter(f => proof.ids.includes(f.id));
  const ext = format === "markdown" ? "md" : format; // json -> json, text -> txt
  const mime = format === "markdown" ? "text/markdown" : format === "json" ? "application/json" : "text/plain";
  let content: string;
  if (format === "text") {
    content = version.draftText;
  } else if (format === "json") {
    content = JSON.stringify({
      app: "Katava Studio",
      exportKind: "approved-content",
      published: false,
      format: item.format,
      version: { id: version.id, number: version.versionNumber },
      approval: { id: approval.id, status: approval.status, approvedBy: approval.approvedBy,
        approvedAt: approval.createdAt.toISOString(), comment: approval.comment },
      policy: { rulebookId: proof.rulebook.rulebookId, version: proof.rulebook.version, authority: proof.rulebook.authority },
      reviewerVerdict: "PASS",
      reviewerModel: proof.reviewed?.reviewerModelId ?? null,
      content: version.draftText,
      citations: facts.map(f => ({ id: f.id, statement: f.statement, status: f.status, sourceExcerpt: f.sourceExcerpt })),
      disclaimer: DISCLAIMER,
    }, null, 2);
  } else {
    const citationLines = facts.length
      ? facts.map(f => `- ${f.statement}\n  > ${f.sourceExcerpt ?? ""}\n  > ${f.id} · ${f.status}`).join("\n")
      : "None cited.";
    const findings = proof.reviewed?.findings?.length
      ? proof.reviewed.findings.map(f => `- ${f.ruleId} (${f.severity}): ${f.issue}`).join("\n")
      : "None recorded.";
    content = `# Katava Studio — Approved Content Export

**Format:** ${item.format}
**Version:** v${version.versionNumber} (${version.id})
**Approved by:** ${approval.approvedBy} (bearer-link holder; personal identity not independently verified)
**Approved at (UTC):** ${approval.createdAt.toISOString()}
**Policy:** ${proof.rulebook.rulebookId} v${proof.rulebook.version} — ${proof.rulebook.authority}
**Reviewer verdict:** PASS (model ${proof.reviewed?.reviewerModelId ?? "n/a"})

## Content
${version.draftText}

## Cited product-sheet evidence
${citationLines}

## Reviewer findings
${findings}

## Approval note
${approval.comment || "No comment supplied."}

---
DISCLAIMER: ${DISCLAIMER}
`;
  }
  const contentHash = sha256(content);
  const shortHash = contentHash.slice(0, 12);
  const filename = `katava-approved-${item.format}-v${version.versionNumber}-${shortHash}.${ext}`;
  return { content, filename, mimeType: `${mime}; charset=utf-8`, contentHash };
}

export interface ExportResult {
  format: ExportFormat; filename: string; mimeType: string; content: string;
  contentHash: string; exportRecordId: string; contentVersionId: string;
}
export async function exportApprovedVersion(input: {
  contentItemId: string; contentVersionId: string; format: ExportFormat; releasedBy: string;
}): Promise<ExportResult> {
  const { item, version, approval, proof } = await approvedExportable(input.contentItemId, input.contentVersionId);
  const built = buildExport({ item, version, approval, proof, format: input.format });
  const record = await prisma.$transaction(async tx => {
    const rec = await tx.exportRecord.create({ data: {
      contentItemId: item.id, contentVersionId: version.id, approvalId: approval.id,
      format: input.format, contentHash: built.contentHash, releasedBy: input.releasedBy,
    } });
    await tx.auditEvent.create({ data: {
      campaignId: item.campaignId, contentItemId: item.id, contentVersionId: version.id,
      actor: input.releasedBy, action: "content_exported",
      details: JSON.stringify({ format: input.format, contentHash: built.contentHash,
        exportRecordId: rec.id, approvalId: approval.id, noPublication: true }),
    } });
    return rec;
  });
  return { format: input.format, filename: built.filename, mimeType: built.mimeType, content: built.content,
    contentHash: built.contentHash, exportRecordId: record.id, contentVersionId: version.id };
}

// Re-exported so routes import a single surface and fail closed on bad input.
export { ApprovalError };
