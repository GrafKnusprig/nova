export {};

declare global {
  interface Window {
    mindmap: {
      platform: NodeJS.Platform;
      loadDefault(): Promise<{ path: string; data: unknown }>;
      open(): Promise<{ path: string; data: unknown } | undefined>;
      save(data: unknown): Promise<string>;
      saveAs(data: unknown): Promise<string | undefined>;
      assistant: {
        status(): Promise<{ provider: "openai" | "fhgenie"; hasKey: boolean; model: string }>;
        setProvider(provider: "openai" | "fhgenie"): Promise<{ provider: "openai" | "fhgenie"; hasKey: boolean; model: string }>;
        saveKey(provider: "openai" | "fhgenie", apiKey: string): Promise<{ provider: "openai" | "fhgenie"; hasKey: boolean; model: string }>;
        deleteKey(provider: "openai" | "fhgenie"): Promise<{ provider: "openai" | "fhgenie"; hasKey: boolean; model: string }>;
        models(provider: "openai" | "fhgenie"): Promise<string[]>;
        setModel(provider: "openai" | "fhgenie", model: string): Promise<{ provider: "openai" | "fhgenie"; hasKey: boolean; model: string }>;
        newChat(): Promise<{ cleared: true }>;
        chat(messages: Array<{ role: "user" | "assistant"; content: string }>, mode: "draft" | "edit" | "full"): Promise<{ text: string; changed: boolean; approval?: { id: string; requiredMode: "edit" | "full"; reason: string } }>;
        resolveApproval(id: string, accepted: boolean): Promise<{ text: string; changed: boolean; approval?: { id: string; requiredMode: "edit" | "full"; reason: string } }>;
      };
      onExternalChange(callback: (result: { path: string; data: unknown; source?: "external" | "assistant" }) => void): () => void;
      onCommand(callback: (command: string) => void): () => void;
    };
  }
}
