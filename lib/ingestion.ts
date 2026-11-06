// Katava Studio — Product Ingestion Module
// Parses a raw product sheet text into structured ProductFact objects
// with source excerpts and verification statuses.

import { Fact, FactStatus } from "./types";

/**
 * Known fact keys we try to extract from a product sheet.
 * The extraction is pattern-based, not LLM-based, to keep it deterministic
 * and auditable. Each fact includes the exact source excerpt.
 */
const FACT_PATTERNS: Array<{
  key: string;
  patterns: RegExp[];
  status: FactStatus;
}> = [
  {
    key: "product_name",
    patterns: [
      /\*\*Product name:\*\*\s*(.+)/i,
      /Product name:\s*(.+)/i,
    ],
    status: "source_backed",
  },
  {
    key: "brand",
    patterns: [
      /\*\*Brand:\*\*\s*(.+)/i,
      /Brand:\s*(.+)/i,
    ],
    status: "source_backed",
  },
  {
    key: "category",
    patterns: [
      /\*\*Category.*?:\*\*\s*(.+)/i,
      /Category.*?:\s*(.+)/i,
    ],
    status: "source_backed",
  },
  {
    key: "ingredients",
    patterns: [
      /\*\*Ingredients.*?:\*\*\s*(.+)/i,
      /Ingredients.*?:\s*(.+)/i,
    ],
    status: "source_backed",
  },
  {
    key: "package",
    patterns: [
      /\*\*Package:\*\*\s*(.+)/i,
      /Package:\s*(.+)/i,
    ],
    status: "source_backed",
  },
  {
    key: "serving_suggestion",
    patterns: [
      /\*\*Serving suggestion:\*\*\s*(.+)/i,
      /Serving suggestion:\s*(.+)/i,
    ],
    status: "source_backed",
  },
  {
    key: "brand_tone",
    patterns: [
      /\*\*Brand tone:\*\*\s*(.+)/i,
      /Brand tone:\s*(.+)/i,
    ],
    status: "source_backed",
  },
];

/**
 * Claims explicitly listed as NOT verified in the product sheet.
 * These are extracted as "unverified" facts.
 */
const UNVERIFIED_PATTERNS: Array<{
  key: string;
  patterns: RegExp[];
}> = [
  {
    key: "organic_certification",
    patterns: [/organic certification/i],
  },
  {
    key: "halal_certification",
    patterns: [/halal certification/i],
  },
  {
    key: "bpom_registration",
    patterns: [/BPOM registration/i, /BPOM.*?permit/i],
  },
  {
    key: "clinical_efficacy",
    patterns: [/clinically proven/i, /clinically.*?effects/i],
  },
  {
    key: "sleep_insomnia_claim",
    patterns: [/sleep.*?insomnia/i, /insomnia.*?treatment/i, /insomnia.*?cure/i],
  },
  {
    key: "safety_claim",
    patterns: [/100%.*?safe/i],
  },
  {
    key: "testimonials",
    patterns: [/testimonials?/i],
  },
  {
    key: "price",
    patterns: [/\bprice\b/i],
  },
  {
    key: "sourcing_origin",
    patterns: [/sourcing origin/i],
  },
];

export interface IngestionResult {
  facts: Fact[];
  productName: string;
  category: string;
  brandName: string;
  brandTone: string;
}

/**
 * Parse a raw product sheet into structured facts.
 * This is deterministic extraction — NOT an LLM call.
 * Every fact includes the exact source excerpt for auditability.
 */
export function ingestProductSheet(rawText: string): IngestionResult {
  const facts: Fact[] = [];
  let factCounter = 0;

  const generateId = () => `fact_${++factCounter}`;

  // Extract supported facts
  for (const pattern of FACT_PATTERNS) {
    for (const regex of pattern.patterns) {
      const match = rawText.match(regex);
      if (match && match[1]) {
        const statement = match[1].trim();
        // Find the full line for source excerpt
        const lineMatch = rawText.match(new RegExp(`.*${regex.source}.*`, "i"));
        const sourceExcerpt = lineMatch ? lineMatch[0].trim() : statement;

        facts.push({
          id: generateId(),
          factKey: pattern.key,
          statement,
          status: pattern.status,
          sourceExcerpt,
        });
        break; // Only use first matching pattern
      }
    }
  }

  // Extract unverified claims (from "Claims NOT supplied as verified" section)
  // Look for the section header
  const unverifiedSectionMatch = rawText.match(
    /Claims NOT supplied as verified:\s*(.+)/i
  );
  if (unverifiedSectionMatch) {
    const unverifiedText = unverifiedSectionMatch[1];
    for (const pattern of UNVERIFIED_PATTERNS) {
      for (const regex of pattern.patterns) {
        if (regex.test(unverifiedText)) {
          facts.push({
            id: generateId(),
            factKey: pattern.key,
            statement: `Claim of ${pattern.key} is NOT verified — explicitly listed as unsupported in product sheet`,
            status: "unverified" as FactStatus,
            sourceExcerpt: unverifiedSectionMatch[0].trim(),
          });
          break;
        }
      }
    }
  }

  // Also scan the adversarial brief for injection detection
  const adversarialMatch = rawText.match(
    /Adversarial brief for test:\s*"?([^"\n]+)"?/i
  );
  if (adversarialMatch) {
    facts.push({
      id: generateId(),
      factKey: "adversarial_brief",
      statement: adversarialMatch[1].trim(),
      status: "unverified" as FactStatus,
      sourceExcerpt: adversarialMatch[0].trim(),
    });
  }

  // Extract metadata
  const productName =
    facts.find((f) => f.factKey === "product_name")?.statement || "Unknown Product";
  const category =
    facts.find((f) => f.factKey === "category")?.statement || "Unknown";
  const brandName =
    facts.find((f) => f.factKey === "brand")?.statement || "Unknown Brand";
  const brandTone =
    facts.find((f) => f.factKey === "brand_tone")?.statement || "Professional";

  return {
    facts,
    productName,
    category,
    brandName,
    brandTone,
  };
}

/**
 * Format facts for inclusion in an LLM prompt.
 * Each fact is numbered and includes its source excerpt.
 */
export function formatFactsForPrompt(facts: Fact[]): string {
  return facts
    .map(
      (f) =>
        `[${f.id}] ${f.factKey.toUpperCase()}: "${f.statement}"\n  Status: ${f.status}\n  Source: "${f.sourceExcerpt || "N/A"}"`
    )
    .join("\n\n");
}
