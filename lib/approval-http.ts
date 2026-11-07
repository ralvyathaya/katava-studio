// Separate manager authorization from bearer-link client access.
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ApprovalError } from "./approval-service";
import { sha256 } from "./content-integrity";

const headers = {
  "Cache-Control": "no-store, private, max-age=0",
  "Pragma": "no-cache", "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow",
};
export function approvalJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers });
}
export function assertApprovalOrigin(request: Request) {
  const url = new URL(request.url);
  const expected = process.env.KATAVA_PUBLIC_ORIGIN || url.origin;
  if (request.headers.get("origin") !== expected) {
    throw new ApprovalError("origin_denied", 403, "Only same-origin review requests are allowed.");
  }
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new ApprovalError("json_required", 415, "Send application/json.");
  }
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    throw new ApprovalError("origin_denied", 403, "Cross-site requests are not allowed.");
  }
}
export function assertManager(request: Request) {
  const configured = process.env.KATAVA_MANAGER_KEY?.trim() ?? "";
  if (configured.length < 32) throw new ApprovalError("manager_not_configured", 503,
    "Set a separate KATAVA_MANAGER_KEY of at least 32 characters in .env. Manager actions fail closed until configured.");
  const supplied = request.headers.get("x-katava-manager-key") ?? "";
  const valid = timingSafeEqual(Buffer.from(sha256(configured), "hex"), Buffer.from(sha256(supplied), "hex"));
  if (!valid) throw new ApprovalError("manager_unauthorized", 401, "Manager authorization required.");
}
export async function approvalBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new ApprovalError("invalid_json", 400, "JSON body required.");
  let bytes = 0;
  const parts: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 90000) {
        await reader.cancel();
        throw new ApprovalError("body_too_large", 413, "Review request is too large.");
      }
      parts.push(value);
    }
    try { return JSON.parse(Buffer.concat(parts).toString("utf8")); }
    catch { throw new ApprovalError("invalid_json", 400, "Invalid JSON body."); }
  } finally { reader.releaseLock(); }
}
export function approvalFailure(error: unknown): Response {
  if (error instanceof ApprovalError) return approvalJson({ error: error.code, message: error.message }, error.httpStatus);
  if (error instanceof z.ZodError) return approvalJson({ error: "invalid_request", message: "Invalid review request.",
    // Paths/messages only: never echo user credential values in validation errors.
    issues: error.issues.map(i => ({ path: i.path, message: i.message })) }, 400);
  // Never expose Prisma diagnostics, request bodies, credentials or raw upstream errors.
  return approvalJson({ error: "persistence_failed", message: "The review operation could not be committed. No approval is inferred. Refresh the item audit before retrying." }, 503);
}
