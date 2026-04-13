import type { OllamaModel } from "@/types/ollama";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const DEFAULT_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS ?? "4000");

type OllamaTagsApiResponse = {
  models?: Array<{
    name?: string;
    size?: number;
    modified_at?: string;
  }>;
};

type OllamaGenerateBody = {
  model: string;
  prompt: string;
  stream?: boolean;
};

class OllamaClientError extends Error {
  status?: number;
}

async function withTimeout<T>(
  promiseFactory: (signal: AbortSignal) => Promise<T>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await promiseFactory(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

function formatBytes(bytes?: number): string | undefined {
  if (!bytes || Number.isNaN(bytes)) return undefined;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unitIndex]}`;
}

export async function checkOllamaHealth(): Promise<{ connected: boolean; message: string }> {
  try {
    const response = await withTimeout((signal) =>
      fetch(`${OLLAMA_BASE_URL}/api/tags`, { method: "GET", signal, cache: "no-store" }),
    );
    if (!response.ok) {
      return {
        connected: false,
        message: `Ollama responded with status ${response.status}`,
      };
    }
    return { connected: true, message: "Connected to local Ollama runtime." };
  } catch {
    return {
      connected: false,
      message: "Ollama not running locally. Run: ollama serve",
    };
  }
}

export async function fetchOllamaModels(): Promise<OllamaModel[]> {
  const response = await withTimeout((signal) =>
    fetch(`${OLLAMA_BASE_URL}/api/tags`, { method: "GET", signal, cache: "no-store" }),
  );

  if (!response.ok) {
    const error = new OllamaClientError(`Ollama /api/tags failed with ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const data = (await response.json()) as OllamaTagsApiResponse;
  const models = data.models ?? [];
  return models
    .filter((model) => typeof model.name === "string")
    .map((model) => ({
      name: model.name as string,
      size: formatBytes(model.size),
      modified_at: model.modified_at,
    }));
}

export async function generateWithOllama(body: OllamaGenerateBody): Promise<Response> {
  return withTimeout((signal) =>
    fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
      cache: "no-store",
    }),
  );
}
