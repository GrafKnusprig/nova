import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";

interface LayoutNode extends SimulationNodeDatum { id: string; radius: number }
interface LayoutLink extends SimulationLinkDatum<LayoutNode> { kind: "hierarchy" | "semantic" }
interface LayoutRequest { nodes: Array<{ id: string; radius: number; x: number; y: number }>; links: Array<{ source: string; target: string; kind: "hierarchy" | "semantic" }> }

self.onmessage = (event: MessageEvent<LayoutRequest>) => {
  const nodes: LayoutNode[] = event.data.nodes.map((node) => ({ ...node }));
  const links: LayoutLink[] = event.data.links.map((link) => ({ ...link }));
  const linkForce = forceLink<LayoutNode, LayoutLink>(links)
    .id((node) => node.id)
    .distance((link) => {
      const source = link.source as LayoutNode; const target = link.target as LayoutNode;
      return source.radius + target.radius + (link.kind === "hierarchy" ? 105 : 300);
    })
    .strength((link) => link.kind === "hierarchy" ? 0.72 : 0.075);

  const simulation = forceSimulation(nodes)
    .alpha(1)
    .alphaDecay(0.017)
    .velocityDecay(0.38)
    .force("links", linkForce)
    .force("charge", forceManyBody<LayoutNode>().strength((node) => -520 - node.radius * 9).distanceMax(850))
    .force("collision", forceCollide<LayoutNode>().radius((node) => node.radius + 34).strength(1).iterations(3))
    .force("center", forceCenter(600, 400).strength(0.06))
    .force("x", forceX<LayoutNode>(600).strength(0.008))
    .force("y", forceY<LayoutNode>(400).strength(0.008))
    .stop();

  for (let iteration = 0; iteration < 300; iteration++) simulation.tick();
  postMessage(Object.fromEntries(nodes.map((node) => [node.id, [node.x ?? 600, node.y ?? 400]])));
};

export {};
