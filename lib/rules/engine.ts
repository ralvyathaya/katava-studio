// Katava Studio — Deterministic Rule Engine
// Pre-Reviewer pattern-based checks for DEMO-GUARD-001 through 006.
// This is NOT a substitute for contextual AI review.
// If the Rule Engine issues a HARD BLOCK, the Reviewer LLM cannot override it to PASS.

import { Fact, WriterOutput, RuleEngineResult, RuleEngineFinding } from "../types";

// ─── Rule Engine Configuration ───────────────────────────────────────

const RULE_SOURCE = "Katava demo policy v0.1";

// Patterns that indicate medical cure or efficacy claims (DEMO-GUARD-001)
const MEDICAL_CURE_PATTERNS: RegExp[] = [
  /cure[sd]?/i,
  /menyembuhkan/i, // Indonesian: cure
  /sembuh/i, // Indonesian: healed
  /maag.*sembuh/i, // handbook example: "maag saya sembuh total"
  /obat/i, // Indonesian: medicine/drug
  /medic/i,
  /treat[s]?/i,
  /mengobati/i, // Indonesian: treat medically
  /heal[s]?/i,
  /clinically proven/i,
  /clinically tested/i,
  /efficac/i,
  /khasiat/i, // Indonesian: efficacy/properties
  /klinikis/i, // Indonesian: clinically
  /insomnia/i,
  /sleep.*disorder/i,
  /anxiety/i,
  /depression/i,
  /therapeutic/i,
  /medical/i,
];

// Patterns that indicate certification claims (DEMO-GUARD-002)
const CERTIFICATION_PATTERNS: RegExp[] = [
  /halal/i,
  /organic/i,
  /BPOM/i,
  /bersertifikat/i, // Indonesian: certified
  /sertifikasi/i, // Indonesian: certification
  /certified/i,
  /certification/i,
  /registered with/i,
  /approved by/i,
  /licensed/i,
  /natural.*certified/i,
];

// Patterns that indicate invented facts (DEMO-GUARD-003)
// These are facts not present in the source product sheet
const INVENTION_INDICATORS: RegExp[] = [
  /Rp\s*[\d,.]+/i, // Indonesian Rupiah price
  / IDR\s*[\d,.]+/i,
  /price/i,
  /harga/i, // Indonesian: price
  /endorsed by/i,
  /recommended by/i,
  /as seen on/i,
  /sourced from/i,
  /origin.*:/i,
  /from.*mountains?/i,
  /from.*fields?/i,
];

// Patterns that indicate prompt injection attempts (DEMO-GUARD-004)
const INJECTION_PATTERNS: RegExp[] = [
  /ignore.*(?:previous|above|all).*instructions/i,
  /ignore.*compliance/i,
  /set.*pass/i,
  /bypass.*review/i,
  /you are now/i,
  /forget.*rules/i,
  /disregard.*safety/i,
  /system prompt/i,
];

/**
 * Run deterministic rule checks on a Writer draft.
 *
 * @param writerOutput - The validated Writer output
 * @param facts - All product facts (to check for invented claims)
 * @param plannerAllowedFactIds - Fact IDs the Planner allowed
 * @returns RuleEngineResult with hardBlocks, warnings, and passed flag
 */
export function runRuleEngine(
  writerOutput: WriterOutput,
  facts: Fact[],
  plannerAllowedFactIds: string[]
): RuleEngineResult {
  const hardBlocks: RuleEngineFinding[] = [];
  const warnings: RuleEngineFinding[] = [];
  const draftText = writerOutput.draftText;

  // ─── DEMO-GUARD-001: Medical cure / efficacy claims ────────────────
  for (const pattern of MEDICAL_CURE_PATTERNS) {
    const match = draftText.match(pattern);
    if (match) {
      // Check if there's a source_backed fact that justifies this
      const medicalFacts = facts.filter(
        (f) =>
          f.status === "source_backed" &&
          pattern.test(f.statement)
      );
      if (medicalFacts.length === 0) {
        hardBlocks.push({
          severity: "block",
          excerpt: match[0],
          issue: `Medical/efficacy claim detected: "${match[0]}". This claim is not supported by any source-backed fact.`,
          ruleId: "DEMO-GUARD-001",
          ruleSource: RULE_SOURCE,
          suggestedFix:
            "Remove the medical cure or efficacy claim. Describe the product using only factual ingredients and preparation instructions.",
        });
      }
    }
  }

  // ─── DEMO-GUARD-002: Unsupported certification claims ──────────────
  for (const pattern of CERTIFICATION_PATTERNS) {
    const match = draftText.match(pattern);
    if (match) {
      // Check if there's a source_backed fact that justifies this
      const certFacts = facts.filter(
        (f) =>
          f.status === "source_backed" &&
          pattern.test(f.statement)
      );
      if (certFacts.length === 0) {
        hardBlocks.push({
          severity: "block",
          excerpt: match[0],
          issue: `Certification claim detected: "${match[0]}". No source-backed evidence supports this certification.`,
          ruleId: "DEMO-GUARD-002",
          ruleSource: RULE_SOURCE,
          suggestedFix:
            "Remove the certification claim. If the product has real certification, add verified documentation to the product sheet first.",
        });
      }
    }
  }

  // ─── DEMO-GUARD-003: Invented product facts ────────────────────────
  // Check for prices, origins, endorsements not in the facts
  for (const pattern of INVENTION_INDICATORS) {
    const match = draftText.match(pattern);
    if (match) {
      // Check if any source_backed fact contains this
      const matchingFacts = facts.filter(
        (f) =>
          f.status === "source_backed" &&
          pattern.test(f.statement)
      );
      if (matchingFacts.length === 0) {
        hardBlocks.push({
          severity: "block",
          excerpt: match[0],
          issue: `Potentially invented product detail: "${match[0]}". This information is not in the source product sheet.`,
          ruleId: "DEMO-GUARD-003",
          ruleSource: RULE_SOURCE,
          suggestedFix:
            "Remove the unsupported detail. Only include facts that are source-backed in the product sheet.",
        });
      }
    }
  }

  // Also check: citedFactIds that are in the "unverified" status
  const citedFacts = facts.filter((f) => writerOutput.citedFactIds.includes(f.id));
  for (const fact of citedFacts) {
    if (fact.status === "unverified") {
      warnings.push({
        severity: "warning",
        excerpt: fact.statement.substring(0, 100),
        issue: `Cited fact "${fact.factKey}" has status "unverified". Using unverified facts in marketing content is risky.`,
        ruleId: "DEMO-GUARD-003",
        ruleSource: RULE_SOURCE,
        suggestedFix: "Only cite source_backed facts in the final draft.",
      });
    }
  }

  // ─── DEMO-GUARD-004: Prompt injection detection ────────────────────
  for (const pattern of INJECTION_PATTERNS) {
    const match = draftText.match(pattern);
    if (match) {
      hardBlocks.push({
        severity: "block",
        excerpt: match[0],
        issue: `Potential prompt injection or instruction override detected in content: "${match[0]}". Content must not contain instructions to bypass safety rules.`,
        ruleId: "DEMO-GUARD-004",
        ruleSource: RULE_SOURCE,
        suggestedFix: "Remove any embedded instructions from the content.",
      });
    }
  }

  // ─── Fact consistency: citedFactIds must be ⊆ allowedFactIds ───────
  const allowedSet = new Set(plannerAllowedFactIds);
  const outOfScopeCitations = writerOutput.citedFactIds.filter(
    (id) => !allowedSet.has(id)
  );
  if (outOfScopeCitations.length > 0) {
    hardBlocks.push({
      severity: "block",
      excerpt: outOfScopeCitations.join(", "),
      issue: `Writer cited fact IDs outside the Planner's allowed set: ${outOfScopeCitations.join(", ")}`,
      ruleId: "DEMO-GUARD-003",
      ruleSource: RULE_SOURCE,
      suggestedFix: "Only cite fact IDs that the Planner explicitly allowed.",
    });
  }

  // ─── DEMO-GUARD-005: Check for auto-publish language ───────────────
  if (/auto.*publish/i.test(draftText) || /published automatically/i.test(draftText)) {
    warnings.push({
      severity: "warning",
      excerpt: "auto publish",
      issue: "Content mentions automatic publishing. Human approval is always required before publication.",
      ruleId: "DEMO-GUARD-005",
      ruleSource: RULE_SOURCE,
      suggestedFix: "Remove any mention of automatic publishing.",
    });
  }

  const passed = hardBlocks.length === 0;

  return {
    hardBlocks,
    warnings,
    passed,
  };
}
