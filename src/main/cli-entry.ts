import { runCli } from "./cli";

const cliIndex = process.argv.indexOf("cli");
void runCli(process.argv.slice(cliIndex >= 0 ? cliIndex + 1 : 2)).then((code) => { process.exitCode = code; });
