// Server-side fingerprints bind approval to exact content and source evidence.
import { createHash } from "node:crypto";
import type { Fact } from "./types";

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function contentDigest(draftText: string, citedFactIds: string, format: string): string {
  return sha256(JSON.stringify({ draftText, citedFactIds, format }));
}

export function policyDigest(policy: { rulebookId: string; version: string; authority: string;
  rules: Array<{ ruleId: string; policyText: string; requiredEvidence: string }> }): string {
  return sha256(JSON.stringify({ rulebookId: policy.rulebookId, version: policy.version, authority: policy.authority,
    rules: [...policy.rules].sort((a, b) => a.ruleId.localeCompare(b.ruleId)).map(r => ({
      ruleId: r.ruleId, policyText: r.policyText, requiredEvidence: r.requiredEvidence,
    })),
  }));
}

export function sourceDigest(facts: Fact[]): string {
  return sha256(JSON.stringify([...facts].sort((a, b) => a.id.localeCompare(b.id)).map((f) => ({
    id: f.id, factKey: f.factKey, statement: f.statement, status: f.status,
    sourceExcerpt: f.sourceExcerpt ?? "",
  }))));
}
