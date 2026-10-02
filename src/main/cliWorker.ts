import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { promises as fs, realpathSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { isSea } from "node:sea";
import { parseCliArguments } from "./cliArguments";

const PROTOCOL = 1;
const DEFAULT_IDLE_MS = 5 * 60 * 1000;
const READS = new Set(["get", "list", "search", "context", "context-get", "validate", "audit", "id", "export", "migration-status", "worker-status"]);
const ONE_SHOT = new Set(["init", "import", "migrate", "benchmark-generate"]);
interface Endpoint { address: string; descriptor: string; lock: string }
interface Descriptor { protocol: number; token: string; pid: number }
interface Reply { code: number; stdout: string; stderr: string }

function idleTimeout(): number {
  const value = Number(process.env.NOVA_CLI_IDLE_MS ?? DEFAULT_IDLE_MS);
  if (!Number.isSafeInteger(value) || value < 100 || value > 86400000) throw new Error("NOVA_CLI_IDLE_MS must be between 100 and 86400000.");
  return value;
}

async function endpoint(project: string): Promise<Endpoint> {
  const uid = process.getuid?.();
  const user = uid === undefined ? createHash("sha256").update(os.userInfo().username).digest("hex").slice(0, 12) : String(uid);
  // Short Unix paths keep macOS socket names below the platform limit.
  const directory = path.join(process.platform === "win32" ? os.tmpdir() : "/tmp", `nova-cli-${user}`);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (uid !== undefined && stat.uid !== uid)) throw new Error("Unsafe NOVA worker directory.");
  if (process.platform !== "win32") await fs.chmod(directory, 0o700);
  const entry = isSea() ? process.execPath : path.resolve(process.argv[1]);
  const entryStat = await fs.stat(entry);
  let fingerprint = `${entry}:${entryStat.size}:${entryStat.mtimeMs}`;
  if (entry.endsWith(".ts")) {
    const files = (await fs.readdir(path.dirname(entry))).filter(name => name.endsWith(".ts")).sort();
    for (const file of files) { const stat = await fs.stat(path.join(path.dirname(entry), file)); fingerprint += `:${file}:${stat.size}:${stat.mtimeMs}`; }
  }
  const key = createHash("sha256").update(`${PROTOCOL}:${process.execPath}:${fingerprint}:${project}`).digest("hex").slice(0, 32);
  return { address: process.platform === "win32" ? `\\\\.\\pipe\\nova-cli-${user}-${key}` : path.join(directory, `${key}.sock`), descriptor: path.join(directory, `${key}.json`), lock: path.join(directory, `${key}.lock`) };
}

async function descriptor(location: Endpoint): Promise<Descriptor> {
  const value = JSON.parse(await fs.readFile(location.descriptor, "utf8")) as Descriptor;
  if (value.protocol !== PROTOCOL || !/^[a-f0-9]{64}$/.test(value.token) || !Number.isSafeInteger(value.pid)) throw new Error("Invalid NOVA worker descriptor.");
  return value;
}

class ConnectionError extends Error {}
class SubmittedConnectionError extends Error {}
const RETRYABLE_READS = new Set(["get", "list", "search", "context", "context-get", "validate", "audit", "migration-status", "worker-status"]);
function request(location: Endpoint, auth: Descriptor, args: string[]): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(location.address);
    let sent = false, output = "", settled = false;
    const fail = (error: Error) => { if (!settled) { settled = true; socket.destroy(); reject(error); } };
    socket.setTimeout(120000, () => fail(new Error("NOVA worker request timed out. Its outcome may be unknown; mutations are not automatically retried.")));
    socket.setEncoding("utf8");
    socket.on("connect", () => {
      sent = true;
      socket.write(`${JSON.stringify({ protocol: PROTOCOL, token: auth.token, args, profile: process.env.NOVA_CLI_PROFILE === "1" })}\n`);
    });
    socket.on("data", chunk => {
      output += chunk;
      if (Buffer.byteLength(output) > 256 * 1024 * 1024) { fail(new Error("NOVA worker response exceeds 256 MiB.")); return; }
      if (!output.includes("\n")) return;
      try {
        const reply = JSON.parse(output.slice(0, output.indexOf("\n"))) as Reply;
        if (![0, 1].includes(reply.code) || typeof reply.stdout !== "string" || typeof reply.stderr !== "string") throw new Error("Invalid NOVA worker response.");
        settled = true; socket.end(); resolve(reply);
      } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
    });
    socket.on("error", error => fail(sent ? new SubmittedConnectionError(`NOVA worker connection failed after submission; outcome may be unknown: ${error.message}`) : new ConnectionError(error.message)));
    socket.on("close", () => { if (!settled) fail(sent ? new SubmittedConnectionError("NOVA worker disconnected after submission; outcome may be unknown.") : new ConnectionError("NOVA worker is unavailable.")); });
  });
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function alive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; } }

async function startWorker(location: Endpoint, project: string): Promise<void> {
  let lock;
  try { lock = await fs.open(location.lock, "wx", 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    // A crashed launcher must not leave an eternal startup lock. Only its owner
    // or an old, incomplete lock can be removed.
    try {
      const stat = await fs.stat(location.lock);
      const owner = JSON.parse(await fs.readFile(location.lock, "utf8")) as { pid: number };
      if (!Number.isSafeInteger(owner.pid) || !alive(owner.pid) || Date.now() - stat.mtimeMs > 30000) await fs.rm(location.lock, { force: true });
    } catch { const stat = await fs.stat(location.lock).catch(() => undefined); if (stat && Date.now() - stat.mtimeMs > 5000) await fs.rm(location.lock, { force: true }); }
    return;
  }
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid }));
    // Recheck after taking the startup lock: another launcher may have just
    // published a worker. Do not unlink its live socket.
    try {
      const auth = await descriptor(location);
      await request(location, auth, ["worker-status", "--project", project]);
      return;
    } catch (error) { if (!(error instanceof ConnectionError) && (error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    await fs.rm(location.descriptor, { force: true });
    if (process.platform !== "win32") await fs.rm(location.address, { force: true });
    const token = randomBytes(32).toString("hex");
    const args = ["__nova-worker", "--project", project, "--address", location.address, "--descriptor", location.descriptor, "--token", token];
    const prefix = isSea() ? [] : [...process.execArgv, process.argv[1]];
    const child = spawn(process.execPath, [...prefix, ...args], { detached: true, stdio: "ignore", windowsHide: true, env: { ...process.env, NOVA_CLI_PROFILE: "0" } });
    child.unref();
    let spawnError: Error | undefined;
    child.on("error", error => { spawnError = error; });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null) throw new Error(`NOVA worker exited during startup (${child.exitCode}).`);
      try { const auth = await descriptor(location); if (auth.token === token) return; } catch { /* Wait for ready publication. */ }
      await delay(50);
    }
    throw new Error("NOVA worker startup timed out.");
  } finally { await lock.close(); await fs.rm(location.lock, { force: true }); }
}

/** null means no request was submitted; it is safe to execute locally. */
export async function forwardCliToWorker(args: string[]): Promise<number | null> {
  if (process.env.NOVA_CLI_WORKER === "0" || args.includes("--help") || !args.length) return null;
  const { command, options } = parseCliArguments(args);
  if (!command || ONE_SHOT.has(command) || typeof options.project !== "string" || path.extname(options.project).toLowerCase() !== ".nova") return null;
  const project = await fs.realpath(path.resolve(options.project));
  const location = await endpoint(project);
  const normalized = [command];
  for (const [key, value] of Object.entries(options)) {
    normalized.push(`--${key}`);
    if (typeof value === "string") normalized.push(key === "project" || key.endsWith("-file") || key === "from" || key === "to" ? path.resolve(value) : value);
  }
  // Retry only failures before sending a request. Replaying a submitted write
  // would be unsafe because it may already have committed.
  for (let attempt = 0; attempt < 220; attempt++) {
    let auth: Descriptor;
    try { auth = await descriptor(location); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (command === "worker-stop") { process.stdout.write(`${JSON.stringify({ ok: true, command, project, running: false })}\n`); return 0; }
      try { await startWorker(location, project); } catch (error) {
        if (process.env.NOVA_CLI_REQUIRE_WORKER === "1" || command === "worker-status") throw error;
        return null;
      }
      await delay(50); continue;
    }
    try {
      const reply = await request(location, auth, normalized);
      process.stdout.write(reply.stdout); process.stderr.write(reply.stderr); return reply.code;
    } catch (error) {
      if (!(error instanceof ConnectionError) && !(error instanceof SubmittedConnectionError && RETRYABLE_READS.has(command))) throw error;
      if (command === "worker-stop") { process.stdout.write(`${JSON.stringify({ ok: true, command, project, running: false })}\n`); return 0; }
      try { await startWorker(location, project); } catch (error) {
        if (process.env.NOVA_CLI_REQUIRE_WORKER === "1" || command === "worker-status") throw error;
        return null;
      }
      await delay(50);
    }
  }
  throw new Error("Could not connect to the NOVA worker.");
}

export async function runWorker(args: string[]): Promise<void> {
  const { releaseSqliteReadSession, retainSqliteReadSession } = await import("./sqliteProject");
  const { runCli } = await import("./cli");
  const { options } = parseCliArguments(["worker", ...args]);
  if (["project", "address", "descriptor", "token"].some(key => typeof options[key] !== "string")) throw new Error("Invalid worker startup arguments.");
  const project = options.project as string, token = options.token as string;
  const address = options.address as string, descriptorPath = options.descriptor as string;
  const timeout = idleTimeout();
  const session = retainSqliteReadSession(project);
  const server = net.createServer();
  const sockets = new Set<net.Socket>();
  let timer: NodeJS.Timeout | undefined, active = 0, closing = false;
  let queue = Promise.resolve();
  const shutdown = async () => {
    if (closing) return; closing = true;
    if (timer) clearTimeout(timer);
    server.close();
    await queue;
    for (const socket of sockets) socket.destroy();
    releaseSqliteReadSession(project);
    const current = await fs.readFile(descriptorPath, "utf8").then(raw => JSON.parse(raw) as Descriptor).catch(() => undefined);
    if (current?.token === token) { await fs.rm(descriptorPath, { force: true }); if (process.platform !== "win32") await fs.rm(address, { force: true }); }
  };
  const scheduleIdle = () => { if (timer) clearTimeout(timer); if (!active && !closing) timer = setTimeout(() => { void shutdown(); }, timeout); };
  process.on("SIGTERM", () => { void shutdown(); }); process.on("SIGINT", () => { void shutdown(); });
  server.on("connection", socket => {
    if (closing) { socket.destroy(); return; }
    sockets.add(socket); socket.on("close", () => sockets.delete(socket)); socket.on("error", () => socket.destroy());
    socket.setEncoding("utf8"); socket.setTimeout(5000, () => socket.destroy());
    let input = "", submitted = false;
    socket.on("data", chunk => {
      if (submitted) { socket.destroy(); return; }
      input += chunk;
      if (Buffer.byteLength(input) > 16 * 1024 * 1024) { socket.destroy(); return; }
      if (!input.includes("\n")) return;
      submitted = true;
      let message: { token: string; protocol: number; args: string[]; profile: boolean };
      try {
        message = JSON.parse(input.slice(0, input.indexOf("\n"))) as typeof message;
        if (message.token !== token || message.protocol !== PROTOCOL || !Array.isArray(message.args) || message.args.some(arg => typeof arg !== "string")) throw new Error("Invalid request.");
        const parsed = parseCliArguments(message.args);
        if (typeof parsed.options.project !== "string" || realpathSync(parsed.options.project) !== project || !parsed.command || ONE_SHOT.has(parsed.command)) throw new Error("Request does not belong to this worker project.");
      } catch { socket.end(`${JSON.stringify({ code: 1, stdout: "", stderr: `${JSON.stringify({ ok: false, error: "Invalid worker request." })}\n` })}\n`); return; }
      active++; if (timer) clearTimeout(timer); socket.setTimeout(0);
      queue = queue.then(async () => {
        let stdout = "", stderr = "", stop = false;
        const originalOut = process.stdout.write, originalError = process.stderr.write;
        process.stdout.write = (chunk: string | Uint8Array) => { stdout += chunk.toString(); return true; };
        process.stderr.write = (chunk: string | Uint8Array) => { stderr += chunk.toString(); return true; };
        process.env.NOVA_CLI_PROFILE = message.profile ? "1" : "0";
        let code = 0;
        try {
          const command = message.args[0];
          if (command === "worker-stop") { stop = true; stdout = `${JSON.stringify({ ok: true, command, project, running: false })}\n`; }
          else if (command === "worker-status") {
            session.begin();
            stdout = `${JSON.stringify({ ok: true, command, project, running: true, pid: process.pid, idle_timeout_ms: timeout, ...session.status() })}\n`;
          } else {
            code = await runCli(message.args, { before: () => { if (READS.has(command)) session.begin(); }, after: () => session.end() });
          }
        } catch (error) { code = 1; stderr += `${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`; }
        finally { session.end(); process.stdout.write = originalOut; process.stderr.write = originalError; active--; }
        socket.end(`${JSON.stringify({ code, stdout, stderr })}\n`);
        if (stop) { setImmediate(() => { void shutdown(); }); } else scheduleIdle();
      }).catch(error => { process.stderr.write(`${String(error)}\n`); void shutdown(); });
    });
  });
  try {
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(address, () => { server.removeListener("error", reject); resolve(); }); });
    if (process.platform !== "win32") await fs.chmod(address, 0o600);
    const temporary = `${descriptorPath}.${token.slice(0, 8)}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify({ protocol: PROTOCOL, token, pid: process.pid }), { mode: 0o600, flag: "wx" });
      await fs.rename(temporary, descriptorPath);
    } finally { await fs.rm(temporary, { force: true }); }
    scheduleIdle();
  } catch (error) { server.close(); releaseSqliteReadSession(project); throw error; }
}
