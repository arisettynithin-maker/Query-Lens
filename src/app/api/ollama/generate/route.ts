import { NextResponse } from "next/server";

import { generateWithOllama } from "@/lib/server/ollama-client";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { model?: string; prompt?: string; stream?: boolean };
    if (!body.model || !body.prompt) {
      return NextResponse.json(
        { error: "model and prompt are required" },
        { status: 400 },
      );
    }

    const response = await generateWithOllama({
      model: body.model,
      prompt: body.prompt,
      stream: body.stream ?? false,
    });

    const text = await response.text();
    return new NextResponse(text, {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return NextResponse.json(
      {
        error: "Ollama not available locally. Run: ollama serve",
      },
      { status: 503 },
    );
  }
}
