export type OllamaConnectionStatus = "connected" | "not_connected" | "checking";

export type OllamaModel = {
  name: string;
  size?: string;
  modified_at?: string;
};

export type OllamaHealthResponse = {
  status: "connected" | "not_connected";
  message: string;
};
