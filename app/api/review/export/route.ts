import { z } from "zod";
import { tokenSchema } from "@/lib/approval-service";
import { assertApprovalOrigin, approvalBody, approvalJson, approvalFile, approvalFailure } from "@/lib/approval-http";
import { exportApprovedVersion, exportFormatSchema } from "@/lib/export-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const exportSchema = z.object({
  token: tokenSchema,
  contentVersionId: z.string().min(1).max(150),
  format: exportFormatSchema,
}).strict();
// POST keeps tokens out of URL logs. The client link must have an APPROVED
// decision for this exact version; the export gate re-validates that server-side.
export async function POST(request: Request) {
  try {
    assertApprovalOrigin(request);
    const body = exportSchema.parse(await approvalBody(request));
    // Resolve the link to find the contentItemId for this token+version,
    // then run the same fail-closed export gate as the manager route.
    const { getClientReview } = await import("@/lib/approval-service");
    const review = await getClientReview(body.token);
    if (review.contentVersionId !== body.contentVersionId) {
      return approvalJson({ error: "stale_version", message: "The submitted version does not match this review link." }, 409);
    }
    if (!review.decision || review.decision.status !== "approved") {
      return approvalJson({ error: "not_approved", message: "Export requires an explicit approved decision for this exact version." }, 409);
    }
    const result = await exportApprovedVersion({
      contentItemId: review.contentItemId, contentVersionId: body.contentVersionId,
      format: body.format, releasedBy: "client_via_link",
    });
    return approvalFile(result.content, result.filename, result.mimeType);
  } catch (error) { return approvalFailure(error); }
}
