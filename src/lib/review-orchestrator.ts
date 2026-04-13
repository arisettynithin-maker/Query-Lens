import { computeRiskScore, getHighestSeverity, getRiskLabel } from "@/lib/riskScore";
import { analyzeSQL } from "@/lib/sqlAnalyzer";
import type { ParsedReviewContext } from "@/types/review-context";
import type { BatchQueryUnit, SqlFinding } from "@/types/sql-review";

export type ArtifactReviewType = "sql" | "batch_sql" | "kpi_definition" | "narrative";
export type ReviewProfile = "standard" | "strict" | "release_gate";
export type SeverityThreshold = "low_plus" | "medium_plus" | "high_only";

export type ReviewOptions = {
  reviewProfile?: ReviewProfile;
  severityThreshold?: SeverityThreshold;
  runtime?: {
    model?: string | null;
    temperature?: number;
    maxTokens?: number;
    responseMode?: "deterministic" | "creative";
    sqlDialect?: "postgres" | "bigquery" | "redshift" | "mysql";
  };
  sqlSafetyRules?: {
    divisionByZeroProtection?: boolean;
    nullHandlingEnforcement?: boolean;
    joinDuplicationDetection?: boolean;
    groupByConsistencyCheck?: boolean;
    distinctMisuseDetection?: boolean;
    severityFilter?: "all" | "hide_low" | "high_critical";
  };
};

type BatchInput = {
  queries: Array<{
    id?: string;
    label?: string;
    source?: "pasted" | "file";
    sourceName?: string;
    sql: string;
  }>;
};

export type ReviewArtifactPayload = {
  artifactType: ArtifactReviewType;
  input: string | BatchInput;
  context?: ParsedReviewContext;
  options?: ReviewOptions;
};

export type BatchReviewResult = {
  artifactType: "batch_sql";
  queries: BatchQueryUnit[];
  batchSummary: {
    totalQueries: number;
    totalFindings: number;
    criticalHighQueries: number;
    averageRiskScore: number;
  };
};

export type SingleReviewResult = {
  artifactType: Exclude<ArtifactReviewType, "batch_sql">;
  findings: SqlFinding[];
};

export type ReviewArtifactResult = SingleReviewResult | BatchReviewResult;

function normalizeOptions(options?: ReviewOptions) {
  return {
    reviewProfile: options?.reviewProfile ?? "standard",
    severityThreshold: options?.severityThreshold ?? "medium_plus",
  };
}

function applyThreshold(findings: SqlFinding[], threshold: SeverityThreshold): SqlFinding[] {
  if (threshold === "low_plus") return findings;
  if (threshold === "medium_plus") return findings.filter((f) => f.type !== "LOW");
  return findings.filter((f) => f.type === "HIGH" || f.type === "CRITICAL");
}

function applyReviewProfile(findings: SqlFinding[], reviewProfile: ReviewProfile): SqlFinding[] {
  if (reviewProfile === "standard") return findings;
  if (reviewProfile === "strict") {
    return findings.map((finding) => {
      if (finding.type !== "LOW") return finding;
      return { ...finding, type: "MEDIUM" as const };
    });
  }
  return findings.filter((finding) => finding.type === "HIGH" || finding.type === "CRITICAL");
}

function withContextMeta(findings: SqlFinding[]): SqlFinding[] {
  return findings.map((finding) => ({
    ...finding,
    contextUsed: finding.contextUsed ?? finding.context_used ?? false,
    contextReason: finding.contextReason ?? finding.context_reason,
    contextConfidenceBasis:
      finding.contextConfidenceBasis ?? finding.context_confidence_basis,
    context_used: finding.contextUsed ?? finding.context_used ?? false,
    context_reason: finding.contextReason ?? finding.context_reason,
    context_confidence_basis:
      finding.contextConfidenceBasis ?? finding.context_confidence_basis,
  }));
}

function applySqlDialectHints(findings: SqlFinding[], options?: ReviewOptions): SqlFinding[] {
  const dialect = options?.runtime?.sqlDialect ?? "postgres";
  if (dialect !== "bigquery") return findings;
  return findings.map((finding) => {
    const haystack = `${finding.title} ${finding.description} ${finding.recommendation}`.toLowerCase();
    if (!/division|denominator|divide-by-zero/.test(haystack)) return finding;
    const recommendation = finding.recommendation.replace(/NULLIF\([^)]+\)/gi, "SAFE_DIVIDE(numerator, denominator)");
    return {
      ...finding,
      recommendation:
        recommendation.includes("SAFE_DIVIDE")
          ? recommendation
          : `${finding.recommendation} Prefer SAFE_DIVIDE in BigQuery for denominator safety.`,
    };
  });
}

function formatLine(index: number): number {
  return Math.max(1, index);
}

function normalizeToken(value: string): string {
  return value.trim().replace(/[`"]/g, "").toLowerCase();
}

function collectContextTables(context: ParsedReviewContext | undefined): Set<string> {
  return new Set(Object.keys(context?.schema?.tables ?? {}).map((table) => normalizeToken(table)));
}

function collectContextColumns(context: ParsedReviewContext | undefined): Set<string> {
  const columns = new Set<string>();
  for (const table of Object.values(context?.schema?.tables ?? {})) {
    for (const columnName of Object.keys(table.columns ?? {})) {
      columns.add(normalizeToken(columnName));
    }
  }
  return columns;
}

function collectNullableColumns(context: ParsedReviewContext | undefined): Set<string> {
  const columns = new Set<string>();
  for (const table of Object.values(context?.schema?.tables ?? {})) {
    for (const [columnName, metadata] of Object.entries(table.columns ?? {})) {
      if (metadata.nullable === true) {
        columns.add(normalizeToken(columnName));
      }
    }
  }
  return columns;
}

function collectGrainDescriptions(context: ParsedReviewContext | undefined): string[] {
  return Object.values(context?.schema?.tables ?? {})
    .map((table) => table.grain?.trim().toLowerCase())
    .filter((value): value is string => Boolean(value));
}

function collectReferencedIdentifiers(input: string): Set<string> {
  const matches = input.match(/\b[a-z_][a-z0-9_]*\b/gi) ?? [];
  const stopWords = new Set([
    "select",
    "from",
    "where",
    "join",
    "left",
    "right",
    "inner",
    "outer",
    "on",
    "and",
    "or",
    "group",
    "by",
    "order",
    "sum",
    "count",
    "avg",
    "min",
    "max",
    "as",
    "is",
    "not",
    "null",
    "true",
    "false",
    "kpi",
    "definition",
    "formula",
    "grain",
    "assumptions",
    "rate",
    "metric",
  ]);
  const identifiers = new Set<string>();
  for (const match of matches) {
    const normalized = normalizeToken(match);
    if (!stopWords.has(normalized) && normalized.length > 1) {
      identifiers.add(normalized);
    }
  }
  return identifiers;
}

function extractDeclaredGrainHints(input: string): string[] {
  const hints: string[] = [];
  const patterns = [
    /\bgrain\s*[:\-]?\s*([a-z0-9_\- ]{2,64})/gi,
    /\bper\s+([a-z0-9_\-]+(?:\s*-\s*[a-z0-9_\-]+)?)/gi,
    /\b([a-z0-9_]+-[a-z0-9_]+)\s+grain\b/gi,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(input)) !== null) {
      const value = normalizeToken(match[1] ?? "");
      if (value) hints.push(value);
    }
  }
  return [...new Set(hints)];
}

function containsAny(value: string, tokens: string[]): boolean {
  return tokens.some((token) => value.includes(token));
}

type KpiSections = {
  name: string;
  grain: string;
  definition: string;
  formula: string;
  assumptions: string;
  lines: Record<"name" | "grain" | "definition" | "formula" | "assumptions", number>;
};

function parseKpiSections(input: string): KpiSections {
  const lines = input.split(/\r?\n/);
  const sections: KpiSections = {
    name: "",
    grain: "",
    definition: "",
    formula: "",
    assumptions: "",
    lines: { name: 1, grain: 1, definition: 1, formula: 1, assumptions: 1 },
  };

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] ?? "";
    const line = raw.trim();
    if (!line) continue;
    const mapped = /^([a-z ]+)\s*:\s*(.*)$/i.exec(line);
    if (!mapped) continue;
    const key = mapped[1].trim().toLowerCase();
    const value = mapped[2].trim();
    const lineNumber = index + 1;

    if (key === "kpi name") {
      sections.name = value;
      sections.lines.name = lineNumber;
    } else if (key === "grain") {
      sections.grain = value;
      sections.lines.grain = lineNumber;
    } else if (key === "definition") {
      sections.definition = value;
      sections.lines.definition = lineNumber;
    } else if (key === "formula") {
      sections.formula = value;
      sections.lines.formula = lineNumber;
    } else if (key === "assumptions") {
      sections.assumptions = value;
      sections.lines.assumptions = lineNumber;
    }
  }

  if (!sections.definition && input.trim()) {
    sections.definition = input.trim();
  }

  return sections;
}

function extractDenominatorExpression(expression: string): string | null {
  if (!expression.includes("/")) return null;
  const parts = expression.split("/");
  const denominator = parts[parts.length - 1]?.trim() ?? "";
  if (!denominator) return null;
  return denominator.replace(/^\(+|\)+$/g, "").trim();
}

function extractNumeratorExpression(expression: string): string | null {
  if (!expression.includes("/")) return null;
  const parts = expression.split("/");
  const numerator = parts.slice(0, -1).join("/").trim();
  if (!numerator) return null;
  return numerator.replace(/^\(+|\)+$/g, "").trim();
}

function extractExpressionTokens(expression: string): string[] {
  return (expression.match(/\b[a-z_][a-z0-9_]*\b/gi) ?? [])
    .map(normalizeToken)
    .filter(
      (token) =>
        ![
          "sum",
          "count",
          "avg",
          "min",
          "max",
          "coalesce",
          "nullif",
          "case",
          "when",
          "then",
          "else",
          "end",
          "as",
        ].includes(token),
    );
}

function analyzeKpiDefinition(
  input: string,
  context: ParsedReviewContext | undefined,
  reviewProfile: ReviewProfile,
): SqlFinding[] {
  const findings: SqlFinding[] = [];
  const sections = parseKpiSections(input);
  const formula = sections.formula;
  const definition = sections.definition;
  const assumptions = sections.assumptions;
  const sectionText = [sections.name, sections.grain, definition, formula, assumptions]
    .filter(Boolean)
    .join("\n");
  const text = input.trim();
  const lower = sectionText.toLowerCase();
  if (!text) return findings;

  const add = (finding: Omit<SqlFinding, "id">) =>
    findings.push({ id: `TMP-${findings.length + 1}`, ...finding });

  const hasNumerator = /\bnumerator\b|divided by|\/|ratio of/i.test(sectionText);
  const hasDenominator = /\bdenominator\b|divided by|\/|per\s+[a-z]+/i.test(sectionText);
  if (!hasNumerator) {
    add({
      type: "HIGH",
      category: "metric_definition",
      title: "Numerator is not explicitly defined",
      description: "The KPI definition does not clearly identify what contributes to the numerator.",
      recommendation: "Define numerator fields and any filters used to construct it.",
      confidence: "HIGH",
      line: formatLine(sections.lines.definition),
      context_used: false,
    });
  }
  if (!hasDenominator) {
    add({
      type: "HIGH",
      category: "metric_definition",
      title: "Denominator is not explicitly defined",
      description: "The KPI definition does not clearly scope denominator population.",
      recommendation: "Specify denominator entity, scope filters, and exclusion rules.",
      confidence: "HIGH",
      line: formatLine(sections.lines.definition),
      context_used: false,
    });
  }

  if (!/\bgrain\b|per\s+(user|account|order|session|day|week|month)/i.test(sectionText)) {
    add({
      type: "MEDIUM",
      category: "metric_definition",
      title: "Metric grain is unclear",
      description: "The metric does not define the expected reporting grain.",
      recommendation: "State the output grain clearly (for example, one row per account per month).",
      confidence: "MEDIUM",
      line: formatLine(sections.lines.grain || sections.lines.definition),
      context_used: false,
    });
  }

  const contextTables = collectContextTables(context);
  const contextColumns = collectContextColumns(context);
  const nullableColumns = collectNullableColumns(context);
  const grainDescriptions = collectGrainDescriptions(context);
  const identifierRefs = collectReferencedIdentifiers(sectionText);
  const hasContext = contextTables.size > 0 || Boolean(context?.hints?.length);

  const hasSourceOfTruth = /\bsource of truth\b|\btable\b|\bdataset\b|\bsystem\b|\bwarehouse\b/i.test(sectionText);
  if (!hasSourceOfTruth) {
    add({
      type: "MEDIUM",
      category: "structure",
      title: "Source-of-truth is not specified",
      description:
        contextTables.size > 0
          ? `Definition does not name a source table/system. Available context tables: ${[...contextTables].slice(0, 4).join(", ")}.`
          : "Definition does not identify a source table or system.",
      recommendation: "Document source-of-truth table/system and ownership.",
      confidence: contextTables.size > 0 ? "MEDIUM" : "LOW",
      line: formatLine(sections.lines.definition),
      context_used: contextTables.size > 0,
      context_reason: contextTables.size > 0 ? "table metadata applied" : undefined,
      context_confidence_basis: contextTables.size > 0 ? "table coverage available" : undefined,
    });
  }

  if (!/\bday|week|month|quarter|year|rolling|trailing|cadence|refresh|window\b/i.test(lower)) {
    add({
      type: "MEDIUM",
      category: "metric_definition",
      title: "Time window or refresh cadence is missing",
      description: "The KPI definition does not specify time window semantics.",
      recommendation: "Define lookback window and refresh cadence (e.g. trailing 28 days, daily refresh).",
      confidence: "MEDIUM",
      line: formatLine(1),
      context_used: false,
    });
  }

  if (!/\bexclude|exclusion|include|filter|only\b/i.test(lower)) {
    add({
      type: reviewProfile === "strict" ? "MEDIUM" : "LOW",
      category: "metric_definition",
      title: "Inclusion or exclusion rules are missing",
      description: "The KPI does not document population boundaries.",
      recommendation: "Document explicit inclusions/exclusions for reproducibility.",
      confidence: "LOW",
      line: formatLine(1),
      context_used: false,
    });
  }

  if (!/\blate|backfill|lag|arrival|delay\b/i.test(lower) && reviewProfile !== "release_gate") {
    add({
      type: "LOW",
      category: "edge_case",
      title: "Late-arriving data handling is not defined",
      description: "Definition does not mention how delayed records are handled.",
      recommendation: "Clarify backfill policy and late-arriving data treatment.",
      confidence: "LOW",
      line: formatLine(1),
      context_used: false,
    });
  }

  if (contextTables.size > 0) {
    const referencedTables = [...identifierRefs].filter((identifier) => contextTables.has(identifier));
    const likelyUnknownTables = [...identifierRefs].filter(
      (identifier) =>
        /(orders|order|payments|payment|sessions|session|accounts|account|users|user|events|event|visits|visit|transactions?|txn)/i.test(
          identifier,
        ) && !contextTables.has(identifier),
    );

    if (likelyUnknownTables.length > 0 && referencedTables.length === 0) {
      add({
        type: "MEDIUM",
        category: "structure",
        title: "Referenced entities are not found in provided context",
        description: `KPI definition references ${likelyUnknownTables
          .slice(0, 4)
          .join(", ")}, but those entities are not present in the available context schema.`,
        recommendation:
          "Validate source entities in the KPI definition or provide matching schema context before release.",
        confidence: "MEDIUM",
        line: formatLine(sections.lines.definition),
        context_used: true,
        context_reason: "table reference validation applied",
        context_confidence_basis: "schema tables provided",
      });
    }
  }

  if (hasContext && grainDescriptions.length > 0) {
    const declaredGrain = extractDeclaredGrainHints(text);
    if (declaredGrain.length > 0) {
      const grainMatch = declaredGrain.some((grainHint) => {
        const tokens = grainHint.split(/[\s_-]+/).filter(Boolean);
        return grainDescriptions.some((grainDescription) => containsAny(grainDescription, tokens));
      });
      if (!grainMatch) {
        add({
          type: "HIGH",
          category: "metric_definition",
          title: "Declared KPI grain may not align with available data grain",
          description: `Declared KPI grain (${declaredGrain[0]}) does not clearly align with context grain metadata (${grainDescriptions.slice(0, 2).join("; ")}).`,
          recommendation:
            "Reconcile KPI output grain with source table grain, or document a clear aggregation path between them.",
          confidence: "MEDIUM",
          line: formatLine(1),
          context_used: true,
          context_reason: "grain metadata applied",
          context_confidence_basis: "declared grain mismatches schema grain",
        });
      }
    }
  }

  const hasCalculation = /\/|\*|\+|-|ratio|rate|numerator|denominator/i.test(sectionText);
  if (hasCalculation && nullableColumns.size > 0) {
    const nullableRefs = [...identifierRefs].filter((identifier) => nullableColumns.has(identifier));
    if (nullableRefs.length > 0) {
      add({
        type: "MEDIUM",
        category: "edge_case",
        title: "Nullable fields may weaken KPI reliability",
        description: `KPI calculation references nullable fields (${nullableRefs
          .slice(0, 4)
          .join(", ")}) according to provided context metadata.`,
        recommendation:
          "Define null-handling assumptions explicitly (for example, COALESCE defaults or exclusion rules).",
        confidence: "MEDIUM",
        line: formatLine(sections.lines.formula || sections.lines.definition),
        context_used: true,
        context_reason: "nullable field metadata applied",
        context_confidence_basis: "nullable columns present in calculation context",
      });
    }
  }

  if (contextColumns.size > 0) {
    const referencedColumns = [...identifierRefs].filter((identifier) => contextColumns.has(identifier));
    if (hasCalculation && referencedColumns.length === 0 && contextTables.size > 0) {
      add({
        type: "LOW",
        category: "metric_definition",
        title: "Formula assumptions are not grounded in provided column metadata",
        description:
          "The KPI definition includes calculation language, but none of the referenced terms map cleanly to known context columns.",
        recommendation:
          "Reference concrete source columns in the KPI definition to improve auditability and implementation accuracy.",
        confidence: "LOW",
        line: formatLine(sections.lines.formula || sections.lines.definition),
        context_used: true,
        context_reason: "column reference validation applied",
        context_confidence_basis: "context available but formula references are ambiguous",
      });
    }
  }

  const formulaText = `${formula} ${definition}`.trim();
  const denominatorExpr = extractDenominatorExpression(formulaText);
  const numeratorExpr = extractNumeratorExpression(formulaText);
  const hasRatioPattern = Boolean(denominatorExpr);
  const baselineSignals = /previous|prior|baseline|growth|variance|lift|change\s*%|month[-\s]?over[-\s]?month|year[-\s]?over[-\s]?year|mom|yoy/i.test(
    `${sections.name} ${definition} ${formula} ${assumptions}`,
  );
  const conversionOrRetentionSignals = /conversion|retention|churn|activation/i.test(
    `${sections.name} ${definition} ${formula} ${assumptions}`,
  );
  const baselineExplicitlyDefined = /previous|prior|baseline|comparison/i.test(
    `${definition} ${assumptions} ${formula}`,
  );
  const comparisonWindowDefined =
    /previous\s+month|prior\s+month|month[-\s]?over[-\s]?month|previous\s+year|prior\s+year|year[-\s]?over[-\s]?year|rolling|trailing|window/i.test(
      `${definition} ${assumptions}`,
    );
  const strongComparisonBoundary =
    /completed\s+month|calendar\s+month|timezone|cutoff|as\s+of|close\s+date|period\s+boundary|snapshot/i.test(
      `${definition} ${assumptions}`,
    );
  const explicitZeroHandling = /nullif|safe_divide|if\s*\(|case\s+when|when\s+.*=\s*0|zero/i.test(
    `${formula} ${assumptions}`,
  );
  const explicitMissingBaselineHandling = /missing|null|coalesce|fallback|exclude|default/i.test(
    `${formula} ${assumptions}`,
  );
  const explicitNegativeBaselineHandling = /negative|abs\(|absolute|signed|sign\s*\(|if\s*\(.*<\s*0|case\s+when\s+.*<\s*0/i.test(
    `${formula} ${assumptions}`,
  );

  if (hasRatioPattern) {
    const denominatorLower = normalizeToken(denominatorExpr ?? "denominator");
    const denominatorColumn = denominatorLower.split(".").pop() ?? denominatorLower;
    const nullableByContext = nullableColumns.has(denominatorColumn) || nullableColumns.has(denominatorLower);
    const numeratorTokens = extractExpressionTokens(numeratorExpr ?? "");
    const denominatorTokens = extractExpressionTokens(denominatorExpr ?? "");
    const hasScopeLanguage = /\bscope|population|eligible|cohort|segment|include|exclude|filter|subset\b/i.test(
      `${definition} ${assumptions}`,
    );
    const sharesToken = numeratorTokens.some((token) => denominatorTokens.includes(token));

    add({
      type: "HIGH",
      category: "edge_case",
      title: "Denominator may be zero or undefined",
      description: `Formula uses ${denominatorExpr ?? "a denominator"} in a ratio, but denominator safety assumptions are not explicit.`,
      recommendation:
        "Define denominator guardrails and expected KPI behavior when denominator is zero, null, or missing.",
      confidence: "HIGH",
      line: formatLine(sections.lines.formula || sections.lines.definition),
      context_used: false,
    });

    add({
      type: "HIGH",
      category: "edge_case",
      title: "Baseline denominator may be zero",
      description: `Formula uses ${denominatorExpr ?? "a denominator"} in division, but behavior when it equals zero is not explicitly defined.`,
      recommendation:
        "Define KPI behavior when baseline denominator is zero (for example, null result, exclusion, or business-specific fallback).",
      confidence: baselineSignals ? "HIGH" : "MEDIUM",
      line: formatLine(sections.lines.formula || sections.lines.definition),
      context_used: false,
    });

    if (!explicitMissingBaselineHandling || nullableByContext) {
      add({
        type: nullableByContext ? "HIGH" : "MEDIUM",
        category: "edge_case",
        title: "Null or missing baseline handling is not specified",
        description: nullableByContext
          ? `Baseline denominator (${denominatorExpr ?? "denominator"}) is nullable in available context, but the KPI does not define missing-baseline behavior.`
          : `Formula references ${denominatorExpr ?? "baseline denominator"} but does not define how null or missing prior values should be handled.`,
        recommendation:
          "Document null/missing-baseline treatment explicitly so KPI outputs remain stable across sparse periods.",
        confidence: nullableByContext ? "HIGH" : "MEDIUM",
        line: formatLine(sections.lines.formula || sections.lines.assumptions || sections.lines.definition),
        context_used: nullableByContext,
        context_reason: nullableByContext ? "nullable field metadata applied" : undefined,
        context_confidence_basis: nullableByContext ? "denominator column marked nullable" : undefined,
      });
    }

    if (baselineSignals && (!comparisonWindowDefined || !strongComparisonBoundary)) {
      add({
        type: "MEDIUM",
        category: "metric_definition",
        title: "Comparison window needs clearer definition",
        description:
          "Baseline-style KPI language is present, but comparison boundaries are not fully defined (for example, exact prior period logic and late data treatment).",
        recommendation:
          "Specify precise comparison window rules (e.g., previous completed month, timezone cutoff, and late-arriving-data policy).",
        confidence: "MEDIUM",
        line: formatLine(sections.lines.assumptions || sections.lines.definition),
        context_used: false,
      });
    }

    if (baselineSignals && !baselineExplicitlyDefined) {
      add({
        type: "HIGH",
        category: "metric_definition",
        title: "Baseline for comparison is not clearly defined",
        description:
          "The KPI appears comparison-based (growth/variance/lift), but the baseline reference is not explicitly defined.",
        recommendation:
          "Specify baseline reference clearly (for example, previous completed month revenue at the same grain).",
        confidence: "HIGH",
        line: formatLine(sections.lines.definition || sections.lines.formula),
        context_used: false,
      });
    }

    if (
      conversionOrRetentionSignals &&
      !/\bcohort|eligible|denominator population|active users|qualifying|new users|existing users\b/i.test(
        `${definition} ${assumptions}`,
      )
    ) {
      add({
        type: "MEDIUM",
        category: "metric_definition",
        title: "Cohort or eligibility population is not defined",
        description:
          "Conversion/retention KPI language is present, but cohort eligibility rules are unclear.",
        recommendation:
          "Define eligibility cohort and denominator population rules before release.",
        confidence: "MEDIUM",
        line: formatLine(sections.lines.definition || sections.lines.assumptions),
        context_used: false,
      });
    }

    if (!hasScopeLanguage && !sharesToken) {
      add({
        type: "MEDIUM",
        category: "metric_definition",
        title: "Numerator and denominator scope may not align",
        description:
          "The formula includes a ratio, but population alignment between numerator and denominator is not explicitly documented.",
        recommendation:
          "Document numerator and denominator scope alignment, filters, and exclusions to avoid interpretation drift.",
        confidence: "MEDIUM",
        line: formatLine(sections.lines.formula || sections.lines.definition),
        context_used: false,
      });
    }

    if (baselineSignals && !explicitNegativeBaselineHandling) {
      add({
        type: "MEDIUM",
        category: "metric_definition",
        title: "Negative baseline behavior is not specified for growth calculation",
        description:
          "When baseline values are negative, growth percentages can become counterintuitive without explicit interpretation rules.",
        recommendation:
          "Document how negative baseline values should be interpreted, filtered, or transformed before KPI publication.",
        confidence: "MEDIUM",
        line: formatLine(sections.lines.assumptions || sections.lines.formula || sections.lines.definition),
        context_used: false,
      });
    }

    if (baselineSignals && !explicitZeroHandling) {
      add({
        type: "HIGH",
        category: "metric_definition",
        title: "Formula does not define behavior when baseline denominator is zero",
        description:
          "A baseline comparison denominator is present, but formula-level safeguards for zero values are not documented.",
        recommendation:
          "Add formula-level denominator guardrails and business interpretation rules for zero-baseline cases.",
        confidence: "HIGH",
        line: formatLine(sections.lines.formula || sections.lines.definition),
        context_used: false,
      });
    }
  }

  return findings;
}

function analyzeNarrative(
  input: string,
  context: ParsedReviewContext | undefined,
  reviewProfile: ReviewProfile,
): SqlFinding[] {
  const findings: SqlFinding[] = [];
  const text = input.trim();
  const lower = text.toLowerCase();
  if (!text) return findings;
  const add = (finding: Omit<SqlFinding, "id">) =>
    findings.push({ id: `TMP-${findings.length + 1}`, ...finding });

  const hasNumbers = /\b\d+(\.\d+)?%|\$\s?\d+|\b\d{2,}\b/.test(text);
  const hasChangeLanguage = /\bincrease(d)?|decrease(d)?|improv(ed|ement)?|decline(d)?|drop(ped)?|significant(ly)?\b/i.test(
    text,
  );
  const hasCausalClaim = /\bbecause|due to|led to|resulted in|caused by\b/i.test(text);
  const hasEvidence = /\bevidence|data shows|observed|experiment|based on|measured|analysis|sample\b/i.test(
    text,
  );
  const hasMetricMention = /\brevenue|conversion|retention|performance|margin|profit|engagement\b/i.test(
    text,
  );
  const hasMetricDefinition = /\bdefined as|formula|calculated as|numerator|denominator|kpi\b/i.test(text);
  const hasVagueLanguage = /\bbetter|worse|strong|weak|engagement|healthy|unhealthy|solid\b/i.test(text);
  const hasRecommendationLanguage = /\brecommend|should|next step|action|propose|plan\b/i.test(text);
  const hasWeakRecommendationLanguage = /\bmonitor|look into|consider|keep an eye|follow up\b/i.test(text);
  const hasConcreteAction = /\bowner|deadline|by\s+\w+day|ship|rollout|pause|revert|launch|approve|reject|go\/no-go\b/i.test(
    text,
  );
  const hasStrongClaim = /\bdefinitely|certainly|proves|guaranteed|undeniable|will\b/i.test(text);
  const hasUncertainty = /\bconfidence|uncertain|likely|possibly|assumption|risk|estimate\b/i.test(text);

  if (hasCausalClaim && !hasEvidence) {
    add({
      type: "CRITICAL",
      category: "communication",
      title: "Causal relationship is asserted without supporting evidence",
      description:
        "The narrative presents a cause-and-effect claim but does not provide supporting evidence or method.",
      recommendation:
        "Add causal evidence (analysis approach, quantified support, or downgrade to correlational language).",
      confidence: "HIGH",
      line: 1,
      context_used: false,
    });
  }

  if (hasChangeLanguage && !hasNumbers) {
    add({
      type: "HIGH",
      category: "communication",
      title: "Impact is not quantified",
      description: "Narrative describes directional change but does not quantify magnitude.",
      recommendation: "Add measurable impact (e.g., % change, revenue delta, affected population).",
      confidence: "HIGH",
      line: 1,
      context_used: false,
    });
  }

  if (hasMetricMention && !hasMetricDefinition) {
    add({
      type: "MEDIUM",
      category: "communication",
      title: "Metric is not clearly defined",
      description:
        "The narrative references KPI/metric terms but does not define how they are measured.",
      recommendation:
        "Define metric meaning, calculation basis, and comparison scope for stakeholder clarity.",
      confidence: "MEDIUM",
      line: 1,
      context_used: false,
    });
  }

  if (hasVagueLanguage) {
    add({
      type: "MEDIUM",
      category: "communication",
      title: "Ambiguous language reduces clarity",
      description:
        "The narrative uses vague qualitative wording that can be interpreted inconsistently.",
      recommendation:
        "Replace ambiguous terms with measurable, decision-oriented language.",
      confidence: "MEDIUM",
      line: 1,
      context_used: false,
    });
  }

  if (!hasRecommendationLanguage || (hasWeakRecommendationLanguage && !hasConcreteAction)) {
    add({
      type: "HIGH",
      category: "communication",
      title: "Recommendation is not actionable",
      description:
        "The recommendation lacks a concrete action, owner, or execution trigger.",
      recommendation:
        "Provide a specific action with owner, timeline, and expected outcome.",
      confidence: "HIGH",
      line: 1,
      context_used: false,
    });
  }

  if ((hasStrongClaim || hasCausalClaim) && !hasUncertainty) {
    add({
      type: reviewProfile === "strict" ? "MEDIUM" : "LOW",
      category: "communication",
      title: "Confidence level or uncertainty not stated",
      description:
        "The narrative makes strong claims but does not acknowledge confidence or uncertainty.",
      recommendation:
        "State confidence level and key uncertainties to improve decision reliability.",
      confidence: "MEDIUM",
      line: 1,
      context_used: false,
    });
  }

  const contextTables = collectContextTables(context);
  const grainDescriptions = collectGrainDescriptions(context);
  const hasSchemaContext = contextTables.size > 0;
  const hasContextHints = Boolean(context?.hints?.length);
  const declaredGrain = extractDeclaredGrainHints(text);

  if (hasSchemaContext && declaredGrain.length > 0) {
    const grainAligned = declaredGrain.some((grainHint) => {
      const tokens = grainHint.split(/[\s_-]+/).filter(Boolean);
      return grainDescriptions.some((grainDescription) => containsAny(grainDescription, tokens));
    });
    if (!grainAligned) {
      add({
        type: "MEDIUM",
        category: "structure",
        title: "Narrative grain may be misaligned with available data grain",
        description: `Narrative references ${declaredGrain[0]} grain, but provided schema context suggests ${grainDescriptions
          .slice(0, 2)
          .join("; ")}.`,
        recommendation:
          "Align narrative grain claims with available source-table grain or clarify transformation logic.",
        confidence: "MEDIUM",
        line: 1,
        context_used: true,
        context_reason: "grain metadata applied",
        context_confidence_basis: "narrative grain terms conflict with schema grain",
      });
    }
  }

  if (hasSchemaContext) {
    const mentionedKnownTables = [...contextTables].filter((table) =>
      new RegExp(`\\b${table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text),
    );
    const likelyTableMentions = [...new Set((text.match(/\b[a-z_][a-z0-9_]*\b/gi) ?? []).map(normalizeToken))].filter(
      (token) =>
        /(orders|order|payments|payment|users|user|accounts|account|sessions|session|events|event|visits|visit|transactions?|txn)/i.test(
          token,
        ),
    );
    const unknownMentions = likelyTableMentions.filter((token) => !contextTables.has(token));

    if (unknownMentions.length > 0 && mentionedKnownTables.length === 0) {
      add({
        type: "MEDIUM",
        category: "communication",
        title: "Narrative references entities not grounded in provided context",
        description: `Narrative mentions ${unknownMentions
          .slice(0, 4)
          .join(", ")}, but those entities are not present in the current data context.`,
        recommendation:
          "Validate referenced entities or include matching schema context before stakeholder distribution.",
        confidence: "MEDIUM",
        line: 1,
        context_used: true,
        context_reason: "table reference validation applied",
        context_confidence_basis: "schema tables available for grounding",
      });
    }
  }

  if ((hasSchemaContext || hasContextHints) && /\bdefinitely|certain|proves|guaranteed|undeniable\b/i.test(lower)) {
    const confidence: SqlFinding["confidence"] = hasSchemaContext ? "LOW" : "MEDIUM";
    add({
      type: "LOW",
      category: "communication",
      title: "Narrative certainty may overstate available context evidence",
      description:
        "Absolute certainty language is present while available context appears partial for the claims being made.",
      recommendation:
        "Use calibrated confidence language and tie certainty level to concrete evidence from available context.",
      confidence,
      line: 1,
      context_used: true,
      context_reason: "context completeness and certainty language compared",
      context_confidence_basis: hasSchemaContext ? "partial metadata coverage" : "hints-only context",
    });
  }

  if (!hasEvidence) {
    add({
      type: "MEDIUM",
      category: "structure",
      title: "Evidence is weak or absent",
      description: "Claims are not clearly backed by supporting evidence.",
      recommendation: "Cite evidence for each key claim and indicate data basis.",
      confidence: "MEDIUM",
      line: 1,
      context_used: false,
    });
  }

  if (!/\bapprove|decision|ask|next step|go\/no-go|owner\b/i.test(lower)) {
    add({
      type: "MEDIUM",
      category: "communication",
      title: "Decision ask is unclear",
      description: "Stakeholder action requested from this narrative is not explicit.",
      recommendation: "End with a concrete decision ask and owner.",
      confidence: "MEDIUM",
      line: 1,
      context_used: false,
    });
  }

  return findings;
}

function finalizeFindings(
  rawFindings: SqlFinding[],
  options?: ReviewOptions,
): SqlFinding[] {
  const normalized = normalizeOptions(options);
  const profiled = applyReviewProfile(rawFindings, normalized.reviewProfile);
  const filtered = applyThreshold(profiled, normalized.severityThreshold);
  const dialectAdjusted = applySqlDialectHints(filtered, options);
  return withContextMeta(
    dialectAdjusted.map((finding, index) => ({
      ...finding,
      id: `F${String(index + 1).padStart(3, "0")}`,
    })),
  );
}

export function reviewArtifact(payload: ReviewArtifactPayload): ReviewArtifactResult {
  const { artifactType, input, context, options } = payload;

  if (artifactType === "sql") {
    const query = typeof input === "string" ? input : "";
    const findings = finalizeFindings(analyzeSQL(query, context), options);
    return { artifactType, findings };
  }

  if (artifactType === "kpi_definition") {
    const text = typeof input === "string" ? input : "";
    const findings = finalizeFindings(
      analyzeKpiDefinition(text, context, normalizeOptions(options).reviewProfile),
      options,
    );
    return { artifactType, findings };
  }

  if (artifactType === "narrative") {
    const text = typeof input === "string" ? input : "";
    const findings = finalizeFindings(
      analyzeNarrative(text, context, normalizeOptions(options).reviewProfile),
      options,
    );
    return { artifactType, findings };
  }

  const batchInput = typeof input === "string" ? { queries: [] } : input;
  const queries: BatchQueryUnit[] = (batchInput.queries ?? []).map((query, index) => {
    const findings = finalizeFindings(analyzeSQL(query.sql, context), options);
    const riskScore = computeRiskScore(findings);
    return {
      id: query.id ?? `BQ-${index + 1}`,
      label: query.label ?? `Query ${index + 1}`,
      source: query.source ?? "pasted",
      sourceName: query.sourceName,
      sql: query.sql,
      findings,
      findingsCount: findings.length,
      highestSeverity: getHighestSeverity(findings),
      riskScore,
      riskLabel: getRiskLabel(riskScore),
      lastReviewedTimestamp: new Date().toISOString(),
    };
  });

  const totalFindings = queries.reduce((sum, q) => sum + q.findingsCount, 0);
  const criticalHighQueries = queries.filter(
    (q) => q.highestSeverity === "CRITICAL" || q.highestSeverity === "HIGH",
  ).length;
  const averageRiskScore =
    queries.length > 0
      ? Math.round(queries.reduce((sum, q) => sum + q.riskScore, 0) / queries.length)
      : 0;

  return {
    artifactType,
    queries,
    batchSummary: {
      totalQueries: queries.length,
      totalFindings,
      criticalHighQueries,
      averageRiskScore,
    },
  };
}
