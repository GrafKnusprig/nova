import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("mindmap", {
  platform: process.platform,
  loadDefault: () => ipcRenderer.invoke("mindmap:load-default"),
  open: () => ipcRenderer.invoke("mindmap:open"),
  save: (data: unknown) => ipcRenderer.invoke("mindmap:save", data),
  saveAs: (data: unknown) => ipcRenderer.invoke("mindmap:save-as", data),
  detach: (panel: string) => ipcRenderer.invoke("mindmap:detach", panel),
  onCommand: (callback: (command: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, command: string) => callback(command);
    ipcRenderer.on("mindmap:command", listener);
    return () => ipcRenderer.removeListener("mindmap:command", listener);
  },
});
