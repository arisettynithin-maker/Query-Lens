import type { BatchQuerySource, BatchQueryUnit } from "@/types/sql-review";

export type ParsedBatchCandidate = {
  label: string;
  sql: string;
  source: BatchQuerySource;
  sourceName?: string;
};

export function splitSqlStatements(input: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const prev = i > 0 ? input[i - 1] : "";

    if (char === "'" && prev !== "\\" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
    } else if (char === '"' && prev !== "\\" && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
    }

    if (char === ";" && !inSingleQuote && !inDoubleQuote) {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = "";
      continue;
    }

    current += char;
  }

  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

function splitByQueryComments(input: string): ParsedBatchCandidate[] {
  const lines = input.split(/\r?\n/);
  const sections: ParsedBatchCandidate[] = [];
  let currentLabel = "Query";
  let buffer: string[] = [];
  let index = 1;

  for (const line of lines) {
    const match = line.match(/^\s*--\s*query\s*[:\-]?\s*(.*)$/i);
    if (match) {
      const sql = buffer.join("\n").trim();
      if (sql) {
        sections.push({
          label: currentLabel === "Query" ? `Query ${index}` : currentLabel,
          sql,
          source: "pasted",
        });
        index += 1;
      }
      buffer = [];
      const nextLabel = match[1]?.trim();
      currentLabel = nextLabel ? nextLabel : `Query ${index}`;
      continue;
    }
    buffer.push(line);
  }

  const finalSql = buffer.join("\n").trim();
  if (finalSql) {
    sections.push({
      label: currentLabel === "Query" ? `Query ${index}` : currentLabel,
      sql: finalSql,
      source: "pasted",
    });
  }

  return sections;
}

export function parseBatchSqlInput(input: string): ParsedBatchCandidate[] {
  const trimmed = input.trim();
  if (!trimmed) return [];

  const byComments = splitByQueryComments(trimmed);
  if (byComments.length > 1) {
    return byComments;
  }

  const statements = splitSqlStatements(trimmed);
  if (statements.length <= 1) {
    return [
      {
        label: "Query 1",
        sql: trimmed,
        source: "pasted",
      },
    ];
  }

  return statements.map((sql, index) => ({
    label: `Query ${index + 1}`,
    sql,
    source: "pasted",
  }));
}

export function parseBatchSqlFileContent(
  fileName: string,
  content: string,
): ParsedBatchCandidate[] {
  const parsed = parseBatchSqlInput(content);
  return parsed.map((item, index) => ({
    ...item,
    label: parsed.length > 1 ? `${fileName} • Q${index + 1}` : fileName,
    source: "file",
    sourceName: fileName,
  }));
}

export function createDraftBatchUnit(candidate: ParsedBatchCandidate): BatchQueryUnit {
  return {
    id: `BQ-${Math.random().toString(36).slice(2, 10)}`,
    label: candidate.label,
    source: candidate.source,
    sourceName: candidate.sourceName,
    sql: candidate.sql,
    findings: [],
    findingsCount: 0,
    highestSeverity: null,
    riskScore: 0,
    riskLabel: "Low risk",
    lastReviewedTimestamp: null,
  };
}

