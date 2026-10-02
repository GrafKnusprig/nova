import assert from "node:assert/strict";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildBenchmarkFixture } from "../main/benchmarkFixture";
import { BackgroundCache } from "../main/backgroundCache";
import { buildContextPack, prepareContextIndex, searchProject } from "../main/context";
import { changeProjectLink, createEmptyProject, createProjectNode, createProjectFile, moveProjectNode, mutateProject, nodeAgentGuidance, nodes, projectRoot, updateProjectNode, validateMap } from "../main/project";
import { migrateJsonToSqlite, releaseSqliteReadSession, retainSqliteReadSession, searchSqliteIndex, type PendingCacheUpdate, type PreparedSnapshot } from "../main/sqliteProject";

test("retained snapshots reuse data and refresh original records, guidance, hierarchy and search after external writes", async context => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "nova-cache-test-"));
  const file = path.join(directory, "test.nova");
  context.after(() => rm(directory, { recursive: true, force: true }));
  await createProjectFile(file, "Cache test");
  let topic = "", other = "", leaf = "";
  await mutateProject(file, document => {
    topic = String(createProjectNode(document, { title: "Retrieval", tags: "concept" }).id);
    other = String(createProjectNode(document, { title: "Storage", tags: "concept" }).id);
    leaf = String(createProjectNode(document, { title: "Known finding", summary: "originalmarker", parentId: topic, tags: "result" }).id);
  });
  const session = retainSqliteReadSession(file);
  context.after(() => releaseSqliteReadSession(file));
  session.begin();
  const first = session.read();
  assert.ok(Object.isFrozen(first.document));
  assert.ok(searchSqliteIndex(file, "originalmarker").has(leaf));
  session.end(); session.begin();
  assert.equal(session.read().document, first.document);
  assert.equal(session.read().revision, first.revision);
  assert.equal(session.status().reload_count, 1);
  // Another connection can commit while this request continues to see its
  // original SQLite snapshot and the matching immutable in-memory document.
  await mutateProject(file, document => {
    updateProjectNode(document, leaf, { summary: "replacementmarker" });
    moveProjectNode(document, leaf, other);
    nodeAgentGuidance(nodes(document)[0]).instructions.push("Global node rule");
    const otherNode = (nodes(document)[0].children as Record<string, unknown>[]).find(node => node.id === other)!;
    nodeAgentGuidance(otherNode).instructions.push("Storage rule");
    changeProjectLink(document, "add", topic, leaf, "supports");
  });
  assert.equal(session.node(leaf)?.summary, "originalmarker");
  assert.equal(searchSqliteIndex(file, "replacementmarker").has(leaf), false);
  session.end(); session.begin();
  const current = session.read();
  assert.notEqual(current.document, first.document);
  assert.equal(session.node(leaf)?.summary, "replacementmarker");
  assert.ok(searchSqliteIndex(file, "replacementmarker").has(leaf));
  assert.equal(searchSqliteIndex(file, "originalmarker").has(leaf), false);
  const found = searchProject(current.document, "Known finding", undefined, 30);
  assert.equal(found.exact_candidates[0].category_id, other);
  const pack = buildContextPack(current.document, "Known finding", other, 6000, 1);
  assert.ok(pack.guidance.topic_guidance.some(scope => scope.instructions.includes("Storage rule")));
  assert.ok(pack.nodes.some(node => node.id === topic), "incoming supporting evidence is expanded");
  assert.equal(session.status().reload_count, 2);
  session.end();
});

test("file replacement is reopened and does not serve the old project's cache", async context => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "nova-replace-test-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "project.nova"), replacement = path.join(directory, "replacement.nova");
  await createProjectFile(file, "Original");
  await createProjectFile(replacement, "Replacement");
  const session = retainSqliteReadSession(file);
  context.after(() => releaseSqliteReadSession(file));
  session.begin(); assert.equal(projectRoot(session.read().document).title, "Original"); session.end();
  await rename(replacement, file);
  session.begin(); assert.equal(projectRoot(session.read().document).title, "Replacement"); session.end();
  const broken = path.join(directory, "broken.nova");
  await writeFile(broken, "invalid database"); await rename(broken, file);
  assert.throws(() => session.begin());
  await createProjectFile(replacement, "Repaired"); await rename(replacement, file);
  session.begin(); assert.equal(projectRoot(session.read().document).title, "Repaired"); session.end();
});

test("context preserves global exact duplicates and scoped instructions under a bounded output budget", () => {
  const document = createEmptyProject("Research");
  const a = createProjectNode(document, { title: "Storage", tags: "concept" });
  const b = createProjectNode(document, { title: "Retrieval", tags: "concept" });
  const existing = createProjectNode(document, { title: "Cache invalidation", summary: "A prior result on external writes.", parentId: String(b.id), tags: "result" });
  nodeAgentGuidance(b).instructions.push("Never infer a result from an implementation.");
  const pack = buildContextPack(document, "Cache invalidation", String(a.id), 6000, 1);
  assert.equal(pack.exact_duplicate_candidates[0].id, existing.id);
  assert.ok(pack.nodes.some(node => node.id === existing.id));
  assert.ok(pack.guidance.topic_guidance.some(scope => scope.id === b.id));
  assert.ok(searchProject(document, "Retrieval", undefined, 30).matches.some(hit => hit.id === existing.id && hit.reasons.includes("hierarchy-context")));
  // Mutable callers must not reuse a stale derived index.
  updateProjectNode(document, String(existing.id), { title: "Renamed finding" });
  assert.equal(searchProject(document, "Renamed finding", undefined, 30).exact_candidates[0].id, existing.id);
  const large = buildBenchmarkFixture({ count: 3000, branching: 6, summaryChars: 1000, linksPerNode: 2, seed: 1 });
  const bounded = buildContextPack(large, "retrieval latency", undefined, 6000, 1);
  assert.ok(Math.ceil(JSON.stringify(bounded).length / 4) <= 6000);
  assert.ok(bounded.omitted_node_count > 50);
  assert.equal(bounded.omitted_node_ids.length, 50);
  assert.equal(bounded.omitted_ids_truncated, true);
});

test("topic guidance is validated and round trips through SQLite metadata", async context => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "nova-guidance-test-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const document = createEmptyProject("Guidance");
  nodeAgentGuidance(projectRoot(document)).instructions.push("Preserve evidence provenance.");
  await migrateJsonToSqlite(path.join(directory, "guidance.nova"), document);
  const session = retainSqliteReadSession(path.join(directory, "guidance.nova"));
  try {
    session.begin(); assert.deepEqual(projectRoot(session.read().document).agent_guidance, projectRoot(document).agent_guidance); session.end();
  } finally { releaseSqliteReadSession(path.join(directory, "guidance.nova")); }
  projectRoot(document).agent_guidance = { summary: "", instructions: [123] };
  assert.throws(() => validateMap(document), /agent_guidance/);
});

test("own committed mutations prepare current context, selectively normalize text, and reject obsolete background snapshots", async context => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "nova-incremental-test-")), file = path.join(directory, "test.nova");
  context.after(() => rm(directory, { recursive: true, force: true }));
  const fixture = buildBenchmarkFixture({ count: 300, branching: 6, summaryChars: 1000, linksPerNode: 2, seed: 1 });
  await migrateJsonToSqlite(file, fixture);
  const session = retainSqliteReadSession(file);
  context.after(() => releaseSqliteReadSession(file));
  session.begin(); const obsolete = session.prepared(); session.end();
  const marker = session.marker();
  const leaf = [...obsolete.index.byId.values()].at(-1)!;
  const changed = await mutateProject(file, document => updateProjectNode(document, String(leaf.id), { summary: "freshcommittedmarker" }));
  assert.equal(session.status().pending_own_cache_update, true);
  assert.equal(session.beginIfCurrent(), false, "reads cannot use the previous cache after a committed own write");
  session.begin(); session.end();
  assert.equal(session.status().incremental_update_count, 1);
  assert.equal(session.status().normalized_records_rebuilt, 1);
  assert.equal(session.status().reload_count, 1);
  assert.equal(session.adopt(obsolete, marker), false, "own commit changes generation even though data_version stays unchanged");
  assert.equal(session.beginIfCurrent(), true);
  const current = session.read();
  assert.equal(session.node(String(leaf.id))?.summary, "freshcommittedmarker");
  const scores = searchSqliteIndex(file, "freshcommittedmarker");
  assert.deepEqual(buildContextPack(current.document, "freshcommittedmarker", undefined, 6000, 1, scores), buildContextPack(structuredClone(current.document), "freshcommittedmarker", undefined, 6000, 1, scores));
  session.end();
  const beforeFailure = session.status().generation;
  await assert.rejects(mutateProject(file, document => { updateProjectNode(document, String(leaf.id), { summary: "mustrollback" }); throw new Error("abort mutation"); }), /abort mutation/);
  assert.equal(session.status().generation, beforeFailure);
  assert.equal(session.beginIfCurrent(), true); assert.equal(session.node(String(leaf.id))?.summary, "freshcommittedmarker");
  const beforeExternal = session.prepared(); session.end();
  const externalMarker = session.marker();
  session.begin();
  await mutateProject(file, document => updateProjectNode(document, String(leaf.id), { summary: "externalnewmarker" }));
  session.end();
  assert.equal(session.adopt(beforeExternal, externalMarker), false, "other-connection commits reject a stale candidate");
  assert.equal(session.beginIfCurrent(), false);
  session.begin(); assert.equal(session.node(String(leaf.id))?.summary, "externalnewmarker"); session.end();
});


test("a pending read waits for preparation and retries an obsolete job without holding a database transaction", async context => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "nova-wait-test-")), file = path.join(directory, "test.nova");
  await createProjectFile(file, "Wait test");
  context.after(() => rm(directory, { recursive: true, force: true }));
  const session = retainSqliteReadSession(file);
  context.after(() => releaseSqliteReadSession(file));
  session.begin(); const root = String(projectRoot(session.read().document).id); session.end();
  const jobs: Array<{ snapshot: PreparedSnapshot; resolve: (snapshot: PreparedSnapshot) => void; reject: (error: Error) => void }> = [];
  class ControlledCache extends BackgroundCache {
    protected override build(update?: PendingCacheUpdate): Promise<PreparedSnapshot> {
      assert.ok(update);
      const document = update.document;
      const snapshot = { document, revision: JSON.stringify(document), index: prepareContextIndex(document, update.previous) };
      return new Promise((resolve, reject) => jobs.push({ snapshot, resolve, reject }));
    }
  }
  const cache = new ControlledCache(session, () => false);
  context.after(() => cache.close());
  await mutateProject(file, document => updateProjectNode(document, root, { summary: "firstjobmarker" }));
  const rebuilding = cache.refresh();
  let answered = false;
  const read = cache.beginRead().then(() => { answered = true; });
  await Promise.resolve();
  assert.equal(answered, false, "an unfinished rebuild cannot serve the old snapshot");
  assert.equal(session.canMutate(), true, "waiting does not hold a SQLite read transaction");
  await mutateProject(file, document => updateProjectNode(document, root, { summary: "latestjobmarker" }));
  jobs[0].resolve(jobs[0].snapshot); await rebuilding;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(jobs.length, 2, "the obsolete first job is replaced by a current one");
  assert.equal(answered, false);
  jobs[1].resolve(jobs[1].snapshot); await read;
  assert.equal(session.node(root)?.summary, "latestjobmarker"); session.end();
  assert.equal(cache.status().rejected_background_rebuild_count, 1);
  await mutateProject(file, document => updateProjectNode(document, root, { summary: "retrymarker" }));
  const failedRead = cache.beginRead();
  jobs[2].reject(new Error("simulated helper failure"));
  await assert.rejects(failedRead, /simulated helper failure/);
  assert.equal(session.beginIfCurrent(), false, "a failed rebuild never blesses stale state");
  const retried = cache.beginRead(); jobs[3].resolve(jobs[3].snapshot); await retried;
  assert.equal(session.node(root)?.summary, "retrymarker"); session.end();
});
