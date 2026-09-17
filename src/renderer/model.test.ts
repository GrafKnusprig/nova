import assert from "node:assert/strict";
import test from "node:test";
import { createNode, emptyMap, flatten, guidId, insertNode, nodeLabelMetrics, nodePassesTagFilter, projectRoot, removeNode, tagButtonSelected, updateNode, type MapNode } from "./model";

const node = (id: string, children: MapNode[] = []): MapNode => ({ id, title: id, tags: ["test"], main_tag: "test", summary: "", created_at: "2026-01-01T00:00:00.000Z", modified_at: "2026-01-01T00:00:00.000Z", children, links: [] });

test("recursive insertion and update retain hierarchy", () => {
  const roots = [node("root")];
  const inserted = insertNode(roots, node("child"), "root");
  const updated = updateNode(inserted, "child", { title: "Changed" });
  assert.equal(updated[0].children[0].title, "Changed");
  assert.equal(flatten(updated)[1].parentId, "root");
});

test("subtree deletion removes incoming links to every descendant", () => {
  const child = node("child", [node("grandchild")]);
  const source = node("source"); source.links = [{ target: "grandchild", relation: "supports" }];
  const result = removeNode([node("root", [child]), source], "child");
  assert.deepEqual([...result.removed].sort(), ["child", "grandchild"]);
  assert.equal(flatten(result.nodes).some((entry) => entry.id === "grandchild"), false);
  assert.deepEqual(result.nodes[1].links, []);
});

test("new node IDs are title-independent UUIDs", () => {
  const first = guidId(emptyMap()); const second = guidId(emptyMap());
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(first, second);
});

test("node creation and updates own timestamps", () => {
  const created = createNode(emptyMap(), "Stable title"); assert.equal(created.created_at, created.modified_at);
  const updated = updateNode([created], created.id, { title: "Changed title" }, "2026-09-15T12:00:00.000Z")[0];
  assert.equal(updated.id, created.id); assert.equal(updated.created_at, created.created_at); assert.equal(updated.modified_at, "2026-09-15T12:00:00.000Z");
});

test("tag filtering supports inclusive and exclusive modes", () => {
  const candidate = { tags: ["implementation", "active"] }; const selected = new Set(["implementation"]); const unrelated = new Set(["documentation"]);
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
  const small = nodeLabelMetrics(48, true), cornerRadius = Math.hypot(small.width / 2, small.height / 2);
  assert.ok(cornerRadius < 48);
  assert.ok(small.titleFontSize >= 11);
  assert.ok(small.tagFontSize >= 7.5);
  assert.equal(small.titleLines, 2);
  assert.equal(nodeLabelMetrics(80, true).titleLines, 3);
});

test("new projects contain one expanded project root", () => {
  const document = emptyMap(); const root = projectRoot(document);
  assert.equal(document.nodes.length, 1);
  assert.equal(document.project.root_node_id, root.id);
  assert.equal(root.title, "Untitled project");
  assert.deepEqual(document.view.expanded, [root.id]);
});

test("main topics are inserted beneath the project root", () => {
  const document = emptyMap(), root = projectRoot(document), topic = createNode(document, "Main topic");
  const nodes = insertNode(document.nodes, topic, root.id);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].children[0].id, topic.id);
});
