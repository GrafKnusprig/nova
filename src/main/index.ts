import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import { promises as fs, watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { AssistantService, type AssistantMessage, type AssistantMode, type AssistantProvider } from "./assistant";

const SCHEMA_VERSION = 6;
const VIEWER_VERSION = "6.3.1";
const TOKEN_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NODE_ID = /^(?:[a-z0-9]+(?:-[a-z0-9]+)*|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
const PANELS = ["graph", "inspector", "outline", "search", "activity", "assistant"] as const;
const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);
let currentMapPath: string | undefined; let primaryWindow: BrowserWindow | undefined; let mapWatcher: FSWatcher | undefined; let watchTimer: NodeJS.Timeout | undefined; let lastSerialized = "";

type JsonObject = Record<string, unknown>;
function assertObject(value: unknown, label: string): asserts value is JsonObject { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`); }
function isIsoDate(value: unknown): value is string { return typeof value === "string" && value.length >= 20 && !Number.isNaN(Date.parse(value)); }

function validateMap(value: unknown): JsonObject {
  assertObject(value, "Mind-map root"); if (value.version !== SCHEMA_VERSION) throw new Error(`Unsupported schema ${String(value.version)}; schema ${SCHEMA_VERSION} is required.`); if (typeof value.viewer_version !== "string" || !value.viewer_version.trim()) throw new Error("viewer_version must be a non-empty string.");
  assertObject(value.project, "project"); assertObject(value.llm_context, "llm_context"); assertObject(value.view, "view"); if (!Array.isArray(value.nodes)) throw new Error("nodes must be an array.");
  if (typeof value.project.name !== "string" || typeof value.project.summary !== "string") throw new Error("project name and summary must be strings."); if (typeof value.llm_context.summary !== "string" || !Array.isArray(value.llm_context.instructions) || value.llm_context.instructions.some((entry) => typeof entry !== "string")) throw new Error("llm_context is invalid."); assertObject(value.llm_context.tag_definitions, "llm_context.tag_definitions"); for (const [tag, description] of Object.entries(value.llm_context.tag_definitions)) if (!TOKEN_ID.test(tag) || typeof description !== "string") throw new Error(`Invalid tag definition: ${tag}`);
  if ("hidden_tags" in value.view || !Array.isArray(value.view.expanded) || (value.view.tag_filter_mode !== "include" && value.view.tag_filter_mode !== "exclude") || !Array.isArray(value.view.tag_filter_tags) || new Set(value.view.tag_filter_tags).size !== value.view.tag_filter_tags.length || value.view.tag_filter_tags.some((tag) => typeof tag !== "string" || !TOKEN_ID.test(tag))) throw new Error("view expansion or tag filters are invalid."); assertObject(value.view.positions, "view.positions"); if (typeof value.view.zoom !== "number" || !Array.isArray(value.view.viewport) || value.view.viewport.length !== 2 || value.view.viewport.some((entry) => typeof entry !== "number")) throw new Error("view geometry is invalid."); if (value.view.workspace !== undefined) assertObject(value.view.workspace, "view.workspace");
  const ids = new Set<string>(); const nodes: JsonObject[] = [];
  const visit = (raw: unknown) => { assertObject(raw, "node"); if (typeof raw.id !== "string" || !NODE_ID.test(raw.id) || ids.has(raw.id)) throw new Error(`Invalid or duplicate node ID: ${String(raw.id)}`); ids.add(raw.id); nodes.push(raw); for (const obsolete of ["type", "status", "categories", "date", "rationale_source"]) if (obsolete in raw) throw new Error(`Node ${raw.id} contains obsolete schema-4 field ${obsolete}.`); for (const key of ["title", "summary", "main_tag"] as const) if (typeof raw[key] !== "string") throw new Error(`Node ${raw.id}.${key} must be a string.`); if (!Array.isArray(raw.tags) || raw.tags.length === 0 || new Set(raw.tags).size !== raw.tags.length || raw.tags.some((entry) => typeof entry !== "string" || !TOKEN_ID.test(entry)) || !raw.tags.includes(raw.main_tag)) throw new Error(`Node ${raw.id} has invalid tags or main_tag.`); if (raw.rationale !== undefined && typeof raw.rationale !== "string") throw new Error(`Node ${raw.id}.rationale must be a string.`); if (!isIsoDate(raw.created_at) || !isIsoDate(raw.modified_at)) throw new Error(`Node ${raw.id} requires valid created_at and modified_at timestamps.`); if (!Array.isArray(raw.children) || !Array.isArray(raw.links)) throw new Error(`Node ${raw.id} has invalid children or links.`); raw.children.forEach(visit); };
  value.nodes.forEach(visit); for (const node of nodes) for (const rawLink of node.links as unknown[]) { assertObject(rawLink, `Link on ${String(node.id)}`); if (typeof rawLink.target !== "string" || !ids.has(rawLink.target) || rawLink.target === node.id || typeof rawLink.relation !== "string" || !TOKEN_ID.test(rawLink.relation)) throw new Error(`Node ${String(node.id)} has an invalid link.`); }
  for (const id of value.view.expanded as unknown[]) if (typeof id !== "string" || !ids.has(id)) throw new Error(`view.expanded contains unknown node ${String(id)}.`); return value;
}

function serialized(value: JsonObject): string { return JSON.stringify(value); }
function settingsPath(): string { return path.join(app.getPath("userData"), "settings.json"); }
async function rememberedProjectPath(): Promise<string | undefined> { try { const value = JSON.parse(await fs.readFile(settingsPath(), "utf8")) as { lastProjectPath?: unknown }; if (typeof value.lastProjectPath !== "string") return undefined; await fs.access(value.lastProjectPath); return path.resolve(value.lastProjectPath); } catch { return undefined; } }
async function rememberProjectPath(filePath: string): Promise<void> { const destination = settingsPath(); await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.writeFile(destination, `${JSON.stringify({ lastProjectPath: path.resolve(filePath) }, null, 2)}\n`, "utf8"); }
async function startupProjectPath(): Promise<string> {
  const remembered = await rememberedProjectPath(); if (remembered) return remembered;
  const candidates = [path.resolve(app.getAppPath(), "..", "..", "mindmap.json"), path.resolve(process.cwd(), "mindmap.json"), path.join(path.dirname(app.getPath("exe")), "mindmap.json")];
  for (const candidate of [...new Set(candidates)]) try { await fs.access(candidate); return candidate; } catch { /* Try the next conventional location. */ }
  const result = await dialog.showOpenDialog({ title: "Open knowledge-map project", filters: [{ name: "Mind-map project", extensions: ["json"] }], properties: ["openFile"] }); if (result.canceled || !result.filePaths[0]) throw new Error("No knowledge-map project was selected."); return result.filePaths[0];
}
function broadcastExternal(filePath: string, data: JsonObject, source: "external" | "assistant" = "external"): void { for (const window of BrowserWindow.getAllWindows()) window.webContents.send("mindmap:external-change", { path: filePath, data, source }); }
function startWatcher(filePath: string): void {
  mapWatcher?.close(); if (watchTimer) clearTimeout(watchTimer); const directory = path.dirname(filePath), filename = path.basename(filePath).toLowerCase();
  mapWatcher = watch(directory, (_event, changed) => { if (!changed || changed.toString().toLowerCase() !== filename) return; if (watchTimer) clearTimeout(watchTimer); watchTimer = setTimeout(async () => { try { const raw = await fs.readFile(filePath, "utf8"), data = validateMap(JSON.parse(raw)), next = serialized(data); if (next === lastSerialized) return; lastSerialized = next; broadcastExternal(filePath, data); } catch { /* Editors keep their cached drafts while an external writer is between writes. */ } }, 140); });
}
async function readMap(filePath: string) { const resolved = path.resolve(filePath), data = validateMap(JSON.parse(await fs.readFile(resolved, "utf8"))); currentMapPath = resolved; lastSerialized = serialized(data); startWatcher(resolved); await rememberProjectPath(resolved); return { path: resolved, data }; }
async function atomicWrite(filePath: string, raw: unknown): Promise<JsonObject> { const candidate = structuredClone(raw); assertObject(candidate, "Mind-map root"); candidate.viewer_version = VIEWER_VERSION; const data = validateMap(candidate), temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.tmp`); try { await fs.writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", flag: "wx" }); await fs.rename(temporary, filePath); lastSerialized = serialized(data); return data; } catch (error) { await fs.rm(temporary, { force: true }).catch(() => undefined); throw error; } }
async function loadStartupMap() { const filePath = currentMapPath ?? await startupProjectPath(); try { return await readMap(filePath); } catch (error) { const owner = BrowserWindow.getFocusedWindow() ?? primaryWindow; const options: Electron.MessageBoxOptions = { type: "error", title: "Project could not be opened", message: `Could not open ${filePath}`, detail: String(error), buttons: ["Choose another project", "Cancel"], defaultId: 0, cancelId: 1 }; const response = owner ? await dialog.showMessageBox(owner, options) : await dialog.showMessageBox(options); if (response.response !== 0) throw error; const choice = await dialog.showOpenDialog({ title: "Open knowledge-map project", filters: [{ name: "Mind-map project", extensions: ["json"] }], properties: ["openFile"] }); if (choice.canceled || !choice.filePaths[0]) throw error; return readMap(choice.filePaths[0]); } }
const assistant = new AssistantService(
  () => currentMapPath,
  async () => { if (!currentMapPath) throw new Error("No mind-map project is open."); return validateMap(JSON.parse(await fs.readFile(currentMapPath, "utf8"))); },
  async (document) => { if (!currentMapPath) throw new Error("No mind-map project is open."); const data = await atomicWrite(currentMapPath, document); broadcastExternal(currentMapPath, data, "assistant"); },
);

function rendererUrl(): string { return isDevelopment ? process.env.VITE_DEV_SERVER_URL! : pathToFileURL(path.join(__dirname, "../../dist/index.html")).toString(); }
function secureWindow(options: Electron.BrowserWindowConstructorOptions): BrowserWindow {
  const window = new BrowserWindow({ backgroundColor: "#0b0f18", ...options, webPreferences: { preload: isDevelopment ? path.join(app.getAppPath(), "dist-electron/preload/index.js") : path.join(__dirname, "../preload/index.js"), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.webContents.on("will-navigate", (event) => event.preventDefault()); window.webContents.setWindowOpenHandler(({ url }) => { const target = new URL(url); const base = new URL(rendererUrl()); if (target.pathname.endsWith("/popout.html") && target.protocol === base.protocol && (target.protocol === "file:" || target.origin === base.origin)) return { action: "allow", overrideBrowserWindowOptions: { backgroundColor: "#0b0f18", webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } } }; if (url.startsWith("https://")) void shell.openExternal(url); return { action: "deny" }; }); return window;
}
function createMainWindow(): void { const window = secureWindow({ title: "Project Knowledge Map", minWidth: 900, minHeight: 600, width: 1440, height: 920, show: false }); primaryWindow = window; window.on("closed", () => { if (primaryWindow === window) primaryWindow = undefined; }); window.once("ready-to-show", () => window.show()); void window.loadURL(rendererUrl()); }
function sendCommand(command: string): void { (primaryWindow ?? BrowserWindow.getFocusedWindow())?.webContents.send("mindmap:command", command); }
async function showAbout(): Promise<void> {
  const owner = BrowserWindow.getFocusedWindow() ?? primaryWindow;
  const options: Electron.MessageBoxOptions = { type: "info", title: "About Project Knowledge Map", message: "Project Knowledge Map", detail: `Version ${VIEWER_VERSION}\n\nProgrammer: Philipp Unger\nphilippraven.com`, buttons: ["Visit philippraven.com", "Close"], defaultId: 1, cancelId: 1, noLink: true };
  const result = owner ? await dialog.showMessageBox(owner, options) : await dialog.showMessageBox(options);
  if (result.response === 0) await shell.openExternal("https://philippraven.com");
}
function stringValue(value: unknown, label: string): string { if (typeof value !== "string") throw new Error(`${label} must be a string.`); return value; }
function assistantMode(value: unknown): AssistantMode { if (value !== "draft" && value !== "edit" && value !== "full") throw new Error("Invalid assistant mode."); return value; }
function assistantProvider(value: unknown): AssistantProvider { if (value !== "openai" && value !== "fhgenie") throw new Error("Invalid assistant provider."); return value; }
function chatMessages(value: unknown): AssistantMessage[] { if (!Array.isArray(value)) throw new Error("Assistant messages must be an array."); return value.map((raw) => { assertObject(raw, "assistant message"); if ((raw.role !== "user" && raw.role !== "assistant") || typeof raw.content !== "string") throw new Error("Assistant message is invalid."); return { role: raw.role, content: raw.content }; }); }

function registerIpc(): void {
  ipcMain.handle("mindmap:load-default", async () => loadStartupMap());
  ipcMain.handle("mindmap:open", async () => { const result = await dialog.showOpenDialog({ title: "Open knowledge-map project", filters: [{ name: "Mind-map project", extensions: ["json"] }], properties: ["openFile"] }); return result.canceled ? undefined : readMap(result.filePaths[0]); });
  ipcMain.handle("mindmap:save", async (_event, data: unknown) => { if (!currentMapPath) throw new Error("Choose a project destination first."); await atomicWrite(currentMapPath, data); return currentMapPath; });
  ipcMain.handle("mindmap:save-as", async (_event, data: unknown) => { const result = await dialog.showSaveDialog({ title: "Save knowledge-map project", defaultPath: currentMapPath ?? "mindmap.json", filters: [{ name: "Mind-map project", extensions: ["json"] }] }); if (result.canceled || !result.filePath) return undefined; const resolved = path.resolve(result.filePath); await atomicWrite(resolved, data); currentMapPath = resolved; startWatcher(resolved); await rememberProjectPath(resolved); return resolved; });
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
    { label: "Node", submenu: [{ label: "Add root node", accelerator: "Ctrl+Shift+N", click: () => sendCommand("add-root") }, { label: "Add child node", accelerator: "Ctrl+Alt+N", click: () => sendCommand("add-child") }, { label: "Delete selected", accelerator: "Delete", click: () => sendCommand("delete-selected") }, { type: "separator" }, { label: "Expand selected", click: () => sendCommand("expand-selected") }, { label: "Collapse selected", click: () => sendCommand("collapse-selected") }] },
    { label: "View", submenu: [{ label: "Panels", submenu: [...panelItems, { type: "separator" }, { label: "Reset panel arrangement", click: () => sendCommand("reset-workspace") }] }, { type: "separator" }, { label: "Fit graph", accelerator: "Ctrl+0", click: () => sendCommand("fit-graph") }, { label: "Re-layout graph", accelerator: "Ctrl+L", click: () => sendCommand("relayout-graph") }, { label: "Show all nodes", click: () => sendCommand("show-all") }, { label: "Collapse to roots", click: () => sendCommand("collapse-all") }, { type: "separator" }, { role: "togglefullscreen" }, { role: "toggleDevTools" }] },
    { label: "Help", role: "help", submenu: [{ label: "About", click: () => void showAbout() }] },
  ]));
}

app.whenReady().then(() => { registerIpc(); createMenu(); createMainWindow(); app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); }); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); }); app.on("before-quit", () => mapWatcher?.close());
