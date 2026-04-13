import type { OllamaHealthResponse, OllamaModel } from "@/types/ollama";

export async function fetchOllamaHealth(): Promise<OllamaHealthResponse> {
  const response = await fetch("/api/ollama/health", { method: "GET" });
  return (await response.json()) as OllamaHealthResponse;
}

export async function fetchOllamaModels(): Promise<OllamaModel[]> {
  const response = await fetch("/api/ollama/models", { method: "GET" });
  if (!response.ok) {
    throw new Error("Failed to load models from Ollama");
  }

  const data = (await response.json()) as unknown;
  if (Array.isArray(data)) {
    return data as OllamaModel[];
  }
  if (
    data &&
    typeof data === "object" &&
    "models" in data &&
    Array.isArray((data as { models: unknown }).models)
  ) {
    return (data as { models: OllamaModel[] }).models;
  }
  return [];
}
