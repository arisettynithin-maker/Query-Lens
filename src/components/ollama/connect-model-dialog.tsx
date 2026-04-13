"use client";

import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

import { useOllama } from "@/components/ollama/ollama-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ConnectModelDialogProps = {
  open: boolean;
  onOpenChange: (value: boolean) => void;
};

export function ConnectModelDialog({ open, onOpenChange }: ConnectModelDialogProps) {
  const {
    connectionStatus,
    models,
    selectedModel,
    isConnecting,
    isLoadingModels,
    errorMessage,
    connectToOllama,
    setSelectedModel,
  } = useOllama();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect Local Model</DialogTitle>
          <DialogDescription>
            QueryLens only connects to local Ollama models in your environment.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-4">
          {isConnecting ? (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking local Ollama runtime...
            </div>
          ) : null}

          {!isConnecting && connectionStatus === "connected" ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
                <div className="flex items-center gap-2 text-emerald-300">
                  <CheckCircle2 className="h-4 w-4" />
                  Connected to Ollama
                </div>
                <Badge variant="success">Local runtime</Badge>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Select model
                </p>
                <Select
                  value={selectedModel ?? undefined}
                  onValueChange={(value) => setSelectedModel(value)}
                  disabled={isLoadingModels || models.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={isLoadingModels ? "Loading models..." : "Choose local model"}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {isLoadingModels ? (
                      <SelectItem value="loading" disabled>
                        Loading models...
                      </SelectItem>
                    ) : models.length === 0 ? (
                      <SelectItem value="empty" disabled>
                        No local models found
                      </SelectItem>
                    ) : (
                      models.map((model) => (
                        <SelectItem key={model.name} value={model.name}>
                          {model.name}
                          {model.size ? ` • ${model.size}` : ""}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                <div className="max-h-36 space-y-1 overflow-auto rounded-md border border-border/70 bg-muted/20 p-2">
                  {models.length > 0 ? (
                    models.map((model) => (
                      <div
                        key={model.name}
                        className="flex items-center justify-between rounded px-2 py-1 text-xs text-muted-foreground"
                      >
                        <span className="font-medium text-foreground">{model.name}</span>
                        <span>
                          {model.size ?? "size n/a"}
                          {model.modified_at ? ` • ${new Date(model.modified_at).toLocaleDateString()}` : ""}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="px-2 py-1 text-xs text-muted-foreground">
                      {isLoadingModels ? "Fetching model metadata..." : "No models available yet"}
                    </div>
                  )}
                </div>
                {errorMessage ? (
                  <p className="text-xs text-red-300">{errorMessage}</p>
                ) : null}
              </div>
            </div>
          ) : null}

          {!isConnecting && connectionStatus === "not_connected" ? (
            <div className="space-y-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
              <div className="flex items-center gap-2 text-sm text-red-300">
                <AlertCircle className="h-4 w-4" />
                Ollama not running locally
              </div>
              <p className="text-xs text-red-200/90">
                {errorMessage ?? "Run: ollama serve"}
              </p>
              <div className="rounded-md border border-red-500/25 bg-black/20 px-2.5 py-1.5 font-mono text-xs text-red-100">
                ollama serve
              </div>
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button onClick={() => void connectToOllama()} disabled={isConnecting || isLoadingModels}>
              Refresh connection
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
