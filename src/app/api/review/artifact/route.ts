import { NextResponse } from "next/server";

import type { ParsedReviewContext } from "@/types/review-context";
import {
  reviewArtifact,
  type ArtifactReviewType,
  type ReviewOptions,
} from "@/lib/review-orchestrator";

type ArtifactReviewRequestBody = {
  artifactType?: ArtifactReviewType;
  input?: string | { queries: Array<{ id?: string; label?: string; source?: "pasted" | "file"; sourceName?: string; sql: string }> };
  context?: ParsedReviewContext;
  options?: ReviewOptions;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ArtifactReviewRequestBody;
    if (!body.artifactType) {
      return NextResponse.json({ error: "artifactType is required" }, { status: 400 });
    }
    const result = reviewArtifact({
      artifactType: body.artifactType,
      input: body.input ?? "",
      context: body.context,
      options: body.options,
    });
    return NextResponse.json(result, { status: 200 });
  } catch {
    return NextResponse.json(
      {
        error: "Failed to review artifact",
      },
      { status: 500 },
    );
  }
}

