import type { ArtifactType } from "@/components/review/review-session-provider";

export type RewriteOutput = {
  artifactType: ArtifactType;
  mode: string;
  original: string;
  rewritten: string;
  changes: string[];
  safetyReasons: string[];
  tradeoffNotes: string[];
  expectedBehavior: string[];
  confidenceLabel: "High" | "Medium" | "Low";
  confidenceDetail: string;
  addressedFindingIds: string[];
  contextEnhanced: boolean;
  generatedAt: string;
  targetBatchQueryId?: string;
  targetBatchQueryLabel?: string;
};
