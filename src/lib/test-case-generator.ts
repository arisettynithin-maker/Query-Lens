import type { ArtifactType } from "@/components/review/review-session-provider";
import type { ParsedReviewContext } from "@/types/review-context";
import type { BatchQueryUnit, SqlFinding } from "@/types/sql-review";
import type { ValidationTestCase } from "@/types/test-cases";

type GenerateTestCasesInput = {
  artifactType: ArtifactType;
  findings: SqlFinding[];
  context: ParsedReviewContext | null;
  artifactInput?: string;
  batchQueries?: BatchQueryUnit[];
  settings?: {
    sqlDialect: "postgres" | "bigquery" | "redshift" | "mysql";
    sqlSafetyRules: {
      divisionByZeroProtection: boolean;
      nullHandlingEnforcement: boolean;
      joinDuplicationDetection: boolean;
      groupByConsistencyCheck: boolean;
      distinctMisuseDetection: boolean;
    };
  };
};

type JoinKey = { left: string; right: string };
type JoinInfo = { table: string; alias: string; condition: string; keys: JoinKey[] };
type QueryShape = {
  baseTable: string;
  baseAlias: string;
  joins: JoinInfo[];
  groupByColumns: string[];
  selectedColumns: string[];
  denominatorExpression: string | null;
  nullableColumns: string[];
};

function clean(value: string): string {
  return value.trim().replace(/[`"]/g, "");
}

function riskGroupFromFinding(finding: SqlFinding): ValidationTestCase["riskGroup"] {
  const title = finding.title.toLowerCase();
  if (title.includes("grain") || title.includes("definition") || title.includes("narrative")) {
    return "Metric Interpretation Risks";
  }
  if (title.includes("null") || title.includes("denominator") || title.includes("division")) {
    return "Data Quality Risks";
  }
  return "Critical Logic Risks";
}

function findingMeta(finding: SqlFinding) {
  return {
    linkedFindingId: finding.id,
    linkedFindingTitle: finding.title,
    linkedFindingSummary: finding.description,
    linkedFindingSeverity: finding.type,
    contextUsed: Boolean(finding.contextUsed || finding.context_used),
    contextReason: finding.contextReason ?? finding.context_reason,
  };
}

function parseQueryShape(sql: string, context: ParsedReviewContext | null): QueryShape {
  const source = sql.replace(/\r\n/g, "\n");
  const from =
    /\bfrom\s+([a-z0-9_."`]+)(?:\s+(?:as\s+)?([a-z0-9_]+))?/i.exec(source) ?? [];
  const baseTable = clean(from[1] ?? "source_table");
  const baseAlias = clean(from[2] ?? from[1] ?? "t");

  const joins: JoinInfo[] = [];
  const joinRegex = /\bjoin\s+([a-z0-9_."`]+)(?:\s+(?:as\s+)?([a-z0-9_]+))?\s+on\s+([^\n;]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = joinRegex.exec(source)) !== null) {
    const table = clean(match[1]);
    const alias = clean(match[2] ?? match[1]);
    const condition = match[3]?.trim() ?? "";
    const keys: JoinKey[] = [];
    const keyRegex =
      /([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)\s*=\s*([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)/gi;
    let key: RegExpExecArray | null;
    while ((key = keyRegex.exec(condition)) !== null) {
      keys.push({ left: key[1], right: key[2] });
    }
    joins.push({ table, alias, condition, keys });
  }

  const groupByColumns: string[] = [];
  const groupBy = /\bgroup\s+by\s+([\s\S]*?)(?:\border\s+by\b|\blimit\b|$)/i.exec(source);
  if (groupBy?.[1]) {
    groupBy[1]
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
      .forEach((v) => groupByColumns.push(v));
  }

  const selectCols: string[] = [];
  const selectMatch = /\bselect\s+([\s\S]*?)\bfrom\b/i.exec(source);
  if (selectMatch?.[1]) {
    selectMatch[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((s) => {
        if (!/(sum|count|avg|min|max)\s*\(/i.test(s)) {
          selectCols.push(s.replace(/\s+as\s+[a-z_][a-z0-9_]*$/i, "").trim());
        }
      });
  }

  const denominatorMatch =
    /(sum\([^)]+\)|count\([^)]+\)|avg\([^)]+\)|[a-z_][a-z0-9_.]*)\s*\/\s*(?:nullif\()?(sum\([^)]+\)|count\([^)]+\)|avg\([^)]+\)|[a-z_][a-z0-9_.]*)/i.exec(
      source,
    );
  const denominatorExpression = denominatorMatch?.[2] ?? null;

  const nullableColumns: string[] = [];
  for (const [tableName, tableMeta] of Object.entries(context?.schema?.tables ?? {})) {
    for (const [columnName, columnMeta] of Object.entries(tableMeta.columns ?? {})) {
      if (columnMeta.nullable) nullableColumns.push(`${tableName}.${columnName}`);
    }
  }

  return {
    baseTable,
    baseAlias,
    joins,
    groupByColumns,
    selectedColumns: selectCols,
    denominatorExpression,
    nullableColumns,
  };
}

function chooseMetricGrain(shape: QueryShape): string[] {
  const candidates = (shape.groupByColumns.length ? shape.groupByColumns : shape.selectedColumns).map(clean);
  if (candidates.length <= 1) return candidates.length ? candidates : [`${shape.baseAlias}.id`];

  const broad = candidates.filter((col) =>
    /(user_id|customer_id|account_id|session_id|day|week|month|date|region|country|segment)$/i.test(
      col,
    ),
  );
  if (broad.length > 0) return broad;

  const withoutRecordIds = candidates.filter(
    (col) => !/(order_id|payment_id|transaction_id|line_id)$/i.test(col),
  );
  return withoutRecordIds.length > 0 ? withoutRecordIds : [candidates[0]];
}

function makeId(prefix: string, index: number): string {
  return `${prefix}-${String(index + 1).padStart(3, "0")}`;
}

function baseCase(
  artifactType: ArtifactType,
  finding: SqlFinding,
  index: number,
): ValidationTestCase {
  return {
    id: makeId("TC", index),
    title: finding.title,
    artifactType,
    riskGroup: riskGroupFromFinding(finding),
    priority: finding.type,
    category: finding.category,
    whatToValidate: finding.title,
    objective: finding.title,
    whyItMatters: finding.description,
    validationSteps: [],
    expectedOutcome: "Risk is addressed before release.",
    whatToDoIfItFails: finding.recommendation,
    status: "Not started",
    notes: "",
    ...findingMeta(finding),
  };
}

function sqlCaseFromFinding(
  finding: SqlFinding,
  sql: string,
  context: ParsedReviewContext | null,
  index: number,
  dialect: "postgres" | "bigquery" | "redshift" | "mysql",
): ValidationTestCase {
  const shape = parseQueryShape(sql, context);
  const title = finding.title.toLowerCase();
  const grain = chooseMetricGrain(shape);
  const grainExpr = grain.join(", ");

  if (title.includes("division") || title.includes("denominator")) {
    const denom = shape.denominatorExpression ?? "COUNT(*)";
    const safeExpr =
      dialect === "bigquery"
        ? `SAFE_DIVIDE(numerator_value, ${denom})`
        : `numerator_value / NULLIF(${denom}, 0)`;
    return {
      ...baseCase("SQL Query", finding, index),
      id: makeId("TC-SQL", index),
      riskGroup: "Data Quality Risks",
      title: "Check denominator safety at metric grain",
      whatToValidate: `Check that ${denom} is never zero at ${grainExpr}.`,
      whyItMatters: "Zero denominators can break KPI logic or produce unstable rates.",
      validationSQL: [
        `SELECT ${grainExpr}, ${denom} AS denominator_value`,
        `FROM ${shape.baseTable} ${shape.baseAlias}`,
        `GROUP BY ${grainExpr}`,
        `HAVING ${denom} = 0;`,
      ].join("\n"),
      expectedOutcome: `No groups at ${grainExpr} return ${denom} = 0.`,
      whatToDoIfItFails:
        dialect === "bigquery"
          ? `Use ${safeExpr} or update metric scope filters.`
          : `Protect denominator with NULLIF(${denom}, 0) or update metric scope filters.`,
    };
  }

  if (title.includes("join") || title.includes("duplication") || title.includes("row multiplication")) {
    const join = shape.joins[0];
    const key = join?.keys[0];
    const leftKey = key?.left ?? `${shape.baseAlias}.id`;
    const rightKey = key?.right ?? `${join?.alias ?? "j"}.id`;
    const grainCol =
      shape.groupByColumns.find((col) => /(order_id|account_id|user_id|customer_id)/i.test(col)) ??
      leftKey;
    const joinSnippet = join
      ? `JOIN ${join.table} ${join.alias} ON ${join.condition}`
      : "/* join detected in source query */";
    return {
      ...baseCase("SQL Query", finding, index),
      id: makeId("TC-SQL", index),
      riskGroup: "Critical Logic Risks",
      title: "Validate joins do not create row duplication",
      priority: finding.type === "MEDIUM" || finding.type === "LOW" ? "HIGH" : finding.type,
      whatToValidate: `Validate uniqueness of ${leftKey} and ${rightKey} before merge.`,
      whyItMatters: "Join duplication inflates totals and can silently distort released metrics.",
      validationSQL: [
        `SELECT ${grainCol}, COUNT(*) AS row_count`,
        `FROM ${shape.baseTable} ${shape.baseAlias}`,
        `${joinSnippet}`,
        `GROUP BY ${grainCol}`,
        "HAVING COUNT(*) > 1;",
      ].join("\n"),
      expectedOutcome: "No duplicated rows at output grain after join.",
      whatToDoIfItFails:
        "Pre-aggregate one side, use a record-level key, or deduplicate before the join.",
    };
  }

  if (title.includes("null")) {
    const nullableCol =
      shape.nullableColumns.find((col) => col.startsWith(`${shape.baseTable}.`)) ??
      shape.nullableColumns[0] ??
      `${shape.baseAlias}.revenue`;
    const col = nullableCol.split(".")[1] ?? "value";
    return {
      ...baseCase("SQL Query", finding, index),
      id: makeId("TC-SQL", index),
      riskGroup: "Data Quality Risks",
      title: "Check null impact on metric output",
      whatToValidate: `Check null frequency for ${col} and how it affects final metrics.`,
      whyItMatters: "Unmanaged nulls can undercount business activity or hide data quality issues.",
      validationSQL: [
        "SELECT",
        "  COUNT(*) AS total_rows,",
        `  COUNT(CASE WHEN ${col} IS NULL THEN 1 END) AS null_${col}_rows`,
        `FROM ${shape.baseTable};`,
      ].join("\n"),
      expectedOutcome: "Null handling is explicit and aligned with business rules.",
      whatToDoIfItFails: "Use COALESCE/default rules or adjust exclusions and document null policy.",
    };
  }

  if (title.includes("grain")) {
    return {
      ...baseCase("SQL Query", finding, index),
      id: makeId("TC-SQL", index),
      riskGroup: "Metric Interpretation Risks",
      title: "Check metric grain matches grouped output",
      whatToValidate: `Confirm grouped output reflects intended grain (${grainExpr}).`,
      whyItMatters: "Wrong grain creates misleading business conclusions.",
      validationSQL: [
        `SELECT ${grainExpr}, COUNT(*) AS rows_at_grain`,
        "FROM (",
        sql.trim(),
        ") reviewed_query",
        `GROUP BY ${grainExpr}`,
        "HAVING COUNT(*) > 1;",
      ].join("\n"),
      expectedOutcome: "Each grain key maps to one logical output row.",
      whatToDoIfItFails: "Align selected columns and GROUP BY with intended business grain.",
    };
  }

  return baseCase("SQL Query", finding, index);
}

function parseKpiFields(input: string): Record<string, string> {
  const out: Record<string, string> = { name: "", definition: "", formula: "", grain: "", assumptions: "" };
  input.split(/\r?\n/).forEach((line) => {
    const [k, ...rest] = line.split(":");
    const key = k?.trim().toLowerCase();
    const val = rest.join(":").trim();
    if (!val) return;
    if (key === "kpi name") out.name = val;
    if (key === "definition") out.definition = val;
    if (key === "formula") out.formula = val;
    if (key === "grain") out.grain = val;
    if (key === "assumptions") out.assumptions = val;
  });
  return out;
}

function kpiCaseFromFinding(finding: SqlFinding, input: string, index: number): ValidationTestCase {
  const kpi = parseKpiFields(input);
  const name = kpi.name || "this KPI";
  const lower = finding.title.toLowerCase();
  const formula = kpi.formula || "formula";
  const what = lower.includes("denominator") || lower.includes("divide")
    ? `Validate baseline denominator behavior in ${formula}, including zero and null cases.`
    : lower.includes("baseline")
      ? `Validate prior-period baseline assumptions for ${name} are explicitly documented and testable.`
      : lower.includes("comparison window")
        ? `Validate comparison window rules for ${name} (period boundary, cutoff, and missing baseline handling).`
        : lower.includes("negative baseline")
          ? `Validate how ${name} should behave when baseline values are negative.`
    : lower.includes("numerator")
      ? `Verify numerator definition for ${name} is explicit and scoped.`
    : lower.includes("grain")
      ? `Verify ${name} grain is consistent with the definition and formula.`
      : `Verify ${name} definition is release-ready and unambiguous.`;
  const validationSQL =
    lower.includes("denominator") || lower.includes("baseline")
      ? [
          "-- Example validation query template",
          "-- Replace table/columns with your KPI source",
          "SELECT",
          "  period_key,",
          "  baseline_value,",
          "  CASE WHEN baseline_value = 0 THEN 1 ELSE 0 END AS is_zero_baseline,",
          "  CASE WHEN baseline_value IS NULL THEN 1 ELSE 0 END AS is_missing_baseline",
          "FROM kpi_source_table;",
        ].join("\n")
      : undefined;
  const fixIfFails =
    lower.includes("denominator") || lower.includes("baseline")
      ? "Document zero, missing, and negative baseline policy directly in KPI definition and formula guidance."
      : "Clarify KPI scope, grain, exclusions, time window, and source-of-truth before release.";
  return {
    ...baseCase("KPI Definition", finding, index),
    id: makeId("TC-KPI", index),
    riskGroup: "Metric Interpretation Risks",
    title: `Review ${name} definition quality`,
    whatToValidate: what,
    whyItMatters: finding.description,
    expectedOutcome: `${name} can be implemented consistently without interpretation gaps.`,
    validationSQL,
    whatToDoIfItFails: fixIfFails,
  };
}

function narrativeCaseFromFinding(finding: SqlFinding, input: string, index: number): ValidationTestCase {
  const snippet = input.split(/[.!?]\s/).find((p) => p.trim().length > 8)?.trim() ?? "";
  const lower = finding.title.toLowerCase();
  const what = lower.includes("causal")
    ? "Validate that causal claims are supported by explicit evidence."
    : lower.includes("impact")
      ? "Validate that impact is quantified, not just described."
      : lower.includes("metric")
        ? "Validate that each metric term is clearly defined."
        : lower.includes("ambiguous")
          ? "Validate that vague wording is replaced with measurable language."
          : lower.includes("recommend")
            ? "Validate the recommendation includes a concrete next action."
            : lower.includes("confidence")
              ? "Validate confidence level is explicitly stated."
              : "Validate claims are supported by clear evidence.";
  return {
    ...baseCase("Narrative", finding, index),
    id: makeId("TC-NAR", index),
    riskGroup: "Metric Interpretation Risks",
    title: "Strengthen narrative decision quality",
    whatToValidate: what,
    whyItMatters: snippet ? `Narrative sample: "${snippet.slice(0, 100)}${snippet.length > 100 ? "..." : ""}"` : finding.description,
    expectedOutcome: "Narrative is specific, evidence-backed, and decision-ready.",
    whatToDoIfItFails: "Rewrite with quantified impact, explicit ask, and confidence framing.",
  };
}

function preserveProgress(next: ValidationTestCase[], existing: ValidationTestCase[]): ValidationTestCase[] {
  const map = new Map(existing.map((t) => [`${t.linkedFindingId ?? "none"}:${t.title}:${t.linkedQueryId ?? "none"}`, t]));
  return next.map((t) => {
    const prior = map.get(`${t.linkedFindingId ?? "none"}:${t.title}:${t.linkedQueryId ?? "none"}`);
    return prior ? { ...t, status: prior.status, notes: prior.notes } : t;
  });
}

function addMandatoryJoinTest(
  artifactType: ArtifactType,
  sql: string,
  context: ParsedReviewContext | null,
  existing: ValidationTestCase[],
  joinRuleEnabled: boolean,
  uniqueSuffix: string,
): ValidationTestCase[] {
  if (!joinRuleEnabled) return existing;
  const shape = parseQueryShape(sql, context);
  if (shape.joins.length === 0) return existing;
  const already = existing.some((t) => t.title === "Validate joins do not create row duplication");
  if (already) return existing;
  const join = shape.joins[0];
  const key = join.keys[0];
  const grainCol =
    shape.groupByColumns.find((c) => /(order_id|account_id|user_id|customer_id)/i.test(c)) ??
    key?.left ??
    `${shape.baseAlias}.id`;
  return [
    ...existing,
    {
      id: `TC-SQL-JOIN-${uniqueSuffix}`,
      artifactType,
      riskGroup: "Critical Logic Risks",
      title: "Validate joins do not create row duplication",
      linkedFindingId: null,
      linkedFindingTitle: "Proactive join duplication check",
      linkedFindingSummary: "Mandatory pre-release join duplication validation.",
      linkedFindingSeverity: "HIGH",
      priority: "HIGH",
      category: "logic",
      whatToValidate: `Check duplicate output rows at ${grainCol} after join.`,
      objective: "Check duplicate output rows at join grain.",
      whyItMatters: "Even without an explicit finding, join blowups can still slip into release.",
      validationSteps: [],
      expectedOutcome: "No duplicate rows are produced by the join.",
      validationSQL: [
        `SELECT ${grainCol}, COUNT(*) AS row_count`,
        `FROM ${shape.baseTable} ${shape.baseAlias}`,
        `JOIN ${join.table} ${join.alias} ON ${join.condition}`,
        `GROUP BY ${grainCol}`,
        "HAVING COUNT(*) > 1;",
      ].join("\n"),
      whatToDoIfItFails: "Deduplicate or pre-aggregate before join; verify expected cardinality.",
      status: "Not started",
      notes: "",
      contextUsed: Boolean(context),
    },
  ];
}

export function generateSessionTestCases(
  input: GenerateTestCasesInput,
  existing: ValidationTestCase[] = [],
): ValidationTestCase[] {
  const { artifactType, findings, context, artifactInput = "", batchQueries = [], settings } = input;
  const dialect = settings?.sqlDialect ?? "postgres";
  const sqlRules = settings?.sqlSafetyRules ?? {
    divisionByZeroProtection: true,
    nullHandlingEnforcement: true,
    joinDuplicationDetection: true,
    groupByConsistencyCheck: true,
    distinctMisuseDetection: true,
  };

  if (artifactType === "Batch Review") {
    const generated: ValidationTestCase[] = [];
    batchQueries.forEach((q, qi) => {
      let queryCases: ValidationTestCase[] = q.findings.map((finding, fi) => {
        const row = sqlCaseFromFinding(finding, q.sql, context, fi, dialect);
        return {
          ...row,
          id: `TC-BATCH-Q${String(qi + 1).padStart(2, "0")}-${String(fi + 1).padStart(3, "0")}`,
          artifactType: "Batch Review" as const,
          linkedQueryId: q.id,
          linkedQueryLabel: q.label,
        };
      });
      queryCases = addMandatoryJoinTest(
        "Batch Review",
        q.sql,
        context,
        queryCases,
        sqlRules.joinDuplicationDetection,
        `${qi + 1}-${q.id}`,
      );
      generated.push(...queryCases);
    });
    const issueCounts = new Map<string, number>();
    for (const query of batchQueries) {
      const dedupInQuery = new Set<string>();
      for (const finding of query.findings) {
        const key = finding.title.toLowerCase();
        if (dedupInQuery.has(key)) continue;
        dedupInQuery.add(key);
        issueCounts.set(key, (issueCounts.get(key) ?? 0) + 1);
      }
    }
    issueCounts.forEach((count, issueTitle) => {
      if (count < 2) return;
      generated.push({
        id: `TC-BATCH-SYS-${generated.length + 1}`,
        artifactType: "Batch Review",
        riskGroup: "Critical Logic Risks",
        title: `Systemic issue check: ${issueTitle}`,
        linkedFindingId: null,
        linkedFindingTitle: "Systemic issue detected across multiple queries",
        linkedFindingSummary: `${count} queries show the same issue pattern.`,
        linkedFindingSeverity: count >= 3 ? "HIGH" : "MEDIUM",
        priority: count >= 3 ? "HIGH" : "MEDIUM",
        category: "release_readiness",
        whatToValidate: `Validate root cause of "${issueTitle}" across all affected queries before release.`,
        objective: "Prevent repeated logic defects across batch release scope.",
        whyItMatters: "Recurring issue patterns usually indicate systemic design or data-model problems.",
        validationSteps: [],
        expectedOutcome: "The repeated issue is addressed consistently across affected queries.",
        whatToDoIfItFails:
          "Apply a shared fix pattern, rerun batch review, and confirm the issue count decreases.",
        status: "Not started",
        notes: "",
        contextUsed: Boolean(context),
      });
    });
    return preserveProgress(generated, existing);
  }

  if (findings.length === 0) {
    return preserveProgress(
      [
        {
          id: "TC-READY-001",
          artifactType,
          riskGroup: "Metric Interpretation Risks",
          title: "Final release readiness check",
          linkedFindingId: null,
          linkedFindingTitle: "No findings in latest review",
          linkedFindingSummary: "Use this check to confirm release readiness before shipping.",
          linkedFindingSeverity: "LOW",
          priority: "LOW",
          category: "structure",
          whatToValidate: "Confirm reviewed input and business intent are still aligned for release.",
          objective: "Confirm release readiness",
          whyItMatters: "A clean review still needs analyst sign-off and traceability.",
          validationSteps: [],
          expectedOutcome: "Artifact is approved for release with documented analyst validation.",
          whatToDoIfItFails: "Re-run review after updates and capture sign-off notes before release.",
          status: "Not started",
          notes: "",
          contextUsed: Boolean(context),
        },
      ],
      existing,
    );
  }

  let generated = findings.map((finding, i) => {
    if (artifactType === "SQL Query") return sqlCaseFromFinding(finding, artifactInput, context, i, dialect);
    if (artifactType === "KPI Definition") return kpiCaseFromFinding(finding, artifactInput, i);
    if (artifactType === "Narrative") return narrativeCaseFromFinding(finding, artifactInput, i);
    return baseCase(artifactType, finding, i);
  });

  if (artifactType === "SQL Query") {
    generated = addMandatoryJoinTest(
      "SQL Query",
      artifactInput,
      context,
      generated,
      sqlRules.joinDuplicationDetection,
      "single",
    );
  }

  return preserveProgress(generated, existing);
}
