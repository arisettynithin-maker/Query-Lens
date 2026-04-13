export type ResponseMode = "deterministic" | "creative";
export type SqlSeverityFilter = "all" | "hide_low" | "high_critical";
export type SqlDialect = "postgres" | "bigquery" | "redshift" | "mysql";
export type DefaultRewriteMode = "Safer SQL" | "Optimized SQL" | "Readable SQL";
export type ConfidenceMode = "conservative" | "balanced" | "lenient";

export type QueryLensSettings = {
  modelRuntime: {
    model: string | null;
    temperature: number;
    maxTokens: number;
    responseMode: ResponseMode;
  };
  reviewIntelligence: {
    enableSqlFindings: boolean;
    enableTestCaseGeneration: boolean;
    enableRewriteSuggestions: boolean;
    enableKpiDefinitionReview: boolean;
    enableNarrativeReview: boolean;
    strictMode: boolean;
    confidenceMode: ConfidenceMode;
  };
  sqlSafetyRules: {
    divisionByZeroProtection: boolean;
    nullHandlingEnforcement: boolean;
    joinDuplicationDetection: boolean;
    groupByConsistencyCheck: boolean;
    distinctMisuseDetection: boolean;
    severityFilter: SqlSeverityFilter;
  };
  workspaceDefaults: {
    sqlDialect: SqlDialect;
    defaultRewriteMode: DefaultRewriteMode;
    autoRunOnUpload: boolean;
  };
  trustGovernance: {
    showModelProvenance: boolean;
    autoSaveHistory: boolean;
    requireConfirmationBeforeReplacingQuery: boolean;
    allowOverwrite: boolean;
  };
};

export const DEFAULT_QUERYLENS_SETTINGS: QueryLensSettings = {
  modelRuntime: {
    model: "llama3",
    temperature: 0.1,
    maxTokens: 2048,
    responseMode: "deterministic",
  },
  reviewIntelligence: {
    enableSqlFindings: true,
    enableTestCaseGeneration: true,
    enableRewriteSuggestions: true,
    enableKpiDefinitionReview: true,
    enableNarrativeReview: true,
    strictMode: false,
    confidenceMode: "balanced",
  },
  sqlSafetyRules: {
    divisionByZeroProtection: true,
    nullHandlingEnforcement: true,
    joinDuplicationDetection: true,
    groupByConsistencyCheck: true,
    distinctMisuseDetection: true,
    severityFilter: "all",
  },
  workspaceDefaults: {
    sqlDialect: "postgres",
    defaultRewriteMode: "Safer SQL",
    autoRunOnUpload: false,
  },
  trustGovernance: {
    showModelProvenance: true,
    autoSaveHistory: true,
    requireConfirmationBeforeReplacingQuery: true,
    allowOverwrite: true,
  },
};

