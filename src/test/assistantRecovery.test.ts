import assert from "node:assert/strict";
import test from "node:test";
import { AssistantToolGuard, assistantSafetyStop, assistantToolFingerprint, MAX_ASSISTANT_TOOL_ROUNDS, normalizeAssistantToken, recoverableToolError } from "../main/assistant";

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

test("assistant tool fingerprints ignore object property order", () => {
  assert.equal(
    assistantToolFingerprint("search_nodes", '{"limit":10,"query":"todo"}'),
    assistantToolFingerprint("search_nodes", '{"query":"todo","limit":10}'),
  );
});

test("assistant guard permits useful sequences and detects repeated patterns", () => {
  const useful = new AssistantToolGuard();
  for (let index = 0; index < 12; index += 1)
    assert.equal(
      useful.observeRound([{ name: "get_node", arguments: JSON.stringify({ id: `node-${index}` }) }]),
      false,
    );

  const repeated = new AssistantToolGuard();
  const search = [{ name: "search_nodes", arguments: '{"query":"todo"}' }];
  assert.equal(repeated.observeRound(search), false);
  assert.equal(repeated.observeRound(search), false);
  assert.equal(repeated.observeRound(search), true);

  const alternating = new AssistantToolGuard();
  const overview = [{ name: "get_project_overview", arguments: "{}" }];
  assert.equal(alternating.observeRound(search), false);
  assert.equal(alternating.observeRound(overview), false);
  assert.equal(alternating.observeRound(search), false);
  assert.equal(alternating.observeRound(overview), false);
  assert.equal(alternating.observeRound(search), false);
  assert.equal(alternating.observeRound(overview), true);
});

test("assistant guard prevents an identical successful mutation from running twice", () => {
  const guard = new AssistantToolGuard();
  const args = '{"operations":[{"kind":"create","title":"Todo"}]}';
  assert.equal(guard.mutationWasApplied("apply_changes", args), false);
  guard.recordAppliedMutation("apply_changes", args);
  assert.equal(guard.mutationWasApplied("apply_changes", args), true);
  assert.equal(guard.mutationWasApplied("search_nodes", args), false);
});

test("assistant safety stops are user-facing replies", () => {
  assert.ok(MAX_ASSISTANT_TOOL_ROUNDS > 10);
  const loop = assistantSafetyStop("loop", true);
  assert.equal(loop.changed, true);
  assert.match(loop.text, /repeating the same project steps/i);
  assert.match(loop.text, /already saved/i);
  assert.doesNotMatch(loop.text, /tool-call depth/i);

  const budget = assistantSafetyStop("budget", false);
  assert.equal(budget.changed, false);
  assert.match(budget.text, /unusually large number of project steps/i);
  assert.match(budget.text, /No project changes were saved/i);
});
