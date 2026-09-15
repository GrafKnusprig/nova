export {};

declare global {
  interface Window {
    mindmap: {
      platform: NodeJS.Platform;
      loadDefault(): Promise<{ path: string; data: unknown }>;
      open(): Promise<{ path: string; data: unknown } | undefined>;
      save(data: unknown): Promise<string>;
      saveAs(data: unknown): Promise<string | undefined>;
      onExternalChange(callback: (result: { path: string; data: unknown }) => void): () => void;
      onCommand(callback: (command: string) => void): () => void;
    };
  }
}
