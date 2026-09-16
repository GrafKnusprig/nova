import assert from "node:assert/strict";
import test from "node:test";
import { toChatCompletionTools } from "../main/assistantProtocol";

test("Responses-style project functions map to Chat Completions tools", () => {
  const parameters = { type: "object", properties: { query: { type: "string" } } };
  assert.deepEqual(toChatCompletionTools([{ type: "function", name: "search_nodes", description: "Search nodes", parameters }]), [{
    type: "function",
    function: { name: "search_nodes", description: "Search nodes", parameters },
  }]);
});

