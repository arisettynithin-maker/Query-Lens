"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { useSettings } from "@/components/settings/settings-provider";
import { fetchOllamaHealth, fetchOllamaModels } from "@/lib/ollama-api";
import type {
  OllamaConnectionStatus,
  OllamaModel,
} from "@/types/ollama";

type OllamaContextValue = {
  connectionStatus: OllamaConnectionStatus;
  models: OllamaModel[];
  selectedModel: string | null;
  isConnecting: boolean;
  isLoadingModels: boolean;
  errorMessage: string | null;
  connectToOllama: () => Promise<void>;
  setSelectedModel: (model: string | null) => void;
  clearError: () => void;
};

const OllamaContext = createContext<OllamaContextValue | null>(null);

type OllamaProviderProps = {
  children: React.ReactNode;
};

export function OllamaProvider({ children }: OllamaProviderProps) {
  const { settings, setSettings } = useSettings();
  const [connectionStatus, setConnectionStatus] =
    useState<OllamaConnectionStatus>("checking");
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [selectedModel, setSelectedModelState] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const setSelectedModel = useCallback((model: string | null) => {
    setSelectedModelState(model);
    setSettings({
      ...settings,
      modelRuntime: {
        ...settings.modelRuntime,
        model,
      },
    });
  }, [settings, setSettings]);

  const connectToOllama = useCallback(async () => {
    setIsConnecting(true);
    setConnectionStatus("checking");
    setErrorMessage(null);
    try {
      const health = await fetchOllamaHealth();
      if (health.status !== "connected") {
        setConnectionStatus("not_connected");
        setModels([]);
        setSelectedModelState(null);
        setErrorMessage(health.message);
        return;
      }

      setConnectionStatus("connected");
      setIsLoadingModels(true);
      try {
        const modelResponse = await fetchOllamaModels();
        setModels(modelResponse);
        setSelectedModelState((current) => {
          const preferred = settings.modelRuntime.model;
          if (current && modelResponse.some((m) => m.name === current)) return current;
          if (preferred && modelResponse.some((m) => m.name === preferred)) return preferred;
          return null;
        });
        if (modelResponse.length === 0) {
          setErrorMessage("Connected, but no local models found. Run: ollama pull llama3");
        } else {
          setErrorMessage(null);
        }
      } catch {
        setModels([]);
        setSelectedModelState(null);
        setErrorMessage("Failed to load models from Ollama");
      }
    } catch {
      setConnectionStatus("not_connected");
      setModels([]);
      setSelectedModelState(null);
      setErrorMessage("Ollama not running locally. Run: ollama serve");
    } finally {
      setIsConnecting(false);
      setIsLoadingModels(false);
    }
  }, [settings.modelRuntime.model]);

  useEffect(() => {
    void connectToOllama();
  }, [connectToOllama]);

  const value = useMemo<OllamaContextValue>(
    () => ({
      connectionStatus,
      models,
      selectedModel,
      isConnecting,
      isLoadingModels,
      errorMessage,
      connectToOllama,
      setSelectedModel,
      clearError: () => setErrorMessage(null),
    }),
    [
      connectionStatus,
      models,
      selectedModel,
      isConnecting,
      isLoadingModels,
      errorMessage,
      connectToOllama,
      setSelectedModel,
    ],
  );

  return <OllamaContext.Provider value={value}>{children}</OllamaContext.Provider>;
}

export function useOllama() {
  const context = useContext(OllamaContext);
  if (!context) {
    throw new Error("useOllama must be used inside OllamaProvider");
  }
  return context;
}

