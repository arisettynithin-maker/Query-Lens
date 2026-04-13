import { NextResponse } from "next/server";

import { checkOllamaHealth } from "@/lib/server/ollama-client";
import type { OllamaHealthResponse } from "@/types/ollama";

export async function GET() {
  const result = await checkOllamaHealth();

  const payload: OllamaHealthResponse = {
    status: result.connected ? "connected" : "not_connected",
    message: result.message,
  };

  return NextResponse.json(payload, { status: 200 });
}
