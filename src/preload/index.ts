import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("mindmap", {
  platform: process.platform,
  loadDefault: () => ipcRenderer.invoke("mindmap:load-default"),
  open: () => ipcRenderer.invoke("mindmap:open"),
  save: (data: unknown) => ipcRenderer.invoke("mindmap:save", data),
  saveAs: (data: unknown) => ipcRenderer.invoke("mindmap:save-as", data),
  onExternalChange: (callback: (result: { path: string; data: unknown }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, result: { path: string; data: unknown }) => callback(result);
    ipcRenderer.on("mindmap:external-change", listener);
    return () => ipcRenderer.removeListener("mindmap:external-change", listener);
  },
  onCommand: (callback: (command: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, command: string) => callback(command);
    ipcRenderer.on("mindmap:command", listener);
    return () => ipcRenderer.removeListener("mindmap:command", listener);
  },
});
