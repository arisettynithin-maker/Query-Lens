export type ContextMode = "query_only" | "context_aware";

export type ContextSource =
  | "none"
  | "pasted_json"
  | "uploaded_json"
  | "uploaded_csv"
  | "uploaded_txt"
  | "mixed";

export type ContextValidationStatus = "empty" | "valid" | "invalid" | "loaded";

export type ContextFileType = "json" | "csv" | "txt";

export type UploadedContextFileMeta = {
  name: string;
  size: number;
  fileType: ContextFileType;
};

export type SqlContextColumn = {
  type?: string;
  nullable?: boolean;
  unique?: boolean;
};

export type SqlContextTable = {
  grain?: string;
  columns?: Record<string, SqlContextColumn>;
};

export type SqlSchemaContext = {
  tables: Record<string, SqlContextTable>;
};

export type ParsedReviewContext = {
  schema?: SqlSchemaContext;
  hints?: string[];
  source: ContextSource;
};

