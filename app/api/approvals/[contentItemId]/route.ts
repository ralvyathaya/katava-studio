import { z } from "zod";
import { approvalOverview, issueReviewLink, revokeReviewLink, editDraft, issueLinkSchema, editDraftSchema } from "@/lib/approval-service";
import { assertApprovalOrigin, assertManager, approvalBody, approvalJson, approvalFile, approvalFailure } from "@/lib/approval-http";
import { exportApprovedVersion, exportFormatSchema } from "@/lib/export-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const operations = z.discriminatedUnion("action", [
  z.object({ action: z.literal("overview") }).strict(),
  issueLinkSchema.extend({ action: z.literal("issue") }),
  z.object({ action: z.literal("revoke"), linkId: z.string().min(1).max(150) }).strict(),
  editDraftSchema.extend({ action: z.literal("edit") }),
  z.object({ action: z.literal("export"), contentVersionId: z.string().min(1).max(150), format: exportFormatSchema }).strict(),
]);
export async function POST(request: Request, context: { params: Promise<{ contentItemId: string }> }) {
  try {
    assertApprovalOrigin(request);
    assertManager(request);
    const body = operations.parse(await approvalBody(request));
    const { contentItemId } = await context.params;
    if (body.action === "overview") return approvalJson(await approvalOverview(contentItemId));
    if (body.action === "issue") return approvalJson(await issueReviewLink(contentItemId, {
      contentVersionId: body.contentVersionId, expiresInHours: body.expiresInHours,
    }), 201);
    if (body.action === "revoke") return approvalJson(await revokeReviewLink(contentItemId, body.linkId));
    if (body.action === "export") {
      const result = await exportApprovedVersion({
        contentItemId, contentVersionId: body.contentVersionId, format: body.format, releasedBy: "manager",
      });
      return approvalFile(result.content, result.filename, result.mimeType);
    }
    return approvalJson(await editDraft(contentItemId, { contentVersionId: body.contentVersionId, draftText: body.draftText }));
  } catch (error) { return approvalFailure(error); }
}
