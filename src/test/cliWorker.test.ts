import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { createProjectFile, mutateProject, projectRoot, updateProjectNode } from "../main/project";

const execute = promisify(execFile);
const entry = path.resolve("src/main/cli-entry.ts");
function cli(project: string, args: string[], idle = "5000", direct = false) {
  return execute(process.execPath, ["--import", "tsx", entry, ...args, "--project", project], { encoding: "utf8", env: { ...process.env, NOVA_CLI_WORKER: direct ? "0" : "1", NOVA_CLI_REQUIRE_WORKER: "1", NOVA_CLI_IDLE_MS: idle, NOVA_CLI_PROFILE: "1" }, timeout: 20000 });
}
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test("CLI worker coordinates startup, detects external and own writes, isolates projects and stops without explicit agent sessions", async context => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "nova-worker-test-"));
  const file = path.join(directory, "test.nova"), other = path.join(directory, "other.nova");
  await createProjectFile(file, "Worker test"); await createProjectFile(other, "Other project");
  context.after(async () => { await cli(file, ["worker-stop"]).catch(() => {}); await cli(other, ["worker-stop"]).catch(() => {}); await rm(directory, { recursive: true, force: true }); });
  const parallel = await Promise.all(Array.from({ length: 4 }, () => cli(file, ["worker-status"])));
  const statuses = parallel.map(result => JSON.parse(result.stdout));
  assert.equal(new Set(statuses.map(status => status.pid)).size, 1);
  assert.ok(statuses.every(status => status.reload_count === 1));
  const isolated = JSON.parse((await cli(other, ["worker-status"])).stdout);
  assert.notEqual(isolated.pid, statuses[0].pid);
  let root = "";
  await mutateProject(file, document => { root = String(projectRoot(document).id); updateProjectNode(document, root, { summary: "externalmarker" }); });
  const refreshed = JSON.parse((await cli(file, ["get", "--id", root])).stdout);
  assert.equal(refreshed.node.summary, "externalmarker");
  const edited = await cli(file, ["update", "--id", root, "--summary", "ownmarker"]);
  const editProfile = edited.stderr.split("\n").filter(line => line.startsWith('{"type":"nova-cli-profile"')).map(line => JSON.parse(line))[0];
  assert.equal(editProfile.phases_ms["cache.prepare-context"], undefined);
  assert.equal(editProfile.phases_ms["cache.revision-on-change"], undefined);
  assert.equal(JSON.parse((await cli(file, ["get", "--id", root])).stdout).node.summary, "ownmarker");
  await cli(file, ["instruction-add", "--id", root, "--instruction", "Keep method and result separate."]);
  const pack = JSON.parse((await cli(file, ["context", "--query", "ownmarker"])).stdout);
  assert.ok(pack.guidance.topic_guidance.some((scope: { instructions: string[] }) => scope.instructions.includes("Keep method and result separate.")));
  const first = await cli(file, ["context", "--query", "ownmarker"]);
  const second = await cli(file, ["context", "--query", "ownmarker"]);
  assert.deepEqual(JSON.parse(first.stdout), JSON.parse(second.stdout));
  const profile = second.stderr.split("\n").filter(line => line.startsWith('{"type":"nova-cli-profile"')).map(line => JSON.parse(line))[0];
  assert.equal(profile.phases_ms["cache.reload"], undefined);
  assert.equal(profile.phases_ms["sqlite.revision-json"], undefined);
  assert.deepEqual(JSON.parse((await cli(file, ["context", "--query", "ownmarker"], "5000", true)).stdout), JSON.parse(second.stdout));
  const updatedStatus = JSON.parse((await cli(file, ["worker-status"])).stdout);
  assert.equal(updatedStatus.reload_count, 2);
  assert.equal(updatedStatus.incremental_update_count, 2);
  assert.equal(updatedStatus.normalized_records_rebuilt, 0);
  if (process.platform !== "win32") {
    const endpointDirectory = `/tmp/nova-cli-${process.getuid!()}`;
    for (const filename of (await readdir(endpointDirectory)).filter(name => name.endsWith(".json"))) {
      const descriptor = JSON.parse(await readFile(path.join(endpointDirectory, filename), "utf8"));
      if (descriptor.pid !== statuses[0].pid) continue;
      const invalidRequest = (token: string, project: string) => new Promise<{ code: number; stderr: string }>((resolve, reject) => {
        const socket = net.createConnection(path.join(endpointDirectory, filename.replace(/\.json$/, ".sock")));
        let output = "";
        socket.setEncoding("utf8"); socket.on("error", reject);
        socket.on("connect", () => socket.write(`${JSON.stringify({ protocol: 1, token, args: ["delete", "--project", project, "--id", root, "--yes"] })}\n`));
        socket.on("data", chunk => { output += chunk; if (output.includes("\n")) { socket.end(); resolve(JSON.parse(output)); } });
      });
      for (const reply of [await invalidRequest("invalid", file), await invalidRequest(descriptor.token, other)]) {
        assert.equal(reply.code, 1); assert.equal(JSON.parse(reply.stderr).error, "Invalid worker request.");
      }
    }
  }
  process.kill(statuses[0].pid, "SIGKILL");
  const recovered = JSON.parse((await cli(file, ["worker-status"])).stdout);
  assert.notEqual(recovered.pid, statuses[0].pid);
  await cli(file, ["worker-stop"]);
  const restarted = JSON.parse((await cli(file, ["worker-status"])).stdout);
  assert.notEqual(restarted.pid, statuses[0].pid);
  assert.equal(restarted.reload_count, 1);
});

test("idle worker exits and the next ordinary command restarts it automatically", async context => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "nova-worker-idle-test-")), file = path.join(directory, "test.nova");
  await createProjectFile(file, "Idle test");
  context.after(async () => { await cli(file, ["worker-stop"]).catch(() => {}); await rm(directory, { recursive: true, force: true }); });
  const first = JSON.parse((await cli(file, ["worker-status"], "300")).stdout);
  await sleep(1000);
  assert.throws(() => process.kill(first.pid, 0), /ESRCH/);
  await cli(file, ["context-get"], "1000");
  const next = JSON.parse((await cli(file, ["worker-status"], "1000")).stdout);
  assert.notEqual(next.pid, first.pid);
});

test("idle background refresh prepares external changes and immediate reads wait for current records", async context => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "nova-background-test-")), file = path.join(directory, "test.nova"), replaceFile = path.join(directory, "replace.nova");
  await createProjectFile(file, "Background test");
  context.after(async () => { await cli(file, ["worker-stop"]).catch(() => {}); await cli(replaceFile, ["worker-stop"]).catch(() => {}); await rm(directory, { recursive: true, force: true }); });
  const before = JSON.parse((await cli(file, ["worker-status"])).stdout);
  let root = "";
  await mutateProject(file, document => { root = String(projectRoot(document).id); updateProjectNode(document, root, { summary: "idlebackgroundmarker" }); });
  await sleep(1000);
  const ready = JSON.parse((await cli(file, ["worker-status"])).stdout);
  assert.ok(ready.background_idle_reload_count > before.background_idle_reload_count, "refresh completed during idle time, before this request");
  assert.equal(JSON.parse((await cli(file, ["get", "--id", root])).stdout).node.summary, "idlebackgroundmarker");
  await mutateProject(file, document => updateProjectNode(document, root, { summary: "immediateexternalmarker" }));
  const immediate = await cli(file, ["context", "--query", "immediateexternalmarker"]);
  assert.deepEqual(JSON.parse(immediate.stdout), JSON.parse((await cli(file, ["context", "--query", "immediateexternalmarker"], "5000", true)).stdout));
  assert.equal(JSON.parse((await cli(file, ["get", "--id", root])).stdout).node.summary, "immediateexternalmarker");
  await cli(file, ["update", "--id", root, "--summary", "immediateownmarker"]);
  const own = JSON.parse((await cli(file, ["worker-status"])).stdout);
  assert.equal(own.incremental_update_count, 1);
  assert.equal(JSON.parse((await cli(file, ["get", "--id", root])).stdout).node.summary, "immediateownmarker");
  const after = JSON.parse((await cli(file, ["worker-status"])).stdout);
  assert.equal(after.reload_count, own.reload_count, "own write did not defer a rebuild to the next read");
  const replacement = path.join(directory, "replacement.nova");
  // Atomic replacement requires a clean database without live WAL sidecars.
  await createProjectFile(replaceFile, "Original");
  await cli(replaceFile, ["worker-status"]);
  await createProjectFile(replacement, "Replacement");
  const { rename, writeFile } = await import("node:fs/promises");
  await rename(replacement, replaceFile);
  assert.equal(JSON.parse((await cli(replaceFile, ["list"])).stdout).nodes[0].title, "Replacement");
  await writeFile(replacement, "invalid"); await rename(replacement, replaceFile);
  await assert.rejects(cli(replaceFile, ["list"]));
  await createProjectFile(replacement, "Repaired"); await rename(replacement, replaceFile);
  assert.equal(JSON.parse((await cli(replaceFile, ["list"])).stdout).nodes[0].title, "Repaired");
});
