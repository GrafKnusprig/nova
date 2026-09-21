import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } from "electron";
import { promises as fs, watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { AssistantService, type AssistantMessage, type AssistantMode, type AssistantProvider } from "./assistant";
import { assertObject, validateMap, VIEWER_VERSION, writeProjectAtomic, type JsonObject } from "./project";
import { runCli } from "./cli";

const PANELS = ["graph", "inspector", "outline", "search", "activity", "assistant"] as const;
const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);
let currentMapPath: string | undefined; let primaryWindow: BrowserWindow | undefined; let aboutWindow: BrowserWindow | undefined; let mapWatcher: FSWatcher | undefined; let watchTimer: NodeJS.Timeout | undefined; let lastSerialized = "";

app.setName("NOVA");

function serialized(value: JsonObject): string { return JSON.stringify(value); }
function settingsPath(): string { return path.join(app.getPath("userData"), "settings.json"); }
function settingsCandidates(): string[] { const appData = app.getPath("appData"); return [...new Set([settingsPath(), path.join(appData, "mindmap-electron", "settings.json"), path.join(appData, "Project Knowledge Map", "settings.json")])]; }
async function rememberedProjectPath(): Promise<string | undefined> { for (const candidate of settingsCandidates()) try { const value = JSON.parse(await fs.readFile(candidate, "utf8")) as { lastProjectPath?: unknown }; if (typeof value.lastProjectPath !== "string") continue; await fs.access(value.lastProjectPath); const resolved = path.resolve(value.lastProjectPath); if (candidate !== settingsPath()) await rememberProjectPath(resolved); return resolved; } catch { /* Try the next settings location. */ } return undefined; }
async function rememberProjectPath(filePath: string): Promise<void> { const destination = settingsPath(); await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.writeFile(destination, `${JSON.stringify({ lastProjectPath: path.resolve(filePath) }, null, 2)}\n`, "utf8"); }
async function startupProjectPath(): Promise<string> {
  const remembered = await rememberedProjectPath(); if (remembered) return remembered;
  const candidates = [path.resolve(app.getAppPath(), "..", "..", "nova.json"), path.resolve(process.cwd(), "nova.json"), path.join(path.dirname(app.getPath("exe")), "nova.json")];
  for (const candidate of [...new Set(candidates)]) try { await fs.access(candidate); return candidate; } catch { /* Try the next conventional location. */ }
  const result = await dialog.showOpenDialog({ title: "Open knowledge-map project", filters: [{ name: "Mind-map project", extensions: ["json"] }], properties: ["openFile"] }); if (result.canceled || !result.filePaths[0]) throw new Error("No knowledge-map project was selected."); return result.filePaths[0];
}
function broadcastExternal(filePath: string, data: JsonObject, source: "external" | "assistant" = "external"): void { for (const window of BrowserWindow.getAllWindows()) window.webContents.send("mindmap:external-change", { path: filePath, data, source }); }
function startWatcher(filePath: string): void {
  mapWatcher?.close(); if (watchTimer) clearTimeout(watchTimer); const directory = path.dirname(filePath), filename = path.basename(filePath).toLowerCase();
  mapWatcher = watch(directory, (_event, changed) => { if (!changed || changed.toString().toLowerCase() !== filename) return; if (watchTimer) clearTimeout(watchTimer); watchTimer = setTimeout(async () => { try { const raw = await fs.readFile(filePath, "utf8"), data = validateMap(JSON.parse(raw)), next = serialized(data); if (next === lastSerialized) return; lastSerialized = next; broadcastExternal(filePath, data); } catch { /* Editors keep their cached drafts while an external writer is between writes. */ } }, 140); });
}
async function readMap(filePath: string) { const resolved = path.resolve(filePath), data = validateMap(JSON.parse(await fs.readFile(resolved, "utf8"))); currentMapPath = resolved; lastSerialized = serialized(data); startWatcher(resolved); await rememberProjectPath(resolved); return { path: resolved, data }; }
async function atomicWrite(filePath: string, raw: unknown): Promise<JsonObject> { const expected = currentMapPath && path.resolve(filePath) === path.resolve(currentMapPath) ? lastSerialized : undefined; const data = await writeProjectAtomic(filePath, raw, expected); lastSerialized = serialized(data); return data; }
async function loadStartupMap() { const filePath = currentMapPath ?? await startupProjectPath(); try { return await readMap(filePath); } catch (error) { const owner = BrowserWindow.getFocusedWindow() ?? primaryWindow; const options: Electron.MessageBoxOptions = { type: "error", title: "Project could not be opened", message: `Could not open ${filePath}`, detail: String(error), buttons: ["Choose another project", "Cancel"], defaultId: 0, cancelId: 1 }; const response = owner ? await dialog.showMessageBox(owner, options) : await dialog.showMessageBox(options); if (response.response !== 0) throw error; const choice = await dialog.showOpenDialog({ title: "Open knowledge-map project", filters: [{ name: "Mind-map project", extensions: ["json"] }], properties: ["openFile"] }); if (choice.canceled || !choice.filePaths[0]) throw error; return readMap(choice.filePaths[0]); } }
const assistant = new AssistantService(
  () => currentMapPath,
  async () => { if (!currentMapPath) throw new Error("No mind-map project is open."); return validateMap(JSON.parse(await fs.readFile(currentMapPath, "utf8"))); },
  async (document) => { if (!currentMapPath) throw new Error("No mind-map project is open."); const data = await atomicWrite(currentMapPath, document); broadcastExternal(currentMapPath, data, "assistant"); },
);

function rendererPageUrl(page = "index.html"): string { return isDevelopment ? new URL(page, `${process.env.VITE_DEV_SERVER_URL!.replace(/\/$/, "")}/`).toString() : pathToFileURL(path.join(__dirname, "../../dist", page)).toString(); }
function rendererUrl(): string { return rendererPageUrl(); }
function appIconPath(): string { return isDevelopment ? path.join(app.getAppPath(), "images", "NOVA_icon.png") : path.join(__dirname, "../../dist/NOVA_icon.png"); }
function secureWindow(options: Electron.BrowserWindowConstructorOptions): BrowserWindow {
  const window = new BrowserWindow({ backgroundColor: "#0b0f18", icon: appIconPath(), ...options, webPreferences: { preload: isDevelopment ? path.join(app.getAppPath(), "dist-electron/preload/index.js") : path.join(__dirname, "../preload/index.js"), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.webContents.on("will-navigate", (event) => event.preventDefault()); window.webContents.setWindowOpenHandler(({ url }) => { const target = new URL(url); const base = new URL(rendererUrl()); if (target.pathname.endsWith("/popout.html") && target.protocol === base.protocol && (target.protocol === "file:" || target.origin === base.origin)) return { action: "allow", overrideBrowserWindowOptions: { backgroundColor: "#0b0f18", icon: appIconPath(), title: "NOVA", webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } } }; if (url.startsWith("https://")) void shell.openExternal(url); return { action: "deny" }; }); return window;
}
function createSplashWindow(onShown: (window: BrowserWindow, shownAt: number) => void): BrowserWindow { const window = secureWindow({ title: "NOVA", width: 920, height: 518, frame: false, transparent: false, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, alwaysOnTop: true, skipTaskbar: true, show: false }); window.once("ready-to-show", () => { if (window.isDestroyed()) return; window.show(); onShown(window, Date.now()); }); void window.loadURL(rendererPageUrl("splash.html")); return window; }
function createMainWindow(splash?: BrowserWindow, splashShownAt = Date.now()): void { const window = secureWindow({ title: "NOVA", minWidth: 900, minHeight: 600, width: 1440, height: 920, show: false }); primaryWindow = window; window.on("closed", () => { if (primaryWindow === window) primaryWindow = undefined; }); window.once("ready-to-show", () => { const reveal = () => { if (!window.isDestroyed()) window.show(); if (splash && !splash.isDestroyed()) splash.close(); }; const remaining = splash ? Math.max(0, 1000 - (Date.now() - splashShownAt)) : 0; setTimeout(reveal, remaining); }); void window.loadURL(rendererUrl()); }
function sendCommand(command: string): void { (primaryWindow ?? BrowserWindow.getFocusedWindow())?.webContents.send("mindmap:command", command); }
function showAbout(): void { if (aboutWindow && !aboutWindow.isDestroyed()) { aboutWindow.show(); aboutWindow.focus(); return; } const owner = BrowserWindow.getFocusedWindow() ?? primaryWindow; const window = secureWindow({ title: "About NOVA", parent: owner, modal: Boolean(owner), width: 700, height: 360, minWidth: 580, minHeight: 320, resizable: true, minimizable: false, maximizable: false, autoHideMenuBar: true, show: false }); aboutWindow = window; window.on("closed", () => { if (aboutWindow === window) aboutWindow = undefined; }); window.once("ready-to-show", () => window.show()); void window.loadURL(`${rendererPageUrl("about.html")}?version=${encodeURIComponent(VIEWER_VERSION)}`); }
function stringValue(value: unknown, label: string): string { if (typeof value !== "string") throw new Error(`${label} must be a string.`); return value; }
function assistantMode(value: unknown): AssistantMode { if (value !== "draft" && value !== "edit" && value !== "full") throw new Error("Invalid assistant mode."); return value; }
function assistantProvider(value: unknown): AssistantProvider { if (value !== "openai" && value !== "fhgenie") throw new Error("Invalid assistant provider."); return value; }
function chatMessages(value: unknown): AssistantMessage[] { if (!Array.isArray(value)) throw new Error("Assistant messages must be an array."); return value.map((raw) => { assertObject(raw, "assistant message"); if ((raw.role !== "user" && raw.role !== "assistant") || typeof raw.content !== "string") throw new Error("Assistant message is invalid."); return { role: raw.role, content: raw.content }; }); }

function registerIpc(): void {
  ipcMain.handle("mindmap:load-default", async () => loadStartupMap());
  ipcMain.handle("mindmap:open", async () => { const result = await dialog.showOpenDialog({ title: "Open knowledge-map project", filters: [{ name: "Mind-map project", extensions: ["json"] }], properties: ["openFile"] }); return result.canceled ? undefined : readMap(result.filePaths[0]); });
  ipcMain.handle("mindmap:save", async (_event, data: unknown) => { if (!currentMapPath) throw new Error("Choose a project destination first."); await atomicWrite(currentMapPath, data); return currentMapPath; });
  ipcMain.handle("mindmap:save-as", async (_event, data: unknown) => { const result = await dialog.showSaveDialog({ title: "Save knowledge-map project", defaultPath: currentMapPath ?? "nova.json", filters: [{ name: "Mind-map project", extensions: ["json"] }] }); if (result.canceled || !result.filePath) return undefined; const resolved = path.resolve(result.filePath); await atomicWrite(resolved, data); currentMapPath = resolved; startWatcher(resolved); await rememberProjectPath(resolved); return resolved; });
  ipcMain.handle("assistant:status", () => assistant.status());
  ipcMain.handle("assistant:set-provider", (_event, provider: unknown) => assistant.setProvider(assistantProvider(provider)));
  ipcMain.handle("assistant:save-key", (_event, provider: unknown, apiKey: unknown) => assistant.saveKey(assistantProvider(provider), stringValue(apiKey, "API key")));
  ipcMain.handle("assistant:delete-key", (_event, provider: unknown) => assistant.deleteKey(assistantProvider(provider)));
  ipcMain.handle("assistant:models", (_event, provider: unknown) => assistant.models(assistantProvider(provider)));
  ipcMain.handle("assistant:set-model", (_event, provider: unknown, model: unknown) => assistant.setModel(assistantProvider(provider), stringValue(model, "model")));
  ipcMain.handle("assistant:new-chat", () => assistant.newChat());
  ipcMain.handle("assistant:chat", (_event, rawMessages: unknown, rawMode: unknown) => assistant.chat(chatMessages(rawMessages), assistantMode(rawMode)));
  ipcMain.handle("assistant:resolve-approval", (_event, id: unknown, accepted: unknown) => assistant.resolveApproval(stringValue(id, "approval id"), Boolean(accepted)));
}

function createMenu(): void {
  const panelItems = PANELS.map((panel) => ({ label: panel === "assistant" ? "AI Assistant" : panel[0].toUpperCase() + panel.slice(1), click: () => sendCommand(`show-panel:${panel}`) }));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "File", submenu: [{ label: "New", accelerator: "Ctrl+N", click: () => sendCommand("new") }, { label: "Open…", accelerator: "Ctrl+O", click: () => sendCommand("open") }, { label: "Save now", accelerator: "Ctrl+S", click: () => sendCommand("save") }, { label: "Save As…", accelerator: "Ctrl+Shift+S", click: () => sendCommand("save-as") }, { type: "separator" }, { role: "quit" }] },
    { label: "Edit", submenu: [{ label: "Undo", accelerator: "Ctrl+Z", click: () => sendCommand("undo") }, { label: "Redo", accelerator: "Ctrl+Y", click: () => sendCommand("redo") }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    { label: "Node", submenu: [{ label: "Add main topic", accelerator: "Ctrl+Shift+N", click: () => sendCommand("add-main-topic") }, { label: "Add child node", accelerator: "Ctrl+Alt+N", click: () => sendCommand("add-child") }, { label: "Delete selected", accelerator: "Delete", click: () => sendCommand("delete-selected") }, { type: "separator" }, { label: "Expand selected", click: () => sendCommand("expand-selected") }, { label: "Collapse selected", click: () => sendCommand("collapse-selected") }] },
    { label: "View", submenu: [{ label: "Panels", submenu: [...panelItems, { type: "separator" }, { label: "Reset panel arrangement", click: () => sendCommand("reset-workspace") }] }, { type: "separator" }, { label: "Fit graph", accelerator: "Ctrl+0", click: () => sendCommand("fit-graph") }, { label: "Re-layout graph", accelerator: "Ctrl+L", click: () => sendCommand("relayout-graph") }, { label: "Show all nodes", click: () => sendCommand("show-all") }, { label: "Collapse to main topics", click: () => sendCommand("collapse-main-topics") }, { type: "separator" }, { role: "togglefullscreen" }, { role: "toggleDevTools" }] },
    { label: "Help", role: "help", submenu: [{ label: "About NOVA", click: () => showAbout() }] },
  ]));
}

const cliIndex = process.argv.indexOf("cli");
if (cliIndex >= 0) app.whenReady().then(async () => { const code = await runCli(process.argv.slice(cliIndex + 1)); app.exit(code); });
else { app.whenReady().then(() => { nativeTheme.themeSource = "dark"; if (process.platform === "win32") app.setAppUserModelId("com.philippraven.nova"); createSplashWindow((splash, shownAt) => { registerIpc(); createMenu(); createMainWindow(splash, shownAt); }); app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); }); }); app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); }); app.on("before-quit", () => mapWatcher?.close()); }
