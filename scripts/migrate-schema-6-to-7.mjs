import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const source = path.resolve(process.argv[2] ?? "nova.json");
const document = JSON.parse(await readFile(source, "utf8"));
if (document.version !== 6) throw new Error(`Expected schema 6, received ${document.version}.`);
if (!document.project || typeof document.project.name !== "string" || typeof document.project.summary !== "string" || !Array.isArray(document.nodes)) throw new Error("Schema-6 project metadata or nodes are invalid.");

const timestamp = new Date().toISOString();
const rootId = randomUUID().toLowerCase();
const formerRoots = document.nodes;
const root = {
  id: rootId,
  title: document.project.name.trim() || "Untitled project",
  tags: ["concept", "project-governance"],
  main_tag: "project-governance",
  summary: document.project.summary,
  rationale: "This protected root carries the project identity and groups the map's main topics.",
  created_at: timestamp,
  modified_at: timestamp,
  children: formerRoots,
  links: [],
};

const positionedRoots = formerRoots.map((node) => document.view?.positions?.[node.id]).filter((point) => Array.isArray(point) && point.length === 2 && point.every((value) => typeof value === "number"));
const rootPosition = positionedRoots.length
  ? [positionedRoots.reduce((sum, point) => sum + point[0], 0) / positionedRoots.length, positionedRoots.reduce((sum, point) => sum + point[1], 0) / positionedRoots.length]
  : [600, 400];

document.version = 7;
document.viewer_version = "8.1.0";
document.project = { root_node_id: rootId };
document.nodes = [root];
document.view = {
  ...document.view,
  expanded: [...new Set([rootId, ...(document.view?.expanded ?? [])])],
  positions: { ...(document.view?.positions ?? {}), [rootId]: rootPosition },
  layout_mode: document.view?.layout_mode ?? "hierarchy",
  layout_compact: document.view?.layout_compact ?? false,
};

await writeFile(source, `${JSON.stringify(document, null, 2)}\n`, "utf8");
console.log(`Migrated ${source} from schema 6 to schema 7 with project root ${rootId}.`);
