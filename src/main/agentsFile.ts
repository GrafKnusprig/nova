import { promises as fs } from "node:fs";
import path from "node:path";

export function agentsTemplateCandidates(): string[] {
  return [...new Set([
    path.join(path.dirname(process.execPath), "AGENTS.md"),
    path.resolve(__dirname, "../../AGENTS.md"),
    path.resolve(__dirname, "../../dist/AGENTS.md"),
    path.resolve(process.cwd(), "AGENTS.md"),
  ])];
}

export async function initializeProjectAgents(projectPath: string, candidates = agentsTemplateCandidates()): Promise<string> {
  let template: string | undefined;
  for (const candidate of candidates) {
    try {
      template = await fs.readFile(candidate, "utf8");
      break;
    } catch { /* Try the next installed or development template location. */ }
  }
  if (template === undefined) throw new Error("The NOVA AGENTS.md template could not be found.");
  const destination = path.join(path.dirname(path.resolve(projectPath)), "AGENTS.md");
  await fs.writeFile(destination, template, "utf8");
  return destination;
}
