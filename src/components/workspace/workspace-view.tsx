"use client";

import Link from "next/link";
import {
  AlertCircle,
  ChevronDown,
  Database,
  FileUp,
  Files,
  Loader2,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

import {
  describeContextSource,
  parseUploadedContextFile,
} from "@/lib/review-context";
import { useOllama } from "@/components/ollama/ollama-provider";
import {
  type ArtifactType,
  useReviewSession,
} from "@/components/review/review-session-provider";
import { useSettings } from "@/components/settings/settings-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  SqlLineEditor,
  type SqlLineEditorHandle,
} from "@/components/workspace/sql-line-editor";
import { Textarea } from "@/components/ui/textarea";
import { getArtifactLabel } from "@/lib/artifact-labels";
type ReviewTab = "sql" | "kpi" | "narrative" | "batch";

const tabToArtifact: Record<ReviewTab, ArtifactType> = {
  sql: "SQL Query",
  kpi: "KPI Definition",
  narrative: "Narrative",
  batch: "Batch Review",
};

const artifactToTab: Record<ArtifactType, ReviewTab> = {
  "SQL Query": "sql",
  "KPI Definition": "kpi",
  Narrative: "narrative",
  "Batch Review": "batch",
};

const tabContent: Record<
  ReviewTab,
  {
    label: "SQL Query" | "KPI Definition" | "Narrative" | "Batch Review";
    placeholder: string;
    helper: string;
  }
> = {
  sql: {
    label: "SQL Query",
    placeholder:
      "Paste a production SQL query here, including CTEs, joins, window functions, and assumptions around grain.",
    helper:
      "Tip: include comments or business context inline so logic checks can map code to intent.",
  },
  kpi: {
    label: "KPI Definition",
    placeholder:
      "Document metric name, owner, numerator, denominator, filters, refresh cadence, and business caveats.",
    helper:
      "Tip: call out exclusions and segmentation rules to reduce denominator and interpretation risk.",
  },
  narrative: {
    label: "Narrative",
    placeholder:
      "Paste the analyst narrative, stakeholder summary, or RCA note to check clarity and business framing before release.",
    helper:
      "Tip: include audience and decision context so communication checks can assess precision and confidence.",
  },
  batch: {
    label: "Batch Review",
    placeholder: "",
    helper:
      "Tip: split related SQL units clearly so batch findings map to each query.",
  },
};

const modelRows = [
  { key: "Runtime", value: "Local" },
  { key: "Privacy mode", value: "On-device" },
];

type KpiDraft = {
  name: string;
  definition: string;
  formula: string;
  grain: string;
  assumptions: string;
};

function parseKpiDraft(input: string): KpiDraft {
  const empty: KpiDraft = {
    name: "",
    definition: "",
    formula: "",
    grain: "",
    assumptions: "",
  };
  if (!input.trim()) return empty;

  const lines = input.split(/\r?\n/);
  const getValue = (label: string) => {
    const line = lines.find((row) => row.toLowerCase().startsWith(`${label.toLowerCase()}:`));
    return line ? line.slice(label.length + 1).trim() : "";
  };

  const parsed: KpiDraft = {
    name: getValue("KPI Name"),
    definition: getValue("Definition"),
    formula: getValue("Formula"),
    grain: getValue("Grain"),
    assumptions: getValue("Assumptions"),
  };

  const hasTemplateMarkers =
    input.toLowerCase().includes("kpi name:") || input.toLowerCase().includes("definition:");
  if (!hasTemplateMarkers) {
    return {
      ...empty,
      definition: input.trim(),
    };
  }

  return parsed;
}

function formatKpiDraft(draft: KpiDraft): string {
  return [
    `KPI Name: ${draft.name.trim()}`,
    `Definition: ${draft.definition.trim()}`,
    `Formula: ${draft.formula.trim()}`,
    `Grain: ${draft.grain.trim()}`,
    `Assumptions: ${draft.assumptions.trim()}`,
  ].join("\n");
}

function formatTimestamp(timestamp: string | null): string {
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleString();
}

export function WorkspaceView() {
  const { settings } = useSettings();
  const editorRef = useRef<SqlLineEditorHandle>(null);
  const contextFileInputRef = useRef<HTMLInputElement>(null);
  const sqlFileInputRef = useRef<HTMLInputElement>(null);
  const batchFileInputRef = useRef<HTMLInputElement>(null);
  const [isContextExpanded, setIsContextExpanded] = useState(false);
  const [uploadedSqlFileName, setUploadedSqlFileName] = useState<string | null>(null);
  const [sqlUploadStatus, setSqlUploadStatus] = useState<string | null>(null);
  const [sqlUploadError, setSqlUploadError] = useState<string | null>(null);
  const {
    connectionStatus,
    models,
    selectedModel: ollamaSelectedModel,
    isConnecting,
    isLoadingModels,
    errorMessage,
    connectToOllama,
    setSelectedModel,
  } = useOllama();

  const {
    activeArtifactType,
    sessionStatus,
    findingsCount,
    title: sessionTitle,
    progressStatus,
    lastReviewedInput,
    editorInputs,
    lastRunTimestamp,
    riskScore,
    riskLabel,
    highestSeverity,
    criticalHighCount,
    selectedModel: sessionSelectedModel,
    runReview,
    runBatchReview,
    isRunningReview,
    lastError,
    lastSuccessMessage,
    clearMessages,
    setActiveArtifactType,
    setSessionSelectedModel,
    setReviewProfile,
    setSeverityThreshold,
    setEditorInput,
    setBatchInput,
    parseBatchInput,
    addBatchFiles,
    batchInput,
    batchQueries,
    selectedBatchQueryId,
    selectBatchQuery,
    batchSummary,
    pendingJumpLine,
    clearPendingJumpLine,
    contextMode,
    pastedSchemaJson,
    uploadedContextFile,
    parsedContext,
    contextQualitySummary,
    contextValidationStatus,
    contextValidationMessage,
    uploadedContextStatusMessage,
    lastReviewUsedContext,
    lastReviewContextSource,
    setPastedSchemaJson,
    setUploadedContext,
    clearUploadedContext,
    reviewProfile,
    severityThreshold,
  } = useReviewSession();
  const effectiveSelectedModel = sessionSelectedModel ?? ollamaSelectedModel;

  const isConnected = connectionStatus === "connected";
  const artifactReviewEnabled =
    activeArtifactType === "SQL Query"
      ? settings.reviewIntelligence.enableSqlFindings
      : activeArtifactType === "KPI Definition"
        ? settings.reviewIntelligence.enableKpiDefinitionReview
        : activeArtifactType === "Narrative"
          ? settings.reviewIntelligence.enableNarrativeReview
          : settings.reviewIntelligence.enableSqlFindings;
  const activeTab = artifactToTab[activeArtifactType];
  const activeContent = tabContent[activeTab];
  const activeEditorInput = editorInputs[activeArtifactType];
  const hasChangesSinceLastReview =
    activeArtifactType === "SQL Query" &&
    sessionStatus === "Completed" &&
    lastReviewedInput !== null &&
    activeEditorInput.trim() !== lastReviewedInput.trim();
  const reviewSyncStatus =
    sessionStatus !== "Completed"
      ? "Not reviewed yet"
      : hasChangesSinceLastReview
        ? "Input changed since last review"
        : "Up to date";
  const nextContextLabel =
    contextMode === "context_aware"
      ? `Context-aware (${describeContextSource(parsedContext?.source ?? "none")})`
      : "Query-only";
  const lastContextLabel = lastReviewUsedContext
    ? `Reviewed with ${describeContextSource(lastReviewContextSource)}`
    : "Reviewed with query only";
  const selectedBatchQuery =
    batchQueries.find((query) => query.id === selectedBatchQueryId) ?? null;
  const kpiDraft = parseKpiDraft(editorInputs["KPI Definition"]);
  const isRunDisabled =
    isRunningReview ||
    !artifactReviewEnabled ||
    !isConnected ||
    !effectiveSelectedModel ||
    (activeArtifactType === "Batch Review" && batchQueries.length === 0 && !batchInput.trim());

  const sessionRows = useMemo(
    () => [
      { key: "Session", value: sessionTitle || "No active session" },
      { key: "Artifact type", value: getArtifactLabel(activeArtifactType) },
      { key: "Status", value: progressStatus },
      { key: "Model", value: effectiveSelectedModel ?? "—" },
      { key: "Context", value: lastReviewUsedContext ? "Context-aware" : "Query-only" },
      { key: "Last run", value: formatTimestamp(lastRunTimestamp) },
      { key: "Findings", value: String(findingsCount) },
      { key: "Export", value: "Available soon" },
    ],
    [
      activeArtifactType,
      progressStatus,
      sessionTitle,
      effectiveSelectedModel,
      lastReviewUsedContext,
      lastRunTimestamp,
      findingsCount,
    ],
  );

  useEffect(() => {
    if (!pendingJumpLine) return;
    if (activeArtifactType !== "SQL Query") {
      setActiveArtifactType("SQL Query");
      return;
    }
    editorRef.current?.focusLine(pendingJumpLine);
    clearPendingJumpLine();
  }, [
    pendingJumpLine,
    activeArtifactType,
    setActiveArtifactType,
    clearPendingJumpLine,
  ]);

  async function runCurrentReview() {
    clearMessages();
    const selectedForRun = isConnected ? effectiveSelectedModel : null;
    if (activeArtifactType === "Batch Review") {
      await runBatchReview({ selectedModel: selectedForRun });
      return;
    }
    await runReview({ selectedModel: selectedForRun });
  }

  async function handleContextFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const parsed = await parseUploadedContextFile(file);
    setUploadedContext({
      fileMeta: parsed.fileMeta,
      parsedContext: parsed.parsedContext,
      error: parsed.error,
      statusMessage: parsed.statusMessage,
    });
    event.target.value = "";
  }

  async function handleSqlFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const lowerName = file.name.toLowerCase();
    const isSupported = lowerName.endsWith(".sql") || lowerName.endsWith(".txt");
    if (!isSupported) {
      setSqlUploadError("Unsupported file type. Please upload a .sql or .txt file.");
      setSqlUploadStatus(null);
      event.target.value = "";
      return;
    }

    if (file.size > 1024 * 1024 * 2) {
      setSqlUploadError("File is too large. Please upload a file under 2 MB.");
      setSqlUploadStatus(null);
      event.target.value = "";
      return;
    }

    try {
      const text = await file.text();
      if (!text.trim()) {
        setSqlUploadError("The selected file is empty.");
        setSqlUploadStatus(null);
        event.target.value = "";
        return;
      }

      setActiveArtifactType("SQL Query");
      setEditorInput("SQL Query", text);
      setUploadedSqlFileName(file.name);
      setSqlUploadError(null);
      setSqlUploadStatus(`Loaded ${file.name}`);

      setTimeout(() => {
        editorRef.current?.focusEditor();
      }, 60);

      if (settings.workspaceDefaults.autoRunOnUpload && isConnected && effectiveSelectedModel) {
        void runReview({ selectedModel: effectiveSelectedModel });
      }
    } catch {
      setSqlUploadError("Could not read the file.");
      setSqlUploadStatus(null);
    } finally {
      event.target.value = "";
    }
  }

  async function handleBatchFileChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    await addBatchFiles(files);
    event.target.value = "";
  }

  function updateKpiDraft(next: Partial<KpiDraft>) {
    const merged = { ...kpiDraft, ...next };
    setEditorInput("KPI Definition", formatKpiDraft(merged));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2.5">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Workspace</h1>
        <p className="text-sm text-muted-foreground">
          Analytics QA Workspace
        </p>
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.72fr)_minmax(380px,1fr)]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Review Input</CardTitle>
            <CardDescription>
              Prepare one artifact at a time before running structured local QA checks.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <Tabs
              value={activeTab}
              onValueChange={(value) =>
                setActiveArtifactType(tabToArtifact[value as ReviewTab])
              }
            >
              <TabsList>
                <TabsTrigger value="sql">SQL Query</TabsTrigger>
                <TabsTrigger value="kpi">KPI Definition</TabsTrigger>
                <TabsTrigger value="narrative">Narrative</TabsTrigger>
                <TabsTrigger value="batch">Batch Review</TabsTrigger>
              </TabsList>
            </Tabs>

            {activeArtifactType === "Batch Review" ? (
              <div className="space-y-3 rounded-md border border-border/70 bg-muted/20 p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-foreground">Batch Input</p>
                    <p className="text-xs text-muted-foreground">
                      Paste multiple queries or upload multiple `.sql`/`.txt` files.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      ref={batchFileInputRef}
                      type="file"
                      accept=".sql,.txt,text/plain"
                      multiple
                      className="hidden"
                      onChange={(event) => void handleBatchFileChange(event)}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => batchFileInputRef.current?.click()}
                    >
                      <Files className="h-3.5 w-3.5" />
                      Upload SQL
                    </Button>
                    <Button variant="outline" size="sm" onClick={parseBatchInput}>
                      Parse input
                    </Button>
                  </div>
                </div>
                <SqlLineEditor
                  value={batchInput}
                  onChange={(value) => setBatchInput(value)}
                  placeholder="Paste multiple SQL queries separated by semicolons or -- Query labels."
                  sqlMode
                />
                <div className="grid gap-2 sm:grid-cols-4">
                  <div className="rounded-md border border-border/70 bg-muted/20 px-2.5 py-2 text-xs">
                    <p className="text-muted-foreground">Queries</p>
                    <p className="mt-0.5 text-sm font-semibold text-foreground">
                      {batchSummary.totalQueries}
                    </p>
                  </div>
                  <div className="rounded-md border border-border/70 bg-muted/20 px-2.5 py-2 text-xs">
                    <p className="text-muted-foreground">Findings</p>
                    <p className="mt-0.5 text-sm font-semibold text-foreground">
                      {batchSummary.totalFindings}
                    </p>
                  </div>
                  <div className="rounded-md border border-border/70 bg-muted/20 px-2.5 py-2 text-xs">
                    <p className="text-muted-foreground">High/Critical Queries</p>
                    <p className="mt-0.5 text-sm font-semibold text-foreground">
                      {batchSummary.criticalHighQueries}
                    </p>
                  </div>
                  <div className="rounded-md border border-border/70 bg-muted/20 px-2.5 py-2 text-xs">
                    <p className="text-muted-foreground">Avg Risk</p>
                    <p className="mt-0.5 text-sm font-semibold text-foreground">
                      {batchSummary.averageRiskScore}
                    </p>
                  </div>
                </div>
                {batchQueries.length > 0 ? (
                  <div className="space-y-2">
                    {batchQueries.map((query) => (
                      <button
                        key={query.id}
                        type="button"
                        onClick={() => selectBatchQuery(query.id)}
                        className={`w-full rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                          selectedBatchQueryId === query.id
                            ? "border-sky-500/40 bg-sky-500/10"
                            : "border-border/70 bg-muted/15 hover:bg-muted/25"
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium text-foreground">{query.label}</span>
                          <span className="text-muted-foreground">
                            Findings {query.findingsCount} • Risk {query.riskScore} •{" "}
                            {query.highestSeverity ?? "—"}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No queries analyzed yet. Add SQL or upload files to begin analysis.
                  </p>
                )}
                {selectedBatchQuery ? (
                  <div className="rounded-md border border-border/70 bg-muted/20 p-2.5">
                    <div className="mb-1.5 flex items-center justify-between">
                      <p className="text-xs font-medium text-foreground">{selectedBatchQuery.label}</p>
                      <span className="text-[11px] text-muted-foreground">
                        {selectedBatchQuery.source === "file"
                          ? selectedBatchQuery.sourceName
                          : "Pasted input"}
                      </span>
                    </div>
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-background/70 p-2 text-[11px] text-muted-foreground">
                      {selectedBatchQuery.sql}
                    </pre>
                    {selectedBatchQuery.findings.length > 0 ? (
                      <div className="mt-2 space-y-1">
                        {selectedBatchQuery.findings.slice(0, 4).map((finding) => (
                          <div
                            key={`${selectedBatchQuery.id}-${finding.id}`}
                            className="rounded border border-border/60 bg-muted/15 px-2 py-1 text-[11px] text-muted-foreground"
                          >
                            {finding.type} • Line {finding.line} • {finding.title}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : activeArtifactType === "SQL Query" ? (
              <>
                <div className="flex flex-col gap-2 rounded-md border border-border/70 bg-muted/20 px-3.5 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="space-y-0.5">
                      <p className="text-xs font-medium text-foreground">Load SQL file</p>
                      <p className="text-[11px] text-muted-foreground">
                        Upload a `.sql` or `.txt` file directly into the SQL editor.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        ref={sqlFileInputRef}
                        type="file"
                        accept=".sql,.txt,text/plain"
                        className="hidden"
                        onChange={(event) => void handleSqlFileChange(event)}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => sqlFileInputRef.current?.click()}
                      >
                        <FileUp className="h-3.5 w-3.5" />
                        Upload SQL
                      </Button>
                    </div>
                  </div>
                  {uploadedSqlFileName ? (
                    <p className="text-[11px] text-muted-foreground">
                      Current file: <span className="text-foreground">{uploadedSqlFileName}</span>
                    </p>
                  ) : null}
                  {sqlUploadStatus ? (
                    <p className="text-[11px] text-emerald-300">{sqlUploadStatus}</p>
                  ) : null}
                  {sqlUploadError ? (
                    <p className="text-[11px] text-red-300">{sqlUploadError}</p>
                  ) : null}
                </div>

                <SqlLineEditor
                  ref={editorRef}
                  value={editorInputs["SQL Query"]}
                  onChange={(value) => setEditorInput("SQL Query", value)}
                  placeholder={tabContent.sql.placeholder}
                  sqlMode
                />
              </>
            ) : activeArtifactType === "KPI Definition" ? (
              <div className="space-y-3 rounded-md border border-border/70 bg-muted/20 p-3.5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">KPI Name</p>
                    <input
                      value={kpiDraft.name}
                      onChange={(event) => updateKpiDraft({ name: event.target.value })}
                      placeholder="e.g., Gross Revenue Retention"
                      className="h-9 w-full rounded-md border border-border/70 bg-background/70 px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">Grain</p>
                    <input
                      value={kpiDraft.grain}
                      onChange={(event) => updateKpiDraft({ grain: event.target.value })}
                      placeholder="e.g., one row per account per month"
                      className="h-9 w-full rounded-md border border-border/70 bg-background/70 px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">Definition</p>
                  <Textarea
                    value={kpiDraft.definition}
                    onChange={(event) => updateKpiDraft({ definition: event.target.value })}
                    placeholder="Describe the KPI business definition, owner, scope, and exclusions."
                    className="min-h-[120px] bg-background/60 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">Formula (optional)</p>
                  <Textarea
                    value={kpiDraft.formula}
                    onChange={(event) => updateKpiDraft({ formula: event.target.value })}
                    placeholder="Add formula or pseudo-SQL used to compute this KPI."
                    className="min-h-[90px] bg-background/60 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">Assumptions</p>
                  <Textarea
                    value={kpiDraft.assumptions}
                    onChange={(event) => updateKpiDraft({ assumptions: event.target.value })}
                    placeholder="Document assumptions, caveats, and stakeholder interpretation notes."
                    className="min-h-[90px] bg-background/60 text-sm"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-1 rounded-md border border-border/70 bg-muted/20 p-3.5">
                <p className="text-xs font-medium text-muted-foreground">Narrative Draft</p>
                <Textarea
                  value={editorInputs.Narrative}
                  onChange={(event) => setEditorInput("Narrative", event.target.value)}
                  placeholder={tabContent.narrative.placeholder}
                  className="min-h-[260px] bg-background/60 text-sm leading-relaxed"
                />
              </div>
            )}

            <div className="rounded-lg border border-dashed border-border/90 bg-muted/20">
              <button
                type="button"
                className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-muted/20"
                onClick={() => setIsContextExpanded((value) => !value)}
              >
                <div className="space-y-0.5">
                  <p className="text-sm font-medium text-foreground">Optional Data Context</p>
                  <p className="text-xs text-muted-foreground">
                    Add schema or data metadata to improve SQL, KPI, narrative, and batch review findings.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="muted">{nextContextLabel}</Badge>
                  <ChevronDown
                    className={`h-4 w-4 text-muted-foreground transition-transform ${
                      isContextExpanded ? "rotate-180" : ""
                    }`}
                  />
                </div>
              </button>
              {isContextExpanded ? (
                <div className="space-y-3 border-t border-border/70 px-4 py-3">
                  <div className="space-y-1">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Paste schema JSON
                    </p>
                    <Textarea
                      value={pastedSchemaJson}
                      onChange={(event) => setPastedSchemaJson(event.target.value)}
                      placeholder={`{
  "tables": {
    "orders": { "grain": "one row per order", "columns": {} }
  }
}`}
                      className="min-h-[132px] bg-muted/25 text-xs leading-relaxed"
                    />
                  </div>

                  <div className="flex flex-col items-start justify-between gap-3 rounded-md border border-border/70 bg-muted/25 p-3 sm:flex-row sm:items-center">
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-foreground">
                        Upload context file (.json, .csv, .txt)
                      </p>
                      {uploadedContextFile ? (
                        <p className="text-xs text-muted-foreground">
                          {uploadedContextFile.name} • {uploadedContextFile.fileType.toUpperCase()} •{" "}
                          {(uploadedContextFile.size / 1024).toFixed(1)} KB
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Use uploads as supplemental schema or data hints.
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        ref={contextFileInputRef}
                        type="file"
                        accept=".json,.csv,.txt"
                        className="hidden"
                        onChange={(event) => void handleContextFileChange(event)}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => contextFileInputRef.current?.click()}
                      >
                        <FileUp className="h-3.5 w-3.5" />
                        Upload file
                      </Button>
                      {uploadedContextFile ? (
                        <Button variant="ghost" size="sm" onClick={clearUploadedContext}>
                          Clear
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  {contextValidationMessage ? (
                    <div className="flex items-start gap-2 rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <p>{contextValidationMessage}</p>
                    </div>
                  ) : null}
                  {uploadedContextStatusMessage ? (
                    <div className="flex items-start gap-2 rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                      <Database className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <p>{uploadedContextStatusMessage}</p>
                    </div>
                  ) : null}
                  <div className="flex items-center justify-between rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                    <span>Next review mode</span>
                    <span className="font-medium text-foreground">{nextContextLabel}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground/90">
                    Context is optional. Reviews run in query-only mode when context is empty or
                    invalid.
                  </p>
                </div>
              ) : null}
            </div>
            <div className="grid gap-4 rounded-lg border border-border/80 bg-muted/20 p-3.5 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.18fr)]">
              <Select value={reviewProfile} onValueChange={(value) => setReviewProfile(value as "standard" | "strict" | "release_gate")}>
                <SelectTrigger>
                  <SelectValue placeholder="Review mode" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Standard QA</SelectItem>
                  <SelectItem value="strict">Strict QA</SelectItem>
                  <SelectItem value="release_gate">Release gate</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={effectiveSelectedModel ?? undefined}
                onValueChange={(value) => {
                  setSelectedModel(value);
                  setSessionSelectedModel(value);
                }}
                disabled={!isConnected || models.length === 0 || isLoadingModels}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      !isConnected
                        ? "No model selected"
                        : isLoadingModels
                          ? "Loading models..."
                          : "Select model"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {isLoadingModels ? (
                    <SelectItem value="loading" disabled>
                      Loading local models...
                    </SelectItem>
                  ) : models.length > 0 ? (
                    models.map((model) => (
                      <SelectItem key={model.name} value={model.name}>
                        {model.name}
                        {model.size ? ` • ${model.size}` : ""}
                      </SelectItem>
                    ))
                  ) : (
                    <SelectItem value="none" disabled>
                      {isConnected ? "No models found" : "Connect model first"}
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
              <Select
                value={severityThreshold}
                onValueChange={(value) =>
                  setSeverityThreshold(value as "low_plus" | "medium_plus" | "high_only")
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Severity threshold" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low_plus">Low+</SelectItem>
                  <SelectItem value="medium_plus">Medium+</SelectItem>
                  <SelectItem value="high_only">High only</SelectItem>
                </SelectContent>
              </Select>
              <Button
                className="h-9 w-full gap-1.5 font-semibold disabled:opacity-100 disabled:border disabled:border-primary/25 disabled:bg-primary/15 disabled:text-foreground disabled:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
                onClick={() => void runCurrentReview()}
                disabled={isRunDisabled}
              >
                {isRunningReview ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                {isRunningReview ? "Reviewing..." : "Run Review"}
              </Button>
            </div>
            {errorMessage ? (
              <div className="flex items-start gap-2 rounded-md border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <p>{errorMessage}</p>
              </div>
            ) : null}
            {lastError ? (
              <div className="flex items-start gap-2 rounded-md border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <p>{lastError}</p>
              </div>
            ) : null}
            {!effectiveSelectedModel ? (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <p>Model not connected. Connect a local model to run analysis.</p>
              </div>
            ) : null}
            {!artifactReviewEnabled ? (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <p>
                  {getArtifactLabel(activeArtifactType)} review is disabled in Settings. Enable it to run this review type.
                </p>
              </div>
            ) : null}
            {activeArtifactType === "Batch Review" && batchQueries.length === 0 && !batchInput.trim() ? (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <p>Analyze or upload at least one query unit before running batch analysis.</p>
              </div>
            ) : null}
            {lastSuccessMessage ? (
              <div className="flex items-start justify-between gap-3 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                <p>{lastSuccessMessage}</p>
                <Button asChild size="sm" variant="outline">
                  <Link href="/findings">View findings</Link>
                </Button>
              </div>
            ) : null}
            <div className="flex items-start gap-2 rounded-md border border-border/80 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p>
                {activeContent.helper} All analysis stays local once Ollama is connected.
              </p>
            </div>
            <div className="rounded-md border border-border/80 bg-muted/15 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Review Status
                </p>
                <Badge
                  className={
                    reviewSyncStatus === "Up to date"
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                      : reviewSyncStatus === "Input changed since last review"
                        ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                        : "border-border bg-muted text-muted-foreground"
                  }
                >
                  {reviewSyncStatus}
                </Badge>
              </div>
              <div className="mt-2 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                <div className="flex items-center justify-between rounded-md border border-border/60 bg-muted/20 px-2.5 py-1.5">
                  <span>Last reviewed</span>
                  <span className="text-foreground">{formatTimestamp(lastRunTimestamp)}</span>
                </div>
                <div className="flex items-center justify-between rounded-md border border-border/60 bg-muted/20 px-2.5 py-1.5">
                  <span>Findings</span>
                  <span className="text-foreground">{findingsCount}</span>
                </div>
                <div className="flex items-center justify-between rounded-md border border-border/60 bg-muted/20 px-2.5 py-1.5">
                  <span>Risk</span>
                  <span className="text-foreground">
                    {sessionStatus === "Completed" ? `${riskScore} (${riskLabel})` : "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-md border border-border/60 bg-muted/20 px-2.5 py-1.5">
                  <span>Highest severity</span>
                  <span className="text-foreground">
                    {sessionStatus === "Completed" ? (highestSeverity ?? "—") : "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-md border border-border/60 bg-muted/20 px-2.5 py-1.5 sm:col-span-2">
                  <span>Context mode</span>
                  <span className="text-foreground">
                    {sessionStatus === "Completed" ? lastContextLabel : nextContextLabel}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-md border border-border/60 bg-muted/20 px-2.5 py-1.5 sm:col-span-2">
                  <span>Context quality</span>
                  <span className="text-foreground">{contextQualitySummary}</span>
                </div>
                <div className="flex items-center justify-between rounded-md border border-border/60 bg-muted/20 px-2.5 py-1.5 sm:col-span-2">
                  <span>Status</span>
                  <span className="text-foreground">{progressStatus}</span>
                </div>
              </div>
              {sessionSelectedModel ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Last reviewed model: {sessionSelectedModel}
                </p>
              ) : null}
              {contextValidationStatus === "invalid" && !parsedContext ? (
                <p className="mt-1 text-xs text-amber-300">
                  Context will be ignored until validation issues are fixed.
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="border-border bg-card shadow-[0_12px_28px_rgba(3,6,17,0.32)]">
            <CardHeader>
              <CardTitle className="text-base font-semibold text-foreground">
                Session Overview
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5 p-6 pt-0">
              {sessionRows.map((row) => (
                <div
                  key={row.key}
                  className="flex items-center justify-between gap-4 rounded-md px-2.5 py-1.5 text-sm transition-colors hover:bg-muted/25"
                >
                  <span className="text-muted-foreground/85">{row.key}</span>
                  <span className="text-right font-semibold text-foreground">{row.value}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Model Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5">
              <div className="flex items-center justify-between gap-4 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted/20">
                <span className="text-muted-foreground/85">Ollama connection</span>
                <span
                  className={
                    isConnected
                      ? "text-right font-semibold text-emerald-300"
                      : "text-right font-semibold text-red-300"
                  }
                >
                  {isLoadingModels
                    ? "Loading models..."
                    : isConnected
                      ? "Connected"
                      : isConnecting
                        ? "Checking..."
                        : "Not connected"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted/20">
                <span className="text-muted-foreground/85">Selected model</span>
                <span className="text-right font-medium">{effectiveSelectedModel ?? "—"}</span>
              </div>
              {modelRows.map((row) => (
                <div
                  key={row.key}
                  className="flex items-center justify-between gap-4 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted/20"
                >
                  <span className="text-muted-foreground/85">{row.key}</span>
                  <span className="text-right font-medium">{row.value}</span>
                </div>
              ))}
              <p className="rounded-md border border-border/70 bg-muted/20 p-2 text-xs text-muted-foreground">
                No data leaves your environment after local model runtime is enabled.
              </p>
              {!isConnected ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => void connectToOllama()}
                >
                  Connect to local Ollama
                </Button>
              ) : null}
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card/70">
            <CardHeader>
              <CardTitle className="text-[13px] font-medium text-muted-foreground/90">
                {sessionStatus === "Completed" ? "Key risks identified" : "What will be evaluated"}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2.5 pt-0">
              {sessionStatus === "Completed" ? (
                <>
                  <div className="flex items-center justify-between rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-sm">
                    <span className="text-muted-foreground">Critical / High findings</span>
                    <span className="font-semibold text-foreground">{criticalHighCount}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-sm">
                    <span className="text-muted-foreground">Highest severity</span>
                    <span className="font-semibold text-foreground">{highestSeverity ?? "—"}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-sm">
                    <span className="text-muted-foreground">Risk score</span>
                    <span className="font-semibold text-foreground">{riskScore}</span>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-[13px] text-muted-foreground">Logic correctness</p>
                  <p className="text-[13px] text-muted-foreground">Edge cases</p>
                  <p className="text-[13px] text-muted-foreground">Business clarity</p>
                  <p className="text-[13px] text-muted-foreground">Metric reliability</p>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}





