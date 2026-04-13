"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

import { useOllama } from "@/components/ollama/ollama-provider";
import { useSettings } from "@/components/settings/settings-provider";
import { generateArtifactRewrite } from "@/lib/rewrite-generator";
import { createDraftBatchUnit, parseBatchSqlFileContent, parseBatchSqlInput } from "@/lib/sql-batch";
import { mergeParsedContexts, parsePastedSchemaJson, summarizeContextQuality } from "@/lib/review-context";
import { generateSessionTestCases } from "@/lib/test-case-generator";
import type {
  ReviewOptions,
  ReviewProfile,
  SeverityThreshold,
} from "@/lib/review-orchestrator";
import { computeRiskScore, countCriticalHigh, getHighestSeverity, getRiskLabel, type RiskLabel } from "@/lib/riskScore";
import type {
  ContextMode,
  ContextSource,
  ContextValidationStatus,
  ParsedReviewContext,
  UploadedContextFileMeta,
} from "@/types/review-context";
import type { BatchQueryUnit, ReviewMode, SqlFinding } from "@/types/sql-review";
import type { TestCaseStatus, ValidationTestCase } from "@/types/test-cases";
import type { RewriteOutput } from "@/types/rewrite";
import type { DefaultRewriteMode } from "@/types/settings";

export type ArtifactType = "SQL Query" | "KPI Definition" | "Narrative" | "Batch Review";
export type SessionStatus = "Not started" | "Completed";
export type ReviewProgressStatus = "Draft" | "Reviewed" | "Changed" | "Ready" | "Blocked";

type EditorInputs = Record<ArtifactType, string>;
type RewriteModeMap = Record<ArtifactType, string>;
type RewriteOutputMap = Record<Exclude<ArtifactType, "Batch Review">, RewriteOutput | null>;

type StoredSession = {
  id: string;
  title: string;
  note: string;
  lastRunMode: ReviewMode;
  activeArtifactType: ArtifactType;
  currentArtifactType: ArtifactType;
  currentInput: string;
  lastReviewedInput: string | null;
  editorInputs: EditorInputs;
  selectedModel: string | null;
  findings: SqlFinding[];
  findingsCount: number;
  lastRunTimestamp: string | null;
  sessionStatus: SessionStatus;
  riskScore: number;
  riskLabel: RiskLabel;
  highestSeverity: SqlFinding["type"] | null;
  criticalHighCount: number;
  contextMode: ContextMode;
  pastedSchemaJson: string;
  uploadedContextFile: UploadedContextFileMeta | null;
  parsedContext: ParsedReviewContext | null;
  contextQualitySummary: string;
  contextValidationStatus: ContextValidationStatus;
  contextValidationMessage: string | null;
  uploadedContextStatusMessage: string | null;
  lastReviewUsedContext: boolean;
  lastReviewContextSource: ContextSource;
  pastedParsedContext: ParsedReviewContext | null;
  uploadedParsedContext: ParsedReviewContext | null;
  batchInput: string;
  batchQueries: BatchQueryUnit[];
  selectedBatchQueryId: string | null;
  batchLastRunTimestamp: string | null;
  reviewProfile: ReviewProfile;
  severityThreshold: SeverityThreshold;
  testCases: ValidationTestCase[];
  rewriteModes: RewriteModeMap;
  rewriteOutputs: RewriteOutputMap;
  batchRewriteOutputs: Record<string, RewriteOutput>;
  selectedRewriteBatchQueryId: string | null;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
};

type ReviewSessionRootState = {
  sessions: StoredSession[];
  activeSessionId: string | null;
  pendingJumpLine: number | null;
  isRunningReview: boolean;
  lastError: string | null;
  lastSuccessMessage: string | null;
};

type RunReviewInput = { selectedModel: string | null };

type BatchSummary = {
  totalQueries: number;
  totalFindings: number;
  criticalHighQueries: number;
  averageRiskScore: number;
  commonIssues: Array<{ label: string; count: number }>;
  systemicIssueCount: number;
};

type ReviewSessionState = {
  sessions: StoredSession[];
  activeSessionId: string | null;
  activeSession: StoredSession | null;
  progressStatus: ReviewProgressStatus;
  lastRunMode: ReviewMode;
  reviewMode: ReviewMode;
  title: string;
  note: string;
  createdAt: string | null;
  updatedAt: string | null;
  lastRunAt: string | null;
  activeArtifactType: ArtifactType;
  currentArtifactType: ArtifactType;
  currentInput: string;
  lastReviewedInput: string | null;
  editorInputs: EditorInputs;
  selectedModel: string | null;
  findings: SqlFinding[];
  findingsCount: number;
  lastRunTimestamp: string | null;
  sessionStatus: SessionStatus;
  riskScore: number;
  riskLabel: RiskLabel;
  highestSeverity: SqlFinding["type"] | null;
  criticalHighCount: number;
  isRunningReview: boolean;
  lastError: string | null;
  lastSuccessMessage: string | null;
  pendingJumpLine: number | null;
  contextMode: ContextMode;
  pastedSchemaJson: string;
  uploadedContextFile: UploadedContextFileMeta | null;
  parsedContext: ParsedReviewContext | null;
  contextQualitySummary: string;
  contextValidationStatus: ContextValidationStatus;
  contextValidationMessage: string | null;
  uploadedContextStatusMessage: string | null;
  lastReviewUsedContext: boolean;
  lastReviewContextSource: ContextSource;
  batchInput: string;
  batchQueries: BatchQueryUnit[];
  selectedBatchQueryId: string | null;
  batchLastRunTimestamp: string | null;
  reviewProfile: ReviewProfile;
  severityThreshold: SeverityThreshold;
  testCases: ValidationTestCase[];
  rewriteModes: RewriteModeMap;
  rewriteOutputs: RewriteOutputMap;
  batchRewriteOutputs: Record<string, RewriteOutput>;
  selectedRewriteBatchQueryId: string | null;
};

type CreateSessionInput = {
  title: string;
  artifactType: ArtifactType;
  note?: string;
};

type ReviewSessionContextValue = ReviewSessionState & {
  createSession: (input: CreateSessionInput) => void;
  switchSession: (sessionId: string) => void;
  renameSession: (sessionId: string, title: string) => void;
  duplicateSession: (sessionId: string) => void;
  deleteSession: (sessionId: string) => void;
  setActiveArtifactType: (artifactType: ArtifactType) => void;
  setReviewProfile: (profile: ReviewProfile) => void;
  setSeverityThreshold: (threshold: SeverityThreshold) => void;
  setSessionSelectedModel: (model: string | null) => void;
  setEditorInput: (artifactType: ArtifactType, input: string) => void;
  setBatchInput: (input: string) => void;
  parseBatchInput: () => void;
  addBatchFiles: (files: File[]) => Promise<void>;
  selectBatchQuery: (id: string) => void;
  setPastedSchemaJson: (input: string) => void;
  setUploadedContext: (payload: {
    fileMeta: UploadedContextFileMeta | null;
    parsedContext: ParsedReviewContext | null;
    error?: string | null;
    statusMessage?: string | null;
  }) => void;
  clearUploadedContext: () => void;
  requestLineJump: (line: number) => void;
  clearPendingJumpLine: () => void;
  runReview: (payload: RunReviewInput) => Promise<SqlFinding[]>;
  runBatchReview: (payload: RunReviewInput) => Promise<BatchQueryUnit[]>;
  generateTestCasesFromFindings: () => void;
  updateTestCaseStatus: (testCaseId: string, status: TestCaseStatus) => void;
  updateTestCaseNotes: (testCaseId: string, notes: string) => void;
  setRewriteMode: (artifactType: ArtifactType, mode: string) => void;
  setSelectedRewriteBatchQueryId: (queryId: string) => void;
  generateRewrite: () => void;
  applyRewriteToSessionInput: () => void;
  clearRewriteOutput: (artifactType?: ArtifactType) => void;
  batchSummary: BatchSummary;
  clearMessages: () => void;
};

const EMPTY_EDITOR_INPUTS: EditorInputs = {
  "SQL Query": "",
  "KPI Definition": "",
  Narrative: "",
  "Batch Review": "",
};

const DEFAULT_REWRITE_MODES: RewriteModeMap = {
  "SQL Query": "Safer SQL",
  "KPI Definition": "Clearer definition",
  Narrative: "Action-oriented",
  "Batch Review": "Safer SQL",
};

const EMPTY_REWRITE_OUTPUTS: RewriteOutputMap = {
  "SQL Query": null,
  "KPI Definition": null,
  Narrative: null,
};

function makeSessionId() {
  return `S-${Math.random().toString(36).slice(2, 10)}`;
}

function createEmptySession(input?: Partial<CreateSessionInput>): StoredSession {
  const now = new Date().toISOString();
  const artifactType = input?.artifactType ?? "SQL Query";
  return {
    id: makeSessionId(),
    title: input?.title ?? "Query Review 1",
    note: input?.note ?? "",
    lastRunMode: artifactType === "Batch Review" ? "batch" : "single",
    activeArtifactType: artifactType,
    currentArtifactType: artifactType,
    currentInput: "",
    lastReviewedInput: null,
    editorInputs: { ...EMPTY_EDITOR_INPUTS },
    selectedModel: null,
    findings: [],
    findingsCount: 0,
    lastRunTimestamp: null,
    sessionStatus: "Not started",
    riskScore: 0,
    riskLabel: "Low risk",
    highestSeverity: null,
    criticalHighCount: 0,
    contextMode: "query_only",
    pastedSchemaJson: "",
    uploadedContextFile: null,
    parsedContext: null,
    contextQualitySummary: "No context",
    contextValidationStatus: "empty",
    contextValidationMessage: null,
    uploadedContextStatusMessage: null,
    lastReviewUsedContext: false,
    lastReviewContextSource: "none",
    pastedParsedContext: null,
    uploadedParsedContext: null,
    batchInput: "",
    batchQueries: [],
    selectedBatchQueryId: null,
    batchLastRunTimestamp: null,
    reviewProfile: "standard",
    severityThreshold: "medium_plus",
    testCases: [],
    rewriteModes: { ...DEFAULT_REWRITE_MODES },
    rewriteOutputs: { ...EMPTY_REWRITE_OUTPUTS },
    batchRewriteOutputs: {},
    selectedRewriteBatchQueryId: null,
    createdAt: now,
    updatedAt: now,
    lastRunAt: null,
  };
}

function updateSessionInList(
  sessions: StoredSession[],
  sessionId: string | null,
  updater: (session: StoredSession) => StoredSession,
) {
  if (!sessionId) return sessions;
  return sessions.map((session) => (session.id === sessionId ? updater(session) : session));
}

function computeProgressStatus(session: StoredSession): ReviewProgressStatus {
  if (!session.lastRunAt) return "Draft";
  const activeInput =
    session.activeArtifactType === "Batch Review"
      ? session.batchInput
      : session.editorInputs[session.activeArtifactType];
  if (session.lastReviewedInput !== null && activeInput.trim() !== session.lastReviewedInput.trim()) {
    return "Changed";
  }
  if (session.highestSeverity === "CRITICAL" || session.highestSeverity === "HIGH") return "Blocked";
  if (session.findingsCount === 0) return "Ready";
  return "Reviewed";
}

function toSqlRewriteMode(defaultMode: DefaultRewriteMode): string {
  if (defaultMode === "Optimized SQL") return "Cleaner SQL";
  if (defaultMode === "Readable SQL") return "Production-ready SQL";
  return "Safer SQL";
}

function applySqlSafetyRules(findings: SqlFinding[], settings: ReturnType<typeof useSettings>["settings"]): SqlFinding[] {
  let filtered = [...findings];
  const { sqlSafetyRules } = settings;

  if (!sqlSafetyRules.divisionByZeroProtection) {
    filtered = filtered.filter(
      (finding) =>
        !/division by zero|denominator|divide-by-zero/i.test(
          `${finding.title} ${finding.description} ${finding.recommendation}`,
        ),
    );
  }

  if (!sqlSafetyRules.nullHandlingEnforcement) {
    filtered = filtered.filter(
      (finding) =>
        !/null handling|nullability|null values|coalesce/i.test(
          `${finding.title} ${finding.description} ${finding.recommendation}`,
        ),
    );
  }

  if (!sqlSafetyRules.joinDuplicationDetection) {
    filtered = filtered.filter(
      (finding) =>
        !/join duplication|row multiplication|join cardinality|duplicate rows|many-to-many/i.test(
          `${finding.title} ${finding.description} ${finding.recommendation}`,
        ),
    );
  }

  if (!sqlSafetyRules.groupByConsistencyCheck) {
    filtered = filtered.filter(
      (finding) =>
        !/grain mismatch|group by|non-aggregated/i.test(
          `${finding.title} ${finding.description} ${finding.recommendation}`,
        ),
    );
  }

  if (!sqlSafetyRules.distinctMisuseDetection) {
    filtered = filtered.filter(
      (finding) =>
        !/distinct/i.test(`${finding.title} ${finding.description} ${finding.recommendation}`),
    );
  }

  if (sqlSafetyRules.severityFilter === "hide_low") {
    filtered = filtered.filter((finding) => finding.type !== "LOW");
  } else if (sqlSafetyRules.severityFilter === "high_critical") {
    filtered = filtered.filter((finding) => finding.type === "HIGH" || finding.type === "CRITICAL");
  }

  return filtered;
}

function applyConfidenceMode(
  findings: SqlFinding[],
  mode: "conservative" | "balanced" | "lenient",
): SqlFinding[] {
  if (mode === "balanced") return findings;
  if (mode === "conservative") {
    return findings.map((finding) =>
      finding.type === "LOW" && finding.confidence !== "HIGH"
        ? { ...finding, type: "MEDIUM" as const }
        : finding,
    );
  }
  return findings.filter(
    (finding) => finding.type !== "LOW" && !(finding.type === "MEDIUM" && finding.confidence === "LOW"),
  );
}

function getDisabledRuleNotes(settings: ReturnType<typeof useSettings>["settings"]): string[] {
  const notes: string[] = [];
  const rules = settings.sqlSafetyRules;
  if (!rules.divisionByZeroProtection) notes.push("[Rule disabled via settings] Division by zero protection");
  if (!rules.nullHandlingEnforcement) notes.push("[Rule disabled via settings] NULL handling enforcement");
  if (!rules.joinDuplicationDetection) notes.push("[Rule disabled via settings] Join duplication detection");
  if (!rules.groupByConsistencyCheck) notes.push("[Rule disabled via settings] GROUP BY consistency check");
  if (!rules.distinctMisuseDetection) notes.push("[Rule disabled via settings] DISTINCT misuse detection");
  return notes;
}

const ReviewSessionContext = createContext<ReviewSessionContextValue | null>(null);

export function ReviewSessionProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useSettings();
  const { connectionStatus, selectedModel: connectedModel } = useOllama();
  const [state, setState] = useState<ReviewSessionRootState>(() => {
    const initial = createEmptySession({ title: "Query Review 1", artifactType: "SQL Query" });
    const sqlDefaultRewriteMode = toSqlRewriteMode(settings.workspaceDefaults.defaultRewriteMode);
    initial.rewriteModes["SQL Query"] = sqlDefaultRewriteMode;
    initial.rewriteModes["Batch Review"] = sqlDefaultRewriteMode;
    return {
      sessions: [initial],
      activeSessionId: initial.id,
      pendingJumpLine: null,
      isRunningReview: false,
      lastError: null,
      lastSuccessMessage: null,
    };
  });

  const activeSession = useMemo(
    () => state.sessions.find((session) => session.id === state.activeSessionId) ?? null,
    [state.sessions, state.activeSessionId],
  );

  const mutateActiveSession = useCallback((updater: (session: StoredSession) => StoredSession) => {
    setState((previous) => ({
      ...previous,
      sessions: updateSessionInList(previous.sessions, previous.activeSessionId, (session) => ({
        ...updater(session),
        updatedAt: settings.trustGovernance.autoSaveHistory
          ? new Date().toISOString()
          : session.updatedAt,
      })),
    }));
  }, [settings.trustGovernance.autoSaveHistory]);

  const createSession = useCallback((input: CreateSessionInput) => {
    setState((previous) => {
      const session = createEmptySession(input);
      const sqlDefaultRewriteMode = toSqlRewriteMode(settings.workspaceDefaults.defaultRewriteMode);
      session.rewriteModes["SQL Query"] = sqlDefaultRewriteMode;
      session.rewriteModes["Batch Review"] = sqlDefaultRewriteMode;
      return {
        ...previous,
        sessions: [session, ...previous.sessions],
        activeSessionId: session.id,
        lastError: null,
        lastSuccessMessage: `Created review session "${session.title}".`,
      };
    });
  }, [settings.workspaceDefaults.defaultRewriteMode]);

  const switchSession = useCallback((sessionId: string) => {
    setState((previous) => ({
      ...previous,
      activeSessionId: sessionId,
      lastError: null,
      lastSuccessMessage: null,
    }));
  }, []);

  const renameSession = useCallback((sessionId: string, title: string) => {
    setState((previous) => ({
      ...previous,
      sessions: previous.sessions.map((session) =>
        session.id === sessionId ? { ...session, title: title.trim() || session.title } : session,
      ),
    }));
  }, []);

  const duplicateSession = useCallback((sessionId: string) => {
    setState((previous) => {
      const source = previous.sessions.find((session) => session.id === sessionId);
      if (!source) return previous;
      const now = new Date().toISOString();
      const copy: StoredSession = {
        ...source,
        id: makeSessionId(),
        title: `${source.title} (Copy)`,
        createdAt: now,
        updatedAt: now,
      };
      return {
        ...previous,
        sessions: [copy, ...previous.sessions],
        activeSessionId: copy.id,
        lastSuccessMessage: `Duplicated session "${source.title}".`,
      };
    });
  }, []);

  const deleteSession = useCallback((sessionId: string) => {
    setState((previous) => {
      const remaining = previous.sessions.filter((session) => session.id !== sessionId);
      const wasActive = previous.activeSessionId === sessionId;
      const nextActiveId = wasActive ? remaining[0]?.id ?? null : previous.activeSessionId;
      return {
        ...previous,
        sessions: remaining,
        activeSessionId: nextActiveId,
        lastError: null,
        lastSuccessMessage: "Review session deleted.",
      };
    });
  }, []);

  const setActiveArtifactType = useCallback(
    (artifactType: ArtifactType) => {
      mutateActiveSession((session) => ({
        ...session,
        activeArtifactType: artifactType,
        lastRunMode: artifactType === "Batch Review" ? "batch" : session.lastRunMode,
      }));
    },
    [mutateActiveSession],
  );

  const setReviewProfile = useCallback(
    (profile: ReviewProfile) => mutateActiveSession((session) => ({ ...session, reviewProfile: profile })),
    [mutateActiveSession],
  );

  const setSeverityThreshold = useCallback(
    (threshold: SeverityThreshold) =>
      mutateActiveSession((session) => ({ ...session, severityThreshold: threshold })),
    [mutateActiveSession],
  );

  const setSessionSelectedModel = useCallback(
    (model: string | null) =>
      mutateActiveSession((session) => ({
        ...session,
        selectedModel: model,
      })),
    [mutateActiveSession],
  );

  const setEditorInput = useCallback(
    (artifactType: ArtifactType, input: string) => {
      mutateActiveSession((session) => ({
        ...session,
        editorInputs: { ...session.editorInputs, [artifactType]: input },
        currentInput: artifactType === session.activeArtifactType ? input : session.currentInput,
      }));
      setState((previous) => ({ ...previous, lastError: null, lastSuccessMessage: null }));
    },
    [mutateActiveSession],
  );

  const setBatchInput = useCallback(
    (input: string) => {
      mutateActiveSession((session) => ({ ...session, batchInput: input, currentInput: input }));
      setState((previous) => ({ ...previous, lastError: null, lastSuccessMessage: null }));
    },
    [mutateActiveSession],
  );

  const parseBatchInput = useCallback(() => {
    if (!activeSession) return;
    const parsed = parseBatchSqlInput(activeSession.batchInput);
    const draftUnits = parsed.map(createDraftBatchUnit);
    mutateActiveSession((session) => ({
      ...session,
      batchQueries: draftUnits,
      selectedBatchQueryId: draftUnits[0]?.id ?? null,
    }));
    setState((previous) => ({
      ...previous,
      lastError: parsed.length === 0 ? "Paste at least one SQL query for batch review." : null,
      lastSuccessMessage: parsed.length > 0 ? `Parsed ${parsed.length} query units for batch review.` : null,
    }));
  }, [activeSession, mutateActiveSession]);

  const addBatchFiles = useCallback(
    async (files: File[]) => {
      if (!activeSession) return;
      const accepted = files.filter((file) => {
        const lower = file.name.toLowerCase();
        return lower.endsWith(".sql") || lower.endsWith(".txt");
      });
      if (accepted.length === 0) {
        setState((previous) => ({
          ...previous,
          lastError: "Unsupported file type. Upload .sql or .txt files.",
          lastSuccessMessage: null,
        }));
        return;
      }

      const parsedCandidates = await Promise.all(
        accepted.map(async (file) => {
          try {
            const text = await file.text();
            return parseBatchSqlFileContent(file.name, text).filter((candidate) => candidate.sql.trim());
          } catch {
            return [];
          }
        }),
      );

      const flattened = parsedCandidates.flat();
      const appended = flattened.map(createDraftBatchUnit);
      mutateActiveSession((session) => {
        const merged = [...session.batchQueries, ...appended];
        return {
          ...session,
          batchQueries: merged,
          selectedBatchQueryId: session.selectedBatchQueryId ?? merged[0]?.id ?? null,
        };
      });
      setState((previous) => ({
        ...previous,
        lastError: appended.length === 0 ? "Could not read any SQL content from selected files." : null,
        lastSuccessMessage: appended.length > 0 ? `Loaded ${appended.length} query units from files.` : null,
      }));
    },
    [activeSession, mutateActiveSession],
  );

  const selectBatchQuery = useCallback(
    (id: string) => mutateActiveSession((session) => ({ ...session, selectedBatchQueryId: id })),
    [mutateActiveSession],
  );

  const setPastedSchemaJson = useCallback(
    (input: string) => {
      mutateActiveSession((session) => {
        const parsed = parsePastedSchemaJson(input);
        const mergedContext = mergeParsedContexts(parsed.parsedContext, session.uploadedParsedContext);
        const validationStatus: ContextValidationStatus = input.trim()
          ? parsed.error
            ? "invalid"
            : "valid"
          : "empty";
        return {
          ...session,
          pastedSchemaJson: input,
          pastedParsedContext: parsed.parsedContext,
          parsedContext: mergedContext,
          contextMode: mergedContext ? "context_aware" : "query_only",
          contextQualitySummary: summarizeContextQuality(mergedContext, validationStatus),
          contextValidationStatus: validationStatus,
          contextValidationMessage: parsed.error,
        };
      });
      setState((previous) => ({ ...previous, lastError: null }));
    },
    [mutateActiveSession],
  );

  const setUploadedContext = useCallback(
    (payload: {
      fileMeta: UploadedContextFileMeta | null;
      parsedContext: ParsedReviewContext | null;
      error?: string | null;
      statusMessage?: string | null;
    }) => {
      mutateActiveSession((session) => {
        const mergedContext = mergeParsedContexts(session.pastedParsedContext, payload.parsedContext);
        return {
          ...session,
          uploadedContextFile: payload.fileMeta,
          uploadedParsedContext: payload.parsedContext,
          parsedContext: mergedContext,
          contextMode: mergedContext ? "context_aware" : "query_only",
          contextQualitySummary: summarizeContextQuality(
            mergedContext,
            payload.error
              ? "invalid"
              : payload.parsedContext
                ? "loaded"
                : session.pastedSchemaJson.trim()
                  ? session.contextValidationStatus
                  : "empty",
          ),
          uploadedContextStatusMessage: payload.statusMessage ?? null,
          contextValidationMessage: payload.error ?? session.contextValidationMessage,
          contextValidationStatus: payload.error
            ? "invalid"
            : payload.parsedContext
              ? "loaded"
              : session.pastedSchemaJson.trim()
                ? session.contextValidationStatus
                : "empty",
        };
      });
      setState((previous) => ({ ...previous, lastError: null }));
    },
    [mutateActiveSession],
  );

  const clearUploadedContext = useCallback(() => {
    mutateActiveSession((session) => {
      const mergedContext = mergeParsedContexts(session.pastedParsedContext, null);
      return {
        ...session,
        uploadedContextFile: null,
        uploadedParsedContext: null,
        parsedContext: mergedContext,
        contextMode: mergedContext ? "context_aware" : "query_only",
        contextQualitySummary: summarizeContextQuality(mergedContext, session.contextValidationStatus),
        uploadedContextStatusMessage: null,
      };
    });
  }, [mutateActiveSession]);

  const requestLineJump = useCallback((line: number) => {
    setState((previous) => ({
      ...previous,
      pendingJumpLine: Math.max(1, Math.floor(line)),
      sessions: updateSessionInList(previous.sessions, previous.activeSessionId, (session) => ({
        ...session,
        activeArtifactType: "SQL Query",
      })),
    }));
  }, []);

  const clearPendingJumpLine = useCallback(() => {
    setState((previous) => ({ ...previous, pendingJumpLine: null }));
  }, []);

  const runReview = useCallback(
    async (payload: RunReviewInput): Promise<SqlFinding[]> => {
      if (!activeSession) return [];
      const artifactType = activeSession.activeArtifactType;
      if (artifactType === "Batch Review") {
        return [];
      }
      if (artifactType === "SQL Query" && !settings.reviewIntelligence.enableSqlFindings) {
        setState((previous) => ({
          ...previous,
          isRunningReview: false,
          lastError: "SQL findings are disabled in Settings.",
        }));
        return [];
      }
      if (artifactType === "KPI Definition" && !settings.reviewIntelligence.enableKpiDefinitionReview) {
        setState((previous) => ({
          ...previous,
          isRunningReview: false,
          lastError: "KPI definition review is disabled in Settings.",
        }));
        return [];
      }
      if (artifactType === "Narrative" && !settings.reviewIntelligence.enableNarrativeReview) {
        setState((previous) => ({
          ...previous,
          isRunningReview: false,
          lastError: "Narrative review is disabled in Settings.",
        }));
        return [];
      }
      const input = activeSession.editorInputs[artifactType];
      const runStartedAt = Date.now();

      setState((previous) => ({
        ...previous,
        isRunningReview: true,
        lastError: null,
        lastSuccessMessage: null,
      }));

      if (!input.trim()) {
        const message =
          artifactType === "KPI Definition"
            ? "Add KPI definition input before running review."
            : artifactType === "Narrative"
              ? "Add narrative input before running review."
              : "Paste a SQL query before running review.";
        setState((previous) => ({ ...previous, isRunningReview: false, lastError: message }));
        return [];
      }

      const resolvedModel = payload.selectedModel ?? activeSession.selectedModel ?? connectedModel ?? null;
      if (connectionStatus !== "connected" || !resolvedModel) {
        setState((previous) => ({
          ...previous,
          isRunningReview: false,
          lastError: "Model not connected. Connect a local model to run review.",
        }));
        return [];
      }

      try {
        const artifactTypeMap: Record<ArtifactType, "sql" | "kpi_definition" | "narrative" | "batch_sql"> = {
          "SQL Query": "sql",
          "KPI Definition": "kpi_definition",
          Narrative: "narrative",
          "Batch Review": "batch_sql",
        };

        const response = await fetch("/api/review/artifact", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            artifactType: artifactTypeMap[artifactType],
            input,
            context: activeSession.parsedContext ?? undefined,
            options: {
              reviewProfile: activeSession.reviewProfile,
              severityThreshold: activeSession.severityThreshold,
              runtime: {
                model: resolvedModel,
                temperature: settings.modelRuntime.temperature,
                maxTokens: settings.modelRuntime.maxTokens,
                responseMode: settings.modelRuntime.responseMode,
                sqlDialect: settings.workspaceDefaults.sqlDialect,
              },
              sqlSafetyRules: {
                divisionByZeroProtection: settings.sqlSafetyRules.divisionByZeroProtection,
                nullHandlingEnforcement: settings.sqlSafetyRules.nullHandlingEnforcement,
                joinDuplicationDetection: settings.sqlSafetyRules.joinDuplicationDetection,
                groupByConsistencyCheck: settings.sqlSafetyRules.groupByConsistencyCheck,
                distinctMisuseDetection: settings.sqlSafetyRules.distinctMisuseDetection,
                severityFilter: settings.sqlSafetyRules.severityFilter,
              },
            } satisfies ReviewOptions,
          }),
        });
        if (!response.ok) throw new Error("review failed");

        const reviewed = (await response.json()) as { findings: SqlFinding[] };
        const rawFindings = reviewed.findings ?? [];
        const findings = applyConfidenceMode(
          artifactType === "SQL Query" ? applySqlSafetyRules(rawFindings, settings) : rawFindings,
          settings.reviewIntelligence.confidenceMode,
        );
        const findingsCount = findings.length;
        const riskScore = computeRiskScore(findings);
        const riskLabel = getRiskLabel(riskScore);
        const highestSeverity = getHighestSeverity(findings);
        const criticalHighCount = countCriticalHigh(findings);
        const timestamp = new Date().toISOString();
        const isStrictBlocked =
          settings.reviewIntelligence.strictMode &&
          findings.some((finding) => finding.type === "CRITICAL");

        const elapsed = Date.now() - runStartedAt;
        if (elapsed < 450) await new Promise((resolve) => setTimeout(resolve, 450 - elapsed));

        mutateActiveSession((session) => {
          const generatedTestCases = settings.reviewIntelligence.enableTestCaseGeneration
            ? generateSessionTestCases(
                {
                  artifactType,
                  findings,
                  context: session.parsedContext,
                  artifactInput: input,
                },
                session.testCases,
              )
            : session.testCases;
          return {
            ...session,
            currentArtifactType: artifactType,
            currentInput: input,
            lastReviewedInput: input,
            selectedModel: resolvedModel ?? session.selectedModel,
            findings,
            findingsCount,
            lastRunTimestamp: timestamp,
            lastRunAt: timestamp,
            sessionStatus: "Completed",
            riskScore,
            riskLabel,
            highestSeverity,
            criticalHighCount,
            lastReviewUsedContext: Boolean(session.parsedContext),
            lastReviewContextSource: session.parsedContext?.source ?? "none",
            lastRunMode: "single",
            testCases: generatedTestCases,
          };
        });

        setState((previous) => ({
          ...previous,
          isRunningReview: false,
          lastError: isStrictBlocked
            ? "Strict mode is enabled. Review is blocked until CRITICAL issues are resolved."
            : null,
          lastSuccessMessage: isStrictBlocked
            ? `Review completed with ${findingsCount} findings (blocked by strict mode).`
            : `Review completed with ${findingsCount} findings.${getDisabledRuleNotes(settings).length ? ` ${getDisabledRuleNotes(settings).join(" | ")}` : ""}`,
        }));

        return findings;
      } catch {
        setState((previous) => ({
          ...previous,
          isRunningReview: false,
          lastError: "Failed to run review.",
        }));
        return [];
      }
    },
    [activeSession, connectionStatus, connectedModel, mutateActiveSession, settings],
  );

  const runBatchReview = useCallback(
    async (payload: RunReviewInput): Promise<BatchQueryUnit[]> => {
      if (!activeSession) return [];
      if (!settings.reviewIntelligence.enableSqlFindings) {
        setState((previous) => ({
          ...previous,
          isRunningReview: false,
          lastError: "SQL findings are disabled in Settings.",
        }));
        return [];
      }
      const existingUnits = activeSession.batchQueries.filter((unit) => unit.sql.trim());
      const parsedFallbackUnits =
        existingUnits.length === 0 && activeSession.batchInput.trim()
          ? parseBatchSqlInput(activeSession.batchInput).map(createDraftBatchUnit)
          : [];
      const queryUnits = existingUnits.length > 0 ? existingUnits : parsedFallbackUnits;
      const runStartedAt = Date.now();

      setState((previous) => ({
        ...previous,
        isRunningReview: true,
        lastError: null,
        lastSuccessMessage: null,
      }));

      if (queryUnits.length === 0) {
        setState((previous) => ({
          ...previous,
          isRunningReview: false,
          lastError: "No batch queries available. Paste SQL or upload files first.",
        }));
        return [];
      }

      if (parsedFallbackUnits.length > 0) {
        mutateActiveSession((session) => ({
          ...session,
          batchQueries: parsedFallbackUnits,
          selectedBatchQueryId: session.selectedBatchQueryId ?? parsedFallbackUnits[0]?.id ?? null,
        }));
      }

      const resolvedModel = payload.selectedModel ?? activeSession.selectedModel ?? connectedModel ?? null;
      if (connectionStatus !== "connected" || !resolvedModel) {
        setState((previous) => ({
          ...previous,
          isRunningReview: false,
          lastError: "Model not connected. Connect a local model to run batch review.",
        }));
        return [];
      }

      try {
        const response = await fetch("/api/review/artifact", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            artifactType: "batch_sql",
            input: {
              queries: queryUnits.map((unit) => ({
                id: unit.id,
                label: unit.label,
                source: unit.source,
                sourceName: unit.sourceName,
                sql: unit.sql,
              })),
            },
            context: activeSession.parsedContext ?? undefined,
            options: {
              reviewProfile: activeSession.reviewProfile,
              severityThreshold: activeSession.severityThreshold,
              runtime: {
                model: resolvedModel,
                temperature: settings.modelRuntime.temperature,
                maxTokens: settings.modelRuntime.maxTokens,
                responseMode: settings.modelRuntime.responseMode,
                sqlDialect: settings.workspaceDefaults.sqlDialect,
              },
              sqlSafetyRules: {
                divisionByZeroProtection: settings.sqlSafetyRules.divisionByZeroProtection,
                nullHandlingEnforcement: settings.sqlSafetyRules.nullHandlingEnforcement,
                joinDuplicationDetection: settings.sqlSafetyRules.joinDuplicationDetection,
                groupByConsistencyCheck: settings.sqlSafetyRules.groupByConsistencyCheck,
                distinctMisuseDetection: settings.sqlSafetyRules.distinctMisuseDetection,
                severityFilter: settings.sqlSafetyRules.severityFilter,
              },
            } satisfies ReviewOptions,
          }),
        });
        if (!response.ok) throw new Error("batch review failed");

        const reviewedPayload = (await response.json()) as {
          queries: BatchQueryUnit[];
          batchSummary: { averageRiskScore: number };
        };
        const reviewedUnits =
          (reviewedPayload.queries ?? []).map((unit) => {
            const filteredFindings = applyConfidenceMode(
              applySqlSafetyRules(unit.findings ?? [], settings),
              settings.reviewIntelligence.confidenceMode,
            );
            const unitRiskScore = computeRiskScore(filteredFindings);
            return {
              ...unit,
              findings: filteredFindings,
              findingsCount: filteredFindings.length,
              highestSeverity: getHighestSeverity(filteredFindings),
              riskScore: unitRiskScore,
              riskLabel: getRiskLabel(unitRiskScore),
            };
          })
          .sort((a, b) => {
            const rank: Record<SqlFinding["type"], number> = {
              CRITICAL: 4,
              HIGH: 3,
              MEDIUM: 2,
              LOW: 1,
            };
            const aRank = a.highestSeverity ? rank[a.highestSeverity] : 0;
            const bRank = b.highestSeverity ? rank[b.highestSeverity] : 0;
            if (bRank !== aRank) return bRank - aRank;
            return b.riskScore - a.riskScore;
          });
        const aggregateFindings = reviewedUnits.flatMap((unit) => unit.findings);
        const now = new Date().toISOString();
        const isStrictBlocked =
          settings.reviewIntelligence.strictMode &&
          aggregateFindings.some((finding) => finding.type === "CRITICAL");

        const elapsed = Date.now() - runStartedAt;
        if (elapsed < 450) await new Promise((resolve) => setTimeout(resolve, 450 - elapsed));

        mutateActiveSession((session) => {
          const generatedTestCases = settings.reviewIntelligence.enableTestCaseGeneration
            ? generateSessionTestCases(
                {
                  artifactType: "Batch Review",
                  findings: aggregateFindings,
                  context: session.parsedContext,
                  batchQueries: reviewedUnits,
                },
                session.testCases,
              )
            : session.testCases;
          const averageRiskScore =
            reviewedUnits.length > 0
              ? Math.round(
                  reviewedUnits.reduce((sum, unit) => sum + unit.riskScore, 0) /
                    reviewedUnits.length,
                )
              : 0;
          return {
            ...session,
            selectedModel: resolvedModel ?? session.selectedModel,
            batchQueries: reviewedUnits,
            selectedBatchQueryId: session.selectedBatchQueryId ?? reviewedUnits[0]?.id ?? null,
            findings: aggregateFindings,
            findingsCount: aggregateFindings.length,
            highestSeverity: getHighestSeverity(aggregateFindings),
            criticalHighCount: countCriticalHigh(aggregateFindings),
            riskScore: averageRiskScore,
            riskLabel: getRiskLabel(averageRiskScore),
            lastRunTimestamp: now,
            batchLastRunTimestamp: now,
            lastRunAt: now,
            sessionStatus: "Completed",
            lastReviewUsedContext: Boolean(session.parsedContext),
            lastReviewContextSource: session.parsedContext?.source ?? "none",
            lastRunMode: "batch",
            lastReviewedInput: session.batchInput,
            testCases: generatedTestCases,
          };
        });

        setState((previous) => ({
          ...previous,
          isRunningReview: false,
          lastError: isStrictBlocked
            ? "Strict mode is enabled. Batch review is blocked until CRITICAL issues are resolved."
            : null,
          lastSuccessMessage: isStrictBlocked
            ? `Batch review completed for ${reviewedUnits.length} queries (blocked by strict mode).`
            : `Batch review completed for ${reviewedUnits.length} queries.${getDisabledRuleNotes(settings).length ? ` ${getDisabledRuleNotes(settings).join(" | ")}` : ""}`,
        }));

        return reviewedUnits;
      } catch {
        setState((previous) => ({
          ...previous,
          isRunningReview: false,
          lastError: "Failed to run batch review.",
        }));
        return [];
      }
    },
    [activeSession, connectionStatus, connectedModel, mutateActiveSession, settings],
  );

  const batchSummary = useMemo<BatchSummary>(() => {
    const queries = activeSession?.batchQueries ?? [];
    const totalQueries = queries.length;
    const totalFindings = queries.reduce((sum, unit) => sum + unit.findingsCount, 0);
    const criticalHighQueries = queries.filter(
      (unit) => unit.highestSeverity === "CRITICAL" || unit.highestSeverity === "HIGH",
    ).length;
    const averageRiskScore =
      totalQueries > 0
        ? Math.round(queries.reduce((sum, unit) => sum + unit.riskScore, 0) / totalQueries)
        : 0;
    const issueCounts = new Map<string, number>();
    for (const query of queries) {
      const dedupInQuery = new Set<string>();
      for (const finding of query.findings) {
        const normalized = finding.title.toLowerCase();
        if (dedupInQuery.has(normalized)) continue;
        dedupInQuery.add(normalized);
        issueCounts.set(normalized, (issueCounts.get(normalized) ?? 0) + 1);
      }
    }
    const commonIssues = [...issueCounts.entries()]
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([label, count]) => ({ label, count }));
    const systemicIssueCount = commonIssues.length;
    return {
      totalQueries,
      totalFindings,
      criticalHighQueries,
      averageRiskScore,
      commonIssues,
      systemicIssueCount,
    };
  }, [activeSession?.batchQueries]);

  const generateTestCasesFromFindings = useCallback(() => {
    if (connectionStatus !== "connected" || !connectedModel) {
      setState((previous) => ({
        ...previous,
        lastError: "Model not connected. Connect a local model to generate outputs.",
        lastSuccessMessage: null,
      }));
      return;
    }
    if (!settings.reviewIntelligence.enableTestCaseGeneration) {
      setState((previous) => ({
        ...previous,
        lastError: "Test case generation is disabled in Settings.",
        lastSuccessMessage: null,
      }));
      return;
    }
    mutateActiveSession((session) => ({
      ...session,
      testCases: generateSessionTestCases(
        {
          artifactType: session.currentArtifactType,
          findings: session.findings,
          context: session.parsedContext,
          artifactInput:
            session.currentArtifactType === "Batch Review"
              ? session.batchInput
              : session.editorInputs[session.currentArtifactType],
          batchQueries: session.batchQueries,
          settings: {
            sqlDialect: settings.workspaceDefaults.sqlDialect,
            sqlSafetyRules: settings.sqlSafetyRules,
          },
        },
        session.testCases,
      ),
    }));
    setState((previous) => ({
      ...previous,
      lastError: null,
      lastSuccessMessage: `Test cases generated from current findings.${getDisabledRuleNotes(settings).length ? ` ${getDisabledRuleNotes(settings).join(" | ")}` : ""}`,
    }));
  }, [connectionStatus, connectedModel, mutateActiveSession, settings]);

  const updateTestCaseStatus = useCallback(
    (testCaseId: string, status: TestCaseStatus) => {
      mutateActiveSession((session) => ({
        ...session,
        testCases: session.testCases.map((testCase) =>
          testCase.id === testCaseId ? { ...testCase, status } : testCase,
        ),
      }));
    },
    [mutateActiveSession],
  );

  const updateTestCaseNotes = useCallback(
    (testCaseId: string, notes: string) => {
      mutateActiveSession((session) => ({
        ...session,
        testCases: session.testCases.map((testCase) =>
          testCase.id === testCaseId ? { ...testCase, notes } : testCase,
        ),
      }));
    },
    [mutateActiveSession],
  );

  const setRewriteMode = useCallback(
    (artifactType: ArtifactType, mode: string) => {
      mutateActiveSession((session) => ({
        ...session,
        rewriteModes: { ...session.rewriteModes, [artifactType]: mode },
      }));
    },
    [mutateActiveSession],
  );

  const setSelectedRewriteBatchQueryId = useCallback(
    (queryId: string) => {
      mutateActiveSession((session) => ({
        ...session,
        selectedRewriteBatchQueryId: queryId,
      }));
    },
    [mutateActiveSession],
  );

  const generateRewrite = useCallback(() => {
    if (!activeSession) return;
    if (connectionStatus !== "connected" || !connectedModel) {
      setState((previous) => ({
        ...previous,
        lastError: "Model not connected. Connect a local model to generate outputs.",
        lastSuccessMessage: null,
      }));
      return;
    }
    if (!settings.reviewIntelligence.enableRewriteSuggestions) {
      setState((previous) => ({
        ...previous,
        lastError: "Rewrite suggestions are disabled in Settings.",
        lastSuccessMessage: null,
      }));
      return;
    }
    const artifactType = activeSession.currentArtifactType;

    if (artifactType === "Batch Review") {
      const selectedId =
        activeSession.selectedRewriteBatchQueryId ??
        activeSession.selectedBatchQueryId ??
        activeSession.batchQueries[0]?.id ??
        null;
      if (!selectedId) {
        setState((previous) => ({
          ...previous,
          lastError: "Select a batch query before generating a rewrite.",
          lastSuccessMessage: null,
        }));
        return;
      }
      const targetQuery = activeSession.batchQueries.find((query) => query.id === selectedId);
      if (!targetQuery) {
        setState((previous) => ({
          ...previous,
          lastError: "Selected batch query could not be found.",
          lastSuccessMessage: null,
        }));
        return;
      }
      const output = generateArtifactRewrite({
        artifactType,
        mode: activeSession.rewriteModes["Batch Review"],
        input: targetQuery.sql,
        findings: targetQuery.findings,
        context: activeSession.parsedContext,
        targetBatchQueryId: targetQuery.id,
        targetBatchQueryLabel: targetQuery.label,
        sqlDialect: settings.workspaceDefaults.sqlDialect,
        sqlSafetyRules: settings.sqlSafetyRules,
      });
      mutateActiveSession((session) => ({
        ...session,
        selectedRewriteBatchQueryId: targetQuery.id,
        batchRewriteOutputs: {
          ...session.batchRewriteOutputs,
          [targetQuery.id]: output,
        },
      }));
      setState((previous) => ({
        ...previous,
      lastError: null,
      lastSuccessMessage: `Generated rewrite for ${targetQuery.label}.${getDisabledRuleNotes(settings).length ? ` ${getDisabledRuleNotes(settings).join(" | ")}` : ""}`,
      }));
      return;
    }

    const artifactInput = activeSession.editorInputs[artifactType];
    if (!artifactInput.trim()) {
      setState((previous) => ({
        ...previous,
        lastError: "Add artifact content before generating a rewrite.",
        lastSuccessMessage: null,
      }));
      return;
    }

    const output = generateArtifactRewrite({
      artifactType,
      mode: activeSession.rewriteModes[artifactType],
      input: artifactInput,
      findings: activeSession.findings,
      context: activeSession.parsedContext,
      sqlDialect: settings.workspaceDefaults.sqlDialect,
      sqlSafetyRules: settings.sqlSafetyRules,
    });
    mutateActiveSession((session) => ({
      ...session,
      rewriteOutputs: {
        ...session.rewriteOutputs,
        [artifactType]: output,
      },
    }));
    setState((previous) => ({
      ...previous,
      lastError: null,
      lastSuccessMessage: `Generated ${artifactType} rewrite.${getDisabledRuleNotes(settings).length ? ` ${getDisabledRuleNotes(settings).join(" | ")}` : ""}`,
    }));
  }, [activeSession, connectionStatus, connectedModel, mutateActiveSession, settings]);

  const applyRewriteToSessionInput = useCallback(() => {
    if (!activeSession) return;
    if (
      settings.reviewIntelligence.strictMode &&
      activeSession.findings.some((finding) => finding.type === "CRITICAL")
    ) {
      setState((previous) => ({
        ...previous,
        lastError: "Resolve critical issues before proceeding.",
        lastSuccessMessage: null,
      }));
      return;
    }
    if (!settings.trustGovernance.allowOverwrite) {
      setState((previous) => ({
        ...previous,
        lastError: "Overwrite is disabled in Settings.",
        lastSuccessMessage: null,
      }));
      return;
    }
    const artifactType = activeSession.currentArtifactType;

    if (artifactType === "Batch Review") {
      const selectedId =
        activeSession.selectedRewriteBatchQueryId ??
        activeSession.selectedBatchQueryId ??
        null;
      if (!selectedId) {
        setState((previous) => ({
          ...previous,
          lastError: "Select a batch query before applying rewrite.",
          lastSuccessMessage: null,
        }));
        return;
      }
      const rewrite = activeSession.batchRewriteOutputs[selectedId];
      if (!rewrite) {
        setState((previous) => ({
          ...previous,
          lastError: "Generate a rewrite before applying changes.",
          lastSuccessMessage: null,
        }));
        return;
      }
      mutateActiveSession((session) => ({
        ...session,
        batchQueries: session.batchQueries.map((query) =>
          query.id === selectedId ? { ...query, sql: rewrite.rewritten } : query,
        ),
      }));
      setState((previous) => ({
        ...previous,
        lastError: null,
        lastSuccessMessage: "Rewritten query applied to batch input.",
      }));
      return;
    }

    const rewrite = activeSession.rewriteOutputs[artifactType];
    if (!rewrite) {
      setState((previous) => ({
        ...previous,
        lastError: "Generate a rewrite before applying changes.",
        lastSuccessMessage: null,
      }));
      return;
    }
    mutateActiveSession((session) => ({
      ...session,
      editorInputs: {
        ...session.editorInputs,
        [artifactType]: rewrite.rewritten,
      },
      currentInput: artifactType === session.activeArtifactType ? rewrite.rewritten : session.currentInput,
    }));
    setState((previous) => ({
      ...previous,
      lastError: null,
      lastSuccessMessage: "Optimization applied to current artifact.",
    }));
  }, [activeSession, mutateActiveSession, settings.reviewIntelligence.strictMode, settings.trustGovernance.allowOverwrite]);

  const clearRewriteOutput = useCallback(
    (artifactType?: ArtifactType) => {
      mutateActiveSession((session) => {
        if (artifactType === "Batch Review") {
          return {
            ...session,
            batchRewriteOutputs: {},
          };
        }
        if (artifactType) {
          return {
            ...session,
            rewriteOutputs: {
              ...session.rewriteOutputs,
              [artifactType]: null,
            },
          };
        }
        return {
          ...session,
          rewriteOutputs: { ...EMPTY_REWRITE_OUTPUTS },
          batchRewriteOutputs: {},
        };
      });
    },
    [mutateActiveSession],
  );

  const value = useMemo<ReviewSessionContextValue>(() => {
    const session = activeSession;
    return {
      sessions: state.sessions,
      activeSessionId: state.activeSessionId,
      activeSession: session,
      progressStatus: session ? computeProgressStatus(session) : "Draft",
      lastRunMode: session?.lastRunMode ?? "single",
      reviewMode: session?.lastRunMode ?? "single",
      title: session?.title ?? "No active session",
      note: session?.note ?? "",
      createdAt: session?.createdAt ?? null,
      updatedAt: session?.updatedAt ?? null,
      lastRunAt: session?.lastRunAt ?? null,
      activeArtifactType: session?.activeArtifactType ?? "SQL Query",
      currentArtifactType: session?.currentArtifactType ?? "SQL Query",
      currentInput: session?.currentInput ?? "",
      lastReviewedInput: session?.lastReviewedInput ?? null,
      editorInputs: session?.editorInputs ?? { ...EMPTY_EDITOR_INPUTS },
      selectedModel: session?.selectedModel ?? null,
      findings: session?.findings ?? [],
      findingsCount: session?.findingsCount ?? 0,
      lastRunTimestamp: session?.lastRunTimestamp ?? null,
      sessionStatus: session?.sessionStatus ?? "Not started",
      riskScore: session?.riskScore ?? 0,
      riskLabel: session?.riskLabel ?? "Low risk",
      highestSeverity: session?.highestSeverity ?? null,
      criticalHighCount: session?.criticalHighCount ?? 0,
      isRunningReview: state.isRunningReview,
      lastError: state.lastError,
      lastSuccessMessage: state.lastSuccessMessage,
      pendingJumpLine: state.pendingJumpLine,
      contextMode: session?.contextMode ?? "query_only",
      pastedSchemaJson: session?.pastedSchemaJson ?? "",
      uploadedContextFile: session?.uploadedContextFile ?? null,
      parsedContext: session?.parsedContext ?? null,
      contextQualitySummary: session?.contextQualitySummary ?? "No context",
      contextValidationStatus: session?.contextValidationStatus ?? "empty",
      contextValidationMessage: session?.contextValidationMessage ?? null,
      uploadedContextStatusMessage: session?.uploadedContextStatusMessage ?? null,
      lastReviewUsedContext: session?.lastReviewUsedContext ?? false,
      lastReviewContextSource: session?.lastReviewContextSource ?? "none",
      batchInput: session?.batchInput ?? "",
      batchQueries: session?.batchQueries ?? [],
      selectedBatchQueryId: session?.selectedBatchQueryId ?? null,
      batchLastRunTimestamp: session?.batchLastRunTimestamp ?? null,
      reviewProfile: session?.reviewProfile ?? "standard",
      severityThreshold: session?.severityThreshold ?? "medium_plus",
      testCases: session?.testCases ?? [],
      rewriteModes: session?.rewriteModes ?? { ...DEFAULT_REWRITE_MODES },
      rewriteOutputs: session?.rewriteOutputs ?? { ...EMPTY_REWRITE_OUTPUTS },
      batchRewriteOutputs: session?.batchRewriteOutputs ?? {},
      selectedRewriteBatchQueryId: session?.selectedRewriteBatchQueryId ?? null,
      createSession,
      switchSession,
      renameSession,
      duplicateSession,
      deleteSession,
      setActiveArtifactType,
      setReviewProfile,
      setSeverityThreshold,
      setSessionSelectedModel,
      setEditorInput,
      setBatchInput,
      parseBatchInput,
      addBatchFiles,
      selectBatchQuery,
      setPastedSchemaJson,
      setUploadedContext,
      clearUploadedContext,
      requestLineJump,
      clearPendingJumpLine,
      runReview,
      runBatchReview,
      generateTestCasesFromFindings,
      updateTestCaseStatus,
      updateTestCaseNotes,
      setRewriteMode,
      setSelectedRewriteBatchQueryId,
      generateRewrite,
      applyRewriteToSessionInput,
      clearRewriteOutput,
      batchSummary,
      clearMessages: () =>
        setState((previous) => ({ ...previous, lastError: null, lastSuccessMessage: null })),
    };
  }, [
    activeSession,
    addBatchFiles,
    batchSummary,
    clearPendingJumpLine,
    clearUploadedContext,
    clearRewriteOutput,
    createSession,
    duplicateSession,
    deleteSession,
    generateRewrite,
    generateTestCasesFromFindings,
    applyRewriteToSessionInput,
    parseBatchInput,
    renameSession,
    requestLineJump,
    runBatchReview,
    runReview,
    selectBatchQuery,
    setActiveArtifactType,
    setBatchInput,
    setEditorInput,
    setPastedSchemaJson,
    setReviewProfile,
    setRewriteMode,
    setSelectedRewriteBatchQueryId,
    setSessionSelectedModel,
    setSeverityThreshold,
    setUploadedContext,
    state.activeSessionId,
    state.isRunningReview,
    state.lastError,
    state.lastSuccessMessage,
    state.pendingJumpLine,
    state.sessions,
    switchSession,
    updateTestCaseNotes,
    updateTestCaseStatus,
  ]);

  return <ReviewSessionContext.Provider value={value}>{children}</ReviewSessionContext.Provider>;
}

export function useReviewSession() {
  const context = useContext(ReviewSessionContext);
  if (!context) {
    throw new Error("useReviewSession must be used within ReviewSessionProvider");
  }
  return context;
}
