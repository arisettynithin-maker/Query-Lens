import { Loader2, PanelLeftClose, PanelLeftOpen, PlugZap, Plus } from "lucide-react";
import { useState } from "react";

import { APP_TITLE } from "@/components/layout/nav-config";
import { MobileNav } from "@/components/layout/mobile-nav";
import { ConnectModelDialog } from "@/components/ollama/connect-model-dialog";
import { useOllama } from "@/components/ollama/ollama-provider";
import { type ArtifactType, useReviewSession } from "@/components/review/review-session-provider";
import { useSettings } from "@/components/settings/settings-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getArtifactLabel } from "@/lib/artifact-labels";

type TopHeaderProps = {
  collapsed: boolean;
  onToggleSidebar: () => void;
  currentPath: string;
};

export function TopHeader({
  collapsed,
  onToggleSidebar,
  currentPath,
}: TopHeaderProps) {
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);
  const [newSessionDialogOpen, setNewSessionDialogOpen] = useState(false);
  const [newArtifactType, setNewArtifactType] = useState<ArtifactType>("SQL Query");
  const [newTitle, setNewTitle] = useState("");
  const [newNote, setNewNote] = useState("");
  const { connectionStatus, selectedModel, isConnecting, isLoadingModels, connectToOllama } =
    useOllama();
  const { settings } = useSettings();
  const { sessions, activeSessionId, switchSession, createSession, selectedModel: sessionSelectedModel } =
    useReviewSession();

  function defaultTitleFor(type: ArtifactType) {
    const base =
      type === "SQL Query"
        ? "Query Review"
        : type === "KPI Definition"
          ? "KPI Review"
          : type === "Narrative"
            ? "Narrative Review"
            : "Batch Review";
    const count = sessions.filter((session) => session.currentArtifactType === type).length + 1;
    return `${base} ${count}`;
  }

  function openNewSessionDialog() {
    const defaultTitle = defaultTitleFor(newArtifactType);
    setNewTitle(defaultTitle);
    setNewNote("");
    setNewSessionDialogOpen(true);
  }

  function submitNewSession() {
    createSession({
      title: newTitle.trim() || defaultTitleFor(newArtifactType),
      artifactType: newArtifactType,
      note: newNote.trim(),
    });
    setNewSessionDialogOpen(false);
  }

  const connectionLabel =
    connectionStatus === "connected"
      ? selectedModel
        ? `Connected: ${selectedModel}`
        : "Connected"
      : connectionStatus === "checking"
        ? "Checking Ollama..."
        : "Ollama not connected";

  const effectiveModel = sessionSelectedModel ?? selectedModel ?? settings.modelRuntime.model ?? "No model";
  const activeSqlRulesCount = [
    settings.sqlSafetyRules.divisionByZeroProtection,
    settings.sqlSafetyRules.nullHandlingEnforcement,
    settings.sqlSafetyRules.joinDuplicationDetection,
    settings.sqlSafetyRules.groupByConsistencyCheck,
    settings.sqlSafetyRules.distinctMisuseDetection,
  ].filter(Boolean).length;

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 px-6 py-4 shadow-[0_1px_0_rgba(255,255,255,0.02),0_10px_20px_rgba(3,6,17,0.18)] backdrop-blur-md mb-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-2">
            <MobileNav currentPath={currentPath} />
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggleSidebar}
              className="hidden lg:inline-flex"
              aria-label="Toggle sidebar"
            >
              {collapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </Button>
            <div className="text-left">
              <p className="text-xl font-semibold tracking-tight lg:text-2xl">{APP_TITLE}</p>
              <p className="mt-1 text-sm text-muted-foreground">Analytics QA Workspace</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge className="rounded-full border-border/70 bg-muted/30 px-2 py-1 text-xs text-foreground">
                  {effectiveModel}
                </Badge>
                <Badge className="rounded-full border-sky-500/30 bg-sky-500/10 px-2 py-1 text-xs text-sky-300">
                  {settings.modelRuntime.responseMode === "deterministic" ? "Deterministic" : "Creative"}
                </Badge>
                <Badge
                  className={
                    settings.reviewIntelligence.strictMode
                      ? "rounded-full border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-300"
                      : "rounded-full border-border/70 bg-muted/30 px-2 py-1 text-xs text-muted-foreground"
                  }
                >
                  Strict {settings.reviewIntelligence.strictMode ? "ON" : "OFF"}
                </Badge>
                <Badge className="rounded-full border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-300">
                  {activeSqlRulesCount} Rules Active
                </Badge>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              className={
                connectionStatus === "connected"
                  ? "hidden md:inline-flex border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  : connectionStatus === "checking"
                    ? "hidden md:inline-flex border-border bg-muted/50 text-muted-foreground"
                  : "hidden md:inline-flex border-red-500/30 bg-red-500/10 text-red-300"
              }
            >
              {connectionLabel}
            </Badge>
            <Select
              value={activeSessionId ?? undefined}
              onValueChange={switchSession}
              disabled={sessions.length === 0}
            >
              <SelectTrigger className="hidden w-[210px] md:flex">
                <SelectValue placeholder="Select session" />
              </SelectTrigger>
              <SelectContent>
                {sessions.length > 0 ? (
                  sessions.map((session) => (
                    <SelectItem key={session.id} value={session.id}>
                {session.title}
                    </SelectItem>
                  ))
                ) : (
                  <SelectItem value="none" disabled>
                    No sessions available
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="hidden sm:inline-flex gap-1.5" onClick={openNewSessionDialog}>
              <Plus className="h-3.5 w-3.5" />
              New Review
            </Button>
            <Button
              size="sm"
              className="gap-1.5"
              onClick={async () => {
                setConnectDialogOpen(true);
                await connectToOllama();
              }}
              disabled={isConnecting || isLoadingModels}
            >
              {isConnecting || isLoadingModels ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <PlugZap className="h-3.5 w-3.5" />
              )}
              {isConnecting ? "Connecting..." : isLoadingModels ? "Loading models..." : "Connect model"}
            </Button>
          </div>
        </div>
      </header>
      <ConnectModelDialog open={connectDialogOpen} onOpenChange={setConnectDialogOpen} />
      <Dialog open={newSessionDialogOpen} onOpenChange={setNewSessionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Review Session</DialogTitle>
            <DialogDescription>
              Start a new review without losing current session progress.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Review title</p>
              <input
                value={newTitle}
                onChange={(event) => setNewTitle(event.target.value)}
                className="h-9 w-full rounded-md border border-border/70 bg-background/70 px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Artifact type</p>
              <Select
                value={newArtifactType}
                onValueChange={(value) => {
                  const next = value as ArtifactType;
                  setNewArtifactType(next);
                  setNewTitle(defaultTitleFor(next));
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SQL Query">SQL Query</SelectItem>
                  <SelectItem value="KPI Definition">KPI Definition</SelectItem>
                  <SelectItem value="Narrative">Narrative</SelectItem>
                  <SelectItem value="Batch Review">{getArtifactLabel("Batch Review")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Note (optional)</p>
              <textarea
                value={newNote}
                onChange={(event) => setNewNote(event.target.value)}
                className="min-h-[84px] w-full rounded-md border border-border/70 bg-background/70 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => setNewSessionDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={submitNewSession}>Create session</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
