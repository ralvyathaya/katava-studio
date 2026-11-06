// Katava Studio — GET /api/audit/[contentItemId]
// Returns the complete persisted audit trail for one content item:
// versions, agent messages, review findings per version, and audit events.

import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ contentItemId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { contentItemId } = await context.params;

  try {
    const contentItem = await prisma.contentItem.findUnique({
      where: { id: contentItemId },
    });
    if (!contentItem) {
      return NextResponse.json({ error: "Content item not found" }, { status: 404 });
    }

    const [versions, agentRuns, findings, auditEvents] = await Promise.all([
      prisma.contentVersion.findMany({
        where: { contentItemId },
        orderBy: { versionNumber: "asc" },
      }),
      prisma.agentRun.findMany({
        where: { contentItemId },
        orderBy: { createdAt: "asc" },
      }),
      prisma.reviewFinding.findMany({
        where: { contentItemId },
        orderBy: { createdAt: "asc" },
      }),
      prisma.auditEvent.findMany({
        where: { contentItemId },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    const source = await prisma.productSource.findUnique({
      where: { campaignId: contentItem.campaignId }, include: { facts: true },
    });
    const productFacts = source?.facts ?? [];
    const factById = new Map(productFacts.map((fact) => [fact.id, fact]));
    return NextResponse.json({
      contentItem,
      productFacts,
      versions: versions.map((v) => {
        let ids: string[] = [];
        try {
          const parsed: unknown = JSON.parse(v.citedFactIds);
          if (Array.isArray(parsed)) ids = parsed.filter((id): id is string => typeof id === "string");
        } catch { /* Historical invalid citations remain visibly unresolved. */ }
        return { ...v,
          citations: ids.flatMap((id) => factById.has(id) ? [factById.get(id)!] : []),
          unresolvedFactIds: ids.filter((id) => !factById.has(id)),
          findings: findings.filter((f) => f.contentVersionId === v.id),
        };
      }),
      agentRuns,
      findings,
      auditEvents,
      summary: {
        versionCount: versions.length,
        agentRunCount: agentRuns.length,
        findingCount: findings.length,
        auditEventCount: auditEvents.length,
        totalAgentLatencyMs: agentRuns.reduce(
          (sum, r) => sum + (r.latencyMs || 0),
          0
        ),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to read audit trail",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
