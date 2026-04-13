"use client";

import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { useState } from "react";

import { useReviewSession, type ReviewProgressStatus } from "@/components/review/review-session-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getArtifactLabel } from "@/lib/artifact-labels";

function formatTimestamp(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function computeStatus(session: {
  lastRunAt: string | null;
  lastReviewedInput: string | null;
  activeArtifactType: string;
  editorInputs: Record<string, string>;
  batchInput: string;
  findingsCount: number;
  highestSeverity: string | null;
}): ReviewProgressStatus {
  if (!session.lastRunAt) return "Draft";
  const currentInput =
    session.activeArtifactType === "Batch Review"
      ? session.batchInput
      : session.editorInputs[session.activeArtifactType] ?? "";
  if (
    session.lastReviewedInput !== null &&
    currentInput.trim() !== session.lastReviewedInput.trim()
  ) {
    return "Changed";
  }
  if (session.highestSeverity === "CRITICAL" || session.highestSeverity === "HIGH") return "Blocked";
  if (session.findingsCount === 0) return "Ready";
  return "Reviewed";
}

export function ReviewHistoryView() {
  const router = useRouter();
  const { sessions, activeSessionId, switchSession, duplicateSession, deleteSession } = useReviewSession();
  const [sessionToDelete, setSessionToDelete] = useState<{ id: string; title: string } | null>(
    null,
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">History</h1>
        <p className="text-sm text-muted-foreground">
          Resume and track review sessions across SQL, KPI, Narrative, and batch workflows.
        </p>
      </div>

      {sessions.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No review sessions</CardTitle>
            <CardDescription>Create a new session from the top header to get started.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="space-y-3">
          {sessions.map((session) => {
            const status = computeStatus(session);
            return (
              <Card key={session.id} className={session.id === activeSessionId ? "border-sky-500/40" : ""}>
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-foreground">{session.title}</p>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>{getArtifactLabel(session.currentArtifactType)}</span>
                        <span>•</span>
                        <span>{status}</span>
                        <span>•</span>
                        <span>Findings {session.findingsCount}</span>
                        <span>•</span>
                        <span>{session.highestSeverity ?? "No severity"}</span>
                        <span>•</span>
                        <span>Updated {formatTimestamp(session.updatedAt)}</span>
                      </div>
                      {session.note ? <p className="text-xs text-muted-foreground">{session.note}</p> : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="muted">
                        {session.lastRunMode === "batch" ? "Batch Review" : "Single Query"}
                      </Badge>
                      <Badge variant="muted">{session.selectedModel ?? "No model"}</Badge>
                      <Badge variant="muted">
                        {session.lastReviewUsedContext ? "Context-aware" : "Query-only"}
                      </Badge>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-end gap-2">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-muted-foreground hover:text-red-300"
                      onClick={() => setSessionToDelete({ id: session.id, title: session.title })}
                      aria-label={`Delete ${session.title}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        duplicateSession(session.id);
                        router.push("/workspace");
                      }}
                    >
                      Duplicate
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        switchSession(session.id);
                        router.push("/workspace");
                      }}
                    >
                      Resume review
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      <Dialog
        open={Boolean(sessionToDelete)}
        onOpenChange={(open) => {
          if (!open) setSessionToDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete review session</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this review? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-sm">
            {sessionToDelete?.title}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setSessionToDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              className="border-red-500/40 text-red-300 hover:bg-red-500/10 hover:text-red-200"
              onClick={() => {
                if (!sessionToDelete) return;
                deleteSession(sessionToDelete.id);
                setSessionToDelete(null);
                router.push("/workspace");
              }}
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

