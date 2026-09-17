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
import {
  communityEdgeWeight,
  detectCommunities,
  type LayoutEdgeKind,
  type LayoutMode,
} from "./layoutModel";

interface LayoutNode extends SimulationNodeDatum {
  id: string;
  radius: number;
}

interface LayoutLink extends SimulationLinkDatum<LayoutNode> {
  kind: LayoutEdgeKind;
}

interface LayoutRequest {
  rootId: string;
  mode: LayoutMode;
  compact: boolean;
  nodes: Array<{ id: string; radius: number; x: number; y: number }>;
  links: Array<{ source: string; target: string; kind: LayoutEdgeKind }>;
}

interface CommunityNode extends SimulationNodeDatum {
  id: string;
  radius: number;
  memberCount: number;
}

interface CommunityLink extends SimulationLinkDatum<CommunityNode> {
  weight: number;
}

function communityCenters(
  request: LayoutRequest,
  groupByNode: ReadonlyMap<string, string>,
): Map<string, [number, number]> {
  const areaByGroup = new Map<string, number>(),
    countByGroup = new Map<string, number>();
  for (const node of request.nodes) {
    const group = groupByNode.get(node.id) ?? node.id;
    areaByGroup.set(group, (areaByGroup.get(group) ?? 0) + node.radius ** 2);
    countByGroup.set(group, (countByGroup.get(group) ?? 0) + 1);
  }

  const rankedGroups = [...areaByGroup].sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    ),
    rootGroup = groupByNode.get(request.rootId),
    centralGroup =
      request.mode === "hierarchy" && rootGroup
        ? rootGroup
        : rankedGroups[0]?.[0],
    goldenAngle = Math.PI * (3 - Math.sqrt(5)),
    communityNodes: CommunityNode[] = rankedGroups.map(
      ([id, squaredRadius], index) => {
        const distance = index === 0 ? 0 : 340 * Math.sqrt(index),
          angle = index * goldenAngle;
        return {
          id,
          radius: Math.sqrt(squaredRadius) * 1.12 + 58,
          memberCount: countByGroup.get(id) ?? 1,
          x: 600 + Math.cos(angle) * distance,
          y: 400 + Math.sin(angle) * distance,
        };
      },
    ),
    crossWeights = new Map<string, number>();

  for (const link of request.links) {
    const sourceGroup = groupByNode.get(link.source),
      targetGroup = groupByNode.get(link.target);
    if (!sourceGroup || !targetGroup || sourceGroup === targetGroup) continue;
    const [left, right] = [sourceGroup, targetGroup].sort(),
      key = `${left}\u0000${right}`;
    crossWeights.set(
      key,
      (crossWeights.get(key) ?? 0) +
        communityEdgeWeight(link.kind, request.mode),
    );
  }

  const communityLinks: CommunityLink[] = [...crossWeights].map(
      ([key, weight]) => {
        const [source, target] = key.split("\u0000");
        return { source, target, weight };
      },
    ),
    centralNode = communityNodes.find((node) => node.id === centralGroup);
  if (centralNode) {
    centralNode.fx = 600;
    centralNode.fy = 400;
  }

  const simulation = forceSimulation(communityNodes)
    .alpha(1)
    .alphaDecay(0.018)
    .velocityDecay(0.4)
    .force(
      "links",
      forceLink<CommunityNode, CommunityLink>(communityLinks)
        .id((node) => node.id)
        .distance((link) => {
          const source = link.source as CommunityNode,
            target = link.target as CommunityNode;
          return (
            source.radius +
            target.radius +
            115 +
            190 / Math.sqrt(Math.max(0.08, link.weight))
          );
        })
        .strength((link) => Math.min(0.58, 0.08 + link.weight * 0.12)),
    )
    .force(
      "charge",
      forceManyBody<CommunityNode>()
        .strength((node) => -3900 - node.radius * 16)
        .distanceMax(2600),
    )
    .force(
      "collision",
      forceCollide<CommunityNode>()
        .radius((node) => node.radius + 100)
        .strength(1)
        .iterations(4),
    )
    .force("center", forceCenter(600, 400).strength(0.075))
    .force("x", forceX<CommunityNode>(600).strength(0.006))
    .force("y", forceY<CommunityNode>(400).strength(0.006))
    .stop();
  for (let iteration = 0; iteration < 280; iteration += 1) simulation.tick();

  return new Map(
    communityNodes.map((node) => [
      node.id,
      [node.x ?? 600, node.y ?? 400] as [number, number],
    ]),
  );
}

self.onmessage = (event: MessageEvent<LayoutRequest>) => {
  const request = event.data,
    nodes: LayoutNode[] = request.nodes.map((node) => ({ ...node })),
    hierarchyFocused = request.mode === "hierarchy",
    groups = request.compact
      ? undefined
      : detectCommunities(
          request.nodes.map((node) => node.id),
          request.links,
          request.mode,
        ),
    root = nodes.find((node) => node.id === request.rootId);
  if (root && (request.compact || hierarchyFocused)) {
    root.fx = 600;
    root.fy = 400;
  }

  const links: LayoutLink[] = request.links.map((link) => ({ ...link })),
    linkForce = forceLink<LayoutNode, LayoutLink>(links)
      .id((node) => node.id)
      .distance((link) => {
        const source = link.source as LayoutNode,
          target = link.target as LayoutNode,
          dominant = hierarchyFocused
            ? link.kind === "hierarchy"
            : link.kind === "semantic",
          sameCommunity =
            !groups || groups.get(source.id) === groups.get(target.id);
        return (
          source.radius +
          target.radius +
          (dominant
            ? request.compact
              ? 68
              : sameCommunity
                ? 62
                : hierarchyFocused
                  ? 430
                  : 225
            : request.compact
              ? 175
              : sameCommunity
                ? 205
                : 330)
        );
      })
      .strength((link) => {
        const source = link.source as LayoutNode,
          target = link.target as LayoutNode,
          sameCommunity =
            !groups || groups.get(source.id) === groups.get(target.id),
          dominant = hierarchyFocused
            ? link.kind === "hierarchy"
            : link.kind === "semantic";
        if (request.compact)
          return dominant ? 0.74 : hierarchyFocused ? 0.065 : 0.11;
        if (dominant && !sameCommunity) return hierarchyFocused ? 0.16 : 0.14;
        if (dominant) return 0.88;
        return sameCommunity ? 0.055 : 0.025;
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
              -(request.compact ? 390 : 350) -
              node.radius * (request.compact ? 6 : 5),
          )
          .distanceMax(request.compact ? 700 : 820),
      )
      .force(
        "collision",
        forceCollide<LayoutNode>()
          .radius((node) => node.radius + (request.compact ? 20 : 26))
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
    const activeGroups = groups!,
      centers = communityCenters(request, activeGroups),
      groupStrength = hierarchyFocused ? 0.145 : 0.11;
    simulation
      .force(
        "communityX",
        forceX<LayoutNode>(
          (node) => centers.get(activeGroups.get(node.id)!)?.[0] ?? 600,
        ).strength(groupStrength),
      )
      .force(
        "communityY",
        forceY<LayoutNode>(
          (node) => centers.get(activeGroups.get(node.id)!)?.[1] ?? 400,
        ).strength(groupStrength),
      );
  }

  for (let iteration = 0; iteration < 380; iteration += 1)
    simulation.tick();
  postMessage(
    Object.fromEntries(
      nodes.map((node) => [node.id, [node.x ?? 600, node.y ?? 400]]),
    ),
  );
};

export {};
