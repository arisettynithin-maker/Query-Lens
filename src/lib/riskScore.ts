import type { SqlFinding } from "@/types/sql-review";

const severityScoreMap: Record<SqlFinding["type"], number> = {
  CRITICAL: 40,
  HIGH: 25,
  MEDIUM: 10,
  LOW: 5,
};

const severityRank: Record<SqlFinding["type"], number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

export type RiskLabel = "Low risk" | "Moderate risk" | "High risk" | "Critical risk";

export function getRiskLabel(score: number): RiskLabel {
  if (score <= 10) return "Low risk";
  if (score <= 35) return "Moderate risk";
  if (score <= 65) return "High risk";
  return "Critical risk";
}

export function getHighestSeverity(findings: SqlFinding[]): SqlFinding["type"] | null {
  if (findings.length === 0) return null;
  return findings
    .map((finding) => finding.type)
    .sort((a, b) => severityRank[b] - severityRank[a])[0];
}

export function computeRiskScore(findings: SqlFinding[]): number {
  const raw = findings.reduce((sum, finding) => sum + severityScoreMap[finding.type], 0);
  return Math.min(100, raw);
}

export function countCriticalHigh(findings: SqlFinding[]): number {
  return findings.filter((finding) => finding.type === "CRITICAL" || finding.type === "HIGH")
    .length;
}
