export type RationaleSource = "user" | "derived-from-context";
export interface MapLink { target: string; relation: string }
export interface MapNode {
  id: string; title: string; type: string; categories: string[]; summary: string; status: string;
  rationale?: string; rationale_source?: RationaleSource; date?: string; children: MapNode[]; links: MapLink[];
}
export interface MapDocument {
  version: 4; viewer_version: string;
  project: { name: string; summary: string };
  llm_context: { summary: string; instructions: string[]; category_definitions: Record<string, string> };
  nodes: MapNode[];
  view: { expanded: string[]; positions: Record<string, [number, number]>; zoom: number; viewport: [number, number] };
}
export interface IndexedNode extends MapNode { parentId?: string; depth: number }

export function emptyMap(): MapDocument {
  return { version: 4, viewer_version: "5.0.0-dev", project: { name: "Untitled project", summary: "" }, llm_context: { summary: "", instructions: [], category_definitions: {} }, nodes: [], view: { expanded: [], positions: {}, zoom: 1, viewport: [0, 0] } };
}

export function flatten(nodes: MapNode[], parentId?: string, depth = 0, output: IndexedNode[] = []): IndexedNode[] {
  for (const node of nodes) { output.push({ ...node, parentId, depth }); flatten(node.children, node.id, depth + 1, output); }
  return output;
}

export function updateNode(nodes: MapNode[], id: string, values: Partial<MapNode>): MapNode[] {
  return nodes.map((node) => node.id === id ? { ...node, ...values } : { ...node, children: updateNode(node.children, id, values) });
}

export function insertNode(nodes: MapNode[], node: MapNode, parentId?: string): MapNode[] {
  if (!parentId) return [...nodes, node];
  return nodes.map((entry) => entry.id === parentId ? { ...entry, children: [...entry.children, node] } : { ...entry, children: insertNode(entry.children, node, parentId) });
}

export function removeNode(nodes: MapNode[], id: string): { nodes: MapNode[]; removed: Set<string> } {
  const all = flatten(nodes); const descendants = new Set<string>();
  const collect = (target: string) => { descendants.add(target); for (const node of all) if (node.parentId === target) collect(node.id); };
  collect(id);
  const clean = (entries: MapNode[]): MapNode[] => entries.filter((entry) => !descendants.has(entry.id)).map((entry) => ({ ...entry, children: clean(entry.children), links: entry.links.filter((link) => !descendants.has(link.target)) }));
  return { nodes: clean(nodes), removed: descendants };
}

export function uniqueId(document: MapDocument, seed: string): string {
  const base = seed.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "new-node";
  const ids = new Set(flatten(document.nodes).map((node) => node.id)); let candidate = base; let suffix = 2;
  while (ids.has(candidate)) candidate = `${base}-${suffix++}`;
  return candidate;
}
