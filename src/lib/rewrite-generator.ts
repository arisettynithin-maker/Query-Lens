import type { ArtifactType } from "@/components/review/review-session-provider";
import type { ParsedReviewContext } from "@/types/review-context";
import type { SqlFinding } from "@/types/sql-review";
import type { RewriteOutput } from "@/types/rewrite";

type GenerateRewriteInput = {
  artifactType: ArtifactType;
  mode: string;
  input: string;
  findings: SqlFinding[];
  context: ParsedReviewContext | null;
  targetBatchQueryId?: string;
  targetBatchQueryLabel?: string;
  sqlDialect?: "postgres" | "bigquery" | "redshift" | "mysql";
  sqlSafetyRules?: {
    divisionByZeroProtection: boolean;
    nullHandlingEnforcement: boolean;
    joinDuplicationDetection: boolean;
    groupByConsistencyCheck: boolean;
    distinctMisuseDetection: boolean;
  };
};

function calcConfidence(findings: SqlFinding[], addressedFindingIds: string[]) {
  const total = findings.length;
  const addressed = findings.filter((f) => addressedFindingIds.includes(f.id)).length;
  const criticalHighTotal = findings.filter((f) => f.type === "CRITICAL" || f.type === "HIGH").length;
  const criticalHighAddressed = findings.filter(
    (f) => (f.type === "CRITICAL" || f.type === "HIGH") && addressedFindingIds.includes(f.id),
  ).length;
  const ratio = total > 0 ? addressed / total : 1;

  if (criticalHighTotal > 0 && criticalHighAddressed === criticalHighTotal && ratio >= 0.8) {
    return {
      label: "High" as const,
      detail: `High (${addressed}/${total} findings addressed, all critical/high covered)`,
    };
  }
  if ((criticalHighTotal > 0 && criticalHighAddressed > 0) || ratio >= 0.4) {
    return {
      label: "Medium" as const,
      detail: `Medium (${addressed}/${total} findings addressed)`,
    };
  }
  return {
    label: "Low" as const,
    detail: `Low (${addressed}/${total} findings addressed; manual review recommended)`,
  };
}

const SQL_KEYWORDS = [
  "select",
  "from",
  "where",
  "join",
  "left join",
  "right join",
  "inner join",
  "outer join",
  "group by",
  "order by",
  "having",
  "with",
  "on",
  "as",
  "and",
  "or",
  "case",
  "when",
  "then",
  "else",
  "end",
];

function upperKeywords(sql: string) {
  let output = sql;
  for (const keyword of SQL_KEYWORDS.sort((a, b) => b.length - a.length)) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    output = output.replace(new RegExp(`\\b${escaped}\\b`, "gi"), keyword.toUpperCase());
  }
  return output;
}

function formatSqlLayout(sql: string) {
  let out = sql;
  const keywords = [
    "WITH",
    "SELECT",
    "FROM",
    "JOIN",
    "LEFT JOIN",
    "RIGHT JOIN",
    "INNER JOIN",
    "WHERE",
    "GROUP BY",
    "HAVING",
    "ORDER BY",
    "UNION",
  ];
  for (const keyword of keywords.sort((a, b) => b.length - a.length)) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`\\s+${escaped}\\b`, "g"), `\n${keyword}`);
  }
  out = out
    .split("\n")
    .map((line) => line.trim())
    .filter((line, idx, arr) => !(line === "" && arr[idx - 1] === ""))
    .join("\n");
  return out.trim();
}

function isJoinRiskFinding(finding: SqlFinding) {
  const haystack = `${finding.title} ${finding.description} ${finding.recommendation}`.toLowerCase();
  return /(join|cardinality|duplication|row multiplication|row explosion|many-to-many)/i.test(
    haystack,
  );
}

function insertJoinWarning(sql: string) {
  if (/warning:\s*this join may create duplicate rows/i.test(sql)) return sql;
  const warning =
    "-- WARNING: This join may create duplicate rows if joined table keys are non-unique";
  if (/\bJOIN\b/i.test(sql)) {
    return sql.replace(/\bJOIN\b/i, `${warning}\nJOIN`);
  }
  return `${warning}\n${sql}`;
}

function safeDivisionRewrite(
  sql: string,
  dialect: "postgres" | "bigquery" | "redshift" | "mysql",
): { sql: string; changed: boolean } {
  let changed = false;
  const updated =
    dialect === "bigquery"
      ? sql.replace(
          /(\b(?:sum|count|avg|min|max)\([^)]+\)|[a-z_][a-z0-9_.]*)\s*\/\s*(\b(?:sum|count|avg|min|max)\([^)]+\)|[a-z_][a-z0-9_.]*)/gi,
          (match, left, right) => {
            changed = true;
            return `SAFE_DIVIDE(${left}, ${right})`;
          },
        )
      : sql.replace(
          /(\b(?:sum|count|avg|min|max)\([^)]+\)|[a-z_][a-z0-9_.]*)\s*\/\s*(?!nullif\()(\b(?:sum|count|avg|min|max)\([^)]+\)|[a-z_][a-z0-9_.]*)/gi,
          (match, left, right) => {
            changed = true;
            return `${left} / NULLIF(${right}, 0)`;
          },
        );
  return { sql: updated, changed };
}

function sumNullRewrite(sql: string): { sql: string; changed: boolean } {
  let changed = false;
  const updated = sql.replace(/\bSUM\(([^)]+)\)/gi, (match, expr) => {
    if (/COALESCE\s*\(/i.test(match)) return match;
    changed = true;
    return `COALESCE(SUM(${expr}), 0)`;
  });
  return { sql: updated, changed };
}

function parseKpi(input: string): Record<string, string> {
  const out: Record<string, string> = {
    name: "",
    definition: "",
    formula: "",
    grain: "",
    assumptions: "",
  };
  input.split(/\r?\n/).forEach((line) => {
    const [key, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    if (!value) return;
    const normalized = key.trim().toLowerCase();
    if (normalized === "kpi name") out.name = value;
    if (normalized === "definition") out.definition = value;
    if (normalized === "formula") out.formula = value;
    if (normalized === "grain") out.grain = value;
    if (normalized === "assumptions") out.assumptions = value;
  });
  if (!out.definition && input.trim()) out.definition = input.trim();
  return out;
}

function sqlRewrite(input: GenerateRewriteInput): RewriteOutput {
  let rewritten = input.input.trim();
  const changes: string[] = [];
  const safetyReasons: string[] = [];
  const tradeoffNotes: string[] = [];
  const expectedBehavior: string[] = [];
  const addressed: string[] = [];
  const lowerMode = input.mode.toLowerCase();

  const sqlDialect = input.sqlDialect ?? "postgres";
  const sqlSafetyRules = input.sqlSafetyRules ?? {
    divisionByZeroProtection: true,
    nullHandlingEnforcement: true,
    joinDuplicationDetection: true,
    groupByConsistencyCheck: true,
    distinctMisuseDetection: true,
  };
  const hasDivisionFinding = input.findings.some((f) =>
    /division|denominator/i.test(f.title),
  );
  if (
    (lowerMode.includes("safer") || lowerMode.includes("production")) &&
    hasDivisionFinding &&
    sqlSafetyRules.divisionByZeroProtection
  ) {
    const result = safeDivisionRewrite(rewritten, sqlDialect);
    rewritten = result.sql;
    if (result.changed) {
      changes.push(
        sqlDialect === "bigquery"
          ? "Added denominator protection using SAFE_DIVIDE for ratio expressions."
          : "Added denominator protection using NULLIF for ratio expressions.",
      );
      tradeoffNotes.push(
        sqlDialect === "bigquery"
          ? "SAFE_DIVIDE returns NULL when denominator is 0 — confirm downstream handling of NULL ratios."
          : "NULLIF returns NULL when denominator is 0 — confirm downstream handling of NULL ratios.",
      );
      safetyReasons.push("Prevents division-by-zero runtime errors in grouped metrics.");
      expectedBehavior.push("Ratio calculations should not fail when denominator groups are zero.");
      addressed.push(
        ...input.findings.filter((f) => /division|denominator/i.test(f.title)).map((f) => f.id),
      );
    }
  } else if (hasDivisionFinding && !sqlSafetyRules.divisionByZeroProtection) {
    changes.push("[Rule disabled via settings] Division by zero protection");
  }

  const hasNullFinding = input.findings.some((f) => /null/i.test(f.title));
  if (
    (lowerMode.includes("safer") || lowerMode.includes("production")) &&
    hasNullFinding &&
    sqlSafetyRules.nullHandlingEnforcement
  ) {
    const result = sumNullRewrite(rewritten);
    rewritten = result.sql;
    if (result.changed) {
      changes.push("Added explicit null-safe aggregation with COALESCE on SUM expressions.");
      safetyReasons.push("Ensures null values do not silently suppress aggregate outputs.");
      tradeoffNotes.push(
        "COALESCE defaults missing values to 0 — confirm this aligns with business expectations.",
      );
      expectedBehavior.push("Aggregate metrics should remain stable when source values are null.");
      addressed.push(...input.findings.filter((f) => /null/i.test(f.title)).map((f) => f.id));
    }
  } else if (hasNullFinding && !sqlSafetyRules.nullHandlingEnforcement) {
    changes.push("[Rule disabled via settings] NULL handling enforcement");
  }

  const hasJoinFinding = input.findings.some((f) => /join|duplication|row multiplication/i.test(f.title));
  const hasJoinRisk = input.findings.some(isJoinRiskFinding);
  if ((hasJoinRisk || hasJoinFinding) && sqlSafetyRules.joinDuplicationDetection) {
    rewritten = insertJoinWarning(rewritten);
    if (!changes.includes("Flagged or mitigated join duplication risk.")) {
      changes.push("Flagged or mitigated join duplication risk.");
    }
    if (!/SUGGESTED PRE-AGGREGATION:/i.test(rewritten)) {
      rewritten = `${rewritten}\n\n-- SUGGESTED PRE-AGGREGATION:\n-- WITH joined_table_agg AS (\n--   SELECT join_key, COUNT(*) AS row_count\n--   FROM joined_table\n--   GROUP BY join_key\n-- )`;
      changes.push("Added pre-aggregation guidance to reduce join-duplication risk.");
    }
    if (
      !safetyReasons.includes(
        "Highlights or reduces join-driven row duplication that could inflate results.",
      )
    ) {
      safetyReasons.push(
        "Highlights or reduces join-driven row duplication that could inflate results.",
      );
    }
    expectedBehavior.push("Each business key should have expected cardinality in final output.");
    addressed.push(
      ...input.findings.filter(isJoinRiskFinding).map((f) => f.id),
    );
  } else if ((hasJoinRisk || hasJoinFinding) && !sqlSafetyRules.joinDuplicationDetection) {
    changes.push("[Rule disabled via settings] Join duplication detection");
  }

  if (lowerMode.includes("cleaner") || lowerMode.includes("production")) {
    const formatted = upperKeywords(rewritten);
    if (formatted !== rewritten) {
      rewritten = formatted;
      changes.push("Standardized SQL readability with consistent keyword casing.");
    }
  }
  rewritten = formatSqlLayout(rewritten);

  if (changes.length === 0) {
    changes.push("Kept business logic stable and provided a clearer review-ready structure.");
    safetyReasons.push("Improves readability without changing business intent.");
  }

  const confidence = calcConfidence(input.findings, [...new Set(addressed)]);

  return {
    artifactType: input.artifactType,
    mode: input.mode,
    original: input.input,
    rewritten,
    changes,
    safetyReasons,
    tradeoffNotes,
    expectedBehavior,
    confidenceLabel: confidence.label,
    confidenceDetail: confidence.detail,
    addressedFindingIds: [...new Set(addressed)],
    contextEnhanced: Boolean(input.context),
    generatedAt: new Date().toISOString(),
    targetBatchQueryId: input.targetBatchQueryId,
    targetBatchQueryLabel: input.targetBatchQueryLabel,
  };
}

function kpiRewrite(input: GenerateRewriteInput): RewriteOutput {
  const kpi = parseKpi(input.input);
  const changes: string[] = [];
  const safetyReasons: string[] = [];
  const tradeoffNotes: string[] = [];
  const expectedBehavior: string[] = [];
  const addressed: string[] = [];
  const lowerMode = input.mode.toLowerCase();

  const title = kpi.name || "KPI";
  const sourceHint = input.context?.schema?.tables
    ? `Candidate source tables: ${Object.keys(input.context.schema.tables).slice(0, 3).join(", ")}.`
    : "Source-of-truth table is not yet specified.";
  const rewritten = [
    `KPI Name: ${title}`,
    `Definition: ${kpi.definition || "Clearly define the business objective and intended use."}`,
    `Formula: ${kpi.formula || "Specify numerator and denominator explicitly (e.g., purchases / visits)."}`,
    `Grain: ${kpi.grain || "Define output grain (e.g., one row per account per month)."}`,
    `Source of Truth: ${sourceHint}`,
    "Baseline Handling: Define behavior when prior/baseline values are zero, missing, or delayed.",
    "Negative Baseline Policy: Define interpretation rules when baseline values are negative.",
    "Comparison Window: Define exact comparison period boundaries (e.g., previous completed month).",
    `Exclusions: Document excluded events/populations and why they are excluded.`,
    `Assumptions: ${kpi.assumptions || "Document edge-case handling, late data policy, and refresh cadence."}`,
  ].join("\n");

  if (input.findings.some((f) => /denominator/i.test(f.title))) {
    changes.push("Made denominator scope explicit for metric reliability.");
    safetyReasons.push("Reduces denominator ambiguity that can shift KPI interpretation.");
    expectedBehavior.push("Numerator and denominator should be interpreted consistently across teams.");
    addressed.push(...input.findings.filter((f) => /denominator/i.test(f.title)).map((f) => f.id));
  }
  if (input.findings.some((f) => /grain/i.test(f.title))) {
    changes.push("Clarified metric grain and reporting level.");
    safetyReasons.push("Aligns KPI grain with reporting expectations and downstream usage.");
    expectedBehavior.push("Reported KPI rows should align with the declared grain.");
    addressed.push(...input.findings.filter((f) => /grain/i.test(f.title)).map((f) => f.id));
  }
  if (input.findings.some((f) => /source/i.test(f.title))) {
    changes.push("Added source-of-truth expectation for governance readiness.");
    safetyReasons.push("Improves governance traceability for audit and ownership.");
    expectedBehavior.push("Metric source ownership and lineage should be auditable.");
    addressed.push(...input.findings.filter((f) => /source/i.test(f.title)).map((f) => f.id));
  }
  if (input.findings.some((f) => /denominator|divide|baseline/i.test(f.title))) {
    changes.push("Added explicit baseline denominator policy for zero and missing values.");
    safetyReasons.push("Prevents ambiguous growth-rate behavior when baseline values are missing or zero.");
    expectedBehavior.push("Growth KPI behavior remains consistent for zero or missing baseline periods.");
    tradeoffNotes.push(
      "Baseline fallback policy can change reported growth rates; confirm policy with business owners.",
    );
    addressed.push(
      ...input.findings.filter((f) => /denominator|divide|baseline/i.test(f.title)).map((f) => f.id),
    );
  }
  if (input.findings.some((f) => /negative baseline/i.test(f.title))) {
    changes.push("Documented negative-baseline interpretation guidance.");
    safetyReasons.push("Improves interpretability for periods where baseline values are negative.");
    expectedBehavior.push("Stakeholders can interpret growth % consistently under negative baseline conditions.");
    addressed.push(...input.findings.filter((f) => /negative baseline/i.test(f.title)).map((f) => f.id));
  }
  if (input.findings.some((f) => /comparison window/i.test(f.title))) {
    changes.push("Specified comparison-window definition requirements.");
    safetyReasons.push("Reduces KPI drift from inconsistent prior-period window logic.");
    expectedBehavior.push("Prior-period comparisons are reproducible across reporting runs.");
    addressed.push(...input.findings.filter((f) => /comparison window/i.test(f.title)).map((f) => f.id));
  }
  if (lowerMode.includes("stakeholder")) {
    changes.push("Simplified language for stakeholder readability.");
  }
  if (changes.length === 0) {
    changes.push("Restructured KPI definition into a governance-ready specification template.");
    safetyReasons.push("Makes KPI definition easier to review and operationalize.");
  }
  const confidence = calcConfidence(input.findings, [...new Set(addressed)]);

  return {
    artifactType: input.artifactType,
    mode: input.mode,
    original: input.input,
    rewritten,
    changes,
    safetyReasons,
    tradeoffNotes,
    expectedBehavior,
    confidenceLabel: confidence.label,
    confidenceDetail: confidence.detail,
    addressedFindingIds: [...new Set(addressed)],
    contextEnhanced: Boolean(input.context),
    generatedAt: new Date().toISOString(),
  };
}

function narrativeRewrite(input: GenerateRewriteInput): RewriteOutput {
  const original = input.input.trim();
  const firstSentence =
    original.split(/[.!?]\s/).find((line) => line.trim().length > 8)?.trim() ?? original;
  const changes: string[] = [];
  const safetyReasons: string[] = [];
  const tradeoffNotes: string[] = [];
  const expectedBehavior: string[] = [];
  const addressed: string[] = [];
  const lowerMode = input.mode.toLowerCase();
  const concise = lowerMode.includes("concise");

  const rewritten = concise
    ? [
        `Impact: ${firstSentence || "State the quantified business impact here."}`,
        "Recommendation: Define one concrete action with owner and timeline.",
      "Confidence: State confidence level and key uncertainty.",
    ].join("\n")
    : [
        "Summary:",
        `${firstSentence || "Describe the core issue and quantified impact."}`,
        "",
        "Recommendation:",
        "Define a concrete action, owner, and expected outcome.",
        "",
        "Confidence and Next Step:",
      "State confidence level, evidence basis, and immediate next-step decision.",
    ].join("\n");

  let adjustedRewrite = rewritten;

  if (input.findings.some((f) => /impact/i.test(f.title))) {
    changes.push("Made impact statement more explicit and decision-ready.");
    safetyReasons.push("Improves decision quality by clarifying expected business impact.");
    expectedBehavior.push("Stakeholders should understand impact magnitude and urgency.");
    addressed.push(...input.findings.filter((f) => /impact/i.test(f.title)).map((f) => f.id));
  }
  if (input.findings.some((f) => /recommend/i.test(f.title))) {
    changes.push("Converted vague recommendation into an actionable next step.");
    safetyReasons.push("Increases execution readiness with clearer ownership and action.");
    expectedBehavior.push("Decision owners should be able to act immediately on the recommendation.");
    addressed.push(...input.findings.filter((f) => /recommend/i.test(f.title)).map((f) => f.id));
  }
  if (input.findings.some((f) => /confidence/i.test(f.title))) {
    changes.push("Added confidence framing for stakeholder interpretation.");
    safetyReasons.push("Prevents overconfidence and clarifies uncertainty for stakeholders.");
    expectedBehavior.push("Confidence and uncertainty should be explicit in decision communication.");
    addressed.push(...input.findings.filter((f) => /confidence/i.test(f.title)).map((f) => f.id));
  }
  if (input.findings.some((f) => /causal relationship is asserted without supporting evidence/i.test(f.title))) {
    changes.push("Softened unsupported causality language to evidence-aware phrasing.");
    safetyReasons.push("Reduces overclaim risk when causal proof is not documented.");
    expectedBehavior.push("Narrative should present correlation unless causal evidence is explicitly provided.");
    adjustedRewrite = adjustedRewrite.replace(/\bbecause\b/gi, "is likely associated with");
    addressed.push(
      ...input.findings
        .filter((f) => /causal relationship is asserted without supporting evidence/i.test(f.title))
        .map((f) => f.id),
    );
  }
  if (input.findings.some((f) => /recommendation is not actionable/i.test(f.title))) {
    changes.push("Strengthened recommendation into a concrete action statement.");
    safetyReasons.push("Improves execution readiness and ownership clarity.");
    expectedBehavior.push("Stakeholders should see a clear next step, owner, and timeline.");
    addressed.push(...input.findings.filter((f) => /recommendation is not actionable/i.test(f.title)).map((f) => f.id));
  }
  if (input.findings.some((f) => /metric is not clearly defined/i.test(f.title))) {
    changes.push("Added metric-definition clarity guidance in narrative structure.");
    safetyReasons.push("Improves interpretation consistency for business stakeholders.");
    addressed.push(...input.findings.filter((f) => /metric is not clearly defined/i.test(f.title)).map((f) => f.id));
  }
  if (changes.length === 0) {
    changes.push("Improved narrative clarity and actionability while preserving intent.");
    safetyReasons.push("Improves readability and stakeholder comprehension.");
  }
  const confidence = calcConfidence(input.findings, [...new Set(addressed)]);

  return {
    artifactType: input.artifactType,
    mode: input.mode,
    original: input.input,
    rewritten: adjustedRewrite,
    changes,
    safetyReasons,
    tradeoffNotes,
    expectedBehavior,
    confidenceLabel: confidence.label,
    confidenceDetail: confidence.detail,
    addressedFindingIds: [...new Set(addressed)],
    contextEnhanced: Boolean(input.context),
    generatedAt: new Date().toISOString(),
  };
}

export function generateArtifactRewrite(input: GenerateRewriteInput): RewriteOutput {
  if (input.artifactType === "SQL Query" || input.artifactType === "Batch Review") {
    return sqlRewrite(input);
  }
  if (input.artifactType === "KPI Definition") {
    return kpiRewrite(input);
  }
  return narrativeRewrite(input);
}
