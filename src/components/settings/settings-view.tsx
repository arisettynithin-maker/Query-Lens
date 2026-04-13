"use client";

import { useMemo } from "react";

import { useOllama } from "@/components/ollama/ollama-provider";
import { useSettings } from "@/components/settings/settings-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { DefaultRewriteMode, QueryLensSettings, ResponseMode, SqlDialect, SqlSeverityFilter } from "@/types/settings";

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border/70 bg-muted/15 px-3 py-2.5">
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`h-6 w-11 rounded-full border transition-colors ${
          checked ? "border-emerald-500/40 bg-emerald-500/30" : "border-border bg-background/60"
        }`}
      >
        <span
          className={`block h-5 w-5 rounded-full bg-foreground transition-transform ${
            checked ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

function NumberInput({
  value,
  onChange,
  min,
  max,
}: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
}) {
  return (
    <input
      type="number"
      min={min}
      max={max}
      value={value}
      onChange={(event) => {
        const next = Number(event.target.value);
        if (!Number.isFinite(next)) return;
        onChange(Math.max(min, Math.min(max, Math.round(next))));
      }}
      className="h-9 w-full rounded-md border border-border/70 bg-background/70 px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    />
  );
}

export function SettingsView() {
  const { settings, setSettings, resetSettings } = useSettings();
  const { models, selectedModel, setSelectedModel } = useOllama();

  const modelOptions = useMemo(
    () => {
      const defaults = ["llama3", "mistral", "codellama"];
      const discovered = models.map((model) => model.name);
      return [...new Set([...defaults, ...discovered])];
    },
    [models],
  );

  const patchSettings = (updater: (previous: QueryLensSettings) => QueryLensSettings) => {
    setSettings(updater(settings));
  };

  const setResponseMode = (mode: ResponseMode) =>
    patchSettings((previous) => ({
      ...previous,
      modelRuntime: { ...previous.modelRuntime, responseMode: mode },
    }));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Configure runtime defaults, intelligence behavior, SQL safety policies, and governance controls.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={resetSettings}>
          Reset to defaults
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Model & Runtime Settings</CardTitle>
          <CardDescription>Applies to local model-backed generation and rewrite runtime settings.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Model</p>
            <Select
              value={settings.modelRuntime.model ?? undefined}
              onValueChange={(value) => {
                patchSettings((previous) => ({
                  ...previous,
                  modelRuntime: { ...previous.modelRuntime, model: value },
                }));
                setSelectedModel(value);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select model" />
              </SelectTrigger>
              <SelectContent>
                {modelOptions.map((model) => (
                  <SelectItem key={model} value={model}>
                    {model}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Active runtime model: <span className="text-foreground">{selectedModel ?? "None"}</span>
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Temperature</p>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.modelRuntime.temperature}
              onChange={(event) =>
                patchSettings((previous) => ({
                  ...previous,
                  modelRuntime: {
                    ...previous.modelRuntime,
                    temperature: Number(event.target.value),
                  },
                }))
              }
              className="w-full accent-foreground"
            />
            <p className="text-xs text-muted-foreground">{settings.modelRuntime.temperature.toFixed(2)}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Max tokens</p>
            <NumberInput
              value={settings.modelRuntime.maxTokens}
              min={128}
              max={32768}
              onChange={(value) =>
                patchSettings((previous) => ({
                  ...previous,
                  modelRuntime: { ...previous.modelRuntime, maxTokens: value },
                }))
              }
            />
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Response mode</p>
            <div className="flex items-center gap-2">
              <Button
                variant={settings.modelRuntime.responseMode === "deterministic" ? "secondary" : "outline"}
                size="sm"
                onClick={() => setResponseMode("deterministic")}
              >
                Deterministic
              </Button>
              <Button
                variant={settings.modelRuntime.responseMode === "creative" ? "secondary" : "outline"}
                size="sm"
                onClick={() => setResponseMode("creative")}
              >
                Creative
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Review Intelligence Settings</CardTitle>
          <CardDescription>Control which review pipelines are active for generated outputs.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2.5">
          <ToggleRow
            label="Enable SQL Findings"
            description="Allow SQL artifact findings generation."
            checked={settings.reviewIntelligence.enableSqlFindings}
            onChange={(next) =>
              patchSettings((previous) => ({
                ...previous,
                reviewIntelligence: { ...previous.reviewIntelligence, enableSqlFindings: next },
              }))
            }
          />
          <ToggleRow
            label="Enable Test Case Generation"
            description="Generate validation plans from findings."
            checked={settings.reviewIntelligence.enableTestCaseGeneration}
            onChange={(next) =>
              patchSettings((previous) => ({
                ...previous,
                reviewIntelligence: { ...previous.reviewIntelligence, enableTestCaseGeneration: next },
              }))
            }
          />
          <ToggleRow
            label="Enable Rewrite Suggestions"
            description="Enable guided artifact rewrite output."
            checked={settings.reviewIntelligence.enableRewriteSuggestions}
            onChange={(next) =>
              patchSettings((previous) => ({
                ...previous,
                reviewIntelligence: { ...previous.reviewIntelligence, enableRewriteSuggestions: next },
              }))
            }
          />
          <ToggleRow
            label="Enable KPI Definition Review"
            description="Run KPI-definition specific findings logic."
            checked={settings.reviewIntelligence.enableKpiDefinitionReview}
            onChange={(next) =>
              patchSettings((previous) => ({
                ...previous,
                reviewIntelligence: { ...previous.reviewIntelligence, enableKpiDefinitionReview: next },
              }))
            }
          />
          <ToggleRow
            label="Enable Narrative Review"
            description="Run narrative clarity and communication checks."
            checked={settings.reviewIntelligence.enableNarrativeReview}
            onChange={(next) =>
              patchSettings((previous) => ({
                ...previous,
                reviewIntelligence: { ...previous.reviewIntelligence, enableNarrativeReview: next },
              }))
            }
          />
          <ToggleRow
            label="Strict Mode"
            description="Block completion when CRITICAL findings remain."
            checked={settings.reviewIntelligence.strictMode}
            onChange={(next) =>
              patchSettings((previous) => ({
                ...previous,
                reviewIntelligence: { ...previous.reviewIntelligence, strictMode: next },
              }))
            }
          />
          <div className="rounded-md border border-border/70 bg-muted/15 px-3 py-2.5">
            <p className="text-sm font-medium text-foreground">Confidence mode</p>
            <p className="mb-2 text-xs text-muted-foreground">
              Controls finding sensitivity across all analyzers.
            </p>
            <Select
              value={settings.reviewIntelligence.confidenceMode}
              onValueChange={(value) =>
                patchSettings((previous) => ({
                  ...previous,
                  reviewIntelligence: {
                    ...previous.reviewIntelligence,
                    confidenceMode: value as "conservative" | "balanced" | "lenient",
                  },
                }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="conservative">Conservative</SelectItem>
                <SelectItem value="balanced">Balanced</SelectItem>
                <SelectItem value="lenient">Lenient</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>SQL Safety Rules</CardTitle>
          <CardDescription>Tune SQL rule visibility and strictness for QA output.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2.5">
          <ToggleRow
            label="Division by zero protection"
            description="Surface denominator safety issues."
            checked={settings.sqlSafetyRules.divisionByZeroProtection}
            onChange={(next) =>
              patchSettings((previous) => ({
                ...previous,
                sqlSafetyRules: { ...previous.sqlSafetyRules, divisionByZeroProtection: next },
              }))
            }
          />
          <ToggleRow
            label="NULL handling enforcement"
            description="Highlight nullable calculation risks."
            checked={settings.sqlSafetyRules.nullHandlingEnforcement}
            onChange={(next) =>
              patchSettings((previous) => ({
                ...previous,
                sqlSafetyRules: { ...previous.sqlSafetyRules, nullHandlingEnforcement: next },
              }))
            }
          />
          <ToggleRow
            label="Join duplication detection"
            description="Detect likely row multiplication from joins."
            checked={settings.sqlSafetyRules.joinDuplicationDetection}
            onChange={(next) =>
              patchSettings((previous) => ({
                ...previous,
                sqlSafetyRules: { ...previous.sqlSafetyRules, joinDuplicationDetection: next },
              }))
            }
          />
          <ToggleRow
            label="GROUP BY consistency check"
            description="Check non-aggregated selections against grouping."
            checked={settings.sqlSafetyRules.groupByConsistencyCheck}
            onChange={(next) =>
              patchSettings((previous) => ({
                ...previous,
                sqlSafetyRules: { ...previous.sqlSafetyRules, groupByConsistencyCheck: next },
              }))
            }
          />
          <ToggleRow
            label="DISTINCT misuse detection"
            description="Flag potentially masking DISTINCT usage."
            checked={settings.sqlSafetyRules.distinctMisuseDetection}
            onChange={(next) =>
              patchSettings((previous) => ({
                ...previous,
                sqlSafetyRules: { ...previous.sqlSafetyRules, distinctMisuseDetection: next },
              }))
            }
          />
          <div className="rounded-md border border-border/70 bg-muted/15 px-3 py-2.5">
            <p className="text-sm font-medium text-foreground">Severity filter</p>
            <p className="mb-2 text-xs text-muted-foreground">Adjust visibility of low-severity SQL findings.</p>
            <Select
              value={settings.sqlSafetyRules.severityFilter}
              onValueChange={(value) =>
                patchSettings((previous) => ({
                  ...previous,
                  sqlSafetyRules: {
                    ...previous.sqlSafetyRules,
                    severityFilter: value as SqlSeverityFilter,
                  },
                }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Show ALL</SelectItem>
                <SelectItem value="hide_low">Hide LOW</SelectItem>
                <SelectItem value="high_critical">Only HIGH/CRITICAL</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Workspace Defaults</CardTitle>
          <CardDescription>Default editing and rewrite behavior for new review work.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">SQL dialect</p>
            <Select
              value={settings.workspaceDefaults.sqlDialect}
              onValueChange={(value) =>
                patchSettings((previous) => ({
                  ...previous,
                  workspaceDefaults: { ...previous.workspaceDefaults, sqlDialect: value as SqlDialect },
                }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="postgres">Postgres</SelectItem>
                <SelectItem value="bigquery">BigQuery</SelectItem>
                <SelectItem value="redshift">Redshift</SelectItem>
                <SelectItem value="mysql">MySQL</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Default rewrite mode</p>
            <Select
              value={settings.workspaceDefaults.defaultRewriteMode}
              onValueChange={(value) =>
                patchSettings((previous) => ({
                  ...previous,
                  workspaceDefaults: {
                    ...previous.workspaceDefaults,
                    defaultRewriteMode: value as DefaultRewriteMode,
                  },
                }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Safer SQL">Safer SQL</SelectItem>
                <SelectItem value="Readable SQL">Readable SQL</SelectItem>
                <SelectItem value="Optimized SQL">Optimized SQL</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Auto-run on upload</p>
              <ToggleRow
                label={settings.workspaceDefaults.autoRunOnUpload ? "Enabled" : "Disabled"}
                description="Run review immediately after SQL file upload."
                checked={settings.workspaceDefaults.autoRunOnUpload}
              onChange={(next) =>
                patchSettings((previous) => ({
                  ...previous,
                  workspaceDefaults: { ...previous.workspaceDefaults, autoRunOnUpload: next },
                }))
              }
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Trust & Governance Settings</CardTitle>
          <CardDescription>Controls for provenance, overwrite protection, and session governance defaults.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2.5">
          <ToggleRow
            label="Show model provenance"
            description="Display model and run metadata in findings, test cases, and rewrite."
            checked={settings.trustGovernance.showModelProvenance}
            onChange={(next) =>
              patchSettings((previous) => ({
                ...previous,
                trustGovernance: { ...previous.trustGovernance, showModelProvenance: next },
              }))
            }
          />
          <ToggleRow
            label="Auto-save history"
            description="Automatically keep session updates in History."
            checked={settings.trustGovernance.autoSaveHistory}
            onChange={(next) =>
              patchSettings((previous) => ({
                ...previous,
                trustGovernance: { ...previous.trustGovernance, autoSaveHistory: next },
              }))
            }
          />
          <ToggleRow
            label="Require confirmation before replacing query"
            description="Prompt before applying rewrite output to active input."
            checked={settings.trustGovernance.requireConfirmationBeforeReplacingQuery}
            onChange={(next) =>
              patchSettings((previous) => ({
                ...previous,
                trustGovernance: {
                  ...previous.trustGovernance,
                  requireConfirmationBeforeReplacingQuery: next,
                },
              }))
            }
          />
          <ToggleRow
            label="Allow overwrite"
            description="Allow rewrite output to replace current artifact input."
            checked={settings.trustGovernance.allowOverwrite}
            onChange={(next) =>
              patchSettings((previous) => ({
                ...previous,
                trustGovernance: { ...previous.trustGovernance, allowOverwrite: next },
              }))
            }
          />
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Badge variant="muted">Applied immediately</Badge>
            <Badge variant="muted">Persisted locally</Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}



