import { spawn, type ChildProcess } from "node:child_process";
import { isSea } from "node:sea";
import type { PendingCacheUpdate, PreparedSnapshot, SqliteReadSession } from "./sqliteProject";

/** One private helper per worker. Expensive external refreshes run off its event loop. */
export class BackgroundCache {
  private child?: ChildProcess;
  private pending?: Promise<void>;
  private closed = false;
  private rejected = 0;
  private idleReloads = 0;
  private error?: string;
  private timer: NodeJS.Timeout;
  constructor(private session: SqliteReadSession, private idle: () => boolean) {
    this.timer = setInterval(() => {
      if (!this.closed && this.idle() && !this.pending) {
        try { if (session.needsRefresh()) void this.refresh(true).catch(error => { this.error = String(error); }); }
        catch (error) { this.error = String(error); }
      }
    }, 250);
    this.timer.unref();
  }
  protected build(update?: PendingCacheUpdate): Promise<PreparedSnapshot> {
    if (!this.child || this.child.exitCode !== null || !this.child.connected) {
      const prefix = isSea() ? [] : [...process.execArgv, process.argv[1]];
      this.child = spawn(process.execPath, [...prefix, "__nova-cache", "--project", this.session.filePath], {
        stdio: ["ignore", "ignore", "ignore", "ipc"], serialization: "advanced", windowsHide: true,
        env: { ...process.env, NOVA_CLI_PROFILE: "0" },
      });
      // Every build installs its own failure handler; keep late errors handled too.
      this.child.on("error", () => {});
    }
    const child = this.child;
    return new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timeout); child.removeListener("message", message); child.removeListener("error", fail); child.removeListener("exit", exited); };
      const fail = (error: Error) => { cleanup(); reject(error); };
      const exited = () => fail(new Error("Background cache process exited before completing a rebuild."));
      const message = (reply: { snapshot?: PreparedSnapshot; error?: string }) => {
        cleanup();
        if (reply.snapshot) resolve(reply.snapshot); else reject(new Error(reply.error ?? "Background cache rebuild failed."));
      };
      const timeout = setTimeout(() => { child.kill(); fail(new Error("Background cache rebuild timed out.")); }, 120000);
      child.once("message", message); child.once("error", fail); child.once("exit", exited);
      child.send({ rebuild: true, update }, error => { if (error) fail(error); });
    });
  }
  refresh(idle = false): Promise<void> {
    if (this.closed) return Promise.reject(new Error("Background cache is closed."));
    if (this.pending) return this.pending;
    const marker = this.session.marker();
    const update = this.session.pendingUpdate(marker);
    const promise = this.build(update).then(snapshot => {
      // generation rejects an old rebuild after an own write on the same
      // connection (SQLite data_version does not change for own commits).
      if (!this.session.canMutate() || !this.session.adopt(snapshot, marker, Boolean(update))) this.rejected++;
      else if (idle) this.idleReloads++;
      this.error = undefined;
    });
    this.pending = promise;
    void promise.then(() => { if (this.pending === promise) this.pending = undefined; }, error => {
      this.error = String(error); if (this.pending === promise) this.pending = undefined;
    });
    return promise;
  }
  afterReply(): void {
    // Return the mutation response before starting IPC serialization/preparation.
    setImmediate(() => {
      if (!this.closed && !this.pending && this.idle()) {
        try { if (this.session.needsRefresh()) void this.refresh().catch(error => { this.error = String(error); }); }
        catch (error) { this.error = String(error); }
      }
    });
  }
  async beginRead(): Promise<void> {
    for (let attempt = 0; attempt < 16; attempt++) {
      if (this.session.beginIfCurrent()) return;
      await this.refresh();
    }
    throw new Error("The project kept changing during cache refresh; retry the read shortly.");
  }
  status() { return { background_rebuild_pending: Boolean(this.pending), background_idle_reload_count: this.idleReloads, rejected_background_rebuild_count: this.rejected, background_error: this.error ?? null }; }
  close(): void { this.closed = true; clearInterval(this.timer); this.child?.kill(); }
}

/** Invoked only by the worker's private child process, over inherited IPC. */
export async function runCacheBuilder(args: string[]): Promise<void> {
  const { parseCliArguments } = await import("./cliArguments");
  const { retainSqliteReadSession, releaseSqliteReadSession } = await import("./sqliteProject");
  const { options } = parseCliArguments(["cache", ...args]);
  if (!process.send || typeof options.project !== "string") throw new Error("Invalid private cache builder startup.");
  const project = options.project;
  // No retained transaction or file handle survives a build. Replacement and
  // corrupt-file recovery work on the next request without a helper restart.
  const { prepareContextIndex } = await import("./context");
  process.on("message", (request: { update?: PendingCacheUpdate }) => {
    try {
      if (request.update) {
        const document = request.update.document;
        const revision = JSON.stringify(document);
        const index = prepareContextIndex(document, request.update.previous);
        process.send!({ snapshot: { document, revision, index } });
        return;
      }
      const session = retainSqliteReadSession(project);
      try { session.begin(); const snapshot = session.prepared(); session.end(); process.send!({ snapshot }); }
      finally { releaseSqliteReadSession(project); }
    } catch (error) { process.send!({ error: error instanceof Error ? error.message : String(error) }); }
  });
  process.on("disconnect", () => process.exit(0));
}
