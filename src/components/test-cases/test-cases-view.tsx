"use client";

import Link from "next/link";
import { useMemo } from "react";
import { CheckCircle2, Circle, FlaskConical, XCircle } from "lucide-react";

import { useOllama } from "@/components/ollama/ollama-provider";
import { useReviewSession } from "@/components/review/review-session-provider";
import { useSettings } from "@/components/settings/settings-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getArtifactLabel } from "@/lib/artifact-labels";
import type { TestCaseStatus, ValidationTestCase } from "@/types/test-cases";

const statusOptions: TestCaseStatus[] = ["Not started", "In progress", "Passed", "Failed"];
const priorityRank: Record<ValidationTestCase["priority"], number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

function priorityStyles(priority: ValidationTestCase["priority"]) {
  if (priority === "CRITICAL") return "border-red-500/30 bg-red-500/10 text-red-300";
  if (priority === "HIGH") return "border-amber-500/30 bg-amber-500/10 text-amber-300";
  if (priority === "MEDIUM") return "border-sky-500/30 bg-sky-500/10 text-sky-300";
  return "border-border bg-muted text-muted-foreground";
}

function statusIcon(status: TestCaseStatus) {
  if (status === "Passed") return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />;
  if (status === "Failed") return <XCircle className="h-3.5 w-3.5 text-red-300" />;
  return <Circle className="h-3.5 w-3.5 text-muted-foreground" />;
}

function groupByRisk(cases: ValidationTestCase[]) {
  const groups: Record<ValidationTestCase["riskGroup"], ValidationTestCase[]> = {
    "Critical Logic Risks": [],
    "Data Quality Risks": [],
    "Metric Interpretation Risks": [],
  };
  [...cases]
    .sort((a, b) => priorityRank[b.priority] - priorityRank[a.priority])
    .forEach((testCase) => groups[testCase.riskGroup].push(testCase));
  return groups;
}

export function TestCasesView() {
  const { settings } = useSettings();
  const { connectionStatus, selectedModel, connectToOllama, isConnecting, isLoadingModels } =
    useOllama();
  const {
    activeSession,
    title,
    activeArtifactType,
    sessionStatus,
    findingsCount,
    lastRunTimestamp,
    testCases,
    lastReviewUsedContext,
    generateTestCasesFromFindings,
    updateTestCaseStatus,
    updateTestCaseNotes,
  } = useReviewSession();

  const statusCounts = useMemo(
    () =>
      testCases.reduce(
        (acc, testCase) => {
          acc[testCase.status] += 1;
          return acc;
        },
        { "Not started": 0, "In progress": 0, Passed: 0, Failed: 0 } as Record<TestCaseStatus, number>,
      ),
    [testCases],
  );

  const total = testCases.length;
  const completed = statusCounts.Passed + statusCounts.Failed;
  const remaining = statusCounts["Not started"] + statusCounts["In progress"];
  const critical = testCases.filter((t) => t.priority === "CRITICAL");
  const criticalPassed = critical.filter((t) => t.status === "Passed").length;
  const criticalCoverage = critical.length > 0 ? Math.round((criticalPassed / critical.length) * 100) : 100;
  const criticalOpen = critical.filter((t) => t.status !== "Passed").length;
  const highOpen = testCases.filter((t) => t.priority === "HIGH" && t.status !== "Passed").length;
  const mediumOpen = testCases.filter((t) => t.priority === "MEDIUM" && t.status !== "Passed").length;
  const criticalFailed = critical.filter((t) => t.status === "Failed").length;

  const readiness =
    criticalFailed > 0 || criticalOpen > 0
      ? { label: "Blocked: critical test case not completed", tone: "danger" as const }
      : highOpen > 0 || mediumOpen > 0
        ? {
            label: `Needs review: ${highOpen + mediumOpen} high/medium check${highOpen + mediumOpen > 1 ? "s" : ""} pending`,
            tone: "warn" as const,
          }
        : { label: "Ready for release", tone: "ready" as const };

  const groupedBatchCases = useMemo(() => {
    const groups = new Map<string, ValidationTestCase[]>();
    testCases.forEach((testCase) => {
      const key = testCase.linkedQueryLabel ?? "Batch-level";
      const current = groups.get(key) ?? [];
      current.push(testCase);
      groups.set(key, current);
    });
    return [...groups.entries()].map(([key, value]) => [key, groupByRisk(value)] as const);
  }, [testCases]);

  const groupedSingleCases = useMemo(() => groupByRisk(testCases), [testCases]);
  const modelReady = connectionStatus === "connected" && Boolean(selectedModel);

  if (!activeSession) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-semibold tracking-tight">Test Cases</h1>
        <p className="text-sm text-muted-foreground">No active session.</p>
      </div>
    );
  }

  if (!modelReady) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Test Cases</h1>
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

  if (sessionStatus !== "Completed" || findingsCount === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Test Cases</h1>
          <p className="text-sm text-muted-foreground">
            Convert completed review findings into release-readiness validation checks.
          </p>
        </div>
        <Card className="max-w-4xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FlaskConical className="h-4 w-4 text-muted-foreground" />
              No test cases yet
            </CardTitle>
            <CardDescription>
              Run a review in Workspace first, then generate test cases from findings.
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

  if (!settings.reviewIntelligence.enableTestCaseGeneration) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Test Cases</h1>
          <p className="text-sm text-muted-foreground">Test case generation is disabled in Settings.</p>
        </div>
        <Card className="max-w-4xl">
          <CardHeader>
            <CardTitle>Test case generation disabled</CardTitle>
            <CardDescription>
              Enable test case generation in Settings to create validation plans from findings.
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Test Cases</h1>
          <p className="text-sm text-muted-foreground">
            Test Cases planning for {title} ({getArtifactLabel(activeArtifactType)}).
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {lastReviewUsedContext ? "Context-aware test case planning" : "Query-only test case planning"}
          </p>
          {settings.trustGovernance.showModelProvenance ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Generated using local model • Model: {selectedModel} • Last run:{" "}
              {lastRunTimestamp ? new Date(lastRunTimestamp).toLocaleString() : "—"}
            </p>
          ) : null}
        </div>
        <Button variant="outline" size="sm" onClick={generateTestCasesFromFindings}>
          Regenerate from findings
        </Button>
      </div>

      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm">Test Cases Coverage</CardTitle>
          <CardDescription>
            Coverage: {criticalCoverage}% | {completed}/{total} completed | {criticalOpen + highOpen} critical/high open
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2 p-4 pt-2 text-xs">
          <Badge variant="muted">Critical checks first</Badge>
          <Badge variant="muted">Then high, then medium</Badge>
          <Badge
            className={
              readiness.tone === "danger"
                ? "border-red-500/30 bg-red-500/10 text-red-300"
                : readiness.tone === "warn"
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                  : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
            }
          >
            {readiness.label}
          </Badge>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="Total" value={total} />
        <MetricCard label="Passed" value={statusCounts.Passed} />
        <MetricCard label="Failed" value={statusCounts.Failed} />
        <MetricCard label="Remaining" value={remaining} />
      </div>

      {activeArtifactType === "Batch Review" ? (
        groupedBatchCases.map(([queryLabel, grouped]) => (
          <Card key={queryLabel}>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm">{queryLabel}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5 p-4 pt-2">
              {(Object.keys(grouped) as Array<keyof typeof grouped>).map((groupName) => (
                <RiskSection
                  key={`${queryLabel}-${groupName}`}
                  title={groupName}
                  cases={grouped[groupName]}
                  onStatusChange={updateTestCaseStatus}
                  onNotesChange={updateTestCaseNotes}
                />
              ))}
            </CardContent>
          </Card>
        ))
      ) : (
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm">Recommended Order</CardTitle>
            <CardDescription>Start with critical logic risks, then move down by priority.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 p-4 pt-2">
            {(Object.keys(groupedSingleCases) as Array<keyof typeof groupedSingleCases>).map((groupName) => (
              <RiskSection
                key={groupName}
                title={groupName}
                cases={groupedSingleCases[groupName]}
                onStatusChange={updateTestCaseStatus}
                onNotesChange={updateTestCaseNotes}
              />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <p className="text-2xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}

function RiskSection({
  title,
  cases,
  onStatusChange,
  onNotesChange,
}: {
  title: string;
  cases: ValidationTestCase[];
  onStatusChange: (id: string, status: TestCaseStatus) => void;
  onNotesChange: (id: string, notes: string) => void;
}) {
  if (cases.length === 0) return null;
  return (
    <section className="space-y-2.5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
        <Badge variant="muted">{cases.length}</Badge>
      </div>
      <div className="space-y-3">
        {cases.map((testCase) => (
          <TestCaseRow
            key={testCase.id}
            testCase={testCase}
            onStatusChange={onStatusChange}
            onNotesChange={onNotesChange}
          />
        ))}
      </div>
    </section>
  );
}

function TestCaseRow({
  testCase,
  onStatusChange,
  onNotesChange,
}: {
  testCase: ValidationTestCase;
  onStatusChange: (id: string, status: TestCaseStatus) => void;
  onNotesChange: (id: string, notes: string) => void;
}) {
  return (
    <div className="rounded-md border border-border/70 bg-muted/10 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {statusIcon(testCase.status)}
          <p className="text-sm font-medium text-foreground">{testCase.title}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={priorityStyles(testCase.priority)}>{testCase.priority}</Badge>
          <Badge variant="muted">{testCase.category}</Badge>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {testCase.linkedFindingId ? (
          <Button asChild size="sm" variant="ghost" className="h-6 px-2 text-xs">
            <Link href={`/findings#finding-${testCase.linkedFindingId}`}>Finding {testCase.linkedFindingId}</Link>
          </Button>
        ) : (
          <span>Proactive check</span>
        )}
        {testCase.linkedFindingSeverity ? (
          <Badge className={priorityStyles(testCase.linkedFindingSeverity)}>
            {testCase.linkedFindingSeverity}
          </Badge>
        ) : null}
        {testCase.linkedFindingSummary ? (
          <span className="text-muted-foreground/90">{testCase.linkedFindingSummary}</span>
        ) : null}
      </div>

      <div className="mt-3 space-y-2 text-xs text-muted-foreground">
        <p>
          <span className="font-medium text-foreground">What to validate:</span> {testCase.whatToValidate}
        </p>
        <p>
          <span className="font-medium text-foreground">Why it matters:</span> {testCase.whyItMatters}
        </p>
        {testCase.validationSQL ? (
          <div>
            <p className="font-medium text-foreground">Validation SQL:</p>
            <pre className="mt-1 overflow-auto rounded-md border border-border/70 bg-background/60 p-2 text-[11px] leading-relaxed text-muted-foreground">
              {testCase.validationSQL}
            </pre>
          </div>
        ) : null}
        {testCase.whatToDoIfItFails ? (
          <p>
            <span className="font-medium text-foreground">Fix if fails:</span> {testCase.whatToDoIfItFails}
          </p>
        ) : null}
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-[220px_minmax(0,1fr)]">
        <Select
          value={testCase.status}
          onValueChange={(value) => onStatusChange(testCase.id, value as TestCaseStatus)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {statusOptions.map((status) => (
              <SelectItem key={status} value={status}>
                {status}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Textarea
          value={testCase.notes}
          onChange={(event) => onNotesChange(testCase.id, event.target.value)}
          placeholder="Add validation notes..."
          className="min-h-[72px] bg-background/60 text-xs"
        />
      </div>
    </div>
  );
}


