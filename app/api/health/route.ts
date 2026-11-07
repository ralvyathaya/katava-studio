// Katava Studio — GET /api/health
// Public infrastructure-neutral status only. Verification performs one real
// minimal call; provider, model, endpoint and credential details stay private.

import { NextRequest, NextResponse } from "next/server";
import { getLLMStatus, verifyLLMAccess } from "@/lib/llm-adapter";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const status = getLLMStatus();
  const wantsVerification =
    new URL(request.url).searchParams.get("verify") === "1";

  const verification = wantsVerification ? await verifyLLMAccess() : null;

  return NextResponse.json({
    app: "Katava Studio",
    checkedAt: new Date().toISOString(),
    llm: { configured: status.configured },
    verification: verification ? { accessible: verification.accessible } : null,
    note: "Connected means a real completion was received. Infrastructure details are intentionally private.",
  });
}
