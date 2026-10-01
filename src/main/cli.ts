import { promises as fs } from "node:fs";
import path from "node:path";
import { addLlmInstruction, changeProjectLink, children, createProjectFile, createProjectNode, defineProjectTag, deleteProjectNode, findNode, flattenNodes, generateUniqueId, moveProjectNode, mutateProject, nodes, projectRoot, projectRootId, readProject, removeLlmInstruction, removeProjectTagDefinition, setLlmContextSummary, stringValue, updateProjectNode, VIEWER_VERSION } from "./project";
import { initializeProjectAgents } from "./agentsFile";
import { auditProject } from "./audit";
import { buildContextPack, searchProject } from "./context";
import { exportSqliteToJson, isNovaDatabasePath, migrateJsonToSqlite, readJsonProjectForImport, searchSqliteIndex, sqliteMigrationStatus } from "./sqliteProject";

type Options = Record<string, string | boolean>;
const HELP = `NOVA CLI ${VIEWER_VERSION}

Usage: NOVA-CLI.exe <command> --project <project-file.json|project.nova> [options]
       NOVA.exe cli <command> --project <project-file.json|project.nova> [options]

Commands:
  init         Create a schema-7 project in JSON or SQLite (.nova). Options: --name, --summary, --summary-file
  validate     Validate a project and report its root, node count, and link count
  audit        Review knowledge quality and report non-mutating candidate findings
  id           Generate a collision-checked UUID candidate (not reserved); create returns the created ID
  list         List compact node records. Optional: --parent <id>
  search       Search all nodes by ID, title, summary, rationale, and tags. Required: --query. Optional: --category <root-child-id>, --limit
  context      Build a bounded agent context pack. Required: --query. Optional: --category <root-child-id>, --scope category|all, --token-budget, --related-depth
  migrate      Copy a schema-6 or schema-7 JSON project to a new .nova database. Required: --to <database.nova>
  import       Import schema-6 or schema-7 JSON into a new .nova database. Required: --from <project.json>. --project is the destination.
  export       Export a .nova database to JSON. Required: --to <project.json>. Optional: --overwrite
  migration-status  Report storage format and database schema status
  get          Read one complete node subtree. Required: --id
  create       Create a node. Required: --title. Optional: --parent, --summary, --summary-file,
               --rationale, --rationale-file, --tags tag-a,tag-b, --main-tag
  update       Update a node. Required: --id. Accepts the same content/tag options as create,
               plus --clear-rationale
  move         Reparent a node. Required: --id, --parent
  delete       Permanently delete a subtree. Required: --id, --yes
  link-add     Add a semantic link. Required: --source, --target, --relation
  link-remove  Remove a semantic link. Required: --source, --target, --relation
  context-get  Read project-specific LLM guidance and tag definitions
  context-set  Set the LLM context summary. Required: --summary or --summary-file
  instruction-add     Add one project-specific instruction. Required: --instruction or --instruction-file
  instruction-remove  Remove an exact project-specific instruction. Required: --instruction or --instruction-file
  tag-define    Create or replace a custom tag definition. Required: --tag, --description or --description-file
  tag-remove    Remove a custom tag definition. Required: --tag

Every successful command emits JSON. Errors emit JSON on stderr and return a nonzero exit code.`;

function parse(args: string[]): { command?: string; options: Options } { const [command, ...rest] = args; const options: Options = {}; for (let index = 0; index < rest.length; index += 1) { const item = rest[index]; if (!item.startsWith("--")) throw new Error(`Unexpected argument: ${item}`); const equals = item.indexOf("="); if (equals > 2) { options[item.slice(2, equals)] = item.slice(equals + 1); continue; } const key = item.slice(2), next = rest[index + 1]; if (next !== undefined && !next.startsWith("--")) { options[key] = next; index += 1; } else options[key] = true; } return { command, options }; }
function option(options: Options, key: string): string | undefined { const value = options[key]; return typeof value === "string" ? value : undefined; }
function required(options: Options, key: string): string { const value = option(options, key); if (value === undefined || !value.trim()) throw new Error(`--${key} is required.`); return value; }
function projectPath(options: Options): string { return path.resolve(required(options, "project")); }
async function textOption(options: Options, key: string): Promise<string | undefined> { const inline = option(options, key), file = option(options, `${key}-file`); if (inline !== undefined && file !== undefined) throw new Error(`Use either --${key} or --${key}-file, not both.`); return file === undefined ? inline : fs.readFile(path.resolve(file), "utf8"); }
function writeJson(value: unknown, error = false): void { (error ? process.stderr : process.stdout).write(`${JSON.stringify(value, null, 2)}\n`); }
function compact(node: Record<string, unknown>): Record<string, unknown> { return { id: node.id, parent_id: node.parentId, depth: node.depth, title: node.title, tags: node.tags, main_tag: node.main_tag, summary: node.summary, rationale: node.rationale, child_count: children(node).length, link_count: Array.isArray(node.links) ? node.links.length : 0, created_at: node.created_at, modified_at: node.modified_at }; }
function boundedInteger(options: Options, key: string, fallback: number, minimum: number, maximum: number): number { const raw = option(options, key); if (raw === undefined) return fallback; const value = Number(raw); if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`--${key} must be an integer between ${minimum} and ${maximum}.`); return value; }

async function execute(command: string, options: Options): Promise<unknown> {
  const filePath = projectPath(options);
  if (command === "init") { const document = await createProjectFile(filePath, option(options, "name"), await textOption(options, "summary")); const agents = await initializeProjectAgents(filePath); const root = projectRoot(document); return { ok: true, command, project: filePath, agents, root_node_id: root.id, name: root.title }; }
  if (command === "migration-status") { if (isNovaDatabasePath(filePath)) return { ok: true, command, project: filePath, ...sqliteMigrationStatus(filePath) }; const document = await readJsonProjectForImport(filePath); return { ok: true, command, project: filePath, storage: "json", format: "schema-6-or-7-json", migration_available: true, normalized_schema: document.version, root_node_id: projectRootId(document), node_count: flattenNodes(nodes(document)).length }; }
  if (command === "migrate" || command === "import") { const sourcePath = path.resolve(command === "migrate" ? filePath : required(options, "from")); const targetPath = path.resolve(command === "migrate" ? required(options, "to") : filePath); const document = await readJsonProjectForImport(sourcePath); const migrated = await migrateJsonToSqlite(targetPath, document); return { ok: true, command, source: sourcePath, project: targetPath, storage: "sqlite", schema: migrated.version, root_node_id: projectRootId(migrated), node_count: flattenNodes(nodes(migrated)).length, source_preserved: true }; }
  if (command === "export") { if (!isNovaDatabasePath(filePath)) throw new Error("Export source must be a .nova database."); const targetPath = path.resolve(required(options, "to")); const document = await exportSqliteToJson(filePath, targetPath, options.overwrite === true || option(options, "overwrite") === "true"); return { ok: true, command, project: filePath, export: targetPath, schema: document.version, root_node_id: projectRootId(document), node_count: flattenNodes(nodes(document)).length }; }
  if (command === "validate") { const { document } = await readProject(filePath); const all = flattenNodes(nodes(document)), links = all.reduce((sum, node) => sum + (node.links as unknown[]).length, 0), root = projectRoot(document); return { ok: true, command, project: filePath, schema: document.version, viewer_version: document.viewer_version, root_node_id: root.id, name: root.title, node_count: all.length, link_count: links }; }
  if (command === "audit") { const { document } = await readProject(filePath); return { ok: true, command, project: filePath, ...auditProject(document) }; }
  if (command === "id") { const { document } = await readProject(filePath); return { ok: true, command, project: filePath, id: generateUniqueId(document) }; }
  if (command === "list") { const { document } = await readProject(filePath); const parentId = option(options, "parent"), entries = parentId ? children(findNode(nodes(document), parentId) ?? (() => { throw new Error(`Node ${parentId} does not exist.`); })()).map((node) => ({ ...node, parentId, depth: flattenNodes(nodes(document)).find((entry) => entry.id === parentId)!.depth + 1 })) : flattenNodes(nodes(document)); return { ok: true, command, project: filePath, nodes: entries.map(compact) }; }
  if (command === "search") { const { document } = await readProject(filePath), query = required(options, "query"), limit = boundedInteger(options, "limit", 30, 1, 100), index = isNovaDatabasePath(filePath) ? searchSqliteIndex(filePath, query) : undefined; return { ok: true, command, project: filePath, query, ...searchProject(document, query, option(options, "category"), limit, index) }; }
  if (command === "context") { const { document } = await readProject(filePath), query = required(options, "query"), tokenBudget = boundedInteger(options, "token-budget", 6000, 250, 50000), relatedDepth = boundedInteger(options, "related-depth", 1, 0, 3), scope = option(options, "scope") ?? "category", category = option(options, "category"), index = isNovaDatabasePath(filePath) ? searchSqliteIndex(filePath, query) : undefined; if (scope !== "category" && scope !== "all") throw new Error("--scope must be category or all."); if (scope === "all" && category) throw new Error("--category cannot be combined with --scope all."); return { ...buildContextPack(document, query, category, tokenBudget, relatedDepth, index, scope), project: filePath }; }
  if (command === "get") { const { document } = await readProject(filePath), id = required(options, "id"), node = findNode(nodes(document), id); if (!node) throw new Error(`Node ${id} does not exist.`); return { ok: true, command, project: filePath, node }; }
  if (command === "create") { const title = required(options, "title"), summary = await textOption(options, "summary"), rationale = await textOption(options, "rationale"); const changed = await mutateProject(filePath, (document) => createProjectNode(document, { parentId: option(options, "parent"), title, summary, rationale, tags: option(options, "tags"), mainTag: option(options, "main-tag") })); const node = changed.result as Record<string, unknown>; return { ok: true, command, project: filePath, id: node.id, parent_id: option(options, "parent") ?? projectRootId(changed.document), node }; }
  if (command === "update") { const id = required(options, "id"), summary = await textOption(options, "summary"), rationale = options["clear-rationale"] === true ? null : await textOption(options, "rationale"); const changed = await mutateProject(filePath, (document) => updateProjectNode(document, id, { title: option(options, "title"), summary, rationale, tags: option(options, "tags"), mainTag: option(options, "main-tag") })); return { ok: true, command, project: filePath, node: changed.result }; }
  if (command === "move") { const id = required(options, "id"), parentId = required(options, "parent"), changed = await mutateProject(filePath, (document) => moveProjectNode(document, id, parentId)); return { ok: true, command, project: filePath, id, parent_id: parentId, node: changed.result }; }
  if (command === "delete") { if (options.yes !== true && option(options, "yes") !== "true") throw new Error("Permanent deletion requires --yes."); const id = required(options, "id"), changed = await mutateProject(filePath, (document) => deleteProjectNode(document, id)); return { ok: true, command, project: filePath, id, deleted_node_count: changed.result }; }
  if (command === "link-add" || command === "link-remove") { const source = required(options, "source"), target = required(options, "target"), relation = required(options, "relation"), changed = await mutateProject(filePath, (document) => changeProjectLink(document, command === "link-add" ? "add" : "remove", source, target, relation)); return { ok: true, command, project: filePath, source, target, relation, node: changed.result }; }
  if (command === "context-get") { const { document } = await readProject(filePath); return { ok: true, command, project: filePath, llm_context: document.llm_context }; }
  if (command === "context-set") { const summary = await textOption(options, "summary"); if (summary === undefined) throw new Error("--summary or --summary-file is required."); const changed = await mutateProject(filePath, (document) => setLlmContextSummary(document, summary)); return { ok: true, command, project: filePath, llm_context: changed.result }; }
  if (command === "instruction-add" || command === "instruction-remove") { const instruction = await textOption(options, "instruction"); if (instruction === undefined) throw new Error("--instruction or --instruction-file is required."); const changed = await mutateProject(filePath, (document) => command === "instruction-add" ? addLlmInstruction(document, instruction) : removeLlmInstruction(document, instruction)); return { ok: true, command, project: filePath, llm_context: changed.result }; }
  if (command === "tag-define") { const tag = required(options, "tag"), description = await textOption(options, "description"); if (description === undefined) throw new Error("--description or --description-file is required."); const changed = await mutateProject(filePath, (document) => defineProjectTag(document, tag, description)); return { ok: true, command, project: filePath, llm_context: changed.result }; }
  if (command === "tag-remove") { const tag = required(options, "tag"), changed = await mutateProject(filePath, (document) => removeProjectTagDefinition(document, tag)); return { ok: true, command, project: filePath, llm_context: changed.result }; }
  throw new Error(`Unknown command: ${command}`);
}

export async function runCli(args: string[]): Promise<number> { try { if (!args.length || args.includes("--help") || args[0] === "help") { process.stdout.write(`${HELP}\n`); return 0; } const { command, options } = parse(args); writeJson(await execute(stringValue(command, "command"), options)); return 0; } catch (error) { writeJson({ ok: false, error: error instanceof Error ? error.message : String(error) }, true); return 1; } }

export { HELP };
