import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Actions,
  DockLocation,
  Layout,
  Model,
  type IJsonModel,
  type TabNode,
} from "flexlayout-react";
import "flexlayout-react/style/dark.css";
import {
  ancestorPath,
  arrangeRevealedNodes,
  createNode,
  descendantIds,
  emptyMap,
  flatten,
  insertNode,
  type IndexedNode,
  type MapDocument,
  type MapNode,
  nodePassesTagFilter,
  nodeLabelMetrics,
  nearestVisibleNode,
  outlineCollapsedNodeIds,
  outlineVisibleNodes,
  projectRoot,
  removeNode,
  tagButtonSelected,
  updateNode,
  wheelZoomFactor,
  zoomViewportAroundPoint,
} from "./model";
import { NodeEditor } from "./NodeEditor";
import { AssistantPanel } from "./AssistantPanel";

type PanelId =
  "graph" | "inspector" | "outline" | "search" | "activity" | "assistant";
type GraphNavigation = {
  focusId: string;
  primary: boolean;
  revealIds: string[];
  secondaryIds: string[];
  token: number;
};
const PANEL_IDS: PanelId[] = [
  "graph",
  "inspector",
  "outline",
  "search",
  "activity",
  "assistant",
];
const panelLabel: Record<PanelId, string> = {
  graph: "Graph",
  inspector: "Inspector",
  outline: "Outline",
  search: "Search",
  activity: "Activity",
  assistant: "AI Assistant",
};

const defaultWorkspace: IJsonModel = {
  global: {
    splitterSize: 5,
    tabEnableClose: true,
    tabEnableRename: false,
    tabEnablePopout: true,
    tabEnablePopoutIcon: true,
    tabSetEnableMaximize: true,
  },
  borders: [],
  layout: {
    type: "row",
    children: [
      {
        type: "tabset",
        id: "graph-tabset",
        weight: 70,
        children: [
          {
            type: "tab",
            id: "panel-graph",
            name: "Graph",
            component: "graph",
            enablePopout: true,
          },
        ],
      },
      {
        type: "row",
        weight: 30,
        children: [
          {
            type: "tabset",
            id: "inspector-tabset",
            weight: 62,
            children: [
              {
                type: "tab",
                id: "panel-inspector",
                name: "Inspector",
                component: "inspector",
                enablePopout: true,
              },
            ],
          },
          {
            type: "tabset",
            id: "utility-tabset",
            weight: 38,
            children: [
              {
                type: "tab",
                id: "panel-outline",
                name: "Outline",
                component: "outline",
                enablePopout: true,
              },
              {
                type: "tab",
                id: "panel-search",
                name: "Search",
                component: "search",
                enablePopout: true,
              },
              {
                type: "tab",
                id: "panel-activity",
                name: "Activity",
                component: "activity",
                enablePopout: true,
              },
              {
                type: "tab",
                id: "panel-assistant",
                name: "AI Assistant",
                component: "assistant",
                enablePopout: true,
              },
            ],
          },
        ],
      },
    ],
  },
};

function workspaceModel(saved?: unknown): Model {
  try {
    return Model.fromJson(
      saved && typeof saved === "object"
        ? (saved as IJsonModel)
        : defaultWorkspace,
    );
  } catch {
    return Model.fromJson(defaultWorkspace);
  }
}

function ensureGraph(model: Model): Model {
  if (model.getNodeById("panel-graph")) {
    model.doAction(Actions.selectTab("panel-graph"));
    return model;
  }
  const destination = model.getActiveTabset() ?? model.getFirstTabSet();
  if (!destination) return Model.fromJson(defaultWorkspace);
  model.doAction(
    Actions.addNode(
      {
        type: "tab",
        id: "panel-graph",
        name: "Graph",
        component: "graph",
        enablePopout: true,
      },
      destination.getId(),
      DockLocation.CENTER,
      0,
      true,
    ),
  );
  return model;
}

function visibleNodes(document: MapDocument): IndexedNode[] {
  const expanded = new Set(document.view.expanded);
  const result: IndexedNode[] = [];
  const visit = (nodes: MapNode[], parentId?: string, depth = 0) => {
    for (const node of nodes) {
      result.push({ ...node, parentId, depth });
      if (node.id === document.project.root_node_id || expanded.has(node.id))
        visit(node.children, node.id, depth + 1);
    }
  };
  visit(document.nodes);
  return result;
}

function graphVisibleNodes(
  document: MapDocument,
  forcedIds: ReadonlySet<string> = new Set(),
): IndexedNode[] {
  const filterTags = new Set(document.view.tag_filter_tags);
  return visibleNodes(document).filter(
    (node) =>
      node.id === document.project.root_node_id ||
      forcedIds.has(node.id) ||
      nodePassesTagFilter(node, document.view.tag_filter_mode, filterTags),
  );
}

function fallbackNodePoint(index: number): [number, number] {
  return [
    600 + Math.cos(index * 2.399963) * (100 + Math.sqrt(index) * 74),
    400 + Math.sin(index * 2.399963) * (100 + Math.sqrt(index) * 74),
  ];
}

function nodeRadii(nodes: IndexedNode[]): Map<string, number> {
  const incoming = new Map<string, number>();
  for (const node of nodes)
    for (const link of node.links)
      incoming.set(link.target, (incoming.get(link.target) ?? 0) + 1);
  return new Map(
    nodes.map((node) => {
      const text =
        node.title.length + node.summary.length + (node.rationale?.length ?? 0);
      const score =
        text / 75 +
        node.children.length * 3.4 +
        (node.links.length + (incoming.get(node.id) ?? 0)) * 2.2;
      return [node.id, Math.min(110, 31 + Math.sqrt(Math.max(1, score)) * 10)];
    }),
  );
}

function expandGraphNode(
  document: MapDocument,
  nodeId: string,
  forcedIds: ReadonlySet<string> = new Set(),
): MapDocument {
  if (document.view.expanded.includes(nodeId)) return document;
  const all = flatten(document.nodes),
    node = all.find((entry) => entry.id === nodeId);
  if (!node?.children.length) return document;
  const before = graphVisibleNodes(document, forcedIds),
    beforeIds = new Set(before.map((entry) => entry.id)),
    seedPositions = { ...document.view.positions },
    radii = nodeRadii(all);
  before.forEach((entry) => {
    if (!seedPositions[entry.id])
      seedPositions[entry.id] = fallbackNodePoint(
        all.findIndex((candidate) => candidate.id === entry.id),
      );
  });
  if (!seedPositions[nodeId])
    seedPositions[nodeId] = fallbackNodePoint(
      all.findIndex((entry) => entry.id === nodeId),
    );
  const expanded = new Set(document.view.expanded);
  expanded.add(nodeId);
  const opened: MapDocument = {
      ...document,
      view: { ...document.view, expanded: [...expanded] },
    },
    revealed = graphVisibleNodes(opened, forcedIds).filter(
      (entry) => !beforeIds.has(entry.id),
    ),
    positions = arrangeRevealedNodes(
      nodeId,
      revealed,
      seedPositions,
      radii,
      before.map((entry) => ({
        id: entry.id,
        point: seedPositions[entry.id],
        radius: radii.get(entry.id) ?? 40,
      })),
    );
  return { ...opened, view: { ...opened.view, positions } };
}

function collapseGraphNode(document: MapDocument, nodeId: string): MapDocument {
  if (
    nodeId === document.project.root_node_id ||
    !document.view.expanded.includes(nodeId)
  )
    return document;
  const expanded = new Set(document.view.expanded);
  expanded.delete(nodeId);
  for (const descendantId of descendantIds(document.nodes, nodeId))
    expanded.delete(descendantId);
  return {
    ...document,
    view: { ...document.view, expanded: [...expanded] },
  };
}

function tagHue(tag: string): number {
  let hash = 2166136261;
  for (const character of tag) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x45d9f3b);
  hash ^= hash >>> 16;
  return (hash >>> 0) % 360;
}
function nodePalette(node: IndexedNode): {
  fill: string;
  stroke: string;
  glow: string;
} {
  const hue = tagHue(node.main_tag);
  const depthDarkening = Math.min(34, node.depth * 9);
  return {
    fill: `hsl(${hue} 42% ${55 - depthDarkening}% / 0.94)`,
    stroke: `hsl(${hue} 74% ${91 - depthDarkening * 0.68}%)`,
    glow: `drop-shadow(0 0 7px hsl(${hue} 72% 62% / 0.42))`,
  };
}

function fitGraph(
  placed: Array<{ node: IndexedNode; point: [number, number] }>,
  radii: Map<string, number>,
): { zoom: number; viewport: [number, number] } {
  if (!placed.length) return { zoom: 0.7, viewport: [0, 0] };
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const { node, point } of placed) {
    const radius = radii.get(node.id) ?? 40;
    left = Math.min(left, point[0] - radius);
    right = Math.max(right, point[0] + radius);
    top = Math.min(top, point[1] - radius);
    bottom = Math.max(bottom, point[1] + radius);
  }
  const zoom = Math.max(
    0.2,
    Math.min(
      1.15,
      1080 / Math.max(1, right - left),
      680 / Math.max(1, bottom - top),
    ),
  );
  const centerX = (left + right) / 2,
    centerY = (top + bottom) / 2;
  return { zoom, viewport: [-zoom * (centerX - 600), -zoom * (centerY - 400)] };
}

function clientToViewBox(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): [number, number] {
  const inverse = svg.getScreenCTM()?.inverse();
  if (!inverse) return [clientX, clientY];
  const point = new DOMPoint(clientX, clientY).matrixTransform(inverse);
  return [point.x, point.y];
}

function screenDeltaToWorld(
  svg: SVGSVGElement,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  zoom: number,
): [number, number] {
  const from = clientToViewBox(svg, fromX, fromY),
    to = clientToViewBox(svg, toX, toY);
  return [(to[0] - from[0]) / zoom, (to[1] - from[1]) / zoom];
}

function screenDeltaToViewBox(
  svg: SVGSVGElement,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): [number, number] {
  const from = clientToViewBox(svg, fromX, fromY),
    to = clientToViewBox(svg, toX, toY);
  return [to[0] - from[0], to[1] - from[1]];
}

function HoverTooltip({
  node,
  x,
  y,
  hostWindow,
}: {
  node: IndexedNode;
  x: number;
  y: number;
  hostWindow: Window;
}) {
  return (
    <aside
      className="node-tooltip hover-tooltip"
      style={{
        left: Math.max(12, Math.min(x + 18, hostWindow.innerWidth - 382)),
        top: Math.max(12, Math.min(y + 18, hostWindow.innerHeight - 120)),
      }}
    >
      <div className="node-tooltip-heading">
        <span
          className="node-tooltip-swatch"
          style={{ background: nodePalette(node).stroke }}
        />
        <div>
          <strong>{node.title}</strong>
        </div>
      </div>
      <div className="node-tooltip-categories">
        {node.tags.map((tag) => (
          <span key={tag}>{tag}</span>
        ))}
      </div>
      <p>{node.summary}</p>
      {node.rationale && (
        <div className="node-tooltip-rationale">
          <b>Why</b>
          <p>{node.rationale}</p>
        </div>
      )}
      <footer>
        {node.children.length} children · {node.links.length} outgoing
        references · depth {node.depth}
      </footer>
    </aside>
  );
}

function GraphPanel({
  document,
  selectedId,
  navigation,
  onSelect,
  onView,
  onOpenNode,
  onShowAll,
  onRelayoutHandled,
  onFitHandled,
  relayoutToken,
  fitToken,
}: {
  document: MapDocument;
  selectedId?: string;
  navigation?: GraphNavigation;
  onSelect(id?: string): void;
  onView(view: MapDocument["view"]): void;
  onOpenNode(id: string): void;
  onShowAll(): void;
  onRelayoutHandled(): void;
  onFitHandled(): void;
  relayoutToken: number;
  fitToken: number;
}) {
  const latestDocument = useRef(document);
  latestDocument.current = document;
  const all = flatten(document.nodes);
  const allTags = [...new Set(all.flatMap((node) => node.tags))].sort();
  const filterTags = new Set(document.view.tag_filter_tags);
  const includeMode = document.view.tag_filter_mode === "include";
  const selectedTagCount = allTags.filter((tag) =>
    tagButtonSelected(tag, document.view.tag_filter_mode, filterTags),
  ).length;
  const forcedVisible = new Set(navigation?.revealIds ?? []);
  const nodes = graphVisibleNodes(document, forcedVisible);
  const radii = nodeRadii(all);
  const parents = new Map(all.map((node) => [node.id, node.parentId]));
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(selectedId ? [selectedId] : []),
  );
  const [zoom, setZoom] = useState(document.view.zoom || 0.7);
  const [pan, setPan] = useState<[number, number]>(
    document.view.viewport ?? [0, 0],
  );
  const [positions, setPositions] = useState<Record<string, [number, number]>>(
    () => ({ ...document.view.positions }),
  );
  const zoomRef = useRef(zoom),
    panRef = useRef(pan),
    positionsRef = useRef(positions),
    wheelCommitFrame = useRef<number | undefined>(undefined);
  zoomRef.current = zoom;
  panRef.current = pan;
  positionsRef.current = positions;
  const [layoutRunning, setLayoutRunning] = useState(false);
  const layoutMode = document.view.layout_mode ?? "hierarchy";
  const compactLayout = document.view.layout_compact ?? false;
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<
    | {
        mode: "pan" | "nodes" | "marquee";
        x: number;
        y: number;
        lastX: number;
        lastY: number;
        startPan: [number, number];
        ids?: string[];
        nodeId?: string;
        wasSelected?: boolean;
        activated?: boolean;
      }
    | undefined
  >(undefined);
  const clickSequences = useRef(
    new Map<string, { count: 1 | 2; timer: ReturnType<typeof setTimeout> }>(),
  );
  const [marquee, setMarquee] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  }>();
  const [tooltip, setTooltip] = useState<{
    node: IndexedNode;
    x: number;
    y: number;
    hostWindow: Window;
  }>();
  const point = useCallback(
    (node: IndexedNode, index: number): [number, number] =>
      positions[node.id] ?? fallbackNodePoint(index),
    [positions],
  );
  const placed = nodes.map((node, index) => ({
    node,
    point: point(node, index),
  }));
  const byId = new Map(placed.map((entry) => [entry.node.id, entry]));
  const visibleIds = new Set(byId.keys());
  const representative = (id: string) => {
    let value: string | undefined = id;
    while (value && !visibleIds.has(value)) value = parents.get(value);
    return value;
  };
  const semantic = new Map<
    string,
    { source: string; target: string; relation: string }
  >();
  for (const source of all)
    for (const link of source.links) {
      const a = representative(source.id),
        b = representative(link.target);
      if (a && b && a !== b)
        semantic.set(`${a}|${b}|${link.relation}`, {
          source: a,
          target: b,
          relation: link.relation,
        });
    }
  const commit = (p = positions, z = zoom, v = pan) =>
    onView({
      ...document.view,
      positions: { ...document.view.positions, ...p },
      zoom: z,
      viewport: v,
    });
  const fit = () => {
    const next = fitGraph(placed, radii);
    setZoom(next.zoom);
    setPan(next.viewport);
    commit(positions, next.zoom, next.viewport);
  };
  const relayout = (
    mode: "hierarchy" | "relations" = layoutMode,
    compact = compactLayout,
  ) => {
    if (layoutRunning || nodes.length === 0) return;
    setLayoutRunning(true);
    if (
      document.view.layout_mode !== mode ||
      document.view.layout_compact !== compact
    )
      onView({
        ...document.view,
        layout_mode: mode,
        layout_compact: compact,
      });
    const worker = new Worker(new URL("./layout.worker.ts", import.meta.url), {
      type: "module",
    });
    const layoutNodes = nodes.map((node, index) => {
      const p = point(node, index);
      return {
        id: node.id,
        radius: radii.get(node.id) ?? 40,
        x: p[0],
        y: p[1],
      };
    });
    const ids = new Set(nodes.map((node) => node.id));
    const links: Array<{
      source: string;
      target: string;
      kind: "hierarchy" | "semantic";
    }> = [];
    for (const node of nodes) {
      if (node.parentId && ids.has(node.parentId))
        links.push({
          source: node.parentId,
          target: node.id,
          kind: "hierarchy",
        });
    }
    for (const edge of semantic.values())
      links.push({
        source: edge.source,
        target: edge.target,
        kind: "semantic",
      });
    worker.onmessage = (
      event: MessageEvent<Record<string, [number, number]>>,
    ) => {
      const next = event.data;
      setPositions(next);
      const latestView = latestDocument.current.view;
      onView({
        ...latestView,
        positions: { ...latestView.positions, ...next },
        layout_mode: mode,
        layout_compact: compact,
      });
      setLayoutRunning(false);
      worker.terminate();
    };
    worker.onerror = () => {
      setLayoutRunning(false);
      worker.terminate();
    };
    worker.postMessage({
      rootId: document.project.root_node_id,
      mode,
      compact,
      nodes: layoutNodes,
      links,
    });
  };
  useEffect(() => {
    if (
      relayoutToken > 0 ||
      document.view.layout_mode === undefined ||
      document.view.layout_compact === undefined
    ) {
      relayout(layoutMode, compactLayout);
      if (relayoutToken > 0) onRelayoutHandled();
    }
  }, [relayoutToken]);
  useEffect(() => {
    if (fitToken > 0) {
      queueMicrotask(fit);
      onFitHandled();
    }
  }, [fitToken]);
  useEffect(
    () => () => {
      for (const sequence of clickSequences.current.values())
        clearTimeout(sequence.timer);
      if (wheelCommitFrame.current !== undefined)
        cancelAnimationFrame(wheelCommitFrame.current);
    },
    [],
  );
  useLayoutEffect(() => {
    if (!drag.current) {
      setPositions({ ...document.view.positions });
      setZoom(document.view.zoom);
      setPan(document.view.viewport);
    }
  }, [document.view.positions, document.view.zoom, document.view.viewport]);
  useEffect(() => {
    if (!navigation) return;
    const target = byId.get(navigation.focusId);
    if (!target) return;
    setSelected(navigation.primary ? new Set([navigation.focusId]) : new Set());
    const nextPan: [number, number] = [
      -zoom * (target.point[0] - 600),
      -zoom * (target.point[1] - 400),
    ];
    setPan(nextPan);
    commit(document.view.positions, zoom, nextPan);
  }, [navigation?.token]);
  const worldPoint = (clientX: number, clientY: number): [number, number] => {
    const [sx, sy] = clientToViewBox(svg.current!, clientX, clientY);
    return [(sx - pan[0] - 600) / zoom + 600, (sy - pan[1] - 400) / zoom + 400];
  };
  const toggleExpanded = (nodeId: string) => {
    const node = all.find((entry) => entry.id === nodeId);
    if (nodeId === document.project.root_node_id || !node?.children.length)
      return;
    const next = document.view.expanded.includes(nodeId)
      ? collapseGraphNode(document, nodeId)
      : expandGraphNode(document, nodeId);
    setPositions({ ...next.view.positions });
    onView(next.view);
  };
  const cancelClickSequences = (exceptId?: string) => {
    for (const [id, sequence] of clickSequences.current)
      if (id !== exceptId) {
        clearTimeout(sequence.timer);
        clickSequences.current.delete(id);
      }
  };
  const handleLeftNodeClick = (nodeId: string) => {
    const sequence = clickSequences.current.get(nodeId);
    if (!sequence) {
      const timer = setTimeout(() => {
        clickSequences.current.delete(nodeId);
        setSelected(new Set([nodeId]));
        onSelect(nodeId);
      }, 500);
      clickSequences.current.set(nodeId, { count: 1, timer });
      return;
    }
    clearTimeout(sequence.timer);
    if (sequence.count === 1) {
      const timer = setTimeout(() => {
        clickSequences.current.delete(nodeId);
        toggleExpanded(nodeId);
      }, 320);
      clickSequences.current.set(nodeId, { count: 2, timer });
      return;
    }
    clickSequences.current.delete(nodeId);
    onOpenNode(nodeId);
  };
  const filterTag = (tag: string) => {
    const next = new Set(document.view.tag_filter_tags);
    next.has(tag) ? next.delete(tag) : next.add(tag);
    onView({ ...document.view, tag_filter_tags: [...next] });
  };
  return (
    <section
      className="graph-canvas"
      onContextMenu={(event) => event.preventDefault()}
      onWheel={(event) => {
        event.preventDefault();
        const previousZoom = zoomRef.current,
          previousPan = panRef.current;
        const next = Math.max(
          0.2,
          Math.min(
            2.5,
            previousZoom *
              wheelZoomFactor(event.deltaY, event.deltaMode, event.ctrlKey),
          ),
        );
        const anchor = svg.current
          ? clientToViewBox(svg.current, event.clientX, event.clientY)
          : ([600, 400] as [number, number]);
        const nextPan = zoomViewportAroundPoint(
          previousPan,
          previousZoom,
          next,
          anchor,
        );
        zoomRef.current = next;
        panRef.current = nextPan;
        setZoom(next);
        setPan(nextPan);
        if (wheelCommitFrame.current === undefined)
          wheelCommitFrame.current = requestAnimationFrame(() => {
            wheelCommitFrame.current = undefined;
            commit(
              positionsRef.current,
              zoomRef.current,
              panRef.current,
            );
          });
      }}
      onPointerDown={(event) => {
        if ((event.target as Element).closest("button, details")) return;
        if (event.button === 0) {
          const nodeId = (event.target as Element).closest<SVGGElement>(
            "[data-node-id]",
          )?.dataset.nodeId;
          cancelClickSequences(nodeId);
          setTooltip(undefined);
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {
            mode: "pan",
            x: event.clientX,
            y: event.clientY,
            lastX: event.clientX,
            lastY: event.clientY,
            startPan: pan,
            nodeId,
          };
        } else if (
          event.button === 2 &&
          ((event.target as Element).tagName === "svg" ||
            event.target === event.currentTarget)
        ) {
          event.preventDefault();
          cancelClickSequences();
          setTooltip(undefined);
          setSelected(new Set());
          onSelect(undefined);
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {
            mode: "marquee",
            x: event.clientX,
            y: event.clientY,
            lastX: event.clientX,
            lastY: event.clientY,
            startPan: pan,
          };
          setMarquee({
            left: event.clientX,
            top: event.clientY,
            width: 0,
            height: 0,
          });
        }
      }}
      onPointerMove={(event) => {
        const state = drag.current;
        if (!state) return;
        if (state.mode === "pan") {
          const [dx, dy] = screenDeltaToViewBox(
            svg.current!,
            state.x,
            state.y,
            event.clientX,
            event.clientY,
          );
          setPan([state.startPan[0] + dx, state.startPan[1] + dy]);
        } else if (state.mode === "nodes") {
          if (
            !state.activated &&
            Math.hypot(event.clientX - state.x, event.clientY - state.y) < 4
          )
            return;
          if (!state.activated) {
            state.activated = true;
            if (!state.wasSelected && state.nodeId) {
              state.ids = [state.nodeId];
              setSelected(new Set(state.ids));
              onSelect(state.nodeId);
            }
          }
          const [dx, dy] = screenDeltaToWorld(
            svg.current!,
            state.lastX,
            state.lastY,
            event.clientX,
            event.clientY,
            zoom,
          );
          state.lastX = event.clientX;
          state.lastY = event.clientY;
          setPositions((current) => {
            const next = { ...current };
            for (const id of state.ids ?? []) {
              const p = next[id] ?? byId.get(id)?.point ?? [0, 0];
              next[id] = [p[0] + dx, p[1] + dy];
            }
            return next;
          });
        } else
          setMarquee({
            left: Math.min(state.x, event.clientX),
            top: Math.min(state.y, event.clientY),
            width: Math.abs(event.clientX - state.x),
            height: Math.abs(event.clientY - state.y),
          });
      }}
      onPointerUp={(event) => {
        const state = drag.current;
        if (state?.mode === "marquee") {
          const a = worldPoint(state.x, state.y),
            b = worldPoint(event.clientX, event.clientY);
          setSelected(
            new Set(
              placed
                .filter(
                  ({ point: p }) =>
                    p[0] >= Math.min(a[0], b[0]) &&
                    p[0] <= Math.max(a[0], b[0]) &&
                    p[1] >= Math.min(a[1], b[1]) &&
                    p[1] <= Math.max(a[1], b[1]),
                )
                .map(({ node }) => node.id),
            ),
          );
        }
        if (state?.mode === "pan") {
          const moved = Math.hypot(
            event.clientX - state.x,
            event.clientY - state.y,
          );
          if (moved < 4) setPan(state.startPan);
          else
            setPan((value) => {
              commit(positions, zoom, value);
              return value;
            });
          if (moved < 4) {
            if (state.nodeId) handleLeftNodeClick(state.nodeId);
            else {
              setSelected(new Set());
              onSelect(undefined);
            }
          }
        }
        if (state?.mode === "nodes") {
          if (state.activated)
            setPositions((value) => {
              commit(value);
              return value;
            });
          else if (state.nodeId) {
            const next = new Set(selected);
            next.add(state.nodeId);
            setSelected(next);
            if (next.has(state.nodeId)) onSelect(state.nodeId);
          }
        }
        drag.current = undefined;
        setMarquee(undefined);
      }}
    >
      <svg ref={svg} viewBox="0 0 1200 800">
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto"
          >
            <path d="M0 0L10 5L0 10z" />
          </marker>
          {placed.map(({ node }) => (
            <clipPath id={`clip-${node.id}`} key={node.id}>
              <circle r={(radii.get(node.id) ?? 40) - 4} />
            </clipPath>
          ))}
        </defs>
        <g
          transform={`translate(${pan[0]} ${pan[1]}) translate(600 400) scale(${zoom}) translate(-600 -400)`}
        >
          {placed.map(
            ({ node, point: p }) =>
              node.parentId &&
              byId.get(node.parentId) && (
                <line
                  key={`h-${node.id}`}
                  x1={p[0]}
                  y1={p[1]}
                  x2={byId.get(node.parentId)!.point[0]}
                  y2={byId.get(node.parentId)!.point[1]}
                  className="graph-edge hierarchy"
                />
              ),
          )}
          {[...semantic.values()].map((edge) => {
            const a = byId.get(edge.source)!.point,
              b = byId.get(edge.target)!.point;
            return (
              <g key={`${edge.source}-${edge.target}-${edge.relation}`}>
                <line
                  x1={a[0]}
                  y1={a[1]}
                  x2={b[0]}
                  y2={b[1]}
                  className="graph-edge semantic"
                  markerEnd="url(#arrow)"
                />
                {zoom > 0.9 && (
                  <text
                    x={(a[0] + b[0]) / 2}
                    y={(a[1] + b[1]) / 2}
                    className="edge-label"
                  >
                    {edge.relation}
                  </text>
                )}
              </g>
            );
          })}
          {placed.map(({ node, point: p }) => {
            const radius = radii.get(node.id) ?? 40,
              palette = nodePalette(node),
              detailed = zoom >= 0.72,
              label = nodeLabelMetrics(radius, detailed);
            return (
              <g
                key={node.id}
                data-node-id={node.id}
                transform={`translate(${p[0]} ${p[1]})`}
                className={`graph-node ${selected.has(node.id) ? "selected" : ""} ${selectedId === node.id ? "inspector-active" : ""} ${navigation?.secondaryIds.includes(node.id) ? "navigation-secondary" : ""}`}
                onPointerEnter={(event) => {
                  if (!drag.current)
                    setTooltip({
                      node,
                      x: event.clientX,
                      y: event.clientY,
                      hostWindow:
                        event.currentTarget.ownerDocument.defaultView!,
                    });
                }}
                onPointerMove={(event) => {
                  if (!drag.current)
                    setTooltip({
                      node,
                      x: event.clientX,
                      y: event.clientY,
                      hostWindow:
                        event.currentTarget.ownerDocument.defaultView!,
                    });
                }}
                onPointerLeave={() =>
                  setTooltip((current) =>
                    current?.node.id === node.id ? undefined : current,
                  )
                }
                onPointerDown={(event) => {
                  if (event.button !== 2) return;
                  event.preventDefault();
                  event.stopPropagation();
                  cancelClickSequences();
                  setTooltip(undefined);
                  event.currentTarget.setPointerCapture(event.pointerId);
                  const wasSelected = selected.has(node.id);
                  drag.current = {
                    mode: "nodes",
                    x: event.clientX,
                    y: event.clientY,
                    lastX: event.clientX,
                    lastY: event.clientY,
                    startPan: pan,
                    ids: wasSelected ? [...selected] : [node.id],
                    nodeId: node.id,
                    wasSelected,
                    activated: false,
                  };
                }}
              >
                <circle
                  r={radius}
                  style={{
                    fill: palette.fill,
                    stroke: palette.stroke,
                    filter: palette.glow,
                  }}
                />
                <foreignObject
                  className="graph-node-label-object"
                  x={-label.width / 2}
                  y={-label.height / 2}
                  width={label.width}
                  height={label.height}
                >
                  <div className="graph-node-label">
                    <div
                      className="graph-node-title"
                      style={{
                        fontSize: label.titleFontSize,
                        WebkitLineClamp: label.titleLines,
                      }}
                    >
                      {node.title}
                    </div>
                    <div
                      className="graph-node-type"
                      style={{ fontSize: label.tagFontSize }}
                    >
                      {detailed && <>{node.main_tag} · </>}
                      {node.children.length}{" "}
                      {node.children.length === 1 ? "child" : "children"}
                    </div>
                  </div>
                </foreignObject>
              </g>
            );
          })}
        </g>
      </svg>
      {marquee && <div className="selection-marquee" style={marquee} />}
      {tooltip && <HoverTooltip {...tooltip} />}
      <details
        className="tag-filter"
        onPointerDown={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
      >
        <summary>
          Tags · {includeMode ? "Include" : "Exclude"}
          {selectedTagCount ? ` (${selectedTagCount})` : ""}
        </summary>
        <div>
          <button
            className="tag-filter-mode"
            onClick={() =>
              onView({
                ...document.view,
                tag_filter_mode: includeMode ? "exclude" : "include",
              })
            }
          >
            {includeMode ? "Inclusive" : "Exclusive"}
          </button>
          <button
            className="tag-filter-reset"
            onClick={() =>
              onView({
                ...document.view,
                tag_filter_tags: includeMode ? allTags : [],
              })
            }
          >
            Show all
          </button>
          <button
            className="tag-filter-reset"
            onClick={() =>
              onView({
                ...document.view,
                tag_filter_tags: includeMode ? [] : allTags,
              })
            }
          >
            Hide all
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              className={
                tagButtonSelected(
                  tag,
                  document.view.tag_filter_mode,
                  filterTags,
                )
                  ? "active"
                  : ""
              }
              onClick={() => filterTag(tag)}
            >
              {tag}
            </button>
          ))}
        </div>
      </details>
      <div className="graph-controls">
        <button onClick={fit}>Fit</button>
        <select
          aria-label="Graph layout emphasis"
          title="Choose which connections dominate re-layout"
          value={layoutMode}
          disabled={layoutRunning}
          onChange={(event) => {
            const mode = event.target.value as "hierarchy" | "relations";
            relayout(mode, compactLayout);
          }}
        >
          <option value="hierarchy">Hierarchy layout</option>
          <option value="relations">Relation layout</option>
        </select>
        <button onClick={() => relayout()} disabled={layoutRunning}>
          {layoutRunning ? "Laying out…" : "Re-layout"}
        </button>
        <button
          className={compactLayout ? "active" : ""}
          disabled={layoutRunning}
          title="Remove or restore extra spacing between unrelated groups"
          onClick={() => {
            const next = !compactLayout;
            relayout(layoutMode, next);
          }}
        >
          Compact {compactLayout ? "on" : "off"}
        </button>
        <button onClick={onShowAll}>Show all nodes</button>
        <button
          onClick={() =>
            onView({
              ...document.view,
              expanded: [document.project.root_node_id],
            })
          }
        >
          Main topics
        </button>
      </div>
      <div className="graph-hud">
        <strong>{projectRoot(document).title}</strong>
        <span>
          {nodes.length}/{all.length} nodes · {selected.size} selected ·{" "}
          {Math.round(zoom * 100)}%
        </span>
      </div>
    </section>
  );
}

function Inspector({
  node,
  allNodes,
  onApply,
  onSelectNode,
}: {
  node?: IndexedNode;
  allNodes: IndexedNode[];
  onApply(values: Partial<MapNode>): void;
  onSelectNode(id: string): void;
}) {
  if (!node)
    return (
      <Empty
        title="Inspector"
        text="Select a node in the graph, outline, or search results."
      />
    );
  return (
    <section className="inspector-tooltip-shell">
      <header>
        <span
          className="node-tooltip-swatch"
          style={{ background: nodePalette(node).stroke }}
        />
        <strong>{node.title}</strong>
      </header>
      <NodeEditor
        node={node}
        allNodes={allNodes}
        allTags={[...new Set(allNodes.flatMap((entry) => entry.tags))].sort()}
        onApply={onApply}
        onSelectNode={onSelectNode}
      />
    </section>
  );
}

function useNodeListNavigation(
  onFocus: (id: string) => void,
  onDoubleClick: (id: string) => void,
  onTripleClick: (id: string) => void,
) {
  const sequences = useRef(
    new Map<
      string,
      { count: 1 | 2; timer: ReturnType<typeof setTimeout> }
    >(),
  );
  useEffect(
    () => () => {
      for (const sequence of sequences.current.values())
        clearTimeout(sequence.timer);
    },
    [],
  );
  return {
    click(id: string) {
      for (const [otherId, sequence] of sequences.current)
        if (otherId !== id) {
          clearTimeout(sequence.timer);
          sequences.current.delete(otherId);
        }
      const sequence = sequences.current.get(id);
      if (!sequence) {
        const timer = setTimeout(() => {
          sequences.current.delete(id);
          onFocus(id);
        }, 500);
        sequences.current.set(id, { count: 1, timer });
        return;
      }
      clearTimeout(sequence.timer);
      if (sequence.count === 1) {
        const timer = setTimeout(() => {
          sequences.current.delete(id);
          onDoubleClick(id);
        }, 320);
        sequences.current.set(id, { count: 2, timer });
        return;
      }
      sequences.current.delete(id);
      onTripleClick(id);
    },
  };
}

function Outline({
  nodes,
  selectedId,
  secondaryIds,
  synchronized,
  expandedIds,
  onFocus,
  onSynchronizedDoubleClick,
  onOpenProperties,
}: {
  nodes: IndexedNode[];
  selectedId?: string;
  secondaryIds: ReadonlySet<string>;
  synchronized: boolean;
  expandedIds: ReadonlySet<string>;
  onFocus(id: string): void;
  onSynchronizedDoubleClick(id: string): void;
  onOpenProperties(id: string): void;
}) {
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const synchronizedCollapsed = useMemo(
    () => outlineCollapsedNodeIds(nodes, expandedIds),
    [expandedIds, nodes],
  );
  const activeCollapsed = synchronized ? synchronizedCollapsed : collapsed;
  const navigation = useNodeListNavigation(
    onFocus,
    (id) => {
      const node = nodes.find((entry) => entry.id === id);
      if (synchronized) {
        onSynchronizedDoubleClick(id);
        return;
      }
      if (!node?.children.length) return;
      setCollapsed((current) => {
        const next = new Set(current);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
      });
    },
    onOpenProperties,
  );
  const visibleNodes = outlineVisibleNodes(nodes, activeCollapsed);
  useEffect(() => {
    if (!selectedId) return;
    const parents = new Map(nodes.map((node) => [node.id, node.parentId]));
    setCollapsed((current) => {
      const next = new Set(current);
      let parentId = parents.get(selectedId),
        changed = false;
      while (parentId) {
        changed = next.delete(parentId) || changed;
        parentId = parents.get(parentId);
      }
      return changed ? next : current;
    });
  }, [nodes, selectedId]);
  useEffect(() => {
    if (!selectedId) return;
    const frame = requestAnimationFrame(() =>
      refs.current
        .get(selectedId)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [activeCollapsed, selectedId]);
  return (
    <section className="panel-content">
      <p className="eyebrow">OUTLINE</p>
      <div className="outline">
        {visibleNodes.map((node) => (
          <button
            ref={(element) => {
              if (element) refs.current.set(node.id, element);
              else refs.current.delete(node.id);
            }}
            key={node.id}
            className={`${selectedId === node.id ? "active" : ""} ${secondaryIds.has(node.id) ? "secondary" : ""}`}
            style={{ paddingLeft: `${10 + node.depth * 14}px` }}
            onClick={() => navigation.click(node.id)}
          >
            <span className="outline-disclosure">
              {node.children.length ? (activeCollapsed.has(node.id) ? "▸" : "▾") : "·"}
            </span>{" "}
            <span>{node.title}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function Search({
  nodes,
  selectedId,
  secondaryIds,
  onFocus,
  onOpen,
  onOpenProperties,
}: {
  nodes: IndexedNode[];
  selectedId?: string;
  secondaryIds: ReadonlySet<string>;
  onFocus(id: string): void;
  onOpen(id: string): void;
  onOpenProperties(id: string): void;
}) {
  const [query, setQuery] = useState("");
  const navigation = useNodeListNavigation(onFocus, onOpen, onOpenProperties);
  const results = query
    ? nodes
        .filter((node) =>
          `${node.title} ${node.summary} ${node.tags.join(" ")}`
            .toLowerCase()
            .includes(query.toLowerCase()),
        )
        .slice(0, 100)
    : [];
  return (
    <section className="panel-content">
      <p className="eyebrow">SEARCH</p>
      <input
        autoFocus
        placeholder="Search the map…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="search-results">
        {results.map((node) => (
          <button
            key={node.id}
            className={`${selectedId === node.id ? "active" : ""} ${secondaryIds.has(node.id) ? "secondary" : ""}`}
            onClick={() => navigation.click(node.id)}
          >
            <strong>{node.title}</strong>
            <span>{node.tags.join(" · ")}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
function Empty({ title, text }: { title: string; text: string }) {
  return (
    <section className="panel-content">
      <p className="eyebrow">{title.toUpperCase()}</p>
      <h2>{title}</h2>
      <p>{text}</p>
    </section>
  );
}

function Panel({
  id,
  panelVisible,
  outlineSynchronized,
  document,
  selectedId,
  navigation,
  setSelected,
  navigateNode,
  applyDocument,
  activity,
  relayoutToken,
  fitToken,
  onRelayoutHandled,
  onFitHandled,
  openNodeProperty,
  onShowAll,
}: {
  id: PanelId;
  panelVisible: boolean;
  outlineSynchronized: boolean;
  document: MapDocument;
  selectedId?: string;
  navigation?: GraphNavigation;
  setSelected(id?: string): void;
  navigateNode(
    id: string,
    expandPath: boolean,
    toggleTarget?: boolean,
    allowHiddenGraph?: boolean,
  ): void;
  applyDocument(
    value: MapDocument,
    message?: string,
    immediate?: boolean,
  ): void;
  activity: string[];
  relayoutToken: number;
  fitToken: number;
  onRelayoutHandled(): void;
  onFitHandled(): void;
  openNodeProperty(id: string): void;
  onShowAll(): void;
}) {
  const all = flatten(document.nodes);
  const selected = all.find((node) => node.id === selectedId);
  const applyNode = (nodeId: string, values: Partial<MapNode>) => {
    const node = all.find((entry) => entry.id === nodeId);
    applyDocument(
      { ...document, nodes: updateNode(document.nodes, nodeId, values) },
      `Changed “${node?.title ?? "node"}”`,
      true,
    );
  };
  if (id === "graph")
    return (
      <GraphPanel
        document={document}
        selectedId={panelVisible ? selectedId : undefined}
        navigation={panelVisible ? navigation : undefined}
        onSelect={setSelected}
        onView={(view) =>
          applyDocument({ ...document, view }, undefined, false)
        }
        onOpenNode={openNodeProperty}
        onShowAll={onShowAll}
        onRelayoutHandled={onRelayoutHandled}
        onFitHandled={onFitHandled}
        relayoutToken={relayoutToken}
        fitToken={fitToken}
      />
    );
  if (id === "inspector")
    return (
      <Inspector
        node={panelVisible ? selected : undefined}
        allNodes={all}
        onApply={(values) => selected && applyNode(selected.id, values)}
        onSelectNode={setSelected}
      />
    );
  if (id === "outline")
    return (
      <Outline
        nodes={all}
        selectedId={selectedId}
        secondaryIds={new Set(navigation?.secondaryIds ?? [])}
        synchronized={outlineSynchronized}
        expandedIds={new Set(document.view.expanded)}
        onFocus={(nodeId) => navigateNode(nodeId, false)}
        onSynchronizedDoubleClick={(nodeId) =>
          navigateNode(nodeId, true, true, true)
        }
        onOpenProperties={openNodeProperty}
      />
    );
  if (id === "search")
    return (
      <Search
        nodes={all}
        selectedId={selectedId}
        secondaryIds={new Set(navigation?.secondaryIds ?? [])}
        onFocus={(nodeId) => navigateNode(nodeId, false)}
        onOpen={(nodeId) => navigateNode(nodeId, true)}
        onOpenProperties={openNodeProperty}
      />
    );
  if (id === "assistant") return <AssistantPanel />;
  return (
    <section className="panel-content">
      <p className="eyebrow">ACTIVITY</p>
      <div className="activity">
        {activity.length ? (
          activity.map((entry, index) => (
            <div key={`${entry}-${index}`}>{entry}</div>
          ))
        ) : (
          <p>No events in this session.</p>
        )}
      </div>
    </section>
  );
}

export function App() {
  const [document, setDocument] = useState<MapDocument>(emptyMap());
  const documentRef = useRef(document);
  const [dockModel, setDockModel] = useState(() =>
    ensureGraph(workspaceModel()),
  );
  const [mapPath, setMapPath] = useState<string>();
  const mapPathRef = useRef<string | undefined>(undefined);
  const [selectedId, setSelectedId] = useState<string>();
  const [graphNavigation, setGraphNavigation] = useState<GraphNavigation>();
  const navigationToken = useRef(0);
  const navigationRun = useRef(0);
  const [activity, setActivity] = useState<string[]>([]);
  const [relayoutToken, setRelayoutToken] = useState(0);
  const [fitToken, setFitToken] = useState(0);
  const undo = useRef<MapDocument[]>([]);
  const redo = useRef<MapDocument[]>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const pendingSave = useRef<MapDocument | undefined>(undefined);
  const saveChain = useRef(Promise.resolve());
  const saveGeneration = useRef(0);
  const record = useCallback(
    (message: string) =>
      setActivity((items) =>
        [`${new Date().toLocaleTimeString()}  ${message}`, ...items].slice(
          0,
          250,
        ),
      ),
    [],
  );
  const enqueueSave = useCallback(
    (value: MapDocument, message?: string) => {
      if (!mapPathRef.current) return;
      const generation = saveGeneration.current;
      saveChain.current = saveChain.current
        .then(async () => {
          if (generation !== saveGeneration.current) return;
          await window.mindmap.save(value);
          if (message) record(`Saved: ${message}`);
        })
        .catch((error) => record(`Save failed: ${String(error)}`));
    },
    [record],
  );
  const scheduleSave = useCallback(
    (value: MapDocument, message?: string, immediate = false) => {
      pendingSave.current = value;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const flush = () => {
        const pending = pendingSave.current;
        pendingSave.current = undefined;
        if (pending) enqueueSave(pending, message);
      };
      if (immediate) flush();
      else saveTimer.current = setTimeout(flush, 120);
    },
    [enqueueSave],
  );
  const applyDocument = useCallback(
    (value: MapDocument, message?: string, immediate = false) => {
      const current = documentRef.current;
      if (value !== current) {
        undo.current.push(current);
        if (undo.current.length > 100) undo.current.shift();
        redo.current = [];
      }
      documentRef.current = value;
      setDocument(value);
      if (message) record(`User: ${message}`);
      scheduleSave(value, message, immediate);
    },
    [record, scheduleSave],
  );
  const load = useCallback(
    (result: { path: string; data: unknown }, source = "Opened") => {
      navigationRun.current += 1;
      const incoming = result.data as MapDocument;
      const fitted = {
        ...incoming,
        view: {
          ...incoming.view,
          zoom: 0.7,
          viewport: [0, 0] as [number, number],
        },
      };
      documentRef.current = fitted;
      setDocument(fitted);
      mapPathRef.current = result.path;
      setMapPath(result.path);
      setSelectedId(undefined);
      setGraphNavigation(undefined);
      undo.current = [];
      redo.current = [];
      const model = ensureGraph(workspaceModel(fitted.view.workspace));
      setDockModel(model);
      setFitToken((value) => value + 1);
      record(`${source}: ${result.path}`);
    },
    [record],
  );
  useEffect(() => {
    void window.mindmap
      .loadDefault()
      .then((result) => load(result, "Opened project"))
      .catch((error) => record(`Open failed: ${String(error)}`));
    return window.mindmap.onExternalChange((result) => {
      if (result.path !== mapPathRef.current) return;
      navigationRun.current += 1;
      saveGeneration.current += 1;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      pendingSave.current = undefined;
      const incoming = result.data as MapDocument;
      const currentWorkspace = JSON.stringify(
        documentRef.current.view.workspace,
      );
      documentRef.current = incoming;
      setDocument(incoming);
      if (JSON.stringify(incoming.view.workspace) !== currentWorkspace)
        setDockModel(ensureGraph(workspaceModel(incoming.view.workspace)));
      record(
        result.source === "assistant"
          ? "AI Assistant updated the project file"
          : "External change loaded from project file",
      );
    });
  }, [load, record]);
  const panelIsVisible = useCallback(
    (panel: PanelId) => {
      const node = dockModel.getNodeById(`panel-${panel}`);
      return node?.getType() === "tab" && (node as TabNode).isVisible();
    },
    [dockModel],
  );
  const panelIsOpen = useCallback(
    (panel: PanelId) => Boolean(dockModel.getNodeById(`panel-${panel}`)),
    [dockModel],
  );
  const openPanel = useCallback(
    (panel: PanelId) => {
      const tabId = `panel-${panel}`;
      if (dockModel.getNodeById(tabId)) {
        dockModel.doAction(Actions.selectTab(tabId));
        return;
      }
      const destination =
        dockModel.getActiveTabset() ?? dockModel.getFirstTabSet();
      dockModel.doAction(
        Actions.addNode(
          {
            type: "tab",
            id: tabId,
            name: panelLabel[panel],
            component: panel,
            enablePopout: true,
          },
          destination.getId(),
          DockLocation.CENTER,
          -1,
          true,
        ),
      );
    },
    [dockModel],
  );
  const openNodeProperty = useCallback(
    (nodeId: string) => {
      const tabId = `node-property-${nodeId}`,
        existing = dockModel.getNodeById(tabId);
      if (existing) {
        dockModel.doAction(Actions.selectTab(tabId));
        return;
      }
      const node = flatten(documentRef.current.nodes).find(
        (entry) => entry.id === nodeId,
      );
      if (!node) return;
      const destination =
        dockModel.getNodeById("inspector-tabset") ??
        dockModel.getActiveTabset() ??
        dockModel.getFirstTabSet();
      if (!destination) return;
      dockModel.doAction(
        Actions.addNode(
          {
            type: "tab",
            id: tabId,
            name: `Node Property · ${node.title}`,
            component: "node-property",
            config: { nodeId },
            enablePopout: true,
          },
          destination.getId(),
          DockLocation.CENTER,
          -1,
          true,
        ),
      );
    },
    [dockModel],
  );
  const addNode = useCallback(
    (parent?: string) => {
      navigationRun.current += 1;
      const current = documentRef.current,
        node = createNode(current);
      const next = {
        ...current,
        nodes: insertNode(current.nodes, node, parent),
      };
      setGraphNavigation(undefined);
      setSelectedId(node.id);
      applyDocument(next, `Created “${node.title}”`, true);
    },
    [applyDocument],
  );
  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    navigationRun.current += 1;
    const current = documentRef.current,
      selected = flatten(current.nodes).find((node) => node.id === selectedId);
    if (!selected) return;
    if (selected.id === current.project.root_node_id) {
      alert("The project root cannot be deleted.");
      return;
    }
    if (
      !confirm(
        `PERMANENT DELETION\n\nDelete “${selected.title}” and its complete subtree?\n\nThis is saved to the project file immediately and cannot be undone.`,
      )
    )
      return;
    const removed = removeNode(current.nodes, selectedId),
      positions = { ...current.view.positions },
      expanded = current.view.expanded.filter((id) => !removed.removed.has(id));
    for (const id of removed.removed) positions[id] && delete positions[id];
    setGraphNavigation(undefined);
    setSelectedId(undefined);
    applyDocument(
      {
        ...current,
        nodes: removed.nodes,
        view: { ...current.view, positions, expanded },
      },
      `Permanently deleted “${selected.title}” and ${removed.removed.size - 1} descendants`,
      true,
    );
    undo.current = [];
    redo.current = [];
  }, [applyDocument, selectedId]);
  const saveAs = useCallback(async () => {
    const saved = await window.mindmap.saveAs(documentRef.current);
    if (saved) {
      mapPathRef.current = saved;
      setMapPath(saved);
      record(`Saved project as ${saved}`);
    }
  }, [record]);
  const showAllNodes = useCallback(() => {
    const current = documentRef.current;
    applyDocument(
      {
        ...current,
        view: {
          ...current.view,
          expanded: flatten(current.nodes)
            .filter((node) => node.children.length)
            .map((node) => node.id),
        },
      },
      "Showed all nodes",
    );
    setRelayoutToken((value) => value + 1);
  }, [applyDocument]);
  useEffect(
    () =>
      window.mindmap.onCommand((command) => {
        const current = documentRef.current;
        if (command === "open")
          void window.mindmap.open().then((result) => result && load(result));
        else if (command === "new")
          void (async () => {
            const next = emptyMap(),
              saved = await window.mindmap.saveAs(next);
            if (saved) load({ path: saved, data: next }, "Created project");
          })();
        else if (command === "save") enqueueSave(current, "manual save");
        else if (command === "save-as") void saveAs();
        else if (command === "undo" && undo.current.length) {
          const previous = undo.current.pop()!;
          redo.current.push(current);
          documentRef.current = previous;
          setDocument(previous);
          scheduleSave(previous, "undo", true);
          record("User: undo");
        } else if (command === "redo" && redo.current.length) {
          const next = redo.current.pop()!;
          undo.current.push(current);
          documentRef.current = next;
          setDocument(next);
          scheduleSave(next, "redo", true);
          record("User: redo");
        } else if (command === "add-main-topic")
          addNode(current.project.root_node_id);
        else if (command === "add-child" && selectedId) addNode(selectedId);
        else if (command === "delete-selected") deleteSelected();
        else if (command.startsWith("show-panel:")) {
          const panel = command.slice(11) as PanelId;
          if (PANEL_IDS.includes(panel)) openPanel(panel);
        } else if (command === "reset-workspace") {
          const model = ensureGraph(workspaceModel());
          setDockModel(model);
          applyDocument(
            {
              ...current,
              view: { ...current.view, workspace: model.toJson() },
            },
            "Reset panel arrangement",
            true,
          );
        } else if (command === "fit-graph") setFitToken((value) => value + 1);
        else if (command === "relayout-graph")
          setRelayoutToken((value) => value + 1);
        else if (command === "show-all") showAllNodes();
        else if (command === "collapse-main-topics")
          applyDocument(
            {
              ...current,
              view: {
                ...current.view,
                expanded: [current.project.root_node_id],
              },
            },
            "Collapsed to main topics",
          );
        else if (
          (command === "expand-selected" || command === "collapse-selected") &&
          selectedId
        ) {
          applyDocument(
            command === "expand-selected"
              ? expandGraphNode(current, selectedId)
              : collapseGraphNode(current, selectedId),
          );
        }
      }),
    [
      addNode,
      applyDocument,
      deleteSelected,
      enqueueSave,
      load,
      openPanel,
      record,
      saveAs,
      scheduleSave,
      selectedId,
      showAllNodes,
    ],
  );
  const selectNode = useCallback(
    (id?: string) => {
      navigationRun.current += 1;
      setGraphNavigation(undefined);
      setSelectedId(id);
    },
    [],
  );
  const navigateNode = useCallback(
    async (
      id: string,
      expandPath: boolean,
      toggleTarget = false,
      allowHiddenGraph = false,
    ) => {
      const run = ++navigationRun.current,
        initial = documentRef.current,
        all = flatten(initial.nodes),
        target = all.find((node) => node.id === id),
        graphVisible = panelIsVisible("graph");
      if (!target) return;
      setSelectedId(id);
      if (!graphVisible && !allowHiddenGraph) {
        setGraphNavigation(undefined);
        return;
      }
      const parents = new Map(all.map((node) => [node.id, node.parentId])),
        path = ancestorPath(id, parents),
        secondaryIds = path.slice(0, -1),
        initiallyVisibleIds = new Set(
          graphVisibleNodes(initial).map((node) => node.id),
        ),
        initialFocus =
          nearestVisibleNode(id, parents, initiallyVisibleIds) ??
          initial.project.root_node_id;
      if (graphVisible && !expandPath) {
        navigationToken.current += 1;
        setGraphNavigation({
          focusId: initialFocus,
          primary: initialFocus === id,
          revealIds: [],
          secondaryIds,
          token: navigationToken.current,
        });
      } else if (!graphVisible || expandPath) setGraphNavigation(undefined);
      if (!expandPath) return;

      if (
        toggleTarget &&
        target.children.length &&
        id !== initial.project.root_node_id &&
        initial.view.expanded.includes(id)
      ) {
        applyDocument(collapseGraphNode(initial, id));
        if (graphVisible) {
          navigationToken.current += 1;
          setGraphNavigation({
            focusId: id,
            primary: true,
            revealIds: path,
            secondaryIds,
            token: navigationToken.current,
          });
        }
        return;
      }

      const forcedIds = new Set(path),
        parentsToOpen = [
          ...secondaryIds,
          ...(toggleTarget && target.children.length ? [id] : []),
        ];
      let working = initial;
      for (const parentId of parentsToOpen) {
        if (working.view.expanded.includes(parentId)) continue;
        working = expandGraphNode(working, parentId, forcedIds);
        applyDocument(working);
        await new Promise((resolve) => setTimeout(resolve, 90));
        if (navigationRun.current !== run) return;
      }
      if (graphVisible) {
        navigationToken.current += 1;
        setGraphNavigation({
          focusId: id,
          primary: true,
          revealIds: path,
          secondaryIds,
          token: navigationToken.current,
        });
      }
    },
    [applyDocument, panelIsVisible],
  );
  const panel = (id: PanelId) => (
    <Panel
      id={id}
      panelVisible={panelIsVisible(id)}
      outlineSynchronized={
        panelIsOpen("outline") && panelIsOpen("graph")
      }
      document={document}
      selectedId={selectedId}
      navigation={graphNavigation}
      setSelected={selectNode}
      navigateNode={navigateNode}
      applyDocument={applyDocument}
      activity={activity}
      relayoutToken={relayoutToken}
      fitToken={fitToken}
      onRelayoutHandled={() => setRelayoutToken(0)}
      onFitHandled={() => setFitToken(0)}
      openNodeProperty={openNodeProperty}
      onShowAll={showAllNodes}
    />
  );
  const nodePanel = (nodeId: string) => {
    const all = flatten(document.nodes),
      node = all.find((entry) => entry.id === nodeId);
    if (!node)
      return (
        <Empty
          title="Node unavailable"
          text="This node no longer exists in the current project file."
        />
      );
    return (
      <section className="inspector-tooltip-shell docked-node-editor">
        <header>
          <span
            className="node-tooltip-swatch"
            style={{ background: nodePalette(node).stroke }}
          />
          <strong>{node.title}</strong>
        </header>
        <NodeEditor
          node={node}
          allNodes={all}
          allTags={[...new Set(all.flatMap((entry) => entry.tags))].sort()}
          onSelectNode={selectNode}
          onApply={(values) =>
            applyDocument(
              {
                ...documentRef.current,
                nodes: updateNode(documentRef.current.nodes, node.id, values),
              },
              `Changed “${node.title}”`,
              true,
            )
          }
        />
      </section>
    );
  };
  return (
    <main className="app-shell">
      <header className="workspace-header">
        <div className="workspace-title">
          <span className="brand-mark" />
          <span>{projectRoot(document).title}</span>
        </div>
        <div className="workspace-actions">
          {PANEL_IDS.map((id) => (
            <button key={id} onClick={() => openPanel(id)}>
              {panelLabel[id]}
            </button>
          ))}
        </div>
      </header>
      <section className="workspace-layout">
        <Layout
          model={dockModel}
          supportsPopout
          popoutURL="popout.html"
          popoutWindowName="Project Knowledge Map"
          factory={(node: TabNode) =>
            node.getComponent() === "node-property"
              ? nodePanel(
                  String(
                    (node.getConfig() as { nodeId?: string } | undefined)
                      ?.nodeId ?? "",
                  ),
                )
              : panel(node.getComponent() as PanelId)
          }
          onModelChange={(model) => {
            const current = documentRef.current,
              workspace = model.toJson();
            if (
              JSON.stringify(current.view.workspace) ===
              JSON.stringify(workspace)
            )
              return;
            applyDocument(
              { ...current, view: { ...current.view, workspace } },
              undefined,
              false,
            );
          }}
        />
      </section>
      <footer className="workspace-status">
        <span>{mapPath ?? "No project file"}</span>
        <span>{flatten(document.nodes).length} nodes · autosave active</span>
      </footer>
    </main>
  );
}
