import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SCHEMA_VERSION = 4;
const NODE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PANELS = ["graph", "inspector", "outline", "search", "activity"] as const;
const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);
let currentMapPath: string | undefined;
let primaryWindow: BrowserWindow | undefined;

type JsonObject = Record<string, unknown>;

function assertObject(value: unknown, label: string): asserts value is JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
}

function validateMap(value: unknown): JsonObject {
  assertObject(value, "Mind-map root");
  if (value.version !== SCHEMA_VERSION) throw new Error(`Unsupported schema ${String(value.version)}; schema ${SCHEMA_VERSION} is required.`);
  assertObject(value.project, "project");
  assertObject(value.llm_context, "llm_context");
  assertObject(value.view, "view");
  if (!Array.isArray(value.nodes)) throw new Error("nodes must be an array.");
  if (typeof value.project.name !== "string" || typeof value.project.summary !== "string") throw new Error("project name and summary must be strings.");
  if (typeof value.llm_context.summary !== "string" || !Array.isArray(value.llm_context.instructions)) throw new Error("llm_context is invalid.");
  assertObject(value.llm_context.category_definitions, "llm_context.category_definitions");
  const ids = new Set<string>();
  const nodes: JsonObject[] = [];
  const visit = (raw: unknown) => {
    assertObject(raw, "node");
    if (typeof raw.id !== "string" || !NODE_ID.test(raw.id) || ids.has(raw.id)) throw new Error(`Invalid or duplicate node ID: ${String(raw.id)}`);
    if ("items" in raw || "parent" in raw) throw new Error(`Node ${raw.id} uses an obsolete schema field.`);
    ids.add(raw.id); nodes.push(raw);
    for (const key of ["title", "type", "summary", "status"] as const) if (typeof raw[key] !== "string") throw new Error(`Node ${raw.id}.${key} must be a string.`);
    if (!Array.isArray(raw.categories) || raw.categories.length === 0 || raw.categories.some((entry) => typeof entry !== "string" || !NODE_ID.test(entry))) throw new Error(`Node ${raw.id} has invalid categories.`);
    if (!Array.isArray(raw.children) || !Array.isArray(raw.links)) throw new Error(`Node ${raw.id} has invalid children or links.`);
    const rationale = raw.rationale; const source = raw.rationale_source;
    if ((rationale === undefined) !== (source === undefined) || (rationale !== undefined && (typeof rationale !== "string" || !["user", "derived-from-context"].includes(String(source))))) throw new Error(`Node ${raw.id} has invalid rationale metadata.`);
    raw.children.forEach(visit);
  };
  value.nodes.forEach(visit);
  for (const node of nodes) for (const rawLink of node.links as unknown[]) {
    assertObject(rawLink, `Link on ${String(node.id)}`);
    if (typeof rawLink.target !== "string" || !ids.has(rawLink.target) || rawLink.target === node.id || typeof rawLink.relation !== "string" || !NODE_ID.test(rawLink.relation)) throw new Error(`Node ${String(node.id)} has an invalid link.`);
  }
  return value;
}

async function readMap(filePath: string) {
  const data = validateMap(JSON.parse(await fs.readFile(filePath, "utf8")));
  currentMapPath = filePath;
  return { path: filePath, data };
}

async function atomicWrite(filePath: string, raw: unknown): Promise<void> {
  const data = validateMap(structuredClone(raw));
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.tmp`);
  try {
    await fs.writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await fs.rename(temporary, filePath);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

function rendererUrl(panel?: string): string {
  const base = isDevelopment ? process.env.VITE_DEV_SERVER_URL! : pathToFileURL(path.join(__dirname, "../../dist/index.html")).toString();
  return panel ? `${base}?panel=${encodeURIComponent(panel)}` : base;
}

function secureWindow(options: Electron.BrowserWindowConstructorOptions): BrowserWindow {
  const window = new BrowserWindow({
    backgroundColor: "#0b0f18",
    ...options,
    webPreferences: {
      preload: isDevelopment ? path.join(app.getAppPath(), "dist-electron/preload/index.js") : path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  return window;
}

function createMainWindow(): void {
  const window = secureWindow({ title: "Project Knowledge Map", minWidth: 900, minHeight: 600, width: 1440, height: 920, show: false });
  primaryWindow = window;
  window.on("closed", () => { if (primaryWindow === window) primaryWindow = undefined; });
  window.once("ready-to-show", () => window.show());
  void window.loadURL(rendererUrl());
}

function createPanelWindow(panel: string): void {
  if (!PANELS.includes(panel as typeof PANELS[number])) return;
  const window = secureWindow({ title: `Project Knowledge Map — ${panel}`, minWidth: 420, minHeight: 320, width: 760, height: 600 });
  void window.loadURL(rendererUrl(panel));
}

function sendCommand(command: string): void {
  (primaryWindow ?? BrowserWindow.getFocusedWindow())?.webContents.send("mindmap:command", command);
}

function registerIpc(): void {
  ipcMain.handle("mindmap:load-default", async () => readMap(currentMapPath ?? path.resolve(app.getAppPath(), "..", "..", "mindmap.json")));
  ipcMain.handle("mindmap:open", async () => {
    const result = await dialog.showOpenDialog({ title: "Open knowledge map", filters: [{ name: "Mind map", extensions: ["json"] }], properties: ["openFile"] });
    return result.canceled ? undefined : readMap(result.filePaths[0]);
  });
  ipcMain.handle("mindmap:save", async (_event, data: unknown) => {
    if (!currentMapPath) throw new Error("Choose a destination with Save As first.");
    await atomicWrite(currentMapPath, data); return currentMapPath;
  });
  ipcMain.handle("mindmap:save-as", async (_event, data: unknown) => {
    const result = await dialog.showSaveDialog({ title: "Save knowledge map", defaultPath: currentMapPath ?? "mindmap.json", filters: [{ name: "Mind map", extensions: ["json"] }] });
    if (result.canceled || !result.filePath) return undefined;
    await atomicWrite(result.filePath, data); currentMapPath = result.filePath; return currentMapPath;
  });
  ipcMain.handle("mindmap:detach", (_event, panel: unknown) => { if (typeof panel === "string") createPanelWindow(panel); });
}

function createMenu(): void {
  const panelItems = PANELS.map((panel) => ({ label: panel[0].toUpperCase() + panel.slice(1), click: () => sendCommand(`show-panel:${panel}`) }));
  const detachItems = PANELS.map((panel) => ({ label: panel[0].toUpperCase() + panel.slice(1), click: () => createPanelWindow(panel) }));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "File", submenu: [
      { label: "New", accelerator: "Ctrl+N", click: () => sendCommand("new") },
      { label: "Open…", accelerator: "Ctrl+O", click: () => sendCommand("open") },
      { label: "Save", accelerator: "Ctrl+S", click: () => sendCommand("save") },
      { label: "Save As…", accelerator: "Ctrl+Shift+S", click: () => sendCommand("save-as") },
      { type: "separator" }, { role: "quit" },
    ] },
    { label: "Edit", submenu: [
      { label: "Undo", accelerator: "Ctrl+Z", click: () => sendCommand("undo") },
      { label: "Redo", accelerator: "Ctrl+Y", click: () => sendCommand("redo") },
      { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" },
    ] },
    { label: "Node", submenu: [
      { label: "Add root node", accelerator: "Ctrl+Shift+N", click: () => sendCommand("add-root") },
      { label: "Add child node", accelerator: "Ctrl+Alt+N", click: () => sendCommand("add-child") },
      { label: "Delete selected", accelerator: "Delete", click: () => sendCommand("delete-selected") },
      { type: "separator" },
      { label: "Expand selected", click: () => sendCommand("expand-selected") },
      { label: "Collapse selected", click: () => sendCommand("collapse-selected") },
    ] },
    { label: "View", submenu: [
      { label: "Panels", submenu: [...panelItems, { type: "separator" }, { label: "Reset workspace layout", click: () => sendCommand("reset-workspace") }] },
      { type: "separator" },
      { label: "Fit graph", accelerator: "Ctrl+0", click: () => sendCommand("fit-graph") },
      { label: "Re-layout graph", accelerator: "Ctrl+L", click: () => sendCommand("relayout-graph") },
      { label: "Show all nodes", click: () => sendCommand("show-all") },
      { label: "Collapse to roots", click: () => sendCommand("collapse-all") },
      { type: "separator" }, { role: "togglefullscreen" }, { role: "toggleDevTools" },
    ] },
    { label: "Window", submenu: [{ label: "Detach panel", submenu: detachItems }, { type: "separator" }, { role: "minimize" }, { role: "zoom" }, { role: "close" }] },
    { role: "help", submenu: [] },
  ]));
}

app.whenReady().then(() => {
  registerIpc(); createMenu(); createMainWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
