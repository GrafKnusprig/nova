import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

if (process.platform !== "win32") {
  process.stdout.write("Packaged CLI smoke test skipped: Windows is required.\n");
  process.exit(0);
}

const executable = path.resolve(
  process.argv[2] ?? process.env.NOVA_PACKAGED_EXE ?? "dist/win-unpacked/NOVA-CLI.exe",
);
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "nova-packaged-cli-"));
const project = path.join(temporaryDirectory, "automation-project.json");

function novaProcessIds() {
  const script = [
    "$target = [IO.Path]::GetFullPath($env:NOVA_TEST_EXECUTABLE)",
    "Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and ([IO.Path]::GetFullPath($_.ExecutablePath) -eq $target) } | ForEach-Object { $_.ProcessId }",
  ].join("; ");
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      encoding: "utf8",
      env: { ...process.env, NOVA_TEST_EXECUTABLE: executable },
      windowsHide: true,
    },
  );
  if (result.status !== 0)
    throw new Error(`Could not inspect NOVA processes: ${result.stderr.trim()}`);
  return new Set(
    result.stdout
      .split(/\r?\n/)
      .filter((value) => value.trim())
      .map((value) => Number(value.trim()))
      .filter(Number.isFinite),
  );
}

function runCli(args) {
  return new Promise((resolve, reject) => {
    const isSidecar = path.basename(executable).toLowerCase() === "nova-cli.exe";
    const childEnvironment = { ...process.env };
    if (!isSidecar) delete childEnvironment.ELECTRON_RUN_AS_NODE;
    const prefix = isSidecar ? [] : ["cli"];
    const child = spawn(executable, [...prefix, ...args], {
      env: childEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Packaged CLI did not exit within 15 seconds. stdout: ${stdout} stderr: ${stderr}`));
    }, 15_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) reject(new Error(`Packaged CLI exited with ${code}. stdout: ${stdout} stderr: ${stderr}`));
      else resolve({ stdout, stderr });
    });
  });
}

try {
  const before = novaProcessIds();
  const initialized = await runCli([
    "init",
    "--project",
    project,
    "--name",
    "Packaged CLI smoke test",
  ]);
  const initResult = JSON.parse(initialized.stdout);
  if (!initResult.ok || initResult.command !== "init" || initialized.stderr.trim())
    throw new Error(`Unexpected init result: ${initialized.stdout} ${initialized.stderr}`);

  const validated = await runCli(["validate", "--project", project]);
  const validateResult = JSON.parse(validated.stdout);
  if (
    !validateResult.ok ||
    validateResult.command !== "validate" ||
    validateResult.node_count !== 1 ||
    validated.stderr.trim()
  )
    throw new Error(`Unexpected validation result: ${validated.stdout} ${validated.stderr}`);

  JSON.parse(await readFile(project, "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 500));
  const leaked = [...novaProcessIds()].filter((pid) => !before.has(pid));
  if (leaked.length)
    throw new Error(`Packaged CLI left NOVA processes running: ${leaked.join(", ")}`);

  process.stdout.write("Packaged NOVA CLI exited cleanly with valid JSON and no leftover processes.\n");
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
