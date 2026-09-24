import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("mindmap", {
  platform: process.platform,
  loadDefault: () => ipcRenderer.invoke("mindmap:load-default"),
  open: () => ipcRenderer.invoke("mindmap:open"),
  newProject: (data: unknown) => ipcRenderer.invoke("mindmap:new", data),
  save: (data: unknown) => ipcRenderer.invoke("mindmap:save", data),
  saveAs: (data: unknown) => ipcRenderer.invoke("mindmap:save-as", data),
  assistant: {
    status: () => ipcRenderer.invoke("assistant:status"),
    setProvider: (provider: "openai" | "fhgenie") => ipcRenderer.invoke("assistant:set-provider", provider),
    saveKey: (provider: "openai" | "fhgenie", apiKey: string) => ipcRenderer.invoke("assistant:save-key", provider, apiKey),
    deleteKey: (provider: "openai" | "fhgenie") => ipcRenderer.invoke("assistant:delete-key", provider),
    models: (provider: "openai" | "fhgenie") => ipcRenderer.invoke("assistant:models", provider),
    setModel: (provider: "openai" | "fhgenie", model: string) => ipcRenderer.invoke("assistant:set-model", provider, model),
    newChat: () => ipcRenderer.invoke("assistant:new-chat"),
    chat: (messages: Array<{ role: "user" | "assistant"; content: string }>, mode: "draft" | "edit" | "full", interactionMode: "chat" | "note", conversationStyle: "default" | "professional") => ipcRenderer.invoke("assistant:chat", messages, mode, interactionMode, conversationStyle),
    resolveApproval: (id: string, accepted: boolean) => ipcRenderer.invoke("assistant:resolve-approval", id, accepted),
  },
  onExternalChange: (callback: (result: { path: string; data: unknown; source?: "external" | "assistant" }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, result: { path: string; data: unknown; source?: "external" | "assistant" }) => callback(result);
    ipcRenderer.on("mindmap:external-change", listener);
    return () => ipcRenderer.removeListener("mindmap:external-change", listener);
  },
  onCommand: (callback: (command: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, command: string) => callback(command);
    ipcRenderer.on("mindmap:command", listener);
    return () => ipcRenderer.removeListener("mindmap:command", listener);
  },
});
