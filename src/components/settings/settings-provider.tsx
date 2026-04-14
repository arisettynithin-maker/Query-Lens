"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import {
  DEFAULT_QUERYLENS_SETTINGS,
  type QueryLensSettings,
} from "@/types/settings";

const STORAGE_KEY = "querylens.settings.v1";

type SettingsContextValue = {
  settings: QueryLensSettings;
  setSettings: (next: QueryLensSettings) => void;
  resetSettings: () => void;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sanitizeSettings(raw: unknown): QueryLensSettings {
  if (!isObject(raw)) return DEFAULT_QUERYLENS_SETTINGS;
  const safe = { ...DEFAULT_QUERYLENS_SETTINGS };

  const modelRuntime = isObject(raw.modelRuntime) ? raw.modelRuntime : {};
  const reviewIntelligence = isObject(raw.reviewIntelligence) ? raw.reviewIntelligence : {};
  const sqlSafetyRules = isObject(raw.sqlSafetyRules) ? raw.sqlSafetyRules : {};
  const workspaceDefaults = isObject(raw.workspaceDefaults) ? raw.workspaceDefaults : {};
  const trustGovernance = isObject(raw.trustGovernance) ? raw.trustGovernance : {};

  return {
    modelRuntime: {
      model:
        typeof modelRuntime.model === "string" || modelRuntime.model === null
          ? modelRuntime.model
          : safe.modelRuntime.model,
      temperature:
        typeof modelRuntime.temperature === "number"
          ? Math.max(0, Math.min(1, modelRuntime.temperature))
          : safe.modelRuntime.temperature,
      maxTokens:
        typeof modelRuntime.maxTokens === "number" && Number.isFinite(modelRuntime.maxTokens)
          ? Math.max(1, Math.round(modelRuntime.maxTokens))
          : safe.modelRuntime.maxTokens,
      responseMode:
        modelRuntime.responseMode === "creative" || modelRuntime.responseMode === "deterministic"
          ? modelRuntime.responseMode
          : safe.modelRuntime.responseMode,
    },
    reviewIntelligence: {
      enableSqlFindings:
        typeof reviewIntelligence.enableSqlFindings === "boolean"
          ? reviewIntelligence.enableSqlFindings
          : safe.reviewIntelligence.enableSqlFindings,
      enableTestCaseGeneration:
        typeof reviewIntelligence.enableTestCaseGeneration === "boolean"
          ? reviewIntelligence.enableTestCaseGeneration
          : safe.reviewIntelligence.enableTestCaseGeneration,
      enableRewriteSuggestions:
        typeof reviewIntelligence.enableRewriteSuggestions === "boolean"
          ? reviewIntelligence.enableRewriteSuggestions
          : safe.reviewIntelligence.enableRewriteSuggestions,
      enableKpiDefinitionReview:
        typeof reviewIntelligence.enableKpiDefinitionReview === "boolean"
          ? reviewIntelligence.enableKpiDefinitionReview
          : safe.reviewIntelligence.enableKpiDefinitionReview,
      enableNarrativeReview:
        typeof reviewIntelligence.enableNarrativeReview === "boolean"
          ? reviewIntelligence.enableNarrativeReview
          : safe.reviewIntelligence.enableNarrativeReview,
      strictMode:
        typeof reviewIntelligence.strictMode === "boolean"
          ? reviewIntelligence.strictMode
          : safe.reviewIntelligence.strictMode,
      confidenceMode:
        reviewIntelligence.confidenceMode === "conservative" ||
        reviewIntelligence.confidenceMode === "balanced" ||
        reviewIntelligence.confidenceMode === "lenient"
          ? reviewIntelligence.confidenceMode
          : safe.reviewIntelligence.confidenceMode,
    },
    sqlSafetyRules: {
      divisionByZeroProtection:
        typeof sqlSafetyRules.divisionByZeroProtection === "boolean"
          ? sqlSafetyRules.divisionByZeroProtection
          : safe.sqlSafetyRules.divisionByZeroProtection,
      nullHandlingEnforcement:
        typeof sqlSafetyRules.nullHandlingEnforcement === "boolean"
          ? sqlSafetyRules.nullHandlingEnforcement
          : safe.sqlSafetyRules.nullHandlingEnforcement,
      joinDuplicationDetection:
        typeof sqlSafetyRules.joinDuplicationDetection === "boolean"
          ? sqlSafetyRules.joinDuplicationDetection
          : safe.sqlSafetyRules.joinDuplicationDetection,
      groupByConsistencyCheck:
        typeof sqlSafetyRules.groupByConsistencyCheck === "boolean"
          ? sqlSafetyRules.groupByConsistencyCheck
          : safe.sqlSafetyRules.groupByConsistencyCheck,
      distinctMisuseDetection:
        typeof sqlSafetyRules.distinctMisuseDetection === "boolean"
          ? sqlSafetyRules.distinctMisuseDetection
          : safe.sqlSafetyRules.distinctMisuseDetection,
      severityFilter:
        sqlSafetyRules.severityFilter === "hide_low" ||
        sqlSafetyRules.severityFilter === "high_critical" ||
        sqlSafetyRules.severityFilter === "all"
          ? sqlSafetyRules.severityFilter
          : safe.sqlSafetyRules.severityFilter,
    },
    workspaceDefaults: {
      sqlDialect:
        workspaceDefaults.sqlDialect === "bigquery" ||
        workspaceDefaults.sqlDialect === "redshift" ||
        workspaceDefaults.sqlDialect === "mysql" ||
        workspaceDefaults.sqlDialect === "postgres"
          ? workspaceDefaults.sqlDialect
          : safe.workspaceDefaults.sqlDialect,
      defaultRewriteMode:
        workspaceDefaults.defaultRewriteMode === "Optimized SQL" ||
        workspaceDefaults.defaultRewriteMode === "Readable SQL" ||
        workspaceDefaults.defaultRewriteMode === "Safer SQL"
          ? workspaceDefaults.defaultRewriteMode
          : safe.workspaceDefaults.defaultRewriteMode,
      autoRunOnUpload:
        typeof workspaceDefaults.autoRunOnUpload === "boolean"
          ? workspaceDefaults.autoRunOnUpload
          : safe.workspaceDefaults.autoRunOnUpload,
    },
    trustGovernance: {
      showModelProvenance:
        typeof trustGovernance.showModelProvenance === "boolean"
          ? trustGovernance.showModelProvenance
          : safe.trustGovernance.showModelProvenance,
      autoSaveHistory:
        typeof trustGovernance.autoSaveHistory === "boolean"
          ? trustGovernance.autoSaveHistory
          : safe.trustGovernance.autoSaveHistory,
      requireConfirmationBeforeReplacingQuery:
        typeof trustGovernance.requireConfirmationBeforeReplacingQuery === "boolean"
          ? trustGovernance.requireConfirmationBeforeReplacingQuery
          : safe.trustGovernance.requireConfirmationBeforeReplacingQuery,
      allowOverwrite:
        typeof trustGovernance.allowOverwrite === "boolean"
          ? trustGovernance.allowOverwrite
          : safe.trustGovernance.allowOverwrite,
    },
  };
}

function loadStoredSettings(): QueryLensSettings {
  if (typeof window === "undefined") return DEFAULT_QUERYLENS_SETTINGS;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_QUERYLENS_SETTINGS;
    return sanitizeSettings(JSON.parse(stored) as unknown);
  } catch {
    return DEFAULT_QUERYLENS_SETTINGS;
  }
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettingsState] = useState<QueryLensSettings>(DEFAULT_QUERYLENS_SETTINGS);

  useEffect(() => {
    setSettingsState(loadStoredSettings());
  }, []);

  const setSettings = useCallback((next: QueryLensSettings) => {
    setSettingsState(next);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_QUERYLENS_SETTINGS);
  }, [setSettings]);

  const value = useMemo<SettingsContextValue>(
    () => ({
      settings,
      setSettings,
      resetSettings,
    }),
    [settings, setSettings, resetSettings],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettings must be used within SettingsProvider");
  }
  return context;
}

