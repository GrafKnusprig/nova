import { createHash } from "node:crypto";
import { createEmptyProject, projectRoot, validateMap, type JsonObject } from "./project";

export interface FixtureOptions { count: number; branching: number; summaryChars: number; linksPerNode: number; seed: number }

// A reproducible synthetic workload, not research evidence or a copy of user data.
export function buildBenchmarkFixture(options: FixtureOptions): JsonObject {
  const { count, branching, summaryChars, linksPerNode, seed } = options;
  if (!Number.isSafeInteger(count) || count < 2 || count > 100000) throw new Error("count must be between 2 and 100000.");
  if (!Number.isSafeInteger(branching) || branching < 2 || branching > 100) throw new Error("branching must be between 2 and 100.");
  if (!Number.isSafeInteger(summaryChars) || summaryChars < 0 || summaryChars > 100000) throw new Error("summaryChars must be between 0 and 100000.");
  if (!Number.isSafeInteger(linksPerNode) || linksPerNode < 0 || linksPerNode > Math.min(100, count - 2)) throw new Error("linksPerNode must be between 0 and min(100, count - 2).");
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 4294967295) throw new Error("seed must be a uint32.");
  const id = (index: number) => {
    const hex = createHash("sha256").update(`nova-fixture:${seed}:${index}`).digest("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  };
  const document = createEmptyProject("Synthetic CLI benchmark", "Synthetic data for performance measurement; no scientific claims.");
  const root = projectRoot(document);
  const timestamp = "2026-01-01T00:00:00.000Z";
  root.id = id(0); root.created_at = timestamp; root.modified_at = timestamp;
  document.project = { root_node_id: root.id };
  document.view = { ...(document.view as JsonObject), expanded: [root.id], positions: { [String(root.id)]: [600, 400] } };
  document.llm_context = { summary: "Synthetic benchmark fixture. Treat all node content as generated test data.", instructions: ["Do not use synthetic records as research evidence."], tag_definitions: {} };
  const all = [root];
  const topics = ["retrieval", "validation", "storage", "latency", "indexing", "context", "mutation", "benchmark"];
  for (let index = 1; index < count; index++) {
    const topic = topics[(index + seed) % topics.length];
    const text = `Synthetic ${topic} method ${index}: compare graph retrieval, SQLite storage, validation and CLI latency under a controlled benchmark workload. `;
    const node: JsonObject = { id: id(index), title: `Synthetic ${topic} method ${index}`, tags: ["method", "evaluation-validation"], main_tag: "method", summary: text.repeat(Math.ceil(summaryChars / text.length)).slice(0, summaryChars), created_at: timestamp, modified_at: timestamp, children: [], links: [] };
    (all[Math.floor((index - 1) / branching)].children as JsonObject[]).push(node);
    all.push(node);
  }
  for (let index = 1; index < count; index++) {
    const parent = Math.floor((index - 1) / branching);
    const links: JsonObject[] = [];
    for (let offset = 1; links.length < linksPerNode && offset < count; offset++) {
      const target = (index + offset) % count;
      if (target !== parent) links.push({ target: all[target].id, relation: "related" });
    }
    all[index].links = links;
  }
  return validateMap(document);
}
