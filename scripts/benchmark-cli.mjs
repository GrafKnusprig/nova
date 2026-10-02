import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = {};
for (let index = 2; index < process.argv.length; index++) {
  const key = process.argv[index];
  if (!/^--(sizes|repeats|warmups|branching|summary-chars|links-per-node|seed|out-dir|include-npm|include-worker|include-refresh|idle-gap-ms)$/.test(key)) throw new Error(`Unknown option ${key}`);
  if (key === "--include-npm" || key === "--include-worker" || key === "--include-refresh") options[key] = true;
  else { const value = process.argv[++index]; if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${key}`); options[key] = value; }
}
const integer = (key, fallback, min, max) => {
  const value = Number(options[key] ?? fallback);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${key} must be between ${min} and ${max}`);
  return value;
};
const sizes = String(options["--sizes"] ?? "300,1000,10000").split(",").map(Number);
if (!sizes.length || sizes.some(value => !Number.isSafeInteger(value) || value < 2 || value > 100000) || new Set(sizes).size !== sizes.length) throw new Error("--sizes requires unique integers between 2 and 100000");
if (options["--include-refresh"]) options["--include-worker"] = true;
const idleGap = integer("--idle-gap-ms", 1000, 0, 60000);
const repeats = integer("--repeats", 5, 1, 100), warmups = integer("--warmups", 1, 0, 20);
const branching = integer("--branching", 6, 2, 100), summaryChars = integer("--summary-chars", 1000, 0, 100000);
const links = integer("--links-per-node", Math.min(2, ...sizes.map(size => size - 2)), 0, Math.min(100, ...sizes.map(size => size - 2)));
const seed = integer("--seed", 1, 0, 4294967295);
if (options["--include-npm"] && !process.env.npm_execpath) throw new Error("Use npm run benchmark:cli with --include-npm so npm_execpath identifies the launcher.");
const directory = path.resolve(options["--out-dir"] ?? path.join(root, "out", "benchmarks", new Date().toISOString().replace(/[:.]/g, "-")));
await mkdir(path.dirname(directory), { recursive: true });
await mkdir(directory); // Refuse an existing run directory.
const cliBundle = path.join(directory, "cli.cjs"), apiBundle = path.join(directory, "cli-api.cjs");
await build({ entryPoints: [path.join(root, "src/main/cli-entry.ts")], outfile: cliBundle, bundle: true, platform: "node", target: "node22", format: "cjs" });
await build({ stdin: { contents: 'export { runCli } from "./src/main/cli"; export { retainSqliteReadSession, releaseSqliteReadSession } from "./src/main/sqliteProject";', resolveDir: root, loader: "ts" }, outfile: apiBundle, bundle: true, platform: "node", target: "node22", format: "cjs" });
const env = { ...process.env, NOVA_CLI_PROFILE: "1", NOVA_CLI_WORKER: "0" };
function fresh(mode, args) {
  const prefix = mode === "npm" ? [process.env.npm_execpath, "run", "--silent", "cli", "--"] : mode === "source" ? ["--import", "tsx", path.join(root, "src/main/cli-entry.ts")] : [cliBundle];
  const started = performance.now();
  const result = spawnSync(process.execPath, [...prefix, ...args], { cwd: root, env: mode === "worker" ? { ...env, NOVA_CLI_WORKER: "1", NOVA_CLI_REQUIRE_WORKER: "1" } : env, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 120000 });
  const wallMs = performance.now() - started;
  if (result.error || result.status !== 0) throw new Error(`${mode} ${args[0]} failed: ${result.error ?? result.stderr}`);
  const profile = result.stderr.split("\n").filter(line => line.startsWith('{"type":"nova-cli-profile"')).map(line => JSON.parse(line)).at(-1);
  if (!profile) throw new Error("Missing profile record");
  return { wall_ms: wallMs, output_bytes: Buffer.byteLength(result.stdout), profile, value: JSON.parse(result.stdout) };
}
const { runCli, retainSqliteReadSession, releaseSqliteReadSession } = createRequire(import.meta.url)(apiBundle);
async function warm(args, session) {
  const stdout = process.stdout.write, stderr = process.stderr.write, previous = process.env.NOVA_CLI_PROFILE;
  let bytes = 0, errors = "";
  process.env.NOVA_CLI_PROFILE = "1";
  process.stdout.write = (chunk) => { bytes += Buffer.byteLength(chunk); return true; };
  process.stderr.write = (chunk) => { errors += chunk; return true; };
  const started = performance.now();
  try {
    const status = await runCli(args, session ? { before: () => { if (args[0] !== "update") session.begin(); }, after: () => session.end() } : undefined);
    const wallMs = performance.now() - started;
    if (status !== 0) throw new Error(errors);
    const profile = errors.split("\n").filter(line => line.startsWith('{"type":"nova-cli-profile"')).map(line => JSON.parse(line)).at(-1);
    return { wall_ms: wallMs, output_bytes: bytes, profile };
  } finally {
    process.stdout.write = stdout; process.stderr.write = stderr;
    if (previous === undefined) delete process.env.NOVA_CLI_PROFILE; else process.env.NOVA_CLI_PROFILE = previous;
  }
}
const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * fraction) - 1)];
const rows = [], samples = [], fixtures = [], refreshRows = [], refreshSamples = [];
for (const size of sizes) {
  const project = path.join(directory, `${size}.nova`);
  const generated = fresh("bundled", ["benchmark-generate", "--project", project, "--nodes", String(size), "--branching", String(branching), "--summary-chars", String(summaryChars), "--links-per-node", String(links), "--seed", String(seed)]).value;
  fixtures.push(generated);
  fresh("bundled", ["validate", "--project", project]);
  const commands = [["context-get"], ["get", "--id", generated.sample_node_id], ["search", "--query", "retrieval latency"], ["context", "--query", "retrieval latency", "--token-budget", "6000"], ["update", "--id", generated.sample_node_id]];
  for (const command of commands) for (const mode of ["bundled", "source", "warm", "cached", ...(options["--include-worker"] ? ["worker"] : []), ...(options["--include-npm"] ? ["npm"] : [])]) {
    const measured = [];
    const session = mode === "cached" ? retainSqliteReadSession(project) : undefined;
    try {
    for (let iteration = -warmups; iteration < repeats; iteration++) {
      const args = [...command, "--project", project];
      if (command[0] === "update") args.push("--summary", `Synthetic benchmark mutation ${mode} ${iteration}`);
      const result = mode === "warm" || mode === "cached" ? await warm(args, session) : fresh(mode, args);
      if (iteration >= 0) { const { value, ...sample } = result; measured.push(sample); samples.push({ size, command: command[0], mode, iteration, ...sample }); }
    }
    } finally { if (session) releaseSqliteReadSession(project); }
    const phaseNames = [...new Set(measured.flatMap(sample => Object.keys(sample.profile.phases_ms)))];
    const row = { size, command: command[0], mode, median_ms: percentile(measured.map(sample => sample.wall_ms), .5), p95_ms: percentile(measured.map(sample => sample.wall_ms), .95), execute_median_ms: percentile(measured.map(sample => sample.profile.execute_ms), .5), phases_median_ms: Object.fromEntries(phaseNames.map(name => [name, percentile(measured.map(sample => sample.profile.phases_ms[name] ?? 0), .5)])) };
    rows.push(row);
    process.stderr.write(`${size} ${command[0]} ${mode}: median ${row.median_ms.toFixed(2)} ms\n`);
  }
  if (options["--include-refresh"]) {
    for (const writer of ["worker", "bundled"]) for (const gapMs of [0, idleGap]) {
      const measured = [];
      for (let iteration = -warmups; iteration < repeats; iteration++) {
        // Fill first; startup is measured elsewhere. Each iteration commits a
        // distinct edit, then times the following context read independently.
        fresh("worker", ["context", "--query", "retrieval latency", "--project", project]);
        const write = fresh(writer, ["update", "--id", generated.sample_node_id, "--summary", `Synthetic retrieval latency refresh ${writer} ${gapMs} ${iteration}`, "--project", project]);
        if (gapMs) await new Promise(resolve => setTimeout(resolve, gapMs));
        const read = fresh("worker", ["context", "--query", "retrieval latency", "--project", project]);
        if (iteration >= 0) {
          const sample = { size, writer: writer === "worker" ? "own" : "external", gap_ms: gapMs, iteration, write_ms: write.wall_ms, read_ms: read.wall_ms, ensure_current_ms: read.profile.phases_ms["cache.ensure-current"] ?? 0, write_phases_ms: write.profile.phases_ms };
          measured.push(sample); refreshSamples.push(sample);
        }
      }
      const row = { size, writer: writer === "worker" ? "own" : "external", gap_ms: gapMs, write_median_ms: percentile(measured.map(sample => sample.write_ms), .5), read_median_ms: percentile(measured.map(sample => sample.read_ms), .5), ensure_current_median_ms: percentile(measured.map(sample => sample.ensure_current_ms), .5) };
      refreshRows.push(row); process.stderr.write(`${size} refresh ${row.writer} gap=${gapMs}: read ${row.read_median_ms.toFixed(2)} ms, write ${row.write_median_ms.toFixed(2)} ms\n`);
    }
  }
  if (options["--include-worker"]) {
    const stopped = spawnSync(process.execPath, [cliBundle, "worker-stop", "--project", project], { env: { ...env, NOVA_CLI_WORKER: "1" }, encoding: "utf8", timeout: 10000 });
    if (stopped.status !== 0) throw new Error(`Worker cleanup failed: ${stopped.stderr}`);
  }
}
const report = { timestamp: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model, repeats, warmups, configuration: { sizes, branching, summaryChars, links, seed, idleGapMs: idleGap }, notes: ["Fresh process timings include startup and captured stdout; OS file cache is not cleared.", "Warm calls reuse the process but reopen SQLite; cached calls retain a snapshot and indexes; worker calls measure the actual bundled client over IPC.", "Profiling adds overhead. Phase timings are inclusive; sqlite.load-document contains selects and validation.", "Fixture generation, bundling and warmups are excluded. Updates operate only on generated fixtures.", "Synthetic data does not model every real project; compare with measurements on the affected machine.", "With few repeats, p95 is effectively the maximum sample. Bundled Node is not a packaged Windows SEA executable."], fixtures, rows, samples, refresh_rows: refreshRows, refresh_samples: refreshSamples };
await writeFile(path.join(directory, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ ok: true, directory, report: path.join(directory, "report.json"), rows, refresh_rows: refreshRows }, null, 2)}\n`);
