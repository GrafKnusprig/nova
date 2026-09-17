import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";

type LayoutMode = "hierarchy" | "relations";
interface LayoutNode extends SimulationNodeDatum {
  id: string;
  radius: number;
}
interface LayoutLink extends SimulationLinkDatum<LayoutNode> {
  kind: "hierarchy" | "semantic";
}
interface LayoutRequest {
  rootId: string;
  mode: LayoutMode;
  compact: boolean;
  nodes: Array<{ id: string; radius: number; x: number; y: number }>;
  links: Array<{
    source: string;
    target: string;
    kind: "hierarchy" | "semantic";
  }>;
}

function relationGroups(request: LayoutRequest): Map<string, string> {
  const parent = new Map(request.nodes.map((node) => [node.id, node.id])),
    sizes = new Map(request.nodes.map((node) => [node.id, 1])),
    maximumGroupSize = Math.max(6, Math.ceil(Math.sqrt(request.nodes.length)));
  const find = (id: string): string => {
    const value = parent.get(id) ?? id;
    if (value === id) return id;
    const root = find(value);
    parent.set(id, root);
    return root;
  };
  const union = (left: string, right: string) => {
    const a = find(left),
      b = find(right);
    if (a === b || (sizes.get(a) ?? 1) + (sizes.get(b) ?? 1) > maximumGroupSize)
      return;
    parent.set(b, a);
    sizes.set(a, (sizes.get(a) ?? 1) + (sizes.get(b) ?? 1));
  };
  for (const link of request.links)
    if (link.kind === "semantic") union(link.source, link.target);
  return new Map(request.nodes.map((node) => [node.id, find(node.id)]));
}

function hierarchyGroups(request: LayoutRequest): Map<string, string> {
  const parents = new Map(
    request.links
      .filter((link) => link.kind === "hierarchy")
      .map((link) => [link.target, link.source]),
  );
  return new Map(
    request.nodes.map((node) => {
      let current = node.id,
        parent = parents.get(current);
      while (parent && parent !== request.rootId) {
        current = parent;
        parent = parents.get(current);
      }
      return [node.id, node.id === request.rootId ? request.rootId : current];
    }),
  );
}

function groupCenters(
  request: LayoutRequest,
  groupByNode: ReadonlyMap<string, string>,
): Map<string, [number, number]> {
  const sizes = new Map<string, number>();
  for (const node of request.nodes) {
    const group = groupByNode.get(node.id) ?? node.id;
    sizes.set(group, (sizes.get(group) ?? 0) + 1);
  }
  const rootGroup = groupByNode.get(request.rootId),
    groups = [...sizes].sort((left, right) => {
      if (left[0] === rootGroup) return -1;
      if (right[0] === rootGroup) return 1;
      return right[1] - left[1] || left[0].localeCompare(right[0]);
    }),
    spacing = request.mode === "hierarchy" ? 900 : 280,
    goldenAngle = Math.PI * (3 - Math.sqrt(5));
  return new Map(
    groups.map(([group], index) => {
      if (index === 0) return [group, [600, 400]];
      const distance = spacing * Math.sqrt(index),
        angle = index * goldenAngle;
      return [
        group,
        [600 + Math.cos(angle) * distance, 400 + Math.sin(angle) * distance],
      ];
    }),
  );
}

self.onmessage = (event: MessageEvent<LayoutRequest>) => {
  const request = event.data,
    nodes: LayoutNode[] = request.nodes.map((node) => ({ ...node })),
    root = nodes.find((node) => node.id === request.rootId);
  if (root) {
    root.fx = 600;
    root.fy = 400;
  }
  const links: LayoutLink[] = request.links.map((link) => ({ ...link })),
    hierarchyFocused = request.mode === "hierarchy",
    linkForce = forceLink<LayoutNode, LayoutLink>(links)
      .id((node) => node.id)
      .distance((link) => {
        const source = link.source as LayoutNode,
          target = link.target as LayoutNode,
          dominant = hierarchyFocused
            ? link.kind === "hierarchy"
            : link.kind === "semantic";
        return (
          source.radius +
          target.radius +
          (dominant ? (request.compact ? 68 : 62) : request.compact ? 175 : 310)
        );
      })
      .strength((link) => {
        const dominant = hierarchyFocused
          ? link.kind === "hierarchy"
          : link.kind === "semantic";
        if (request.compact)
          return dominant ? 0.74 : hierarchyFocused ? 0.065 : 0.11;
        return dominant ? 0.88 : hierarchyFocused ? 0.035 : 0.025;
      }),
    simulation = forceSimulation(nodes)
      .alpha(1)
      .alphaDecay(0.015)
      .velocityDecay(0.38)
      .force("links", linkForce)
      .force(
        "charge",
        forceManyBody<LayoutNode>()
          .strength(
            (node) =>
              -(request.compact ? 390 : 340) -
              node.radius * (request.compact ? 6 : 5),
          )
          .distanceMax(request.compact ? 700 : 680),
      )
      .force(
        "collision",
        forceCollide<LayoutNode>()
          .radius((node) => node.radius + (request.compact ? 20 : 24))
          .strength(1)
          .iterations(3),
      )
      .force("center", forceCenter(600, 400).strength(0.045))
      .stop();

  if (request.compact) {
    simulation
      .force("x", forceX<LayoutNode>(600).strength(0.01))
      .force("y", forceY<LayoutNode>(400).strength(0.01));
  } else {
    const groups = hierarchyFocused
        ? hierarchyGroups(request)
        : relationGroups(request),
      centers = groupCenters(request, groups),
      groupStrength = hierarchyFocused ? 0.16 : 0.075;
    simulation
      .force(
        "groupX",
        forceX<LayoutNode>(
          (node) => centers.get(groups.get(node.id)!)?.[0] ?? 600,
        ).strength(groupStrength),
      )
      .force(
        "groupY",
        forceY<LayoutNode>(
          (node) => centers.get(groups.get(node.id)!)?.[1] ?? 400,
        ).strength(groupStrength),
      );
  }

  for (let iteration = 0; iteration < 350; iteration++) simulation.tick();
  postMessage(
    Object.fromEntries(
      nodes.map((node) => [node.id, [node.x ?? 600, node.y ?? 400]]),
    ),
  );
};

export {};
