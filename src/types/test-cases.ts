import type { ArtifactType } from "@/components/review/review-session-provider";
import type { ExtendedFindingCategory, FindingSeverity } from "@/types/sql-review";

export type TestCaseStatus = "Not started" | "In progress" | "Passed" | "Failed";

export type ValidationTestCase = {
  id: string;
  title: string;
  artifactType: ArtifactType;
  riskGroup: "Critical Logic Risks" | "Data Quality Risks" | "Metric Interpretation Risks";
  linkedFindingId: string | null;
  linkedFindingTitle?: string;
  linkedFindingSummary?: string;
  linkedFindingSeverity?: FindingSeverity;
  linkedQueryId?: string | null;
  linkedQueryLabel?: string | null;
  priority: FindingSeverity;
  category: ExtendedFindingCategory | "release_readiness";
  whatToValidate: string;
  objective: string;
  whyItMatters: string;
  validationSteps: string[];
  expectedOutcome: string;
  validationSQL?: string;
  whatToDoIfItFails?: string;
  status: TestCaseStatus;
  notes: string;
  contextUsed?: boolean;
  contextReason?: string;
};
