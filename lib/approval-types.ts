import type { Fact, Finding } from "./types";

export type HumanDecision = "approved" | "rejected" | "revision_requested";
export interface ReviewLinkSummary {
  id: string;
  contentVersionId: string;
  createdAt: string;
  expiresAt: string;
  state: "active" | "expired" | "revoked" | "consumed" | "stale";
}
export interface HumanApproval {
  id: string;
  contentVersionId: string;
  status: HumanDecision;
  approvedBy: string;
  comment: string | null;
  createdAt: string;
}
export interface ApprovalOverview {
  contentItemId: string;
  currentVersionId: string | null;
  versionNumber: number | null;
  draftText: string | null;
  status: string;
  eligible: boolean;
  eligibilityReason: string | null;
  currentApproval: HumanApproval | null;
  approvals: HumanApproval[];
  links: ReviewLinkSummary[];
}
export interface ClientReview {
  linkId: string;
  campaignName: string;
  format: string;
  contentItemId: string;
  contentVersionId: string;
  versionNumber: number;
  draftText: string;
  citations: Fact[];
  findings: Finding[];
  policy: { rulebookId: string; version: string; authority: string; reviewedAt: string };
  expiresAt: string;
  decision: HumanApproval | null;
  canDecide: boolean;
  disclaimer: string;
}
