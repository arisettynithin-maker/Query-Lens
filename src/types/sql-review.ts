export type FindingSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export type FindingCategory = "logic" | "edge_case" | "performance";
export type ExtendedFindingCategory =
  | FindingCategory
  | "communication"
  | "metric_definition"
  | "structure";
export type FindingConfidence = "HIGH" | "MEDIUM" | "LOW";

export type SqlFinding = {
  id: string;
  type: FindingSeverity;
  category: ExtendedFindingCategory;
  title: string;
  description: string;
  line: number | null;
  recommendation: string;
  confidence: FindingConfidence;
  contextUsed?: boolean;
  contextReason?: string;
  contextConfidenceBasis?: string;
  context_used?: boolean;
  context_reason?: string;
  context_confidence_basis?: string;
};

export type ReviewMode = "single" | "batch";

export type BatchQuerySource = "pasted" | "file";

export type BatchQueryUnit = {
  id: string;
  label: string;
  source: BatchQuerySource;
  sourceName?: string;
  sql: string;
  findings: SqlFinding[];
  findingsCount: number;
  highestSeverity: FindingSeverity | null;
  riskScore: number;
  riskLabel: string;
  lastReviewedTimestamp: string | null;
};
