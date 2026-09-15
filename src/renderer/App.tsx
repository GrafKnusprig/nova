import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Actions, DockLocation, Layout, Model, type IJsonModel, type TabNode } from "flexlayout-react";
import "flexlayout-react/style/dark.css";
import { emptyMap, flatten, insertNode, type IndexedNode, type MapDocument, type MapNode, removeNode, uniqueId, updateNode } from "./model";

type PanelId = "graph" | "inspector" | "outline" | "search" | "activity";
const PANEL_IDS: PanelId[] = ["graph", "inspector", "outline", "search", "activity"];
const WORKSPACE_KEY = "project-knowledge-map.workspace.v2";
const panelLabel: Record<PanelId, string> = { graph: "Graph", inspector: "Inspector", outline: "Outline", search: "Search", activity: "Activity" };

const defaultWorkspace: IJsonModel = { global: { splitterSize: 5, tabEnableClose: true, tabEnableRename: false, tabSetEnableMaximize: true }, borders: [], layout: { type: "row", children: [
  { type: "tabset", id: "graph-tabset", weight: 70, children: [{ type: "tab", id: "panel-graph", name: "Graph", component: "graph", enableClose: false }] },
  { type: "row", weight: 30, children: [
    { type: "tabset", id: "inspector-tabset", weight: 62, children: [{ type: "tab", id: "panel-inspector", name: "Inspector", component: "inspector" }] },
    { type: "tabset", id: "utility-tabset", weight: 38, children: [
      { type: "tab", id: "panel-outline", name: "Outline", component: "outline" },
      { type: "tab", id: "panel-search", name: "Search", component: "search" },
      { type: "tab", id: "panel-activity", name: "Activity", component: "activity" },
    ] },
  ] },
] } };

function workspaceModel(): Model { try { const saved = localStorage.getItem(WORKSPACE_KEY); return Model.fromJson(saved ? JSON.parse(saved) as IJsonModel : defaultWorkspace); } catch { return Model.fromJson(defaultWorkspace); } }

function visibleNodes(document: MapDocument): IndexedNode[] {
  const expanded = new Set(document.view.expanded); const result: IndexedNode[] = [];
  const visit = (nodes: MapNode[], parentId?: string, depth = 0) => { for (const node of nodes) { result.push({ ...node, parentId, depth }); if (expanded.has(node.id)) visit(node.children, node.id, depth + 1); } };
  visit(document.nodes); return result;
}

function nodeRadii(nodes: IndexedNode[]): Map<string, number> {
  const incoming = new Map<string, number>(); for (const node of nodes) for (const link of node.links) incoming.set(link.target, (incoming.get(link.target) ?? 0) + 1);
  return new Map(nodes.map((node) => { const text = node.title.length + node.summary.length + (node.rationale?.length ?? 0); const score = text / 75 + node.children.length * 3.4 + (node.links.length + (incoming.get(node.id) ?? 0)) * 2.2; return [node.id, Math.min(110, 31 + Math.sqrt(Math.max(1, score)) * 10)]; }));
}

function wrapTitle(text: string, radius: number): string[] {
  const max = Math.max(8, Math.floor(radius / 4.3)); const words = text.split(/\s+/); const lines: string[] = [];
  for (const word of words) { const current = lines.at(-1); if (!current || current.length + word.length + 1 > max) lines.push(word); else lines[lines.length - 1] = `${current} ${word}`; }
  const limit = radius < 48 ? 2 : 3; if (lines.length > limit) { lines.length = limit; lines[limit - 1] = `${lines[limit - 1].slice(0, Math.max(3, max - 1))}…`; } return lines;
}

function nodePalette(node: IndexedNode): { fill: string; stroke: string; glow: string } {
  const category = node.categories[0] ?? "uncategorized";
  let hash = 2166136261;
  for (const character of category) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  hash ^= hash >>> 16; hash = Math.imul(hash, 0x45d9f3b); hash ^= hash >>> 16;
  const hue = (hash >>> 0) % 360;
  const depthLightening = Math.min(34, node.depth * 9);
  return {
    fill: `hsl(${hue} 42% ${21 + depthLightening}% / 0.94)`,
    stroke: `hsl(${hue} 74% ${68 + depthLightening * 0.68}%)`,
    glow: `drop-shadow(0 0 7px hsl(${hue} 72% 62% / 0.42))`,
  };
}

function GraphTooltip({ node, position, pinned = false, onClose }: { node: IndexedNode; position: { left: number; top: number }; pinned?: boolean; onClose?(): void }) {
  return <aside className={`node-tooltip ${pinned ? "pinned" : ""}`} style={position} onPointerDown={pinned ? (event) => event.stopPropagation() : undefined} onWheel={pinned ? (event) => event.stopPropagation() : undefined}>
    {pinned && <button className="node-tooltip-close" title="Close tooltip" onClick={onClose}>×</button>}
    <div className="node-tooltip-heading"><span className="node-tooltip-swatch" style={{ background: nodePalette(node).stroke }} /><div><strong>{node.title}</strong><span>{node.type} · {node.status}</span></div></div>
    <div className="node-tooltip-categories">{node.categories.map((category) => <span key={category}>{category}</span>)}</div><p>{node.summary}</p>
    {node.rationale && <div className="node-tooltip-rationale"><b>Why</b><p>{node.rationale}</p></div>}<footer>{node.children.length} children · {node.links.length} outgoing references · depth {node.depth}</footer>
  </aside>;
}

function hierarchyLayout(nodes: IndexedNode[], radii: Map<string, number>, current: Record<string, [number, number]>): Record<string, [number, number]> {
  const positions: Record<string, [number, number]> = {}; const children = new Map<string, IndexedNode[]>();
  for (const node of nodes) { if (node.parentId) children.set(node.parentId, [...(children.get(node.parentId) ?? []), node]); }
  const roots = nodes.filter((node) => !node.parentId); roots.forEach((node, index) => { const a = index / Math.max(1, roots.length) * Math.PI * 2; positions[node.id] = [600 + Math.cos(a) * 210, 400 + Math.sin(a) * 170]; });
  const place = (parent: IndexedNode) => { const list = children.get(parent.id) ?? []; const center = positions[parent.id] ?? current[parent.id] ?? [600, 400]; list.forEach((node, index) => { const a = index / Math.max(1, list.length) * Math.PI * 2 + parent.depth * 0.43; const distance = (radii.get(parent.id) ?? 40) + (radii.get(node.id) ?? 40) + 58 + node.depth * 12; positions[node.id] = [center[0] + Math.cos(a) * distance, center[1] + Math.sin(a) * distance]; place(node); }); };
  roots.forEach(place);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (let iteration = 0; iteration < 90; iteration++) {
    const delta = new Map(nodes.map((node) => [node.id, [0, 0] as [number, number]]));
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) { const a = nodes[i], b = nodes[j], pa = positions[a.id], pb = positions[b.id]; let dx = pa[0] - pb[0], dy = pa[1] - pb[1]; const d = Math.max(1, Math.hypot(dx, dy)); const minimum = (radii.get(a.id) ?? 40) + (radii.get(b.id) ?? 40) + 20; const force = d < minimum ? (minimum - d) * 0.12 : 1200 / (d * d); dx /= d; dy /= d; delta.get(a.id)![0] += dx * force; delta.get(a.id)![1] += dy * force; delta.get(b.id)![0] -= dx * force; delta.get(b.id)![1] -= dy * force; }
    for (const child of nodes) if (child.parentId && byId.has(child.parentId)) { const a = positions[child.id], b = positions[child.parentId]; const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.max(1, Math.hypot(dx, dy)); const desired = (radii.get(child.id) ?? 40) + (radii.get(child.parentId) ?? 40) + 65; const force = (d - desired) * 0.075; delta.get(child.id)![0] += dx / d * force; delta.get(child.id)![1] += dy / d * force; delta.get(child.parentId)![0] -= dx / d * force * 0.3; delta.get(child.parentId)![1] -= dy / d * force * 0.3; }
    for (const source of nodes) for (const link of source.links) if (byId.has(link.target)) { const a = positions[source.id], b = positions[link.target], dx = b[0] - a[0], dy = b[1] - a[1], d = Math.max(1, Math.hypot(dx, dy)); const force = (d - 300) * 0.008; delta.get(source.id)![0] += dx / d * force; delta.get(source.id)![1] += dy / d * force; }
    for (const node of nodes) { positions[node.id][0] += Math.max(-10, Math.min(10, delta.get(node.id)![0])); positions[node.id][1] += Math.max(-10, Math.min(10, delta.get(node.id)![1])); }
  }
  return positions;
}

function GraphPanel({ document, selectedId, onSelect, onView, relayoutToken }: { document: MapDocument; selectedId?: string; onSelect(id: string): void; onView(view: MapDocument["view"]): void; relayoutToken: number }) {
  const nodes = visibleNodes(document); const all = flatten(document.nodes); const radii = nodeRadii(all); const parents = new Map(all.map((node) => [node.id, node.parentId]));
  const [selected, setSelected] = useState<Set<string>>(() => new Set(selectedId ? [selectedId] : [])); const [zoom, setZoom] = useState(document.view.zoom || 0.55); const [pan, setPan] = useState<[number, number]>(document.view.viewport ?? [0, 0]); const [positions, setPositions] = useState<Record<string, [number, number]>>(() => ({ ...document.view.positions })); const [layoutRunning, setLayoutRunning] = useState(false);
  const svg = useRef<SVGSVGElement>(null); const drag = useRef<{ mode: "pan" | "nodes" | "marquee"; x: number; y: number; lastX: number; lastY: number; startPan: [number, number]; ids?: string[]; nodeId?: string; wasSelected?: boolean; activated?: boolean } | undefined>(undefined); const lastLeftClick = useRef<{ nodeId: string; time: number } | undefined>(undefined); const [marquee, setMarquee] = useState<{ left: number; top: number; width: number; height: number }>(); const [tooltip, setTooltip] = useState<{ node: IndexedNode; x: number; y: number }>(); const [pinnedTooltips, setPinnedTooltips] = useState<Array<{ nodeId: string; x: number; y: number }>>([]);
  const point = useCallback((node: IndexedNode, index: number): [number, number] => positions[node.id] ?? [600 + Math.cos(index * 2.399963) * (100 + Math.sqrt(index) * 74), 400 + Math.sin(index * 2.399963) * (100 + Math.sqrt(index) * 74)], [positions]);
  const placed = nodes.map((node, index) => ({ node, point: point(node, index) })); const byId = new Map(placed.map((entry) => [entry.node.id, entry])); const visibleIds = new Set(byId.keys());
  const representative = (id: string) => { let value: string | undefined = id; while (value && !visibleIds.has(value)) value = parents.get(value); return value; }; const semantic = new Map<string, { source: string; target: string; relation: string }>(); for (const source of all) for (const link of source.links) { const a = representative(source.id), b = representative(link.target); if (a && b && a !== b) semantic.set(`${a}|${b}|${link.relation}`, { source: a, target: b, relation: link.relation }); }
  const commit = (p = positions, z = zoom, v = pan) => onView({ ...document.view, positions: { ...document.view.positions, ...p }, zoom: z, viewport: v });
  const relayout = () => {
    if (layoutRunning || nodes.length === 0) return;
    setLayoutRunning(true);
    const worker = new Worker(new URL("./layout.worker.ts", import.meta.url), { type: "module" });
    const layoutNodes = nodes.map((node, index) => { const p = point(node, index); return { id: node.id, radius: radii.get(node.id) ?? 40, x: p[0], y: p[1] }; });
    const ids = new Set(nodes.map((node) => node.id)); const links: Array<{ source: string; target: string; kind: "hierarchy" | "semantic" }> = [];
    for (const node of nodes) { if (node.parentId && ids.has(node.parentId)) links.push({ source: node.parentId, target: node.id, kind: "hierarchy" }); for (const link of node.links) if (ids.has(link.target)) links.push({ source: node.id, target: link.target, kind: "semantic" }); }
    worker.onmessage = (event: MessageEvent<Record<string, [number, number]>>) => { const next = event.data; setPositions(next); commit(next); setLayoutRunning(false); worker.terminate(); };
    worker.onerror = () => { setLayoutRunning(false); worker.terminate(); };
    worker.postMessage({ nodes: layoutNodes, links });
  };
  useEffect(() => { if (relayoutToken > 0) relayout(); }, [relayoutToken]);
  const worldPoint = (clientX: number, clientY: number): [number, number] => { const rect = svg.current!.getBoundingClientRect(); const sx = (clientX - rect.left) / rect.width * 1200, sy = (clientY - rect.top) / rect.height * 800; return [(sx - pan[0] - 600) / zoom + 600, (sy - pan[1] - 400) / zoom + 400]; };
  const toggleExpanded = (nodeId: string) => { const node = all.find((entry) => entry.id === nodeId); if (!node?.children.length) return; const expanded = new Set(document.view.expanded); expanded.has(nodeId) ? expanded.delete(nodeId) : expanded.add(nodeId); onView({ ...document.view, expanded: [...expanded] }); };
  return <section className="graph-canvas" onContextMenu={(e) => e.preventDefault()} onWheel={(e) => { e.preventDefault(); const next = Math.max(0.2, Math.min(2.5, zoom * (e.deltaY < 0 ? 1.12 : 0.89))); setZoom(next); commit(positions, next, pan); }} onPointerDown={(e) => {
    if ((e.target as Element).closest("button")) return;
    if (e.button === 0) {
      const nodeId = (e.target as Element).closest<SVGGElement>("[data-node-id]")?.dataset.nodeId;
      setTooltip(undefined); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { mode: "pan", x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, startPan: pan, nodeId };
    } else if (e.button === 2 && ((e.target as Element).tagName === "svg" || e.target === e.currentTarget)) { e.preventDefault(); setTooltip(undefined); setSelected(new Set()); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { mode: "marquee", x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, startPan: pan }; setMarquee({ left: e.clientX, top: e.clientY, width: 0, height: 0 }); }
  }} onPointerMove={(e) => {
    const state = drag.current; if (!state) return;
    if (state.mode === "pan") setPan([state.startPan[0] + e.clientX - state.x, state.startPan[1] + e.clientY - state.y]);
    else if (state.mode === "nodes") {
      if (!state.activated && Math.hypot(e.clientX - state.x, e.clientY - state.y) < 4) return;
      if (!state.activated) { state.activated = true; if (!state.wasSelected && state.nodeId) { state.ids = [state.nodeId]; setSelected(new Set(state.ids)); onSelect(state.nodeId); } }
      const rect = svg.current!.getBoundingClientRect(); const dx = (e.clientX - state.lastX) / rect.width * 1200 / zoom, dy = (e.clientY - state.lastY) / rect.height * 800 / zoom; state.lastX = e.clientX; state.lastY = e.clientY;
      setPositions((current) => { const next = { ...current }; for (const id of state.ids ?? []) { const p = next[id] ?? byId.get(id)?.point ?? [0, 0]; next[id] = [p[0] + dx, p[1] + dy]; } return next; });
    } else setMarquee({ left: Math.min(state.x, e.clientX), top: Math.min(state.y, e.clientY), width: Math.abs(e.clientX - state.x), height: Math.abs(e.clientY - state.y) });
  }} onPointerUp={(e) => {
    const state = drag.current;
    if (state?.mode === "marquee") { const a = worldPoint(state.x, state.y), b = worldPoint(e.clientX, e.clientY); setSelected(new Set(placed.filter(({ point: p }) => p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0]) && p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1])).map(({ node }) => node.id))); }
    if (state?.mode === "pan") {
      const moved = Math.hypot(e.clientX - state.x, e.clientY - state.y); if (moved < 4) setPan(state.startPan); else setPan((value) => { commit(positions, zoom, value); return value; });
      if (state.nodeId && moved < 4) { const now = performance.now(), previous = lastLeftClick.current; if (previous?.nodeId === state.nodeId && now - previous.time < 400) { toggleExpanded(state.nodeId); lastLeftClick.current = undefined; } else { lastLeftClick.current = { nodeId: state.nodeId, time: now }; setPinnedTooltips((items) => items.some((item) => item.nodeId === state.nodeId) ? items : [...items, { nodeId: state.nodeId!, x: e.clientX, y: e.clientY }]); } }
    }
    if (state?.mode === "nodes") {
      if (state.activated) setPositions((value) => { commit(value); return value; });
      else if (state.nodeId) { const next = new Set(selected); if (e.ctrlKey || e.shiftKey) next.has(state.nodeId) ? next.delete(state.nodeId) : next.add(state.nodeId); else next.add(state.nodeId); setSelected(next); if (next.has(state.nodeId)) onSelect(state.nodeId); }
    }
    drag.current = undefined; setMarquee(undefined);
  }}>
    <svg ref={svg} viewBox="0 0 1200 800"><defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" /></marker>{placed.map(({ node }) => <clipPath id={`clip-${node.id}`} key={node.id}><circle r={(radii.get(node.id) ?? 40) - 4} /></clipPath>)}</defs><g transform={`translate(${pan[0]} ${pan[1]}) translate(600 400) scale(${zoom}) translate(-600 -400)`}>
      {placed.map(({ node, point: p }) => node.parentId && byId.get(node.parentId) && <line key={`h-${node.id}`} x1={p[0]} y1={p[1]} x2={byId.get(node.parentId)!.point[0]} y2={byId.get(node.parentId)!.point[1]} className="graph-edge hierarchy" />)}{[...semantic.values()].map((edge) => { const a = byId.get(edge.source)!.point, b = byId.get(edge.target)!.point; return <g key={`${edge.source}-${edge.target}-${edge.relation}`}><line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className="graph-edge semantic" markerEnd="url(#arrow)" />{zoom > .9 && <text x={(a[0] + b[0]) / 2} y={(a[1] + b[1]) / 2} className="edge-label">{edge.relation}</text>}</g>; })}
      {placed.map(({ node, point: p }) => { const radius = radii.get(node.id) ?? 40, lines = wrapTitle(node.title, radius), palette = nodePalette(node); return <g key={node.id} data-node-id={node.id} transform={`translate(${p[0]} ${p[1]})`} className={`graph-node ${selected.has(node.id) ? "selected" : ""}`} onPointerEnter={(e) => { if (!drag.current && !pinnedTooltips.some((item) => item.nodeId === node.id)) setTooltip({ node, x: e.clientX, y: e.clientY }); }} onPointerMove={(e) => { if (!drag.current && !pinnedTooltips.some((item) => item.nodeId === node.id)) setTooltip({ node, x: e.clientX, y: e.clientY }); }} onPointerLeave={() => setTooltip((current) => current?.node.id === node.id ? undefined : current)} onPointerDown={(e) => {
        if (e.button !== 2) return;
        e.preventDefault(); e.stopPropagation(); setTooltip(undefined); e.currentTarget.setPointerCapture(e.pointerId);
        const wasSelected = selected.has(node.id); drag.current = { mode: "nodes", x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, startPan: pan, ids: wasSelected ? [...selected] : [node.id], nodeId: node.id, wasSelected, activated: false };
      }}><circle r={radius} style={{ fill: palette.fill, stroke: palette.stroke, filter: palette.glow }} />
        <text clipPath={`url(#clip-${node.id})`} textAnchor="middle" y={-((lines.length - 1) * 7)}>{lines.map((line, index) => <tspan key={index} x="0" dy={index ? 14 : 0}>{line}</tspan>)}</text>{zoom >= .72 && <text clipPath={`url(#clip-${node.id})`} className="graph-node-type" textAnchor="middle" y={lines.length * 8 + 13}>{node.type} · {node.children.length}</text>}{zoom >= 1.2 && <foreignObject clipPath={`url(#clip-${node.id})`} x={-radius * .72} y={radius * .3} width={radius * 1.44} height={radius * .52}><div className="node-summary">{node.summary}</div></foreignObject>}</g>; })}
    </g></svg>{marquee && <div className="selection-marquee" style={marquee} />}{tooltip && <GraphTooltip node={tooltip.node} position={{ left: Math.max(12, Math.min(tooltip.x + 18, window.innerWidth - 382)), top: Math.max(12, Math.min(tooltip.y + 18, window.innerHeight - 310)) }} />}{pinnedTooltips.map((item, index) => { const node = all.find((entry) => entry.id === item.nodeId); if (!node) return null; return <GraphTooltip key={item.nodeId} node={node} pinned position={{ left: Math.max(12, Math.min(item.x + 18 + index * 16, window.innerWidth - 382)), top: Math.max(12, Math.min(item.y + 18 + index * 16, window.innerHeight - 310)) }} onClose={() => setPinnedTooltips((items) => items.filter((entry) => entry.nodeId !== item.nodeId))} />; })}<div className="graph-controls"><button onClick={() => { setZoom(.7); setPan([0, 0]); commit(positions, .7, [0, 0]); }}>Fit</button><button onClick={relayout} disabled={layoutRunning}>{layoutRunning ? "Laying out…" : "Re-layout"}</button><button onClick={() => onView({ ...document.view, expanded: all.filter((n) => n.children.length).map((n) => n.id) })}>Show all</button><button onClick={() => onView({ ...document.view, expanded: [] })}>Roots</button></div><div className="graph-hud"><strong>{document.project.name}</strong><span>{nodes.length}/{all.length} nodes · {selected.size} selected · {Math.round(zoom * 100)}%</span></div>
  </section>;
}

function Inspector({ node, allNodes, onApply }: { node?: IndexedNode; allNodes: IndexedNode[]; onApply(values: Partial<MapNode>): void }) {
  const [draft, setDraft] = useState<Partial<MapNode>>({}); useEffect(() => setDraft(node ? { ...node, categories: [...node.categories] } : {}), [node]);
  if (!node) return <Empty title="Inspector" text="Select a node in the graph, outline, or search results." />;
  const field = (key: keyof MapNode, label: string) => <label>{label}<input value={String(draft[key] ?? "")} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} /></label>;
  return <form className="inspector" onSubmit={(event) => { event.preventDefault(); onApply({ ...draft, id: node.id, categories: draft.categories?.map((value) => value.trim()).filter(Boolean) } as Partial<MapNode>); }}>
    <p className="eyebrow">SELECTED NODE</p><label>ID<input value={node.id} readOnly /></label>{field("title", "Title")}{field("type", "Type")}{field("status", "Status")}
    <label>Categories<input value={(draft.categories ?? []).join(", ")} onChange={(event) => setDraft({ ...draft, categories: event.target.value.split(",") })} /></label>
    <label>Summary<textarea value={draft.summary ?? ""} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} /></label>
    <label>Why<textarea value={draft.rationale ?? ""} onChange={(event) => setDraft({ ...draft, rationale: event.target.value || undefined, rationale_source: event.target.value ? (draft.rationale_source ?? "user") : undefined })} /></label>
    {draft.rationale && <label>Why source<select value={draft.rationale_source ?? "user"} onChange={(event) => setDraft({ ...draft, rationale_source: event.target.value as "user" | "derived-from-context" })}><option value="user">user</option><option value="derived-from-context">derived-from-context</option></select></label>}
    <div className="link-editor"><div className="section-title"><span>Links</span><button type="button" onClick={() => { const target = prompt("Target node ID"); if (!target || !allNodes.some((entry) => entry.id === target) || target === node.id) return; const relation = prompt("Relation", "related")?.trim() || "related"; setDraft({ ...draft, links: [...(draft.links ?? []), { target, relation }] }); }}>Add</button></div>{(draft.links ?? []).map((link, index) => <div key={`${link.target}-${index}`}><span>{link.relation} → {link.target}</span><button type="button" onClick={() => setDraft({ ...draft, links: draft.links?.filter((_, item) => item !== index) })}>×</button></div>)}</div>
    <button className="primary" type="submit">Apply changes</button>
  </form>;
}

function Empty({ title, text }: { title: string; text: string }) { return <section className="panel-content"><p className="eyebrow">{title.toUpperCase()}</p><h2>{title}</h2><p>{text}</p></section>; }

function Panel({ id, document, selectedId, setSelected, updateDocument, activity, relayoutToken }: { id: PanelId; document: MapDocument; selectedId?: string; setSelected(id: string): void; updateDocument(value: MapDocument, message?: string): void; activity: string[]; relayoutToken: number }) {
  const all = flatten(document.nodes); const selected = all.find((node) => node.id === selectedId);
  if (id === "graph") return <GraphPanel document={document} selectedId={selectedId} onSelect={setSelected} onView={(view) => updateDocument({ ...document, view })} relayoutToken={relayoutToken} />;
  if (id === "inspector") return <Inspector node={selected} allNodes={all} onApply={(values) => selected && updateDocument({ ...document, nodes: updateNode(document.nodes, selected.id, values) }, `Updated ${selected.id}`)} />;
  if (id === "outline") return <section className="panel-content"><p className="eyebrow">OUTLINE</p><div className="outline">{all.map((node) => <button key={node.id} className={selectedId === node.id ? "active" : ""} style={{ paddingLeft: `${10 + node.depth * 14}px` }} onClick={() => setSelected(node.id)}>{node.children.length ? "◆" : "·"} {node.title}</button>)}</div></section>;
  if (id === "search") return <Search nodes={all} onSelect={setSelected} />;
  return <section className="panel-content"><p className="eyebrow">ACTIVITY</p><div className="activity">{activity.length ? activity.map((entry, index) => <div key={`${entry}-${index}`}>{entry}</div>) : <p>No changes in this session.</p>}</div></section>;
}

function Search({ nodes, onSelect }: { nodes: IndexedNode[]; onSelect(id: string): void }) { const [query, setQuery] = useState(""); const results = query ? nodes.filter((node) => `${node.title} ${node.summary} ${node.id}`.toLowerCase().includes(query.toLowerCase())).slice(0, 100) : []; return <section className="panel-content"><p className="eyebrow">SEARCH</p><input autoFocus placeholder="Search the map…" value={query} onChange={(event) => setQuery(event.target.value)} /><div className="search-results">{results.map((node) => <button key={node.id} onClick={() => onSelect(node.id)}><strong>{node.title}</strong><span>{node.type} · {node.id}</span></button>)}</div></section>; }

export function App() {
  const dockModel = useMemo(workspaceModel, []); const detached = new URLSearchParams(location.search).get("panel") as PanelId | null;
  const [document, setDocument] = useState<MapDocument>(emptyMap()); const [mapPath, setMapPath] = useState<string>(); const [selectedId, setSelectedId] = useState<string>(); const [dirty, setDirty] = useState(false); const [activity, setActivity] = useState<string[]>([]); const [relayoutToken, setRelayoutToken] = useState(0); const undo = useRef<MapDocument[]>([]); const redo = useRef<MapDocument[]>([]); const [, redraw] = useState(0);
  const load = useCallback((result: { path: string; data: unknown }) => { setDocument(result.data as MapDocument); setMapPath(result.path); setSelectedId(undefined); setDirty(false); undo.current = []; redo.current = []; setActivity([`Opened ${result.path}`]); }, []);
  useEffect(() => { void window.mindmap.loadDefault().then(load).catch((error) => setActivity([String(error)])); }, [load]);
  const updateDocument = useCallback((value: MapDocument, message?: string) => { setDocument((current) => { undo.current.push(current); if (undo.current.length > 100) undo.current.shift(); return value; }); redo.current = []; setDirty(true); if (message) setActivity((items) => [message, ...items].slice(0, 100)); }, []);
  const openPanel = useCallback((panel: PanelId) => { if (dockModel.getNodeById(`panel-${panel}`)) return; const destination = dockModel.getActiveTabset() ?? dockModel.getFirstTabSet(); dockModel.doAction(Actions.addNode({ type: "tab", id: `panel-${panel}`, name: panelLabel[panel], component: panel }, destination.getId(), DockLocation.CENTER, -1, true)); localStorage.setItem(WORKSPACE_KEY, JSON.stringify(dockModel.toJson())); redraw((n) => n + 1); }, [dockModel]);
  const resetWorkspace = useCallback(() => { localStorage.removeItem(WORKSPACE_KEY); location.reload(); }, []);
  const addNode = useCallback((parent?: string) => { const id = uniqueId(document, parent ? "new-child" : "new-node"); const node: MapNode = { id, title: "New node", type: "concept", categories: ["uncategorized"], summary: "", status: "active", children: [], links: [] }; updateDocument({ ...document, nodes: insertNode(document.nodes, node, parent) }, `Added ${id}`); setSelectedId(id); }, [document, updateDocument]);
  const deleteSelected = useCallback(() => { if (!selectedId || !confirm(`Delete ${selectedId} and its complete subtree?`)) return; const removed = removeNode(document.nodes, selectedId); const positions = { ...document.view.positions }; const expanded = document.view.expanded.filter((id) => !removed.removed.has(id)); for (const id of removed.removed) delete positions[id]; updateDocument({ ...document, nodes: removed.nodes, view: { ...document.view, positions, expanded } }, `Deleted ${selectedId}`); setSelectedId(undefined); }, [document, selectedId, updateDocument]);
  const save = useCallback(async (as = false) => { const saved = as ? await window.mindmap.saveAs(document) : await window.mindmap.save(document); if (saved) { setMapPath(saved); setDirty(false); setActivity((items) => [`Saved ${saved}`, ...items]); } }, [document]);
  useEffect(() => window.mindmap.onCommand((command) => {
    if (command === "open") void window.mindmap.open().then((result) => result && load(result));
    else if (command === "new") { const next = emptyMap(); updateDocument(next, "Created a new map"); setMapPath(undefined); }
    else if (command === "save") void save(); else if (command === "save-as") void save(true);
    else if (command === "undo" && undo.current.length) { const previous = undo.current.pop()!; redo.current.push(document); setDocument(previous); setDirty(true); }
    else if (command === "redo" && redo.current.length) { const next = redo.current.pop()!; undo.current.push(document); setDocument(next); setDirty(true); }
    else if (command === "add-root") addNode(); else if (command === "add-child" && selectedId) addNode(selectedId); else if (command === "delete-selected") deleteSelected();
    else if (command.startsWith("show-panel:")) { const panel = command.slice(11) as PanelId; if (PANEL_IDS.includes(panel)) openPanel(panel); }
    else if (command === "reset-workspace") resetWorkspace();
    else if (command === "fit-graph") updateDocument({ ...document, view: { ...document.view, zoom: 0.7, viewport: [0, 0] } });
    else if (command === "relayout-graph") setRelayoutToken((value) => value + 1);
    else if (command === "show-all") updateDocument({ ...document, view: { ...document.view, expanded: flatten(document.nodes).filter((node) => node.children.length).map((node) => node.id) } });
    else if (command === "collapse-all") updateDocument({ ...document, view: { ...document.view, expanded: [] } });
    else if ((command === "expand-selected" || command === "collapse-selected") && selectedId) { const expanded = new Set(document.view.expanded); command === "expand-selected" ? expanded.add(selectedId) : expanded.delete(selectedId); updateDocument({ ...document, view: { ...document.view, expanded: [...expanded] } }); }
  }), [addNode, deleteSelected, document, load, openPanel, resetWorkspace, save, selectedId, updateDocument]);
  const panel = (id: PanelId) => <div className="panel-wrapper"><div className="panel-window-actions"><button title="Detach into its own window" onClick={() => void window.mindmap.detach(id)}>↗</button></div><Panel id={id} document={document} selectedId={selectedId} setSelected={setSelectedId} updateDocument={updateDocument} activity={activity} relayoutToken={relayoutToken} /></div>;
  if (detached && PANEL_IDS.includes(detached)) return <main className="detached-shell">{panel(detached)}</main>;
  return <main className="app-shell"><header className="workspace-header"><div className="workspace-title"><span className="brand-mark" /><span>{dirty ? "● " : ""}{document.project.name}</span></div><div className="workspace-actions">{PANEL_IDS.map((id) => <button key={id} onClick={() => openPanel(id)}>{panelLabel[id]}</button>)}<button onClick={resetWorkspace}>Reset layout</button></div></header><section className="workspace-layout"><Layout model={dockModel} factory={(node: TabNode) => panel(node.getComponent() as PanelId)} onModelChange={(model) => localStorage.setItem(WORKSPACE_KEY, JSON.stringify(model.toJson()))} /></section><footer className="workspace-status"><span>{mapPath ?? "Unsaved map"}</span><span>{flatten(document.nodes).length} nodes · {dirty ? "Unsaved changes" : "Saved"}</span></footer></main>;
}
