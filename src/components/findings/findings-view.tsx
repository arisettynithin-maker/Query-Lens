"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileSearch, Filter } from "lucide-react";
import { useMemo, useState } from "react";

import { FindingCard } from "@/components/findings/finding-card";
import { useOllama } from "@/components/ollama/ollama-provider";
import { useReviewSession } from "@/components/review/review-session-provider";
import { useSettings } from "@/components/settings/settings-provider";
import { describeContextSource } from "@/lib/review-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { SqlFinding } from "@/types/sql-review";

type SeverityFilter = "ALL" | SqlFinding["type"];

const filterOrder: SeverityFilter[] = ["ALL", "CRITICAL", "HIGH", "MEDIUM", "LOW"];

function formatTimestamp(timestamp: string | null): string {
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleString();
}

function sortBySeverity(findings: SqlFinding[]): SqlFinding[] {
  const rank: Record<SqlFinding["type"], number> = {
    CRITICAL: 4,
    HIGH: 3,
    MEDIUM: 2,
    LOW: 1,
  };
  return [...findings].sort((a, b) => rank[b.type] - rank[a.type]);
}

export function FindingsView() {
  const { settings } = useSettings();
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("ALL");
  const router = useRouter();
  const { connectionStatus, selectedModel, connectToOllama, isConnecting, isLoadingModels } =
    useOllama();
  const {
    currentArtifactType,
    sessionStatus,
    lastRunMode,
    findings,
    batchQueries,
    batchSummary,
    findingsCount,
    riskScore,
    riskLabel,
    criticalHighCount,
    lastRunTimestamp,
    requestLineJump,
    lastReviewUsedContext,
    lastReviewContextSource,
    contextQualitySummary,
  } = useReviewSession();

  const severityBreakdown = useMemo(() => {
    const counts: Record<SqlFinding["type"], number> = {
      CRITICAL: 0,
      HIGH: 0,
      MEDIUM: 0,
      LOW: 0,
    };
    findings.forEach((finding) => {
      counts[finding.type] += 1;
    });
    return counts;
  }, [findings]);

  const filteredFindings = useMemo(() => {
    const sorted = sortBySeverity(findings);
    if (severityFilter === "ALL") return sorted;
    return sorted.filter((finding) => finding.type === severityFilter);
  }, [findings, severityFilter]);
  const modelReady = connectionStatus === "connected" && Boolean(selectedModel);
  const findingsEnabledForArtifact =
    currentArtifactType === "SQL Query" || currentArtifactType === "Batch Review"
      ? settings.reviewIntelligence.enableSqlFindings
      : currentArtifactType === "KPI Definition"
        ? settings.reviewIntelligence.enableKpiDefinitionReview
        : settings.reviewIntelligence.enableNarrativeReview;

  if (!modelReady) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Findings</h1>
          <p className="text-sm text-muted-foreground">
            Model not connected
          </p>
        </div>
        <Card className="max-w-4xl">
          <CardHeader>
            <CardTitle>Model not connected</CardTitle>
            <CardDescription>
              Connect a local model (Ollama) to generate findings, test cases, and rewrite suggestions.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              onClick={() => void connectToOllama()}
              disabled={isConnecting || isLoadingModels}
            >
              {isConnecting || isLoadingModels ? "Connecting..." : "Connect model"}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!findingsEnabledForArtifact) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Findings</h1>
          <p className="text-sm text-muted-foreground">Findings disabled via settings</p>
        </div>
        <Card className="max-w-4xl">
          <CardHeader>
            <CardTitle>Findings disabled via settings</CardTitle>
            <CardDescription>
              Enable this review pipeline in Settings to generate findings for the active artifact.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/settings">Open Settings</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (sessionStatus === "Not started") {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Findings</h1>
          <p className="text-sm text-muted-foreground">
            Structured review findings will appear here after a review run.
          </p>
        </div>
        <Card className="max-w-4xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSearch className="h-4 w-4 text-muted-foreground" />
              No findings yet
            </CardTitle>
            <CardDescription>
              Run a review in Workspace to generate severity-ranked findings and recommendations.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/workspace">Return to Workspace</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (lastRunMode === "batch") {
    return (
      <div className="space-y-6">
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Findings</h1>
              <p className="text-sm text-muted-foreground">
                Batch findings grouped by query unit for faster triage.
              </p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/workspace">Back to editor</Link>
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
                Queries Reviewed
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <p className="text-2xl font-semibold">{batchSummary.totalQueries}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
                Total Findings
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <p className="text-2xl font-semibold">{batchSummary.totalFindings}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
                High-Risk Queries
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <p className="text-2xl font-semibold">{batchSummary.criticalHighQueries}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {batchSummary.criticalHighQueries}/{batchSummary.totalQueries} queries have
                high/critical issues
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
                Avg Risk
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <p className="text-2xl font-semibold">{batchSummary.averageRiskScore}</p>
              <p className="mt-1 text-xs text-muted-foreground">{formatTimestamp(lastRunTimestamp)}</p>
            </CardContent>
          </Card>
        </div>

        {batchSummary.commonIssues.length > 0 ? (
          <Card>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm">Systemic Patterns Across Queries</CardTitle>
              <CardDescription>
                {batchSummary.systemicIssueCount} repeated issue
                {batchSummary.systemicIssueCount === 1 ? "" : "s"} detected across batch inputs.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 p-4 pt-2">
              {batchSummary.commonIssues.map((issue) => (
                <div
                  key={issue.label}
                  className="flex items-center justify-between rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-xs"
                >
                  <span className="text-foreground">{issue.label}</span>
                  <span className="text-muted-foreground">{issue.count} queries</span>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm">Batch Findings</CardTitle>
            <CardDescription>
              Findings are grouped by query to preserve context and prioritization.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 p-4 pt-2">
            {batchQueries.length > 0 ? (
              batchQueries.map((query) => (
                <div key={query.id} className="rounded-md border border-border/70 bg-muted/10 p-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">{query.label}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>Findings {query.findingsCount}</span>
                      <span>•</span>
                      <span>Risk {query.riskScore}</span>
                      <span>•</span>
                      <span>{query.highestSeverity ?? "No severity"}</span>
                    </div>
                  </div>
                  {query.findings.length > 0 ? (
                    <div className="space-y-3">
                      {query.findings.map((finding) => (
                        <FindingCard key={`${query.id}-${finding.id}`} finding={finding} />
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-md border border-border/70 bg-muted/20 p-3 text-xs text-muted-foreground">
                      No findings for this query.
                    </div>
                  )}
                </div>
              ))
            ) : (
              <div className="rounded-md border border-border/70 bg-muted/20 p-6 text-sm text-muted-foreground">
              No batch query results available yet. Run a batch review from Workspace.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Findings</h1>
            <p className="text-sm text-muted-foreground">
              Review, prioritize, and resolve quality issues before release.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {lastReviewUsedContext
                ? `Reviewed with ${describeContextSource(lastReviewContextSource)}`
                : "Reviewed with query only"}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">Context quality: {contextQualitySummary}</p>
            {settings.trustGovernance.showModelProvenance ? (
              <p className="mt-0.5 text-xs text-muted-foreground">
                Generated using local model • Model: {selectedModel} • Last run:{" "}
                {formatTimestamp(lastRunTimestamp)}
              </p>
            ) : null}
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/workspace">Back to editor</Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
              Overall Risk Score
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <p className="text-2xl font-semibold">{riskScore}</p>
            <p className="mt-1 text-xs text-muted-foreground">{riskLabel}</p>
            <p className="mt-1 text-xs text-muted-foreground/90">
              Based on {severityBreakdown.CRITICAL} critical, {severityBreakdown.HIGH} high,{" "}
              {severityBreakdown.MEDIUM} medium, and {severityBreakdown.LOW} low findings
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
              Total Findings
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <p className="text-2xl font-semibold">{findingsCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
              Critical / High
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <p className="text-2xl font-semibold">{criticalHighCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
              Last Run
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <p className="text-sm font-medium">{formatTimestamp(lastRunTimestamp)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {lastReviewUsedContext ? "Context-aware" : "Query-only"}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="p-4 pb-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-sm">Findings List</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="muted" className="gap-1.5">
                <Filter className="h-3.5 w-3.5" />
                Filter
              </Badge>
              {filterOrder.map((option) => (
                <Button
                  key={option}
                  variant={severityFilter === option ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setSeverityFilter(option)}
                >
                  {option === "ALL" ? "All" : option}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 p-4 pt-2">
          {filteredFindings.length > 0 ? (
            filteredFindings.map((finding) => (
              <FindingCard
                key={finding.id}
                finding={finding}
                onLineClick={(line) => {
                  if (typeof line !== "number") return;
                  requestLineJump(line);
                  router.push("/workspace");
                }}
              />
            ))
          ) : (
            <div className="rounded-md border border-border/70 bg-muted/20 p-6 text-sm text-muted-foreground">
              No findings match the current filter.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

