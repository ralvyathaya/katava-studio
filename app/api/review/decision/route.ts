import { decisionSchema, recordClientDecision } from "@/lib/approval-service";
import { assertApprovalOrigin, approvalBody, approvalJson, approvalFailure } from "@/lib/approval-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    assertApprovalOrigin(request);
    const body = decisionSchema.parse(await approvalBody(request));
    return approvalJson(await recordClientDecision(body));
  } catch (error) { return approvalFailure(error); }
}
