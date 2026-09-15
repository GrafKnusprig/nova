import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const source = path.resolve(process.argv[2] ?? "mindmap.json");
const document = JSON.parse(await readFile(source, "utf8"));
if (document.version !== 4) throw new Error(`Expected schema 4, received ${document.version}.`);
const migratedAt = new Date().toISOString();
const timestamp = (date) => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T00:00:00.000Z` : migratedAt;
const migrateNode = (node) => {
  const tags = [...new Set([...(node.categories ?? []), node.type, node.status, node.rationale_source].filter(Boolean))];
  const result = {
    id: node.id,
    title: node.title,
    tags: tags.length ? tags : ["uncategorized"],
    main_tag: node.categories?.[0] ?? tags[0] ?? "uncategorized",
    summary: node.summary,
    ...(node.rationale ? { rationale: node.rationale } : {}),
    created_at: node.created_at ?? timestamp(node.date),
    modified_at: node.modified_at ?? timestamp(node.date),
    children: node.children.map(migrateNode),
    links: node.links,
  };
  return result;
};

document.version = 5;
document.viewer_version = "5.0.0";
document.llm_context = {
  summary: document.llm_context.summary,
  instructions: document.llm_context.instructions,
  tag_definitions: document.llm_context.category_definitions ?? document.llm_context.tag_definitions ?? {},
};
document.nodes = document.nodes.map(migrateNode);
document.view = { ...document.view, hidden_tags: document.view.hidden_tags ?? [], workspace: document.view.workspace ?? {
  global: { splitterSize: 5, tabEnableClose: true, tabEnableRename: false, tabEnablePopout: true, tabEnablePopoutIcon: true, tabSetEnableMaximize: true },
  borders: [],
  layout: { type: "row", children: [
    { type: "tabset", id: "graph-tabset", weight: 70, children: [{ type: "tab", id: "panel-graph", name: "Graph", component: "graph", enablePopout: true }] },
    { type: "row", weight: 30, children: [
      { type: "tabset", id: "inspector-tabset", weight: 62, children: [{ type: "tab", id: "panel-inspector", name: "Inspector", component: "inspector", enablePopout: true }] },
      { type: "tabset", id: "utility-tabset", weight: 38, children: [{ type: "tab", id: "panel-outline", name: "Outline", component: "outline", enablePopout: true }, { type: "tab", id: "panel-search", name: "Search", component: "search", enablePopout: true }, { type: "tab", id: "panel-activity", name: "Activity", component: "activity", enablePopout: true }] },
    ] },
  ] },
} };
await writeFile(source, `${JSON.stringify(document, null, 2)}\n`, "utf8");
console.log(`Migrated ${source} to schema 5 at ${migratedAt}.`);
