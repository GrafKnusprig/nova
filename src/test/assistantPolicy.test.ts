import assert from "node:assert/strict";
import test from "node:test";
import { modeAllows, mutationToolsForMode } from "../main/assistantPolicy";

test("draft mode exposes no project mutation tools", () => {
  assert.deepEqual(mutationToolsForMode("draft"), []);
  assert.equal(modeAllows("draft", "edit"), false);
  assert.equal(modeAllows("draft", "full"), false);
});

test("edit mode can change data but cannot delete nodes", () => {
  assert.deepEqual(mutationToolsForMode("edit"), ["apply_changes"]);
  assert.equal(modeAllows("edit", "edit"), true);
  assert.equal(modeAllows("edit", "full"), false);
});

test("full mode exposes edit and deletion tools", () => {
  assert.deepEqual(mutationToolsForMode("full"), ["apply_changes", "delete_nodes"]);
  assert.equal(modeAllows("full", "edit"), true);
  assert.equal(modeAllows("full", "full"), true);
});

