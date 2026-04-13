import type {
  ContextFileType,
  ContextSource,
  ContextValidationStatus,
  ParsedReviewContext,
  SqlContextColumn,
  SqlContextTable,
  SqlSchemaContext,
  UploadedContextFileMeta,
} from "@/types/review-context";

type JsonParseResult = {
  parsedContext: ParsedReviewContext | null;
  error: string | null;
};

type UploadedContextParseResult = {
  fileMeta: UploadedContextFileMeta;
  parsedContext: ParsedReviewContext | null;
  error: string | null;
  statusMessage: string;
};

function normalizeTableName(name: string): string {
  return name.trim().replace(/[`"]/g, "").toLowerCase();
}

function normalizeColumnName(name: string): string {
  return name.trim().replace(/[`"]/g, "").toLowerCase();
}

function normalizeColumn(column: unknown): SqlContextColumn {
  if (!column || typeof column !== "object") return {};
  const source = column as Record<string, unknown>;
  return {
    type: typeof source.type === "string" ? source.type : undefined,
    nullable: typeof source.nullable === "boolean" ? source.nullable : undefined,
    unique: typeof source.unique === "boolean" ? source.unique : undefined,
  };
}

function normalizeTable(table: unknown): SqlContextTable {
  if (!table || typeof table !== "object") return {};
  const source = table as Record<string, unknown>;
  const normalized: SqlContextTable = {};
  if (typeof source.grain === "string" && source.grain.trim()) {
    normalized.grain = source.grain.trim();
  }
  if (source.columns && typeof source.columns === "object") {
    const columns: Record<string, SqlContextColumn> = {};
    for (const [columnName, value] of Object.entries(
      source.columns as Record<string, unknown>,
    )) {
      columns[normalizeColumnName(columnName)] = normalizeColumn(value);
    }
    normalized.columns = columns;
  }
  return normalized;
}

function parseSchemaObject(input: unknown): SqlSchemaContext | null {
  if (!input || typeof input !== "object") return null;
  const source = input as Record<string, unknown>;
  if (!source.tables || typeof source.tables !== "object") return null;

  const normalizedTables: Record<string, SqlContextTable> = {};
  for (const [tableName, tableDef] of Object.entries(source.tables as Record<string, unknown>)) {
    normalizedTables[normalizeTableName(tableName)] = normalizeTable(tableDef);
  }
  return { tables: normalizedTables };
}

function detectFileType(fileName: string): ContextFileType | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".txt")) return "txt";
  return null;
}

function parseCsvHints(text: string): string[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];
  const headerLine = lines[0];
  const columns = headerLine
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  const hints = [`CSV headers detected: ${columns.join(", ")}`];
  if (lines.length > 1) {
    hints.push(`CSV sample rows detected: ${Math.max(lines.length - 1, 0)}`);
  }
  return hints;
}

function parseTextHints(text: string): string[] {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return [];
  return [`Text context loaded (${Math.min(compact.length, 240)} chars inspected).`];
}

export function parsePastedSchemaJson(input: string): JsonParseResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { parsedContext: null, error: null };
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const schema = parseSchemaObject(parsed);
    if (!schema || Object.keys(schema.tables).length === 0) {
      return {
        parsedContext: null,
        error: "Invalid schema JSON. Include a top-level `tables` object.",
      };
    }
    return {
      parsedContext: {
        schema,
        source: "pasted_json",
      },
      error: null,
    };
  } catch {
    return {
      parsedContext: null,
      error: "Invalid JSON format. Fix syntax and try again.",
    };
  }
}

export async function parseUploadedContextFile(file: File): Promise<UploadedContextParseResult> {
  const fileType = detectFileType(file.name);
  if (!fileType) {
    return {
      fileMeta: {
        name: file.name,
        size: file.size,
        fileType: "txt",
      },
      parsedContext: null,
      error: "Unsupported file type. Upload .json, .csv, or .txt",
      statusMessage: "Unsupported context file type",
    };
  }

  const fileMeta: UploadedContextFileMeta = {
    name: file.name,
    size: file.size,
    fileType,
  };

  const text = await file.text();

  if (fileType === "json") {
    try {
      const parsed = JSON.parse(text) as unknown;
      const schema = parseSchemaObject(parsed);
      if (!schema || Object.keys(schema.tables).length === 0) {
        return {
          fileMeta,
          parsedContext: null,
          error: "Uploaded JSON is valid but missing a usable `tables` schema object.",
          statusMessage: "JSON loaded, but context metadata is incomplete",
        };
      }
      return {
        fileMeta,
        parsedContext: {
          schema,
          source: "uploaded_json",
        },
        error: null,
        statusMessage: "Context file loaded (JSON schema detected)",
      };
    } catch {
      return {
        fileMeta,
        parsedContext: null,
        error: "Invalid JSON in uploaded context file.",
        statusMessage: "Failed to parse JSON context",
      };
    }
  }

  if (fileType === "csv") {
    const hints = parseCsvHints(text);
    return {
      fileMeta,
      parsedContext: {
        source: "uploaded_csv",
        hints,
      },
      error: null,
      statusMessage: "Context file loaded (CSV detected)",
    };
  }

  return {
    fileMeta,
    parsedContext: {
      source: "uploaded_txt",
      hints: parseTextHints(text),
    },
    error: null,
    statusMessage: "Context file loaded (text detected)",
  };
}

export function mergeParsedContexts(
  pastedContext: ParsedReviewContext | null,
  uploadedContext: ParsedReviewContext | null,
): ParsedReviewContext | null {
  if (!pastedContext && !uploadedContext) return null;
  if (pastedContext && !uploadedContext) return pastedContext;
  if (!pastedContext && uploadedContext) return uploadedContext;

  const mergedTables: Record<string, SqlContextTable> = {
    ...(uploadedContext?.schema?.tables ?? {}),
    ...(pastedContext?.schema?.tables ?? {}),
  };

  const mergedHints = [
    ...(uploadedContext?.hints ?? []),
    ...(pastedContext?.hints ?? []),
  ];

  let source: ContextSource = "mixed";
  if (pastedContext?.source === uploadedContext?.source) {
    source = pastedContext?.source ?? "mixed";
  }

  return {
    source,
    schema: Object.keys(mergedTables).length > 0 ? { tables: mergedTables } : undefined,
    hints: mergedHints.length > 0 ? mergedHints : undefined,
  };
}

export function describeContextSource(source: ContextSource): string {
  if (source === "pasted_json") return "Pasted JSON";
  if (source === "uploaded_json") return "Uploaded JSON";
  if (source === "uploaded_csv") return "Uploaded CSV";
  if (source === "uploaded_txt") return "Uploaded text";
  if (source === "mixed") return "Mixed context";
  return "Query only";
}

export function summarizeContextQuality(
  parsedContext: ParsedReviewContext | null,
  validationStatus: ContextValidationStatus,
): string {
  if (validationStatus === "invalid") return "Invalid context";
  if (!parsedContext) return "No context";

  const tables = Object.values(parsedContext.schema?.tables ?? {});
  if (tables.length === 0) {
    return parsedContext.hints?.length ? "Partial context (supplemental hints only)" : "No context";
  }

  let columnCount = 0;
  let uniqueCount = 0;
  let nullableCount = 0;
  let grainCount = 0;

  for (const table of tables) {
    if (table.grain?.trim()) grainCount += 1;
    for (const column of Object.values(table.columns ?? {})) {
      columnCount += 1;
      if (typeof column.unique === "boolean") uniqueCount += 1;
      if (typeof column.nullable === "boolean") nullableCount += 1;
    }
  }

  const missing: string[] = [];
  if (grainCount < tables.length) missing.push("grain");
  if (columnCount > 0 && uniqueCount < columnCount) missing.push("uniqueness");
  if (columnCount > 0 && nullableCount < columnCount) missing.push("nullability");

  if (missing.length === 0 && columnCount > 0) return "Full context";
  if (missing.length === 0) return "Partial context (table metadata only)";
  return `Partial context (missing ${missing.join(", ")} metadata)`;
}
