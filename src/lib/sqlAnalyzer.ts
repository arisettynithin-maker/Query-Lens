import type { SqlFinding } from "@/types/sql-review";
import type { ParsedReviewContext } from "@/types/review-context";

type FindingDraft = Omit<SqlFinding, "id">;

type JoinSegment = {
  joinIndex: number;
  joinLine: number;
  joinTable: string;
  joinAlias: string;
  onClause: string;
};

type TableAliasMap = Record<string, string>;
type ResolvedContextColumn = {
  table: string;
  column: string;
  nullable?: boolean;
  unique?: boolean;
  grain?: string;
};

const BROAD_JOIN_KEYS = [
  "user_id",
  "customer_id",
  "account_id",
  "session_id",
  "client_id",
  "member_id",
];

const RECORD_LEVEL_KEYS = [
  "order_id",
  "payment_id",
  "transaction_id",
  "line_id",
  "invoice_id",
  "event_id",
  "item_id",
  "shipment_id",
];

const AGGREGATE_FN_REGEX = /\b(sum|avg|min|max|count)\s*\(/i;
const NULL_GUARD_REGEX = /\b(coalesce|ifnull|nullif|safe_divide)\s*\(/i;

function lineNumberFromIndex(query: string, index: number): number {
  return query.slice(0, Math.max(0, index)).split(/\r?\n/).length;
}

function findLineByExpression(lines: string[], expression: string): number {
  const escaped = expression.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const idx = lines.findIndex((line) => new RegExp(escaped, "i").test(line));
  return idx >= 0 ? idx + 1 : 1;
}

function splitTopLevelComma(input: string): string[] {
  const parts: string[] = [];
  let buffer = "";
  let depth = 0;
  for (const char of input) {
    if (char === "(") depth += 1;
    if (char === ")") depth = Math.max(depth - 1, 0);
    if (char === "," && depth === 0) {
      parts.push(buffer.trim());
      buffer = "";
      continue;
    }
    buffer += char;
  }
  if (buffer.trim()) parts.push(buffer.trim());
  return parts;
}

function stripAlias(expression: string): string {
  return expression
    .replace(/\s+as\s+[a-z0-9_`"]+$/i, "")
    .replace(/\s+[a-z0-9_`"]+$/i, (value) =>
      /\)\s*[a-z0-9_`"]+$/i.test(expression) ? value : "",
    )
    .trim();
}

function isPlainColumnExpression(expression: string): boolean {
  const raw = stripAlias(expression)
    .replace(/[`"]/g, "")
    .replace(/;+\s*$/g, "")
    .trim();

  return /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/i.test(raw);
}

function normalizeFieldToken(expression: string): string {
  return stripAlias(expression)
    .replace(/[`"]/g, "")
    .replace(/;+\s*$/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function unqualifyFieldToken(field: string): string {
  const cleaned = field.replace(/[`"]/g, "").toLowerCase();
  const parts = cleaned.split(".");
  return parts[parts.length - 1];
}

function extractFromAlias(query: string): string {
  const fromMatch =
    /\bfrom\s+([a-z0-9_.`"]+)(?:\s+(?:as\s+)?([a-z0-9_`"]+))?/i.exec(query);
  if (!fromMatch) return "";
  const table = fromMatch[1].replace(/[`"]/g, "");
  const alias = (fromMatch[2] ?? table).replace(/[`"]/g, "");
  return alias.toLowerCase();
}

function extractFromTableAndAlias(query: string): { table: string; alias: string } | null {
  const fromMatch =
    /\bfrom\s+([a-z0-9_.`"]+)(?:\s+(?:as\s+)?([a-z0-9_`"]+))?/i.exec(query);
  if (!fromMatch) return null;
  const table = fromMatch[1].replace(/[`"]/g, "").toLowerCase();
  const alias = (fromMatch[2] ?? table).replace(/[`"]/g, "").toLowerCase();
  return { table, alias };
}

function extractTableAliases(query: string): TableAliasMap {
  const map: TableAliasMap = {};
  const from = extractFromTableAndAlias(query);
  if (from) {
    map[from.alias] = from.table;
    map[from.table] = from.table;
  }
  for (const join of extractJoinSegments(query)) {
    map[join.joinAlias] = join.joinTable;
    map[join.joinTable] = join.joinTable;
  }
  return map;
}

function parseJoinColumnPairs(onClause: string): Array<{
  leftAlias: string;
  leftColumn: string;
  rightAlias: string;
  rightColumn: string;
}> {
  const pairs: Array<{
    leftAlias: string;
    leftColumn: string;
    rightAlias: string;
    rightColumn: string;
  }> = [];

  const regex = /\b([a-z0-9_`"]+)\.([a-z0-9_`"]+)\s*=\s*([a-z0-9_`"]+)\.([a-z0-9_`"]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(onClause)) !== null) {
    pairs.push({
      leftAlias: match[1].replace(/[`"]/g, "").toLowerCase(),
      leftColumn: match[2].replace(/[`"]/g, "").toLowerCase(),
      rightAlias: match[3].replace(/[`"]/g, "").toLowerCase(),
      rightColumn: match[4].replace(/[`"]/g, "").toLowerCase(),
    });
  }
  return pairs;
}

function resolveContextColumnByAlias(
  context: ParsedReviewContext | undefined,
  aliases: TableAliasMap,
  alias: string,
  column: string,
): ResolvedContextColumn | null {
  const table = aliases[alias] ?? alias;
  const tableMeta = context?.schema?.tables?.[table];
  const columnMeta = tableMeta?.columns?.[column];
  if (!tableMeta || !columnMeta) return null;
  return {
    table,
    column,
    nullable: columnMeta.nullable,
    unique: columnMeta.unique,
    grain: tableMeta.grain,
  };
}

function resolveContextColumnByName(
  context: ParsedReviewContext | undefined,
  aliases: TableAliasMap,
  column: string,
): ResolvedContextColumn[] {
  const uniqueTables = Array.from(new Set(Object.values(aliases)));
  const resolved: ResolvedContextColumn[] = [];
  for (const table of uniqueTables) {
    const tableMeta = context?.schema?.tables?.[table];
    const columnMeta = tableMeta?.columns?.[column];
    if (!tableMeta || !columnMeta) continue;
    resolved.push({
      table,
      column,
      nullable: columnMeta.nullable,
      unique: columnMeta.unique,
      grain: tableMeta.grain,
    });
  }
  return resolved;
}

function extractColumnRefs(expression: string): Array<{ alias?: string; column: string }> {
  const refs: Array<{ alias?: string; column: string }> = [];
  const qualified = /([a-z0-9_`"]+)\.([a-z0-9_`"]+)/gi;
  let q: RegExpExecArray | null;
  while ((q = qualified.exec(expression)) !== null) {
    refs.push({
      alias: q[1].replace(/[`"]/g, "").toLowerCase(),
      column: q[2].replace(/[`"]/g, "").toLowerCase(),
    });
  }

  const bareCandidate = expression.replace(qualified, " ");
  const bare = /\b([a-z_][a-z0-9_]*)\b/gi;
  const ignore = new Set([
    "sum",
    "avg",
    "min",
    "max",
    "count",
    "coalesce",
    "ifnull",
    "nullif",
    "safe_divide",
    "case",
    "when",
    "then",
    "else",
    "end",
    "distinct",
  ]);
  let b: RegExpExecArray | null;
  while ((b = bare.exec(bareCandidate)) !== null) {
    const token = b[1].toLowerCase();
    if (ignore.has(token)) continue;
    refs.push({ column: token });
  }
  return refs;
}

function extractJoinSegments(query: string): JoinSegment[] {
  const segments: JoinSegment[] = [];
  const joinRegex =
    /\b(?:inner|left|right|full|cross)?\s*join\s+([a-z0-9_.`"]+)(?:\s+(?:as\s+)?([a-z0-9_`"]+))?\s+on\s+([\s\S]*?)(?=\b(?:inner|left|right|full|cross)?\s*join\b|\bwhere\b|\bgroup\s+by\b|\bhaving\b|\border\s+by\b|\blimit\b|$)/gi;

  let match: RegExpExecArray | null;
  while ((match = joinRegex.exec(query)) !== null) {
    const joinTable = match[1].replace(/[`"]/g, "");
    const joinAlias = (match[2] ?? joinTable).replace(/[`"]/g, "");
    segments.push({
      joinIndex: match.index,
      joinLine: lineNumberFromIndex(query, match.index),
      joinTable: joinTable.toLowerCase(),
      joinAlias: joinAlias.toLowerCase(),
      onClause: match[3].trim(),
    });
  }

  return segments;
}

function extractSelectExpressions(query: string): string[] {
  const selectMatch = /\bselect\b([\s\S]*?)\bfrom\b/i.exec(query);
  if (!selectMatch) return [];
  return splitTopLevelComma(selectMatch[1]);
}

function hasRowExplosionProtection(query: string): boolean {
  const lower = query.toLowerCase();
  return (
    /\bselect\s+distinct\b/i.test(query) ||
    /\bgroup\s+by\b/i.test(query) ||
    /\brow_number\s*\(/i.test(query) ||
    /\bqualify\b/i.test(query) ||
    /\bdense_rank\s*\(/i.test(query) ||
    /\brank\s*\(/i.test(query) ||
    /\bcount\s*\(\s*distinct\b/i.test(query) ||
    /\bdistinct\s+on\s*\(/i.test(query) ||
    /\bdedup/i.test(lower)
  );
}

function detectDivisionByZero(query: string): FindingDraft[] {
  const findings: FindingDraft[] = [];
  const divisionRegex = /\/\s*([a-z0-9_."`[\]()]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = divisionRegex.exec(query)) !== null) {
    const snippetStart = Math.max(0, match.index - 70);
    const snippetEnd = Math.min(query.length, match.index + 140);
    const snippet = query.slice(snippetStart, snippetEnd).toLowerCase();
    const hasGuard = snippet.includes("nullif(") || snippet.includes("safe_divide(");
    if (hasGuard) continue;

    findings.push({
      type: "CRITICAL",
      category: "edge_case",
      title: "Potential division-by-zero risk",
      description: "A division operation was found without explicit denominator protection.",
      line: lineNumberFromIndex(query, match.index),
      recommendation:
        "Wrap denominator with NULLIF(denominator, 0) or use SAFE_DIVIDE to prevent runtime errors.",
      confidence: "HIGH",
    });
  }
  return findings;
}

function detectJoinDuplicationRisk(
  query: string,
  context?: ParsedReviewContext,
): FindingDraft[] {
  const findings: FindingDraft[] = [];
  const selectExpressions = extractSelectExpressions(query).map((expr) => expr.toLowerCase());
  const fromAlias = extractFromAlias(query);
  const joinSegments = extractJoinSegments(query);
  const tableAliases = extractTableAliases(query);
  const hasAggregate = AGGREGATE_FN_REGEX.test(query);
  const hasProtection = hasRowExplosionProtection(query) || hasAggregate;

  for (const segment of joinSegments) {
    const onClauseLower = segment.onClause.toLowerCase();
    const usesBroadKey = BROAD_JOIN_KEYS.some((key) =>
      new RegExp(`\\b${key}\\b`, "i").test(onClauseLower),
    );
    if (!usesBroadKey) continue;

    const usesRecordLevelKey = RECORD_LEVEL_KEYS.some((key) =>
      new RegExp(`\\b${key}\\b`, "i").test(onClauseLower),
    );
    if (usesRecordLevelKey) continue;

    const fromAliasReferenced = fromAlias
      ? selectExpressions.some((expr) => expr.includes(`${fromAlias}.`))
      : true;
    const joinAliasReferenced = selectExpressions.some((expr) =>
      expr.includes(`${segment.joinAlias}.`),
    );
    const selectsFromBothSides = fromAliasReferenced && joinAliasReferenced;
    if (!selectsFromBothSides) continue;

    if (hasProtection) continue;

    const joinPairs = parseJoinColumnPairs(segment.onClause);
    const contextDetails = joinPairs.map((pair) => {
      const left = resolveContextColumnByAlias(
        context,
        tableAliases,
        pair.leftAlias,
        pair.leftColumn,
      );
      const right = resolveContextColumnByAlias(
        context,
        tableAliases,
        pair.rightAlias,
        pair.rightColumn,
      );
      return { pair, left, right };
    });

    const hasAnyContext = contextDetails.some((detail) => detail.left || detail.right);
    const hasBothExplicitlyNonUnique = contextDetails.some(
      (detail) => detail.left?.unique === false && detail.right?.unique === false,
    );
    const hasOneSideUnique = contextDetails.some(
      (detail) => detail.left?.unique === true || detail.right?.unique === true,
    );

    if (hasAnyContext && hasOneSideUnique && !hasBothExplicitlyNonUnique) {
      continue;
    }

    const pair = contextDetails.find((detail) => detail.left || detail.right);
    const leftText = pair?.left
      ? `\`${pair.left.table}.${pair.left.column}\` (unique: ${
          pair.left.unique === undefined ? "unknown" : String(pair.left.unique)
        }${pair.left.grain ? `, grain: "${pair.left.grain}"` : ""})`
      : null;
    const rightText = pair?.right
      ? `\`${pair.right.table}.${pair.right.column}\` (unique: ${
          pair.right.unique === undefined ? "unknown" : String(pair.right.unique)
        }${pair.right.grain ? `, grain: "${pair.right.grain}"` : ""})`
      : null;

    if (hasBothExplicitlyNonUnique && pair?.left && pair?.right) {
      findings.push({
        type: "HIGH",
        category: "logic",
        title: "Likely row multiplication due to non-unique join key",
        description: `The join uses ${pair.pair.leftColumn}, which is not unique in either side according to schema context: ${leftText} and ${rightText}. This indicates likely many-to-many row multiplication.`,
        line: segment.joinLine,
        recommendation:
          "Join on a record-level key such as order_id/payment_id or pre-aggregate one side before joining.",
        confidence: "HIGH",
        contextUsed: true,
        contextReason: "grain + uniqueness metadata applied",
      });
      continue;
    }

    if (hasAnyContext && (leftText || rightText)) {
      findings.push({
        type: "HIGH",
        category: "logic",
        title: "Potential join duplication risk",
        description: `The join uses a broad key with partial schema context${leftText ? `: ${leftText}` : ""}${
          rightText ? ` and ${rightText}` : ""
        }. Row multiplication is possible depending on table cardinality.`,
        line: segment.joinLine,
        recommendation:
          "Validate join cardinality and prefer record-level keys or pre-aggregated inputs before joining.",
        confidence: "MEDIUM",
        contextUsed: true,
        contextReason: "partial uniqueness metadata applied",
      });
      continue;
    }

    findings.push({
      type: "HIGH",
      category: "logic",
      title: "Potential join duplication risk",
      description:
        "The query joins tables on a broad key that may produce duplicate rows or row explosion.",
      line: segment.joinLine,
      recommendation:
        "Validate join cardinality and prefer record-level keys or pre-aggregated inputs before joining.",
      confidence: "MEDIUM",
    });
  }

  return findings;
}

function detectNullHandling(query: string, context?: ParsedReviewContext): FindingDraft[] {
  const findings: FindingDraft[] = [];
  const lines = query.split(/\r?\n/);
  const selectExpressions = extractSelectExpressions(query);
  const tableAliases = extractTableAliases(query);
  const aggregateCallRegex = /\b(sum|avg|min|max|count)\s*\(([^)]*)\)/gi;

  for (const expr of selectExpressions) {
    const lowerExpr = expr.toLowerCase();
    const exprHasAggregate = AGGREGATE_FN_REGEX.test(expr);
    const exprHasArithmetic = /[+\-*/]/.test(expr);
    if (!exprHasAggregate || !exprHasArithmetic) continue;
    if (NULL_GUARD_REGEX.test(expr)) continue;

    const aggregateArgs: string[] = [];
    let aggregateMatch: RegExpExecArray | null;
    const resetRegex = new RegExp(aggregateCallRegex.source, "gi");
    while ((aggregateMatch = resetRegex.exec(lowerExpr)) !== null) {
      aggregateArgs.push(aggregateMatch[2].trim());
    }

    const hasNullableSignal = aggregateArgs.some((arg) =>
      /(?:^|[_\W])(nullable|null|optional|discount|refund|rebate|adjustment|credit)(?:[_\W]|$)/i.test(
        arg,
      ),
    );

    const resolvedRefs = aggregateArgs.flatMap((arg) =>
      extractColumnRefs(arg).flatMap((ref) => {
        if (ref.alias) {
          const byAlias = resolveContextColumnByAlias(
            context,
            tableAliases,
            ref.alias,
            ref.column,
          );
          return byAlias ? [byAlias] : [];
        }
        return resolveContextColumnByName(context, tableAliases, ref.column);
      }),
    );
    const nullableRefs = resolvedRefs.filter((ref) => ref.nullable === true);
    const nonNullableRefs = resolvedRefs.filter((ref) => ref.nullable === false);
    const hasContextNullableSignals = nullableRefs.length > 0;
    const allResolvedAsNonNullable =
      resolvedRefs.length > 0 && resolvedRefs.length === nonNullableRefs.length;

    const hasDivision = lowerExpr.includes("/");
    const aggregatesCount = aggregateArgs.length;

    if (allResolvedAsNonNullable && !hasNullableSignal) {
      continue;
    }

    if (!hasNullableSignal && !hasContextNullableSignals && !hasDivision && aggregatesCount < 2) {
      continue;
    }

    const nullableSummary =
      nullableRefs.length > 0
        ? ` Nullable inputs from context: ${nullableRefs
            .map((ref) => `${ref.table}.${ref.column}`)
            .slice(0, 3)
            .join(", ")}.`
        : "";

    findings.push({
      type: "MEDIUM",
      category: "edge_case",
      title: "Potential null impact in aggregate arithmetic",
      description:
        hasContextNullableSignals
          ? `Aggregate arithmetic references nullable columns from provided context without explicit null guards.${nullableSummary}`
          : "Aggregate arithmetic appears without explicit null guards, which may materially affect calculated output.",
      line: findLineByExpression(lines, expr),
      recommendation:
        hasContextNullableSignals
          ? "Use COALESCE on nullable inputs when business logic expects zeros, and NULLIF for divisors to stabilize metric output."
          : "Consider COALESCE/IFNULL around nullable inputs and NULLIF around divisors for stable metric computation.",
      confidence: hasDivision || hasContextNullableSignals ? "MEDIUM" : "LOW",
      contextUsed: hasContextNullableSignals,
      contextReason:
        hasContextNullableSignals
          ? "nullable metadata applied"
          : undefined,
    });
  }
  return findings;
}

function detectGrainMismatch(query: string, context?: ParsedReviewContext): FindingDraft[] {
  const findings: FindingDraft[] = [];
  const lines = query.split(/\r?\n/);
  const aliases = extractTableAliases(query);
  const selectExpressions = extractSelectExpressions(query);
  if (selectExpressions.length === 0) return findings;

  const hasAggregate = selectExpressions.some((expr) => AGGREGATE_FN_REGEX.test(expr));
  if (!hasAggregate) return findings;

  const groupByMatch = /\bgroup\s+by\b([\s\S]*?)(\border\b|\bhaving\b|\blimit\b|$)/i.exec(query);
  if (!groupByMatch) return findings;
  const rawGroupByExpressions = splitTopLevelComma(groupByMatch[1]);

  const resolvedGroupByExpressions = rawGroupByExpressions.map((groupExpr) => {
    const numericRef = groupExpr.trim().match(/^\d+$/);
    if (!numericRef) return groupExpr;
    const index = Number(numericRef[0]) - 1;
    return index >= 0 && index < selectExpressions.length ? selectExpressions[index] : groupExpr;
  });

  const groupByTokens = new Set(
    resolvedGroupByExpressions.map((expr) => normalizeFieldToken(expr)),
  );
  const groupByUnqualifiedTokens = new Set(
    Array.from(groupByTokens).map((token) => unqualifyFieldToken(token)),
  );

  const plainNonAggregatedFields = selectExpressions.filter((expr) => {
    if (AGGREGATE_FN_REGEX.test(expr)) return false;
    if (/^\s*\d+\s*$/.test(expr)) return false;
    if (/^'.*'$/.test(expr.trim())) return false;
    return isPlainColumnExpression(expr);
  });

  for (const expr of plainNonAggregatedFields) {
    const fieldToken = normalizeFieldToken(expr);
    const fieldUnqualified = unqualifyFieldToken(fieldToken);
    const inGroupBy =
      groupByTokens.has(fieldToken) || groupByUnqualifiedTokens.has(fieldUnqualified);
    if (inGroupBy) continue;

    const aliasMatch = /([a-z0-9_`"]+)\.([a-z0-9_`"]+)/i.exec(expr);
    let grainHint = "";
    let contextDescription = "";
    let usedContext = false;
    if (aliasMatch) {
      const alias = aliasMatch[1].replace(/[`"]/g, "").toLowerCase();
      const table = aliases[alias] ?? alias;
      const grain = context?.schema?.tables?.[table]?.grain;
      if (grain) {
        grainHint = ` Declared table grain for \`${table}\` is "${grain}".`;
        const groupByGrain = rawGroupByExpressions
          .map((item) => normalizeFieldToken(item))
          .join(", ");
        contextDescription = `The query output grain is driven by GROUP BY (${groupByGrain}), while \`${table}.${aliasMatch[2]}\` sits at the declared "${grain}" grain.`;
        usedContext = true;
      }
    }

    findings.push({
      type: "HIGH",
      category: "logic",
      title: "Possible grain mismatch between selected fields and aggregations",
      description: usedContext
        ? contextDescription
        : "Aggregate metrics are selected alongside a non-aggregated field that is not present in GROUP BY.",
      line: findLineByExpression(lines, expr),
      recommendation: `Include the non-aggregated field in GROUP BY or aggregate it explicitly to match query grain.${grainHint}`,
      confidence: "HIGH",
      contextUsed: usedContext,
      contextReason: usedContext ? "grain metadata applied" : undefined,
    });
    break;
  }

  return findings;
}

function severityRank(type: SqlFinding["type"]): number {
  if (type === "CRITICAL") return 4;
  if (type === "HIGH") return 3;
  if (type === "MEDIUM") return 2;
  return 1;
}

function suppressOverlappingFindings(findings: FindingDraft[]): FindingDraft[] {
  const grainMismatchLines = new Set(
    findings
      .filter((finding) => finding.title.includes("grain mismatch"))
      .map((finding) => finding.line),
  );

  return findings.filter((finding) => {
    if (
      finding.title === "Potential null impact in aggregate arithmetic" &&
      grainMismatchLines.has(finding.line)
    ) {
      return false;
    }
    return true;
  });
}

function dedupeFindings(findings: FindingDraft[]): FindingDraft[] {
  const deduped = new Map<string, FindingDraft>();
  for (const finding of findings) {
    const key = `${finding.title}|${finding.line}|${finding.category}`;
    const existing = deduped.get(key);
    if (!existing || severityRank(finding.type) > severityRank(existing.type)) {
      deduped.set(key, finding);
    }
  }
  return Array.from(deduped.values());
}

export function analyzeSQL(query: string, context?: ParsedReviewContext): SqlFinding[] {
  const cleanedQuery = query.trim();
  if (!cleanedQuery) return [];

  const rawDrafts: FindingDraft[] = [
    ...detectDivisionByZero(cleanedQuery),
    ...detectJoinDuplicationRisk(cleanedQuery, context),
    ...detectNullHandling(cleanedQuery, context),
    ...detectGrainMismatch(cleanedQuery, context),
  ];

  const drafts = dedupeFindings(suppressOverlappingFindings(rawDrafts));

  const findings = drafts.map((finding, index) => ({
    id: `F${String(index + 1).padStart(3, "0")}`,
    ...finding,
  }));

  return findings;
}


