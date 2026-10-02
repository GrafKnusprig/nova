import { forwardCliToWorker, runWorker } from "./cliWorker";

const args = process.argv.slice(process.argv[2] === "cli" ? 3 : 2);
void (async () => {
  if (args[0] === "__nova-cache") { await (await import("./backgroundCache")).runCacheBuilder(args.slice(1)); return; }
  if (args[0] === "__nova-worker") { await runWorker(args.slice(1)); return; }
  try { process.exitCode = await forwardCliToWorker(args) ?? await (await import("./cli")).runCli(args); }
  catch (error) { process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`); process.exitCode = 1; }
})();
