"use client";

import Link from "next/link";
import { useMemo } from "react";

import { useOllama } from "@/components/ollama/ollama-provider";
import { useReviewSession, type ArtifactType } from "@/components/review/review-session-provider";
import { useSettings } from "@/components/settings/settings-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getArtifactLabel } from "@/lib/artifact-labels";

const rewriteModes: Record<ArtifactType, string[]> = {
  "SQL Query": ["Safer SQL", "Cleaner SQL", "Production-ready SQL"],
  "KPI Definition": [
    "Clearer definition",
    "Governance-ready definition",
    "Stakeholder-friendly definition",
  ],
  Narrative: ["Concise", "Executive-ready", "Action-oriented"],
  "Batch Review": ["Safer SQL", "Cleaner SQL", "Production-ready SQL"],
};

export function RewriteView() {
  const { settings } = useSettings();
  const { connectionStatus, selectedModel, connectToOllama, isConnecting, isLoadingModels } =
    useOllama();
  const {
    title,
    currentArtifactType,
    sessionStatus,
    findings,
    findingsCount,
    lastRunTimestamp,
    lastReviewUsedContext,
    batchQueries,
    selectedBatchQueryId,
    rewriteModes: sessionRewriteModes,
    rewriteOutputs,
    batchRewriteOutputs,
    selectedRewriteBatchQueryId,
    setRewriteMode,
    setSelectedRewriteBatchQueryId,
    generateRewrite,
    applyRewriteToSessionInput,
    clearRewriteOutput,
  } = useReviewSession();

  const targetBatchQueryId =
    selectedRewriteBatchQueryId ?? selectedBatchQueryId ?? batchQueries[0]?.id ?? null;
  const targetBatchQuery = batchQueries.find((query) => query.id === targetBatchQueryId) ?? null;
  const currentOutput =
    currentArtifactType === "Batch Review"
      ? (targetBatchQueryId ? batchRewriteOutputs[targetBatchQueryId] ?? null : null)
      : rewriteOutputs[currentArtifactType as "SQL Query" | "KPI Definition" | "Narrative"];
  const outputChanges = currentOutput?.changes ?? [];
  const outputSafetyReasons = currentOutput?.safetyReasons ?? [];
  const outputTradeoffNotes = currentOutput?.tradeoffNotes ?? [];
  const outputConfidenceLabel = currentOutput?.confidenceLabel ?? "Low";
  const outputConfidenceDetail =
    currentOutput?.confidenceDetail ?? "Low (rewrite metadata incomplete; regenerate recommended)";
  const outputExpectedBehavior = currentOutput?.expectedBehavior ?? [];
  const modelReady = connectionStatus === "connected" && Boolean(selectedModel);

  const findingsSummary = useMemo(
    () =>
      findings
        .slice(0, 4)
        .map((finding) => ({ id: finding.id, title: finding.title, severity: finding.type })),
    [findings],
  );

  if (!modelReady) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Rewrite</h1>
          <p className="text-sm text-muted-foreground">Model not connected</p>
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

  if (!settings.reviewIntelligence.enableRewriteSuggestions) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Rewrite</h1>
          <p className="text-sm text-muted-foreground">Rewrite suggestions are disabled in Settings.</p>
        </div>
        <Card className="max-w-4xl">
          <CardHeader>
            <CardTitle>Rewrite suggestions disabled</CardTitle>
            <CardDescription>
              Enable rewrite suggestions in Settings to generate guided remediations from findings.
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

  if (sessionStatus !== "Completed" || findingsCount === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Rewrite</h1>
          <p className="text-sm text-muted-foreground">
            Build grounded rewrite suggestions from completed reviews.
          </p>
        </div>
        <Card className="max-w-4xl">
          <CardHeader>
            <CardTitle>No rewrite suggestions yet</CardTitle>
            <CardDescription>
              Rewrite suggestions are generated from completed reviews with findings.
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Rewrite</h1>
          <p className="text-sm text-muted-foreground">
            Guided rewrite for {title} ({getArtifactLabel(currentArtifactType)}).
          </p>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <span>{findingsCount} findings available for rewrite guidance</span>
            {lastReviewUsedContext ? (
              <Badge variant="muted">Context-enhanced</Badge>
            ) : (
              <Badge variant="muted">Query-only</Badge>
            )}
          </div>
          {settings.trustGovernance.showModelProvenance ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Generated using local model • Model: {selectedModel} • Last run:{" "}
              {lastRunTimestamp ? new Date(lastRunTimestamp).toLocaleString() : "—"}
            </p>
          ) : null}
        </div>
      </div>

      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm">Rewrite Controls</CardTitle>
          <CardDescription>Generate findings-driven improvements and apply only when ready.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 p-4 pt-2">
          <div className="grid gap-3 md:grid-cols-2">
            <Select
              value={sessionRewriteModes[currentArtifactType]}
              onValueChange={(value) => setRewriteMode(currentArtifactType, value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Rewrite mode" />
              </SelectTrigger>
              <SelectContent>
                {rewriteModes[currentArtifactType].map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {mode}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {currentArtifactType === "Batch Review" ? (
              <Select
                value={targetBatchQueryId ?? undefined}
                onValueChange={setSelectedRewriteBatchQueryId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select query" />
                </SelectTrigger>
                <SelectContent>
                  {batchQueries.map((query) => (
                    <SelectItem key={query.id} value={query.id}>
                      {query.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={generateRewrite}
              disabled={currentArtifactType === "Batch Review" && !targetBatchQuery}
            >
              {currentOutput ? "Regenerate rewrite" : "Generate rewrite"}
            </Button>
            <Button
              variant="outline"
              disabled={!currentOutput}
              onClick={async () => {
                if (!currentOutput) return;
                await navigator.clipboard.writeText(currentOutput.rewritten);
              }}
            >
              Copy rewritten version
            </Button>
            <Button
              variant="outline"
              disabled={!currentOutput || !settings.trustGovernance.allowOverwrite}
              onClick={() => {
                if (!currentOutput) return;
                if (settings.trustGovernance.requireConfirmationBeforeReplacingQuery) {
                  const confirmed = window.confirm(
                    "Apply rewritten content to the current artifact input?",
                  );
                  if (!confirmed) return;
                }
                applyRewriteToSessionInput();
              }}
            >
              Apply Rewrite
            </Button>
            <Button
              variant="ghost"
              disabled={!currentOutput}
              onClick={() => clearRewriteOutput(currentArtifactType)}
            >
              Keep original
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm">Findings Driving This Rewrite</CardTitle>
          <CardDescription>
            {currentOutput
              ? `${currentOutput.addressedFindingIds.length} finding(s) addressed in current rewrite`
              : "Generate rewrite to see addressed findings"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 p-4 pt-2 text-sm">
          {findingsSummary.map((item, index) => (
            <div
              key={`${item.id}-${index}-${item.severity}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/70 bg-muted/20 px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <Badge variant="muted">{item.severity}</Badge>
                <span className="text-foreground">{item.title}</span>
              </div>
              <Button asChild variant="ghost" size="sm">
                <Link href={`/findings#finding-${item.id}`}>View finding</Link>
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {currentArtifactType === "Batch Review" && !targetBatchQuery ? (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            Select a batch query to generate rewrite suggestions.
          </CardContent>
        </Card>
      ) : null}

      {currentOutput ? (
        <>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-sm">Original</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-2">
                <pre className="max-h-[420px] overflow-auto rounded-md border border-border/70 bg-background/60 p-3 text-xs leading-relaxed text-muted-foreground">
                  {currentOutput.original}
                </pre>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-sm">Rewritten</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-2">
                <pre className="max-h-[420px] overflow-auto rounded-md border border-border/70 bg-background/60 p-3 text-xs leading-relaxed text-foreground">
                  {currentOutput.rewritten}
                </pre>
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm">What Changed</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 p-4 pt-2 text-sm text-muted-foreground">
              {outputChanges.map((change) => (
                <div key={change} className="rounded-md border border-border/70 bg-muted/15 px-3 py-2">
                  {change}
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm">Why This Rewrite Is Safer</CardTitle>
              <CardDescription>{outputConfidenceDetail}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 p-4 pt-2 text-sm text-muted-foreground">
              <Badge variant="muted">Rewrite confidence: {outputConfidenceLabel}</Badge>
              {outputSafetyReasons.map((item) => (
                <div key={item} className="rounded-md border border-border/70 bg-muted/15 px-3 py-2">
                  {item}
                </div>
              ))}
            </CardContent>
          </Card>
          {outputTradeoffNotes.length > 0 ? (
            <Card>
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-sm">Trade-offs To Confirm</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 p-4 pt-2 text-sm text-muted-foreground">
                {outputTradeoffNotes.map((item) => (
                  <div key={item} className="rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2">
                    {item}
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
          {outputExpectedBehavior.length > 0 ? (
            <Card>
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-sm">Expected Behavior</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 p-4 pt-2 text-sm text-muted-foreground">
                {outputExpectedBehavior.map((item) => (
                  <div key={item} className="rounded-md border border-border/70 bg-muted/15 px-3 py-2">
                    {item}
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            Generate rewrite suggestions to compare original and improved versions.
          </CardContent>
        </Card>
      )}
    </div>
  );
}


