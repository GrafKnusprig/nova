export type LayoutMode = "hierarchy" | "relations";
export type LayoutEdgeKind = "hierarchy" | "semantic";

export interface CommunityEdge {
  source: string;
  target: string;
  kind: LayoutEdgeKind;
}

export function communityEdgeWeight(
  kind: LayoutEdgeKind,
  mode: LayoutMode,
): number {
  if (mode === "hierarchy") return kind === "hierarchy" ? 1 : 0.18;
  return kind === "semantic" ? 1 : 0.08;
}

export function detectCommunities(
  nodeIds: readonly string[],
  edges: readonly CommunityEdge[],
  mode: LayoutMode,
): Map<string, string> {
  const adjacency = new Map<string, Map<string, number>>(
    nodeIds.map((id) => [id, new Map()]),
  );
  for (const edge of edges) {
    if (edge.source === edge.target) continue;
    const weight = communityEdgeWeight(edge.kind, mode),
      source = adjacency.get(edge.source),
      target = adjacency.get(edge.target);
    if (!source || !target) continue;
    source.set(edge.target, (source.get(edge.target) ?? 0) + weight);
    target.set(edge.source, (target.get(edge.source) ?? 0) + weight);
  }
  const degrees = new Map(
      nodeIds.map((id) => [
        id,
        [...(adjacency.get(id)?.values() ?? [])].reduce(
          (sum, weight) => sum + weight,
          0,
        ),
      ]),
    ),
    totalDegree = [...degrees.values()].reduce((sum, value) => sum + value, 0);
  if (totalDegree === 0) return new Map(nodeIds.map((id) => [id, id]));

  const community = new Map(nodeIds.map((id) => [id, id])),
    communityDegree = new Map(degrees),
    resolution = mode === "hierarchy" ? 1.08 : 1;
  const order = [...nodeIds].sort(
    (left, right) =>
      (degrees.get(right) ?? 0) - (degrees.get(left) ?? 0) ||
      left.localeCompare(right),
  );
  for (let pass = 0; pass < 24; pass += 1) {
    let moved = false;
    for (const nodeId of order) {
      const degree = degrees.get(nodeId) ?? 0;
      if (degree === 0) continue;
      const previous = community.get(nodeId)!,
        weightsByCommunity = new Map<string, number>();
      for (const [neighbor, weight] of adjacency.get(nodeId) ?? []) {
        const neighborCommunity = community.get(neighbor)!;
        weightsByCommunity.set(
          neighborCommunity,
          (weightsByCommunity.get(neighborCommunity) ?? 0) + weight,
        );
      }
      communityDegree.set(
        previous,
        (communityDegree.get(previous) ?? 0) - degree,
      );
      let best = previous,
        bestGain =
          (weightsByCommunity.get(previous) ?? 0) -
          (resolution * degree * (communityDegree.get(previous) ?? 0)) /
            totalDegree;
      for (const [candidate, internalWeight] of weightsByCommunity) {
        const gain =
          internalWeight -
          (resolution * degree * (communityDegree.get(candidate) ?? 0)) /
            totalDegree;
        if (
          gain > bestGain + 1e-9 ||
          (Math.abs(gain - bestGain) <= 1e-9 && candidate < best)
        ) {
          best = candidate;
          bestGain = gain;
        }
      }
      community.set(nodeId, best);
      communityDegree.set(best, (communityDegree.get(best) ?? 0) + degree);
      if (best !== previous) moved = true;
    }
    if (!moved) break;
  }

  const members = new Map<string, string[]>();
  for (const nodeId of nodeIds) {
    const label = community.get(nodeId)!;
    const values = members.get(label) ?? [];
    values.push(nodeId);
    members.set(label, values);
  }
  const canonical = new Map<string, string>();
  for (const [label, values] of members)
    canonical.set(label, [...values].sort()[0]);
  return new Map(
    nodeIds.map((nodeId) => [
      nodeId,
      canonical.get(community.get(nodeId)!) ?? nodeId,
    ]),
  );
}
