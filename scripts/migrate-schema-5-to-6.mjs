import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const source = path.resolve(process.argv[2] ?? "mindmap.json");
const document = JSON.parse(await readFile(source, "utf8"));
if (document.version !== 5) throw new Error(`Expected schema 5, received ${document.version}.`);

document.version = 6;
document.viewer_version = "6.0.1";
document.view = {
  ...document.view,
  tag_filter_mode: "exclude",
  tag_filter_tags: document.view.hidden_tags ?? [],
};
delete document.view.hidden_tags;

await writeFile(source, `${JSON.stringify(document, null, 2)}\n`, "utf8");
console.log(`Migrated ${source} from schema 5 to schema 6.`);
