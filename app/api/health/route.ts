// Katava Studio — GET /api/health
// Reports the OpenAI-compatible LLM configuration and, with ?verify=1,
// performs one real minimal call. Never returns the API key.

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
    llm: status,
    verification,
    note:
      "configured means a key is present; accessible means a real completion was received. " +
      "They are deliberately separate. No successful call is ever simulated.",
  });
}
