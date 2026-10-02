import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildBenchmarkFixture } from "../main/benchmarkFixture";
import { flattenNodes, nodes, readProject } from "../main/project";

test("synthetic fixtures reproduce content and preserve hierarchy and link invariants", () => {
  for (const count of [2, 300, 3000]) {
    const options = { count, branching: 6, summaryChars: 750, linksPerNode: Math.min(2, count - 2), seed: 42 };
    const first = buildBenchmarkFixture(options);
    assert.deepEqual(first, buildBenchmarkFixture(options));
    const all = flattenNodes(nodes(first));
    assert.equal(all.length, count);
    assert.equal(new Set(all.map(node => node.id)).size, count);
    for (const node of all.slice(1)) {
      assert.equal(String(node.summary).length, 750);
      assert.ok(node.depth < 10);
      const links = node.links as Array<{ target: string }>;
      assert.equal(links.length, options.linksPerNode);
      assert.equal(new Set(links.map(link => link.target)).size, links.length);
      assert.ok(links.every(link => link.target !== node.id && link.target !== node.parentId));
    }
    assert.notEqual(flattenNodes(nodes(buildBenchmarkFixture({ ...options, seed: 43 })))[1].id, all[1].id);
  }
});

test("invalid fixture dimensions fail before allocation", () => {
  const valid = { count: 300, branching: 6, summaryChars: 750, linksPerNode: 2, seed: 42 };
  for (const invalid of [{ count: 1 }, { count: 1.5 }, { branching: 1 }, { summaryChars: -1 }, { linksPerNode: 300 }, { seed: -1 }]) assert.throws(() => buildBenchmarkFixture({ ...valid, ...invalid }));
});

test("generator CLI creates an indexed database, refuses overwrites, and separates profiling from JSON", async context => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "nova-benchmark-test-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const project = path.join(directory, "fixture.nova");
  const cli = (args: string[]) => spawnSync(process.execPath, ["--import", "tsx", "src/main/cli-entry.ts", ...args, "--project", project], { encoding: "utf8", env: { ...process.env, NOVA_CLI_PROFILE: "1", NOVA_CLI_WORKER: "0" } });
  const generated = cli(["benchmark-generate", "--nodes", "300", "--seed", "42"]);
  assert.equal(generated.status, 0, generated.stderr);
  assert.equal(JSON.parse(generated.stdout).node_count, 300);
  const first = await readProject(project);
  assert.equal(flattenNodes(nodes(first.document)).length, 300);
  const searched = cli(["search", "--query", "retrieval"]);
  assert.equal(searched.status, 0, searched.stderr);
  assert.ok(JSON.parse(searched.stdout).total_matches > 0);
  const profile = searched.stderr.split("\n").filter(line => line.startsWith('{"type":"nova-cli-profile"')).map(line => JSON.parse(line))[0];
  assert.ok(profile.phases_ms["sqlite.fts"] >= 0);
  assert.ok(profile.phases_ms["sqlite.load-document"] >= profile.phases_ms["sqlite.validate"]);
  assert.equal(cli(["benchmark-generate"]).status, 1);
  assert.equal((await readProject(project)).revision, first.revision);
});
