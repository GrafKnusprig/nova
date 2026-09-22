export interface MapLink {
  target: string;
  relation: string;
}
export interface MapNode {
  id: string;
  title: string;
  tags: string[];
  main_tag: string;
  summary: string;
  rationale?: string;
  created_at: string;
  modified_at: string;
  children: MapNode[];
  links: MapLink[];
}
export interface MapDocument {
  version: 7;
  viewer_version: "8.0.1";
  project: { root_node_id: string };
  llm_context: {
    summary: string;
    instructions: string[];
    tag_definitions: Record<string, string>;
  };
  nodes: MapNode[];
  view: {
    expanded: string[];
    positions: Record<string, [number, number]>;
    zoom: number;
    viewport: [number, number];
    tag_filter_mode: "include" | "exclude";
    tag_filter_tags: string[];
    layout_mode?: "hierarchy" | "relations";
    layout_compact?: boolean;
    recency_glow?: boolean;
    live_expand?: boolean;
    workspace?: unknown;
  };
}
export interface IndexedNode extends MapNode {
  parentId?: string;
  depth: number;
}
export interface PositionedCircle {
  id: string;
  point: [number, number];
  radius: number;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function recencyIntensity(
  modifiedAt: string,
  oldestModifiedAt: number,
  newestModifiedAt: number,
): number {
  if (newestModifiedAt <= oldestModifiedAt) return 1;
  const modified = Date.parse(modifiedAt);
  if (!Number.isFinite(modified)) return 0;
  const ageSeconds = Math.max(0, newestModifiedAt - modified) / 1_000;
  const rangeSeconds = (newestModifiedAt - oldestModifiedAt) / 1_000;
  return Math.max(
    0,
    Math.min(1, 1 - Math.log1p(ageSeconds) / Math.log1p(rangeSeconds)),
  );
}

export function expandExternalChanges(
  current: MapDocument,
  incoming: MapDocument,
): { document: MapDocument; changedIds: string[] } {
  const currentById = new Map(
    flatten(current.nodes).map((node) => [node.id, node]),
  );
  const incomingNodes = flatten(incoming.nodes);
  const incomingById = new Map(incomingNodes.map((node) => [node.id, node]));
  const changedIds = incomingNodes
    .filter((node) => {
      const previous = currentById.get(node.id);
      return !previous || previous.modified_at !== node.modified_at;
    })
    .map((node) => node.id);
  if (!changedIds.length) return { document: incoming, changedIds };

  const expanded = new Set(incoming.view.expanded);
  for (const changedId of changedIds) {
    let parentId = incomingById.get(changedId)?.parentId;
    while (parentId) {
      expanded.add(parentId);
      parentId = incomingById.get(parentId)?.parentId;
    }
  }
  return {
    document: {
      ...incoming,
      view: { ...incoming.view, expanded: [...expanded] },
    },
    changedIds,
  };
}

export function nodePassesTagFilter(
  node: Pick<MapNode, "tags">,
  mode: "include" | "exclude",
  selectedTags: ReadonlySet<string>,
): boolean {
  const matches = node.tags.some((tag) => selectedTags.has(tag));
  return mode === "include" ? matches : !matches;
}

export function tagButtonSelected(
  tag: string,
  mode: "include" | "exclude",
  filterTags: ReadonlySet<string>,
): boolean {
  return mode === "include" ? filterTags.has(tag) : !filterTags.has(tag);
}

export function nodeLabelMetrics(
  radius: number,
  detailed: boolean,
): {
  width: number;
  height: number;
  titleFontSize: number;
  tagFontSize: number;
  titleLines: number;
} {
  return {
    width: radius * 1.68,
    height: radius,
    titleFontSize: Math.max(11, Math.min(15, radius * 0.24)),
    tagFontSize: Math.max(7.5, Math.min(10, radius * 0.15)),
    titleLines: detailed && radius < 60 ? 2 : 3,
  };
}

export function zoomViewportAroundPoint(
  viewport: [number, number],
  previousZoom: number,
  nextZoom: number,
  anchor: [number, number],
  center: [number, number] = [600, 400],
): [number, number] {
  const ratio = nextZoom / previousZoom;
  return [
    anchor[0] - center[0] - ratio * (anchor[0] - viewport[0] - center[0]),
    anchor[1] - center[1] - ratio * (anchor[1] - viewport[1] - center[1]),
  ];
}

export function wheelZoomFactor(
  deltaY: number,
  deltaMode: number,
  ctrlKey: boolean,
): number {
  const deltaPixels =
      deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 800 : 1),
    sensitivity = ctrlKey ? 0.006 : 0.002;
  return Math.exp(-deltaPixels * sensitivity);
}

export function ancestorPath(
  nodeId: string,
  parents: ReadonlyMap<string, string | undefined>,
): string[] {
  const path: string[] = [];
  let current: string | undefined = nodeId;
  while (current) {
    path.unshift(current);
    current = parents.get(current);
  }
  return path;
}

export function outlineVisibleNodes(
  nodes: readonly IndexedNode[],
  collapsed: ReadonlySet<string>,
): IndexedNode[] {
  const parents = new Map(nodes.map((node) => [node.id, node.parentId]));
  return nodes.filter((node) => {
    let parentId = node.parentId;
    while (parentId) {
      if (collapsed.has(parentId)) return false;
      parentId = parents.get(parentId);
    }
    return true;
  });
}

export function outlineCollapsedNodeIds(
  nodes: readonly IndexedNode[],
  expandedIds: ReadonlySet<string>,
): Set<string> {
  return new Set(
    nodes
      .filter((node) => node.children.length && !expandedIds.has(node.id))
      .map((node) => node.id),
  );
}

export function nearestVisibleNode(
  nodeId: string,
  parents: ReadonlyMap<string, string | undefined>,
  visibleIds: ReadonlySet<string>,
): string | undefined {
  let current: string | undefined = nodeId;
  while (current && !visibleIds.has(current)) current = parents.get(current);
  return current;
}

export function arrangeRevealedNodes(
  parentId: string,
  revealed: IndexedNode[],
  seedPositions: Record<string, [number, number]>,
  radii: ReadonlyMap<string, number>,
  occupiedInput: PositionedCircle[],
): Record<string, [number, number]> {
  const positions = { ...seedPositions },
    childrenByParent = new Map<string, IndexedNode[]>(),
    occupied = [...occupiedInput];
  for (const node of revealed) {
    if (!node.parentId) continue;
    const siblings = childrenByParent.get(node.parentId) ?? [];
    siblings.push(node);
    childrenByParent.set(node.parentId, siblings);
  }
  const queue = [parentId];
  while (queue.length) {
    const currentParentId = queue.shift()!,
      parentPoint = positions[currentParentId],
      siblings = childrenByParent.get(currentParentId) ?? [];
    if (!parentPoint || !siblings.length) continue;
    const other = occupied.filter((entry) => entry.id !== currentParentId),
      centroid = other.length
        ? (other
            .reduce<[number, number]>(
              (sum, entry) => [
                sum[0] + entry.point[0],
                sum[1] + entry.point[1],
              ],
              [0, 0],
            )
            .map((value) => value / other.length) as [number, number])
        : [parentPoint[0], parentPoint[1] + 1];
    const outward = Math.atan2(
      parentPoint[1] - centroid[1],
      parentPoint[0] - centroid[0],
    );
    const span =
      siblings.length === 1
        ? 0
        : Math.min(Math.PI * 1.5, Math.max(1.1, (siblings.length - 1) * 0.78));
    siblings.forEach((node, index) => {
      const radius = radii.get(node.id) ?? 40,
        parentRadius = radii.get(currentParentId) ?? 40,
        desired =
          outward +
          (siblings.length === 1
            ? 0
            : -span / 2 + (span * index) / (siblings.length - 1));
      let chosen: [number, number] | undefined;
      for (let attempt = 0; attempt < 30 && !chosen; attempt += 1) {
        const ring = Math.floor(attempt / 6),
          step = attempt % 6,
          offset =
            step === 0 ? 0 : Math.ceil(step / 2) * 0.24 * (step % 2 ? 1 : -1),
          distance = parentRadius + radius + 38 + ring * (radius + 28),
          candidate: [number, number] = [
            parentPoint[0] + Math.cos(desired + offset) * distance,
            parentPoint[1] + Math.sin(desired + offset) * distance,
          ];
        if (
          occupied.every(
            (entry) =>
              Math.hypot(
                candidate[0] - entry.point[0],
                candidate[1] - entry.point[1],
              ) >=
              radius + entry.radius + 20,
          )
        )
          chosen = candidate;
      }
      const fallbackDistance = parentRadius + radius + 38 + 5 * (radius + 28);
      positions[node.id] = chosen ?? [
        parentPoint[0] + Math.cos(desired) * fallbackDistance,
        parentPoint[1] + Math.sin(desired) * fallbackDistance,
      ];
      occupied.push({ id: node.id, point: positions[node.id], radius });
      queue.push(node.id);
    });
  }
  return positions;
}

export function emptyMap(): MapDocument {
  const timestamp = nowIso(),
    id = crypto.randomUUID().toLowerCase();
  const root: MapNode = {
    id,
    title: "Untitled project",
    tags: ["concept", "project-governance"],
    main_tag: "project-governance",
    summary: "",
    created_at: timestamp,
    modified_at: timestamp,
    children: [],
    links: [],
  };
  return {
    version: 7,
    viewer_version: "8.0.1",
    project: { root_node_id: id },
    llm_context: { summary: "", instructions: [], tag_definitions: {} },
    nodes: [root],
    view: {
      expanded: [id],
      positions: { [id]: [600, 400] },
      zoom: 0.7,
      viewport: [0, 0],
      tag_filter_mode: "exclude",
      tag_filter_tags: [],
      layout_mode: "hierarchy",
      layout_compact: false,
      recency_glow: false,
      live_expand: false,
    },
  };
}

export function projectRoot(document: MapDocument): MapNode {
  const root = document.nodes.find(
    (node) => node.id === document.project.root_node_id,
  );
  if (!root) throw new Error("Project root node is unavailable.");
  return root;
}

export function flatten(
  nodes: MapNode[],
  parentId?: string,
  depth = 0,
  output: IndexedNode[] = [],
): IndexedNode[] {
  for (const node of nodes) {
    output.push({ ...node, parentId, depth });
    flatten(node.children, node.id, depth + 1, output);
  }
  return output;
}

export function descendantIds(nodes: MapNode[], nodeId: string): Set<string> {
  const target = flatten(nodes).find((node) => node.id === nodeId);
  return new Set(target ? flatten(target.children).map((node) => node.id) : []);
}

export function updateNode(
  nodes: MapNode[],
  id: string,
  values: Partial<MapNode>,
  modifiedAt = nowIso(),
): MapNode[] {
  return nodes.map((node) =>
    node.id === id
      ? {
          ...node,
          ...values,
          id: node.id,
          created_at: node.created_at,
          modified_at: modifiedAt,
        }
      : {
          ...node,
          children: updateNode(node.children, id, values, modifiedAt),
        },
  );
}

export function insertNode(
  nodes: MapNode[],
  node: MapNode,
  parentId?: string,
): MapNode[] {
  if (!parentId) return [...nodes, node];
  return nodes.map((entry) =>
    entry.id === parentId
      ? { ...entry, children: [...entry.children, node], modified_at: nowIso() }
      : { ...entry, children: insertNode(entry.children, node, parentId) },
  );
}

export function removeNode(
  nodes: MapNode[],
  id: string,
): { nodes: MapNode[]; removed: Set<string> } {
  const all = flatten(nodes);
  const descendants = new Set<string>();
  const collect = (target: string) => {
    descendants.add(target);
    for (const node of all) if (node.parentId === target) collect(node.id);
  };
  collect(id);
  const clean = (entries: MapNode[]): MapNode[] =>
    entries
      .filter((entry) => !descendants.has(entry.id))
      .map((entry) => {
        const children = clean(entry.children),
          links = entry.links.filter((link) => !descendants.has(link.target));
        const changed =
          children.length !== entry.children.length ||
          links.length !== entry.links.length;
        return {
          ...entry,
          children,
          links,
          modified_at: changed ? nowIso() : entry.modified_at,
        };
      });
  return { nodes: clean(nodes), removed: descendants };
}

export function guidId(document: MapDocument): string {
  const ids = new Set(flatten(document.nodes).map((node) => node.id));
  let candidate = crypto.randomUUID().toLowerCase();
  while (ids.has(candidate)) candidate = crypto.randomUUID().toLowerCase();
  return candidate;
}

export function createNode(document: MapDocument, title = "New node"): MapNode {
  const timestamp = nowIso();
  return {
    id: guidId(document),
    title,
    tags: ["uncategorized"],
    main_tag: "uncategorized",
    summary: "",
    created_at: timestamp,
    modified_at: timestamp,
    children: [],
    links: [],
  };
}
