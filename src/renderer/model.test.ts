import assert from "node:assert/strict";
import test from "node:test";
import { emptyMap, flatten, insertNode, removeNode, uniqueId, updateNode, type MapNode } from "./model";

const node = (id: string, children: MapNode[] = []): MapNode => ({ id, title: id, type: "concept", categories: ["test"], summary: "", status: "active", children, links: [] });

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

test("unique IDs are stable kebab-case and collision-free", () => {
  const document = emptyMap(); document.nodes = [node("new-node"), node("new-node-2")];
  assert.equal(uniqueId(document, "New Node"), "new-node-3");
});
