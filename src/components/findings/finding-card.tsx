"use client";

import { AlertTriangle, ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SqlFinding } from "@/types/sql-review";

function severityStyles(type: SqlFinding["type"]) {
  if (type === "CRITICAL") {
    return "border-red-500/30 bg-red-500/10 text-red-300";
  }
  if (type === "HIGH") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-300";
  }
  if (type === "MEDIUM") {
    return "border-sky-500/30 bg-sky-500/10 text-sky-300";
  }
  return "border-border bg-muted text-muted-foreground";
}

type FindingCardProps = {
  finding: SqlFinding;
  onLineClick?: (line: number) => void;
};

export function FindingCard({ finding, onLineClick }: FindingCardProps) {
  const isPriority = finding.type === "CRITICAL" || finding.type === "HIGH";
  const findingLine = finding.line;

  return (
    <Card
      id={`finding-${finding.id}`}
      className={isPriority ? "border-border shadow-[0_12px_26px_rgba(3,6,17,0.35)]" : ""}
    >
      <CardHeader className="p-4 pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {isPriority ? (
              <AlertTriangle className="h-4 w-4 text-amber-300" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
            <CardTitle className="text-sm">{finding.title}</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Badge className={severityStyles(finding.type)}>{finding.type}</Badge>
            <Badge variant="muted">{finding.category}</Badge>
            {finding.contextUsed ? (
              <Badge variant="muted" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
                Context-enhanced
              </Badge>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 p-4 pt-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {typeof findingLine === "number" ? (
            <button
              type="button"
              onClick={() => onLineClick?.(findingLine)}
              className="rounded px-1 py-0.5 text-sky-300 hover:bg-sky-500/10 hover:text-sky-200"
            >
              Line {findingLine}
            </button>
          ) : (
            <span className="rounded px-1 py-0.5 text-muted-foreground">Line —</span>
          )}
          <span>•</span>
          <span>Confidence: {finding.confidence}</span>
          <span>•</span>
          <span>ID: {finding.id}</span>
        </div>
        <p className="text-sm text-muted-foreground">{finding.description}</p>
        <div className="rounded-md border border-border/70 bg-muted/20 p-2.5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Recommendation
          </p>
          <p className="mt-1 text-sm">{finding.recommendation}</p>
        </div>
        {finding.contextUsed && finding.contextReason ? (
          <div className="space-y-0.5">
            <p className="text-xs text-muted-foreground">Using data context: {finding.contextReason}</p>
            {finding.contextConfidenceBasis ? (
              <p className="text-[11px] text-muted-foreground/80">
                Confidence basis: {finding.contextConfidenceBasis}
              </p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
