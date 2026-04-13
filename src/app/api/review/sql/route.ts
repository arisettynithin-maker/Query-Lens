import { NextResponse } from "next/server";

import type { ParsedReviewContext } from "@/types/review-context";
import { reviewArtifact } from "@/lib/review-orchestrator";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      query?: string;
      context?: ParsedReviewContext;
      options?: {
        reviewProfile?: "standard" | "strict" | "release_gate";
        severityThreshold?: "low_plus" | "medium_plus" | "high_only";
      };
    };
    const query = body.query ?? "";
    const result = reviewArtifact({
      artifactType: "sql",
      input: query,
      context: body.context,
      options: body.options,
    });
    const findings = "findings" in result ? result.findings : [];
    return NextResponse.json(findings, { status: 200 });
  } catch {
    return NextResponse.json(
      [
        {
          id: "F001",
          type: "LOW",
          category: "logic",
          title: "Failed to analyze SQL",
          description: "The SQL analyzer could not process this request.",
          line: 1,
          recommendation: "Retry with a valid SQL query string.",
          confidence: "LOW",
        },
      ],
      { status: 500 },
    );
  }
}
