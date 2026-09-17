import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAssistantToken, recoverableToolError } from "../main/assistant";

test("assistant normalizes human-readable tag and relation labels", () => {
  assert.equal(normalizeAssistantToken("Work Tasks", "tag"), "work-tasks");
  assert.equal(normalizeAssistantToken("  Supported by  ", "relation"), "supported-by");
  assert.equal(normalizeAssistantToken("Überprüfung", "tag"), "uberprufung");
  assert.throws(() => normalizeAssistantToken("---", "tag"), /letters or numbers/);
});

test("assistant tool failures are represented as retryable model feedback", () => {
  const result = recoverableToolError("apply_changes", new Error("Link endpoints are invalid."));
  assert.equal(result.ok, false);
  assert.equal(result.retryable, true);
  assert.equal(result.tool, "apply_changes");
  assert.equal(result.error, "Link endpoints are invalid.");
  assert.match(String(result.guidance), /newly created node/);
});
