import type { ArtifactType } from "@/components/review/review-session-provider";

export function getArtifactLabel(artifactType: ArtifactType): string {
  if (artifactType === "SQL Query") return "SQL Query";
  if (artifactType === "KPI Definition") return "KPI Definition";
  if (artifactType === "Narrative") return "Narrative";
  return "Batch Review";
}
