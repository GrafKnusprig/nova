export interface MapLink { target: string; relation: string }
export interface MapNode {
  id: string; title: string; tags: string[]; main_tag: string; summary: string; rationale?: string;
  created_at: string; modified_at: string; children: MapNode[]; links: MapLink[];
}
export interface MapDocument {
  version: 6; viewer_version: "6.0.1";
  project: { name: string; summary: string };
  llm_context: { summary: string; instructions: string[]; tag_definitions: Record<string, string> };
  nodes: MapNode[];
  view: { expanded: string[]; positions: Record<string, [number, number]>; zoom: number; viewport: [number, number]; tag_filter_mode: "include" | "exclude"; tag_filter_tags: string[]; workspace?: unknown };
}
export interface IndexedNode extends MapNode { parentId?: string; depth: number }

export function nowIso(): string { return new Date().toISOString(); }

export function nodePassesTagFilter(node: Pick<MapNode, "tags">, mode: "include" | "exclude", selectedTags: ReadonlySet<string>): boolean {
  const matches = node.tags.some((tag) => selectedTags.has(tag)); return mode === "include" ? matches : !matches;
}

export function emptyMap(): MapDocument {
  return { version: 6, viewer_version: "6.0.1", project: { name: "Untitled project", summary: "" }, llm_context: { summary: "", instructions: [], tag_definitions: {} }, nodes: [], view: { expanded: [], positions: {}, zoom: 0.7, viewport: [0, 0], tag_filter_mode: "exclude", tag_filter_tags: [] } };
}

export function flatten(nodes: MapNode[], parentId?: string, depth = 0, output: IndexedNode[] = []): IndexedNode[] {
  for (const node of nodes) { output.push({ ...node, parentId, depth }); flatten(node.children, node.id, depth + 1, output); }
  return output;
}

export function updateNode(nodes: MapNode[], id: string, values: Partial<MapNode>, modifiedAt = nowIso()): MapNode[] {
  return nodes.map((node) => node.id === id ? { ...node, ...values, id: node.id, created_at: node.created_at, modified_at: modifiedAt } : { ...node, children: updateNode(node.children, id, values, modifiedAt) });
}

export function insertNode(nodes: MapNode[], node: MapNode, parentId?: string): MapNode[] {
  if (!parentId) return [...nodes, node];
  return nodes.map((entry) => entry.id === parentId ? { ...entry, children: [...entry.children, node], modified_at: nowIso() } : { ...entry, children: insertNode(entry.children, node, parentId) });
}

export function removeNode(nodes: MapNode[], id: string): { nodes: MapNode[]; removed: Set<string> } {
  const all = flatten(nodes); const descendants = new Set<string>();
  const collect = (target: string) => { descendants.add(target); for (const node of all) if (node.parentId === target) collect(node.id); };
  collect(id);
  const clean = (entries: MapNode[]): MapNode[] => entries.filter((entry) => !descendants.has(entry.id)).map((entry) => { const children = clean(entry.children), links = entry.links.filter((link) => !descendants.has(link.target)); const changed = children.length !== entry.children.length || links.length !== entry.links.length; return { ...entry, children, links, modified_at: changed ? nowIso() : entry.modified_at }; });
  return { nodes: clean(nodes), removed: descendants };
}

export function guidId(document: MapDocument): string {
  const ids = new Set(flatten(document.nodes).map((node) => node.id)); let candidate = crypto.randomUUID().toLowerCase();
  while (ids.has(candidate)) candidate = crypto.randomUUID().toLowerCase();
  return candidate;
}

export function createNode(document: MapDocument, title = "New node"): MapNode {
  const timestamp = nowIso();
  return { id: guidId(document), title, tags: ["uncategorized"], main_tag: "uncategorized", summary: "", created_at: timestamp, modified_at: timestamp, children: [], links: [] };
}
