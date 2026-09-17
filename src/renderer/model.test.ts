import assert from "node:assert/strict";
import test from "node:test";
import { communityEdgeWeight, detectCommunities } from "./layoutModel";
import {
  ancestorPath,
  arrangeRevealedNodes,
  createNode,
  descendantIds,
  emptyMap,
  flatten,
  guidId,
  insertNode,
  nodeLabelMetrics,
  nodePassesTagFilter,
  nearestVisibleNode,
  projectRoot,
  removeNode,
  tagButtonSelected,
  updateNode,
  zoomViewportAroundPoint,
  type IndexedNode,
  type MapNode,
} from "./model";

const node = (id: string, children: MapNode[] = []): MapNode => ({
  id,
  title: id,
  tags: ["test"],
  main_tag: "test",
  summary: "",
  created_at: "2026-01-01T00:00:00.000Z",
  modified_at: "2026-01-01T00:00:00.000Z",
  children,
  links: [],
});

test("layout modes derive communities from weighted graph topology", () => {
  assert.ok(
    communityEdgeWeight("hierarchy", "hierarchy") >
      communityEdgeWeight("semantic", "hierarchy"),
  );
  assert.ok(
    communityEdgeWeight("semantic", "relations") >
      communityEdgeWeight("hierarchy", "relations"),
  );

  const groups = detectCommunities(
    ["a", "b", "c", "d", "e", "f"],
    [
      { source: "a", target: "b", kind: "semantic" },
      { source: "b", target: "c", kind: "semantic" },
      { source: "c", target: "a", kind: "semantic" },
      { source: "d", target: "e", kind: "semantic" },
      { source: "e", target: "f", kind: "semantic" },
      { source: "f", target: "d", kind: "semantic" },
      { source: "c", target: "d", kind: "hierarchy" },
    ],
    "relations",
  );
  assert.equal(groups.get("a"), groups.get("b"));
  assert.equal(groups.get("b"), groups.get("c"));
  assert.equal(groups.get("d"), groups.get("e"));
  assert.equal(groups.get("e"), groups.get("f"));
  assert.notEqual(groups.get("c"), groups.get("d"));
});

test("recursive insertion and update retain hierarchy", () => {
  const roots = [node("root")];
  const inserted = insertNode(roots, node("child"), "root");
  const updated = updateNode(inserted, "child", { title: "Changed" });
  assert.equal(updated[0].children[0].title, "Changed");
  assert.equal(flatten(updated)[1].parentId, "root");
});

test("descendant IDs include the complete subtree but not its parent", () => {
  const roots = [node("root", [node("child", [node("grandchild")])])];
  assert.deepEqual([...descendantIds(roots, "root")].sort(), [
    "child",
    "grandchild",
  ]);
  assert.deepEqual([...descendantIds(roots, "child")], ["grandchild"]);
});

test("subtree deletion removes incoming links to every descendant", () => {
  const child = node("child", [node("grandchild")]);
  const source = node("source");
  source.links = [{ target: "grandchild", relation: "supports" }];
  const result = removeNode([node("root", [child]), source], "child");
  assert.deepEqual([...result.removed].sort(), ["child", "grandchild"]);
  assert.equal(
    flatten(result.nodes).some((entry) => entry.id === "grandchild"),
    false,
  );
  assert.deepEqual(result.nodes[1].links, []);
});

test("new node IDs are title-independent UUIDs", () => {
  const first = guidId(emptyMap());
  const second = guidId(emptyMap());
  assert.match(
    first,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.notEqual(first, second);
});

test("node creation and updates own timestamps", () => {
  const created = createNode(emptyMap(), "Stable title");
  assert.equal(created.created_at, created.modified_at);
  const updated = updateNode(
    [created],
    created.id,
    { title: "Changed title" },
    "2026-09-15T12:00:00.000Z",
  )[0];
  assert.equal(updated.id, created.id);
  assert.equal(updated.created_at, created.created_at);
  assert.equal(updated.modified_at, "2026-09-15T12:00:00.000Z");
});

test("tag filtering supports inclusive and exclusive modes", () => {
  const candidate = { tags: ["implementation", "active"] };
  const selected = new Set(["implementation"]);
  const unrelated = new Set(["documentation"]);
  assert.equal(nodePassesTagFilter(candidate, "include", selected), true);
  assert.equal(nodePassesTagFilter(candidate, "include", unrelated), false);
  assert.equal(nodePassesTagFilter(candidate, "exclude", selected), false);
  assert.equal(nodePassesTagFilter(candidate, "exclude", unrelated), true);
  assert.equal(nodePassesTagFilter(candidate, "include", new Set()), false);
  assert.equal(nodePassesTagFilter(candidate, "exclude", new Set()), true);
});

test("exclusive filter buttons select the tags that remain visible", () => {
  const storedExcluded = new Set(["hidden"]);
  assert.equal(tagButtonSelected("visible", "exclude", storedExcluded), true);
  assert.equal(tagButtonSelected("hidden", "exclude", storedExcluded), false);
  assert.equal(tagButtonSelected("hidden", "include", storedExcluded), true);
  assert.equal(tagButtonSelected("visible", "include", storedExcluded), false);
});

test("node label boxes remain inside the circle with readable minimum fonts", () => {
  const small = nodeLabelMetrics(48, true),
    cornerRadius = Math.hypot(small.width / 2, small.height / 2);
  assert.ok(cornerRadius < 48);
  assert.ok(small.titleFontSize >= 11);
  assert.ok(small.tagFontSize >= 7.5);
  assert.equal(small.titleLines, 2);
  assert.equal(nodeLabelMetrics(80, true).titleLines, 3);
});

test("zooming keeps the graph point beneath the pointer stationary", () => {
  const viewport: [number, number] = [100, -40],
    anchor: [number, number] = [900, 200],
    center: [number, number] = [600, 400],
    previousZoom = 0.5,
    nextZoom = 1.25,
    worldPoint: [number, number] = [
      center[0] + (anchor[0] - viewport[0] - center[0]) / previousZoom,
      center[1] + (anchor[1] - viewport[1] - center[1]) / previousZoom,
    ],
    nextViewport = zoomViewportAroundPoint(
      viewport,
      previousZoom,
      nextZoom,
      anchor,
      center,
    );
  assert.deepEqual(
    [
      nextViewport[0] + center[0] + nextZoom * (worldPoint[0] - center[0]),
      nextViewport[1] + center[1] + nextZoom * (worldPoint[1] - center[1]),
    ],
    anchor,
  );
});

test("navigation resolves ancestor paths and the nearest visible representative", () => {
  const parents = new Map<string, string | undefined>([
    ["root", undefined],
    ["topic", "root"],
    ["branch", "topic"],
    ["leaf", "branch"],
  ]);
  assert.deepEqual(ancestorPath("leaf", parents), [
    "root",
    "topic",
    "branch",
    "leaf",
  ]);
  assert.equal(
    nearestVisibleNode("leaf", parents, new Set(["root", "topic"])),
    "topic",
  );
  assert.equal(
    nearestVisibleNode("leaf", parents, new Set(["root", "leaf"])),
    "leaf",
  );
});

test("expansion layout moves only newly revealed branches around their parent", () => {
  const revealed = [
    { ...node("child-a"), parentId: "parent", depth: 1 },
    { ...node("child-b"), parentId: "parent", depth: 1 },
    { ...node("grandchild"), parentId: "child-a", depth: 2 },
  ] as IndexedNode[];
  const seed = {
      parent: [500, 500] as [number, number],
      existing: [300, 300] as [number, number],
      "child-a": [10, 10] as [number, number],
    },
    radii = new Map([
      ["parent", 50],
      ["existing", 45],
      ["child-a", 35],
      ["child-b", 35],
      ["grandchild", 30],
    ]),
    result = arrangeRevealedNodes("parent", revealed, seed, radii, [
      { id: "parent", point: seed.parent, radius: 50 },
      { id: "existing", point: seed.existing, radius: 45 },
    ]);
  assert.deepEqual(result.parent, seed.parent);
  assert.deepEqual(result.existing, seed.existing);
  assert.notDeepEqual(result["child-a"], seed["child-a"]);
  assert.ok(
    Math.hypot(
      result["child-a"][0] - seed.parent[0],
      result["child-a"][1] - seed.parent[1],
    ) >=
      50 + 35 + 37.9,
  );
  assert.ok(
    Math.hypot(
      result.grandchild[0] - result["child-a"][0],
      result.grandchild[1] - result["child-a"][1],
    ) >=
      35 + 30 + 37.9,
  );
});

test("new projects contain one expanded project root", () => {
  const document = emptyMap();
  const root = projectRoot(document);
  assert.equal(document.nodes.length, 1);
  assert.equal(document.project.root_node_id, root.id);
  assert.equal(root.title, "Untitled project");
  assert.deepEqual(document.view.expanded, [root.id]);
});

test("main topics are inserted beneath the project root", () => {
  const document = emptyMap(),
    root = projectRoot(document),
    topic = createNode(document, "Main topic");
  const nodes = insertNode(document.nodes, topic, root.id);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].children[0].id, topic.id);
});
