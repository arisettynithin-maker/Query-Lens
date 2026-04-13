import { NextResponse } from "next/server";

import { fetchOllamaModels } from "@/lib/server/ollama-client";

export async function GET() {
  try {
    const models = await fetchOllamaModels();
    return NextResponse.json(models, { status: 200 });
  } catch {
    return NextResponse.json(
      {
        message: "Failed to load models from Ollama",
      },
      { status: 503 },
    );
  }
}
