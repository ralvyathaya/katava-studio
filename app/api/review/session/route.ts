import { z } from "zod";
import { tokenSchema, getClientReview } from "@/lib/approval-service";
import { assertApprovalOrigin, approvalBody, approvalJson, approvalFailure } from "@/lib/approval-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const sessionSchema = z.object({ token: tokenSchema }).strict();
// POST keeps tokens out of URL logs, cache keys and Referrer headers.
export async function POST(request: Request) {
  try {
    assertApprovalOrigin(request);
    const body = sessionSchema.parse(await approvalBody(request));
    return approvalJson(await getClientReview(body.token));
  } catch (error) { return approvalFailure(error); }
}
