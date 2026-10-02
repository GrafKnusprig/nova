import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { accessSync, closeSync, mkdirSync, openSync, promises as fs, realpathSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { measureCliPhase } from "./cliProfile";
import { assertObject, flattenNodes, nodes, projectRootId, stringValue, validateMap, VIEWER_VERSION, type JsonObject } from "./project";

export const NOVA_DATABASE_VERSION = 1;
const APPLICATION_ID = 0x4e4f5641; // NOVA

type DatabaseRow = Record<string, string | number | bigint | Uint8Array | null>;

function parseJson<T>(raw: unknown, label: string): T {
  if (typeof raw !== "string") throw new Error(`The NOVA database ${label} is invalid.`);
  try { return JSON.parse(raw) as T; }
  catch { throw new Error(`The NOVA database ${label} contains invalid JSON.`); }
}

function openDatabase(filePath: string): DatabaseSync {
  return measureCliPhase("sqlite.open", () => openDatabaseUnmeasured(filePath));
}

function openDatabaseUnmeasured(filePath: string): DatabaseSync {
  let db: DatabaseSync;
  try { db = new DatabaseSync(filePath); }
  catch (error) { throw new Error(`Could not open NOVA database ${filePath}: ${error instanceof Error ? error.message : String(error)}`); }
  try {
    db.exec("PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL;");
    const applicationId = Number(db.prepare("PRAGMA application_id").get()?.application_id ?? 0);
    const version = Number(db.prepare("PRAGMA user_version").get()?.user_version ?? 0);
    if (applicationId !== APPLICATION_ID || version !== NOVA_DATABASE_VERSION)
      throw new Error(`Unsupported or invalid NOVA database (application_id=${applicationId}, schema=${version}).`);
    return db;
  } catch (error) { db.close(); throw error; }
}

function createSchema(db: DatabaseSync): void {
  db.exec(`
    PRAGMA foreign_keys=ON;
    PRAGMA journal_mode=WAL;
    PRAGMA synchronous=FULL;
    CREATE TABLE project_info (
      singleton INTEGER PRIMARY KEY CHECK(singleton=1),
      schema_version INTEGER NOT NULL,
      viewer_version TEXT NOT NULL,
      root_node_id TEXT NOT NULL,
      extra_json TEXT NOT NULL
    );
    CREATE TABLE project_context (
      singleton INTEGER PRIMARY KEY CHECK(singleton=1),
      data_json TEXT NOT NULL
    );
    CREATE TABLE project_view (
      singleton INTEGER PRIMARY KEY CHECK(singleton=1),
      data_json TEXT NOT NULL
    );
    CREATE TABLE nodes (
      id TEXT PRIMARY KEY,
      parent_id TEXT REFERENCES nodes(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
      sort_order INTEGER NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      rationale TEXT,
      tags_json TEXT NOT NULL,
      main_tag TEXT NOT NULL,
      created_at TEXT NOT NULL,
      modified_at TEXT NOT NULL,
      extra_json TEXT NOT NULL,
      UNIQUE(parent_id, sort_order)
    );
    CREATE INDEX nodes_parent_order ON nodes(parent_id, sort_order);
    CREATE TABLE links (
      source_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      relation TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      PRIMARY KEY(source_id, sort_order),
      CHECK(source_id <> target_id)
    );
    CREATE INDEX links_target ON links(target_id, source_id);
    CREATE VIRTUAL TABLE nodes_fts USING fts5(
      node_id UNINDEXED, title, summary, rationale, tags,
      tokenize='unicode61 remove_diacritics 2'
    );
    CREATE TRIGGER nodes_fts_insert AFTER INSERT ON nodes BEGIN
      INSERT INTO nodes_fts(rowid, node_id, title, summary, rationale, tags)
      VALUES (new.rowid, new.id, new.title, new.summary, coalesce(new.rationale, ''), new.tags_json || ' ' || new.main_tag);
    END;
    CREATE TRIGGER nodes_fts_update AFTER UPDATE ON nodes BEGIN
      DELETE FROM nodes_fts WHERE rowid=old.rowid;
      INSERT INTO nodes_fts(rowid, node_id, title, summary, rationale, tags)
      VALUES (new.rowid, new.id, new.title, new.summary, coalesce(new.rationale, ''), new.tags_json || ' ' || new.main_tag);
    END;
    CREATE TRIGGER nodes_fts_delete AFTER DELETE ON nodes BEGIN
      DELETE FROM nodes_fts WHERE rowid=old.rowid;
    END;
    PRAGMA application_id=${APPLICATION_ID};
    PRAGMA user_version=${NOVA_DATABASE_VERSION};
  `);
}

function extraFields(value: JsonObject, known: string[]): JsonObject {
  const extra: JsonObject = {};
  for (const [key, item] of Object.entries(value)) if (!known.includes(key)) extra[key] = item;
  return extra;
}

function rawNodeMap(document: JsonObject): Map<string, JsonObject> {
  const result = new Map<string, JsonObject>();
  const visit = (entries: JsonObject[]) => entries.forEach((node) => {
    result.set(stringValue(node.id, "node.id"), node);
    visit(node.children as JsonObject[]);
  });
  visit(nodes(document));
  return result;
}

function executeInsert(db: DatabaseSync, sql: string, values: unknown[]): void {
  db.prepare(sql).run(...values as (string | number | bigint | Uint8Array | null)[]);
}

function writeDocument(db: DatabaseSync, document: JsonObject): void {
  const rootId = projectRootId(document);
  const projectExtras = extraFields(document, ["version", "viewer_version", "project", "llm_context", "nodes", "view"]);
  executeInsert(db,
    "INSERT INTO project_info(singleton,schema_version,viewer_version,root_node_id,extra_json) VALUES(1,?,?,?,?)",
    [Number(document.version), stringValue(document.viewer_version, "viewer_version"), rootId, JSON.stringify(projectExtras)]);
  executeInsert(db, "INSERT INTO project_context(singleton,data_json) VALUES(1,?)", [JSON.stringify(document.llm_context)]);
  executeInsert(db, "INSERT INTO project_view(singleton,data_json) VALUES(1,?)", [JSON.stringify(document.view)]);

  const all = flattenNodes(nodes(document));
  const rawById = rawNodeMap(document);
  const orderById = new Map<string, number>();
  const recordOrder = (entries: JsonObject[]) => entries.forEach((node, index) => {
    orderById.set(stringValue(node.id, "node.id"), index);
    recordOrder(node.children as JsonObject[]);
  });
  recordOrder(nodes(document));
  const insertNode = db.prepare(`INSERT INTO nodes(
    id,parent_id,sort_order,title,summary,rationale,tags_json,main_tag,created_at,modified_at,extra_json
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
  for (const node of all) {
    const parentId = node.parentId ?? null;
    const sortOrder = orderById.get(stringValue(node.id, "node.id")) ?? 0;
    const extra = extraFields(rawById.get(stringValue(node.id, "node.id"))!, ["id", "title", "summary", "rationale", "tags", "main_tag", "created_at", "modified_at", "children", "links"]);
    insertNode.run(
      stringValue(node.id, "node.id"), parentId, sortOrder,
      stringValue(node.title, "node.title"), stringValue(node.summary, "node.summary"),
      typeof node.rationale === "string" ? node.rationale : null,
      JSON.stringify(node.tags), stringValue(node.main_tag, "node.main_tag"),
      stringValue(node.created_at, "node.created_at"), stringValue(node.modified_at, "node.modified_at"),
      JSON.stringify(extra),
    );
  }
  const insertLink = db.prepare("INSERT INTO links(source_id,target_id,relation,sort_order) VALUES(?,?,?,?)");
  for (const node of all) for (const [index, link] of (node.links as Array<{ target: string; relation: string }>).entries())
    insertLink.run(stringValue(node.id, "node.id"), link.target, link.relation, index);
}

function loadDocument(db: DatabaseSync): JsonObject {
  const info = db.prepare("SELECT schema_version,viewer_version,root_node_id,extra_json FROM project_info WHERE singleton=1").get() as DatabaseRow | undefined;
  const contextRow = db.prepare("SELECT data_json FROM project_context WHERE singleton=1").get() as DatabaseRow | undefined;
  const viewRow = db.prepare("SELECT data_json FROM project_view WHERE singleton=1").get() as DatabaseRow | undefined;
  if (!info || !contextRow || !viewRow) throw new Error("The NOVA database is missing required project metadata.");
  const nodeRows = measureCliPhase("sqlite.select-nodes", () => db.prepare("SELECT id,parent_id,sort_order,title,summary,rationale,tags_json,main_tag,created_at,modified_at,extra_json FROM nodes ORDER BY parent_id,sort_order").all()) as DatabaseRow[];
  const nodeMap = new Map<string, JsonObject>();
  for (const row of nodeRows) {
    const id = stringValue(row.id, "database node id");
    const extra = parseJson<JsonObject>(row.extra_json, `node ${id} extras`);
    nodeMap.set(id, {
      ...extra,
      id,
      title: stringValue(row.title, "database node title"),
      tags: parseJson<unknown[]>(row.tags_json, `node ${id} tags`),
      main_tag: stringValue(row.main_tag, "database node main_tag"),
      summary: stringValue(row.summary, "database node summary"),
      ...(row.rationale === null ? {} : { rationale: stringValue(row.rationale, "database node rationale") }),
      created_at: stringValue(row.created_at, "database node created_at"),
      modified_at: stringValue(row.modified_at, "database node modified_at"),
      children: [],
      links: [],
    });
  }
  for (const row of nodeRows) {
    if (row.parent_id === null) continue;
    const parent = nodeMap.get(stringValue(row.parent_id, "database parent id"));
    const child = nodeMap.get(stringValue(row.id, "database child id"));
    if (!parent || !child) throw new Error("The NOVA database contains an orphan hierarchy record.");
    (parent.children as JsonObject[]).push(child);
  }
  const linkRows = measureCliPhase("sqlite.select-links", () => db.prepare("SELECT source_id,target_id,relation FROM links ORDER BY source_id,sort_order").all()) as DatabaseRow[];
  for (const row of linkRows) {
    const source = nodeMap.get(stringValue(row.source_id, "database link source"));
    if (!source) throw new Error("The NOVA database contains a link with a missing source.");
    (source.links as JsonObject[]).push({ target: row.target_id, relation: row.relation });
  }
  const rootId = stringValue(info.root_node_id, "database root id");
  const root = nodeMap.get(rootId);
  if (!root || nodeRows.filter((row) => row.parent_id === null).length !== 1)
    throw new Error("The NOVA database must contain exactly one project root.");
  const document: JsonObject = {
    ...parseJson<JsonObject>(info.extra_json, "project extras"),
    version: Number(info.schema_version),
    viewer_version: stringValue(info.viewer_version, "database viewer version"),
    project: { root_node_id: rootId },
    llm_context: parseJson<JsonObject>(contextRow.data_json, "LLM context"),
    nodes: [root],
    view: parseJson<JsonObject>(viewRow.data_json, "view state"),
  };
  return measureCliPhase("sqlite.validate", () => validateMap(document));
}

function transaction<T>(db: DatabaseSync, callback: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const value = callback();
    db.exec("COMMIT");
    return value;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* Preserve the original failure. */ }
    if (error instanceof Error && /database is (?:locked|busy)/i.test(error.message))
      throw new Error("Another NOVA process is writing to this project. Retry the operation shortly.");
    throw error;
  }
}

function nodeExtras(node: JsonObject): JsonObject {
  return extraFields(node, ["id", "title", "summary", "rationale", "tags", "main_tag", "created_at", "modified_at", "children", "links"]);
}

function nodeOrder(document: JsonObject): Map<string, { parentId?: string; position: number }> {
  const result = new Map<string, { parentId?: string; position: number }>();
  const visit = (entries: JsonObject[], parentId?: string) => entries.forEach((node, position) => {
    result.set(stringValue(node.id, "node.id"), { parentId, position });
    visit(node.children as JsonObject[], stringValue(node.id, "node.id"));
  });
  visit(nodes(document));
  return result;
}

function storedNodeData(node: JsonObject): JsonObject {
  const { children: _children, ...stored } = node;
  return stored;
}

function nextSiblingOrder(db: DatabaseSync, parentId: string | null): number {
  const row = db.prepare("SELECT coalesce(max(sort_order),-1)+1 AS next_order FROM nodes WHERE parent_id IS ?").get(parentId) as DatabaseRow | undefined;
  return Number(row?.next_order ?? 0);
}

function insertSqliteNode(db: DatabaseSync, node: JsonObject, parentId: string | null, sortOrder: number): void {
  db.prepare(`INSERT INTO nodes(id,parent_id,sort_order,title,summary,rationale,tags_json,main_tag,created_at,modified_at,extra_json)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
    stringValue(node.id, "node.id"), parentId, sortOrder, stringValue(node.title, "node.title"),
    stringValue(node.summary, "node.summary"), typeof node.rationale === "string" ? node.rationale : null,
    JSON.stringify(node.tags), stringValue(node.main_tag, "node.main_tag"), stringValue(node.created_at, "node.created_at"),
    stringValue(node.modified_at, "node.modified_at"), JSON.stringify(nodeExtras(node)),
  );
  const insertLink = db.prepare("INSERT INTO links(source_id,target_id,relation,sort_order) VALUES(?,?,?,?)");
  for (const [index, link] of (node.links as Array<{ target: string; relation: string }>).entries())
    insertLink.run(stringValue(node.id, "node.id"), link.target, link.relation, index);
}

function updateSqliteNode(db: DatabaseSync, node: JsonObject, parentId: string | null, sortOrder: number): void {
  db.prepare(`UPDATE nodes SET parent_id=?,sort_order=?,title=?,summary=?,rationale=?,tags_json=?,main_tag=?,created_at=?,modified_at=?,extra_json=? WHERE id=?`).run(
    parentId, sortOrder, stringValue(node.title, "node.title"), stringValue(node.summary, "node.summary"),
    typeof node.rationale === "string" ? node.rationale : null, JSON.stringify(node.tags), stringValue(node.main_tag, "node.main_tag"),
    stringValue(node.created_at, "node.created_at"), stringValue(node.modified_at, "node.modified_at"), JSON.stringify(nodeExtras(node)),
    stringValue(node.id, "node.id"),
  );
  db.prepare("DELETE FROM links WHERE source_id=?").run(stringValue(node.id, "node.id"));
  const insertLink = db.prepare("INSERT INTO links(source_id,target_id,relation,sort_order) VALUES(?,?,?,?)");
  for (const [index, link] of (node.links as Array<{ target: string; relation: string }>).entries())
    insertLink.run(stringValue(node.id, "node.id"), link.target, link.relation, index);
}

function applySqliteMutation(db: DatabaseSync, before: JsonObject, after: JsonObject): void {
  const oldNodes = rawNodeMap(before);
  const newNodes = rawNodeMap(after);
  const oldOrder = nodeOrder(before), newOrder = nodeOrder(after);
  const deleted = new Set([...oldNodes.keys()].filter((id) => !newNodes.has(id)));
  for (const id of deleted) {
    const parentId = oldOrder.get(id)?.parentId;
    if (parentId && deleted.has(parentId)) continue;
    db.prepare("DELETE FROM nodes WHERE id=?").run(id);
  }

  const orderedNewNodes = flattenNodes(nodes(after));
  for (const indexed of orderedNewNodes) {
    const id = stringValue(indexed.id, "node.id"), node = newNodes.get(id)!;
    const parentId = indexed.parentId ?? null;
    const oldNode = oldNodes.get(id);
    if (!oldNode) {
      insertSqliteNode(db, node, parentId, nextSiblingOrder(db, parentId));
      continue;
    }
    const previousOrder = oldOrder.get(id)!, desiredOrder = newOrder.get(id)!;
    const movedOrReordered = previousOrder.parentId !== desiredOrder.parentId || previousOrder.position !== desiredOrder.position;
    const contentChanged = !isDeepStrictEqual(storedNodeData(oldNode), storedNodeData(node));
    if (!movedOrReordered && !contentChanged) continue;
    const parentChanged = previousOrder.parentId !== desiredOrder.parentId;
    const positionChanged = previousOrder.position !== desiredOrder.position;
    const parent = desiredOrder.parentId ?? null;
    const order = parentChanged || positionChanged ? nextSiblingOrder(db, parent) : Number(
      db.prepare("SELECT sort_order FROM nodes WHERE id=?").get(id)?.sort_order ?? 0,
    );
    updateSqliteNode(db, node, parent, order);
  }

  const extras = extraFields(after, ["version", "viewer_version", "project", "llm_context", "nodes", "view"]);
  db.prepare("UPDATE project_info SET schema_version=?,viewer_version=?,root_node_id=?,extra_json=? WHERE singleton=1").run(
    Number(after.version), stringValue(after.viewer_version, "viewer_version"), projectRootId(after), JSON.stringify(extras),
  );
  if (!isDeepStrictEqual(before.llm_context, after.llm_context))
    db.prepare("UPDATE project_context SET data_json=? WHERE singleton=1").run(JSON.stringify(after.llm_context));
  if (!isDeepStrictEqual(before.view, after.view))
    db.prepare("UPDATE project_view SET data_json=? WHERE singleton=1").run(JSON.stringify(after.view));
}

export function isNovaDatabasePath(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === ".nova";
}

export async function readJsonProjectForImport(filePath: string): Promise<JsonObject> {
  if (path.extname(filePath).toLowerCase() !== ".json") throw new Error("The import source must use the .json extension.");
  const raw = JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
  assertObject(raw, "JSON project");
  if (raw.version === 7) return validateMap(raw);
  if (raw.version !== 6) throw new Error(`Unsupported JSON project schema ${String(raw.version)}. Import supports schema 6 and schema 7.`);
  assertObject(raw.project, "schema-6 project");
  if (typeof raw.project.name !== "string" || typeof raw.project.summary !== "string" || !Array.isArray(raw.nodes))
    throw new Error("Schema-6 project metadata or nodes are invalid.");
  const projectName = raw.project.name.trim() || "Untitled project";
  const projectSummary = raw.project.summary;
  const view = raw.view && typeof raw.view === "object" && !Array.isArray(raw.view) ? raw.view as JsonObject : {};
  const formerRoots = raw.nodes as JsonObject[];
  const timestamp = new Date().toISOString();
  const rootId = randomUUID().toLowerCase();
  const positions = view.positions && typeof view.positions === "object" && !Array.isArray(view.positions) ? view.positions as JsonObject : {};
  const positionedRoots = formerRoots.map((node) => positions[stringValue(node.id, "node.id")]).filter((point): point is number[] => Array.isArray(point) && point.length === 2 && point.every((entry) => typeof entry === "number"));
  const rootPosition: [number, number] = positionedRoots.length
    ? [positionedRoots.reduce((sum, point) => sum + point[0], 0) / positionedRoots.length, positionedRoots.reduce((sum, point) => sum + point[1], 0) / positionedRoots.length]
    : [600, 400];
  const expanded = Array.isArray(view.expanded) ? view.expanded : [];
  raw.version = 7;
  raw.viewer_version = VIEWER_VERSION;
  raw.project = { root_node_id: rootId };
  raw.nodes = [{
    id: rootId,
    title: projectName,
    tags: ["concept", "project-governance"],
    main_tag: "project-governance",
    summary: projectSummary,
    rationale: "This protected root carries the project identity and groups the map's main topics.",
    created_at: timestamp,
    modified_at: timestamp,
    children: formerRoots,
    links: [],
  }];
  raw.view = {
    ...view,
    expanded: [...new Set([rootId, ...expanded])],
    positions: { ...positions, [rootId]: rootPosition },
    layout_mode: view.layout_mode ?? "hierarchy",
    layout_compact: view.layout_compact ?? false,
  };
  return validateMap(raw);
}

export function readSqliteProject(filePath: string): { document: JsonObject; revision: string } {
  const retained = retainedSession(filePath);
  if (retained) return retained.read();
  const db = openDatabase(filePath);
  try {
    const document = measureCliPhase("sqlite.load-document", () => loadDocument(db));
    return { document, revision: measureCliPhase("sqlite.revision-json", () => JSON.stringify(document)) };
  } finally { measureCliPhase("sqlite.close", () => db.close()); }
}

export function searchSqliteIndex(filePath: string, query: string, limit = 100): Map<string, number> {
  const retained = retainedSession(filePath);
  if (retained) return retained.search(query, limit);
  const db = openDatabase(filePath);
  try { return searchIndexOnConnection(db, query, limit); } finally { db.close(); }
}

function searchIndexOnConnection(db: DatabaseSync, query: string, limit: number): Map<string, number> {
  const terms = [...new Set(query.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().match(/[a-z0-9]+/g) ?? [])]
    .filter((term) => term.length > 1);
  if (!terms.length) return new Map();
  const expression = terms.map((term) => `"${term.replace(/"/g, '""')}"*`).join(" OR ");
  try {
    const rows = measureCliPhase("sqlite.fts", () => db.prepare(`SELECT node_id, bm25(nodes_fts, 0, 8, 2, 1, 1) AS rank
      FROM nodes_fts WHERE nodes_fts MATCH ? ORDER BY rank LIMIT ?`).all(expression, limit)) as DatabaseRow[];
    return new Map(rows.map((row) => [stringValue(row.node_id, "FTS node id"), Math.max(0, 100 - Number(row.rank) * 10)]));
  } catch (error) {
    if (error instanceof Error && /fts5: syntax error/i.test(error.message)) return new Map();
    throw error;
  }
}

const retainedSessions = new Map<string, SqliteReadSession>();
function retainedSession(filePath: string): SqliteReadSession | undefined {
  if (!retainedSessions.size) return undefined;
  return retainedSessions.get(path.resolve(filePath)) ?? retainedSessions.get(realpathSync(filePath));
}

function freezeSnapshot(value: unknown): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  for (const nested of Object.values(value)) freezeSnapshot(nested);
  Object.freeze(value);
}

/** Worker-owned immutable snapshot. No transaction survives a request. */
export class SqliteReadSession {
  private db?: DatabaseSync;
  private identity: string;
  private dataVersion = -1;
  private snapshot?: { document: JsonObject; revision: string };
  private byId = new Map<string, JsonObject>();
  private searches = new Map<string, Map<string, number>>();
  private active = false;
  private generation = 0;
  private reloads = 0;

  constructor(readonly filePath: string) {
    this.identity = this.fileIdentity();
    this.db = openDatabase(filePath);
  }
  private fileIdentity(): string { const stat = statSync(this.filePath); return `${stat.dev}:${stat.ino}`; }
  begin(): void {
    if (this.active) throw new Error("A cached read request is already active.");
    const identity = this.fileIdentity();
    if (identity !== this.identity) {
      this.db?.close(); this.db = undefined; this.identity = identity;
      this.snapshot = undefined; this.dataVersion = -1;
    }
    this.db ??= openDatabase(this.filePath);
    const db = this.db;
    db.exec("BEGIN"); this.active = true;
    try {
      // Pin a read snapshot before comparing the connection-local change marker.
      db.prepare("SELECT root_node_id FROM project_info WHERE singleton=1").get();
      const version = Number(db.prepare("PRAGMA data_version").get()?.data_version ?? 0);
      if (!this.snapshot || version !== this.dataVersion) {
        const document = measureCliPhase("cache.reload", () => loadDocument(db));
        const revision = measureCliPhase("cache.revision-on-change", () => JSON.stringify(document));
        const byId = rawNodeMap(document);
        freezeSnapshot(document);
        this.snapshot = { document, revision }; this.byId = byId;
        this.searches.clear(); this.dataVersion = version; this.generation++; this.reloads++;
      }
    } catch (error) { this.end(); throw error; }
  }
  end(): void { if (this.active) { this.db!.exec("ROLLBACK"); this.active = false; } }
  read(): { document: JsonObject; revision: string } {
    if (!this.active || !this.snapshot) throw new Error("Cached reads require an active request snapshot.");
    return this.snapshot;
  }
  node(id: string): JsonObject | undefined { this.read(); return this.byId.get(id); }
  search(query: string, limit: number): Map<string, number> {
    this.read();
    const key = `${limit}:${query}`;
    const cached = this.searches.get(key);
    if (cached) return cached;
    const result = searchIndexOnConnection(this.db!, query, limit);
    if (this.searches.size >= 64) this.searches.delete(this.searches.keys().next().value!);
    this.searches.set(key, result); return result;
  }
  status(): JsonObject { return { generation: this.generation, reload_count: this.reloads, node_count: this.byId.size, query_cache_size: this.searches.size }; }
  close(): void { this.end(); this.db?.close(); this.db = undefined; this.snapshot = undefined; this.byId.clear(); this.searches.clear(); }
}

export function retainSqliteReadSession(filePath: string): SqliteReadSession {
  const resolved = path.resolve(filePath);
  if (retainedSessions.has(resolved)) throw new Error("This project already has a retained read session.");
  const session = new SqliteReadSession(resolved); retainedSessions.set(resolved, session); return session;
}
export function releaseSqliteReadSession(filePath: string): void {
  const resolved = path.resolve(filePath), session = retainedSessions.get(resolved);
  retainedSessions.delete(resolved); session?.close();
}
export function findCachedSqliteNode(filePath: string, id: string): JsonObject | undefined {
  return retainedSession(filePath)?.node(id);
}

export function watchSqliteProject(filePath: string): { readChanged(): { document: JsonObject; revision: string } | undefined; close(): void } {
  const db = openDatabase(filePath);
  let dataVersion = Number(db.prepare("PRAGMA data_version").get()?.data_version ?? 0);
  return {
    readChanged() {
      const nextVersion = Number(db.prepare("PRAGMA data_version").get()?.data_version ?? 0);
      if (nextVersion === dataVersion) return undefined;
      dataVersion = nextVersion;
      const document = loadDocument(db);
      return { document, revision: JSON.stringify(document) };
    },
    close() { db.close(); },
  };
}

export function writeSqliteProject(filePath: string, raw: unknown, expectedRevision?: string): JsonObject {
  const candidate = structuredClone(raw);
  assertObject(candidate, "Mind-map root");
  const document = validateMap(candidate);
  if (!fsSyncExists(filePath)) {
    if (expectedRevision !== undefined) throw new Error("The project database disappeared after it was read; reload it before saving.");
    mkdirSync(path.dirname(filePath), { recursive: true });
    let fd: number;
    try { fd = openSync(filePath, "wx"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("The project database was created by another process; reopen it before saving."); throw error; }
    closeSync(fd);
    try { return initializeSqliteProject(filePath, document); }
    catch (error) { removeSqliteFiles(filePath); throw error; }
  }
  const db = openDatabase(filePath);
  try {
    return transaction(db, () => {
      const before = loadDocument(db);
      if (expectedRevision !== undefined && JSON.stringify(before) !== expectedRevision)
        throw new Error("The project changed after it was read; reload it before saving to avoid overwriting newer changes.");
      applySqliteMutation(db, before, document);
      return loadDocument(db);
    });
  } finally { db.close(); }
}

export function mutateSqliteProject(filePath: string, mutation: (document: JsonObject) => unknown): { document: JsonObject; result: unknown } {
  const db = openDatabase(filePath);
  try {
    return transaction(db, () => {
      const before = measureCliPhase("sqlite.load-document", () => loadDocument(db));
      const after = measureCliPhase("sqlite.clone", () => structuredClone(before));
      const result = mutation(after);
      after.viewer_version = stringValue(before.viewer_version, "viewer_version");
      measureCliPhase("sqlite.validate-candidate", () => validateMap(after));
      measureCliPhase("sqlite.apply-mutation", () => applySqliteMutation(db, before, after));
      return { document: measureCliPhase("sqlite.load-document", () => loadDocument(db)), result };
    });
  } finally { db.close(); }
}

function fsSyncExists(filePath: string): boolean {
  try { accessSync(filePath); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

export function initializeSqliteProject(filePath: string, raw: unknown): JsonObject {
  const document = validateMap(raw);
  const db = new DatabaseSync(filePath);
  try {
    createSchema(db);
    transaction(db, () => writeDocument(db, document));
  } catch (error) {
    try { db.close(); } catch { /* Best-effort cleanup before removing a failed new database. */ }
    removeSqliteFiles(filePath);
    throw error;
  }
  db.close();
  return document;
}

export async function createSqliteProjectFile(filePath: string, document: JsonObject): Promise<JsonObject> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const handle = await fs.open(filePath, "wx");
  await handle.close();
  try { return initializeSqliteProject(filePath, document); }
  catch (error) { await removeSqliteFilesAsync(filePath); throw error; }
}

export async function migrateJsonToSqlite(targetPath: string, document: JsonObject): Promise<JsonObject> {
  if (!isNovaDatabasePath(targetPath)) throw new Error("The migration destination must use the .nova extension.");
  const absoluteTarget = path.resolve(targetPath);
  const handle = await fs.open(absoluteTarget, "wx");
  await handle.close();
  try {
    const migrated = initializeSqliteProject(absoluteTarget, document);
    const roundTrip = readSqliteProject(absoluteTarget).document;
    if (!isDeepStrictEqual(migrated, roundTrip)) throw new Error("The migrated database did not preserve the complete project data.");
    return roundTrip;
  }
  catch (error) { await removeSqliteFilesAsync(absoluteTarget); throw error; }
}

function removeSqliteFiles(filePath: string): void {
  for (const candidate of [filePath, `${filePath}-wal`, `${filePath}-shm`])
    try { rmSync(candidate, { force: true }); } catch { /* Best-effort cleanup of an uncommitted new database. */ }
}

async function removeSqliteFilesAsync(filePath: string): Promise<void> {
  await Promise.all([filePath, `${filePath}-wal`, `${filePath}-shm`].map((candidate) => fs.rm(candidate, { force: true }).catch(() => undefined)));
}

export async function exportSqliteToJson(sourcePath: string, targetPath: string, overwrite = false): Promise<JsonObject> {
  const { document } = readSqliteProject(sourcePath);
  const absoluteTarget = path.resolve(targetPath);
  if (path.extname(absoluteTarget).toLowerCase() !== ".json") throw new Error("The export destination must use the .json extension.");
  await fs.mkdir(path.dirname(absoluteTarget), { recursive: true });
  if (!overwrite) {
    const handle = await fs.open(absoluteTarget, "wx");
    try { await handle.writeFile(`${JSON.stringify(document, null, 2)}\n`, "utf8"); }
    finally { await handle.close(); }
  } else {
    const temporary = `${absoluteTarget}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fs.writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      await fs.rename(temporary, absoluteTarget);
    } catch (error) { await fs.rm(temporary, { force: true }).catch(() => undefined); throw error; }
  }
  return document;
}

export function sqliteMigrationStatus(filePath: string): JsonObject {
  const { document } = readSqliteProject(filePath);
  return { storage: "sqlite", format: "NOVA", database_schema: NOVA_DATABASE_VERSION, project_schema: document.version, root_node_id: projectRootId(document), node_count: flattenNodes(nodes(document)).length };
}
