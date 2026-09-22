import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import postject from "postject";

if (process.platform !== "win32")
  throw new Error("The NOVA CLI executable is currently packaged for Windows only.");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(root, "out", "cli");
const bundle = path.join(outputDirectory, "cli.cjs");
const blob = path.join(outputDirectory, "sea-prep.blob");
const config = path.join(outputDirectory, "sea-config.json");
const executable = path.join(outputDirectory, "NOVA-CLI.exe");

await mkdir(outputDirectory, { recursive: true });
await build({
  entryPoints: [path.join(root, "src", "main", "cli-entry.ts")],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node22",
  outfile: bundle,
});
await writeFile(
  config,
  `${JSON.stringify(
    {
      main: bundle,
      output: blob,
      disableExperimentalSEAWarning: true,
      useCodeCache: false,
      useSnapshot: false,
    },
    null,
    2,
  )}\n`,
  "utf8",
);
execFileSync(process.execPath, ["--experimental-sea-config", config], {
  cwd: root,
  stdio: "inherit",
});
await copyFile(process.execPath, executable);
await postject.inject(executable, "NODE_SEA_BLOB", await readFile(blob), {
  sentinelFuse: "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
});
process.stdout.write(`Built headless CLI: ${executable}\n`);
