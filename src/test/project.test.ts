import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { addLlmInstruction, changeProjectLink, children, createProjectFile, createProjectNode, defineProjectTag, deleteProjectNode, findNode, moveProjectNode, mutateProject, nodes, projectRoot, readProject, removeLlmInstruction, removeProjectTagDefinition, setLlmContextSummary, updateProjectNode, validateMap, writeProjectAtomic } from "../main/project";

async function fixture(): Promise<{ directory: string; file: string }> { const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mindmap-cli-test-")), file = path.join(directory, "mindmap.json"); await createProjectFile(file, "Test project", "Test description"); return { directory, file }; }

test("project helper lifecycle preserves a valid protected-root map", async (context) => {
  const { directory, file } = await fixture(); context.after(() => fs.rm(directory, { recursive: true, force: true }));
  let firstId = "", secondId = "";
  await mutateProject(file, (document) => { const root = projectRoot(document), first = createProjectNode(document, { title: "First", tags: ["concept"] }), second = createProjectNode(document, { title: "Second", parentId: String(first.id), tags: ["implementation"], summary: "Initial" }); firstId = String(first.id); secondId = String(second.id); assert.equal(children(root).length, 1); });
  await mutateProject(file, (document) => updateProjectNode(document, secondId, { summary: "Updated", tags: ["implementation", "active"], mainTag: "implementation" }));
  await mutateProject(file, (document) => changeProjectLink(document, "add", firstId, secondId, "supports"));
  await mutateProject(file, (document) => moveProjectNode(document, secondId, String(projectRoot(document).id)));
  const beforeDelete = await readProject(file); assert.equal(findNode(nodes(beforeDelete.document), secondId)?.summary, "Updated"); validateMap(beforeDelete.document);
  await mutateProject(file, (document) => deleteProjectNode(document, firstId));
  const afterDelete = await readProject(file); assert.equal(findNode(nodes(afterDelete.document), firstId), undefined); assert.ok(findNode(nodes(afterDelete.document), secondId)); validateMap(afterDelete.document);
  assert.throws(() => deleteProjectNode(afterDelete.document, String(projectRoot(afterDelete.document).id)), /cannot be deleted/);
});

test("atomic writes reject a stale project revision", async (context) => {
  const { directory, file } = await fixture(); context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const stale = await readProject(file), current = structuredClone(stale.document); updateProjectNode(current, String(projectRoot(current).id), { title: "External" }); await writeProjectAtomic(file, current, stale.revision);
  updateProjectNode(stale.document, String(projectRoot(stale.document).id), { title: "Stale" }); await assert.rejects(() => writeProjectAtomic(file, stale.document, stale.revision), /changed after it was read/);
});

test("project-specific LLM context mutations remain schema-valid", async (context) => {
  const { directory, file } = await fixture(); context.after(() => fs.rm(directory, { recursive: true, force: true }));
  await mutateProject(file, (document) => { setLlmContextSummary(document, "Domain guidance"); addLlmInstruction(document, "Preserve measured units."); addLlmInstruction(document, "Preserve measured units."); defineProjectTag(document, "domain-area", "A project-specific work area."); });
  let loaded = await readProject(file), llm = loaded.document.llm_context as Record<string, unknown>;
  assert.equal(llm.summary, "Domain guidance"); assert.deepEqual(llm.instructions, ["Preserve measured units."]); assert.deepEqual(llm.tag_definitions, { "domain-area": "A project-specific work area." }); validateMap(loaded.document);
  await mutateProject(file, (document) => { removeLlmInstruction(document, "Preserve measured units."); removeProjectTagDefinition(document, "domain-area"); });
  loaded = await readProject(file); llm = loaded.document.llm_context as Record<string, unknown>; assert.deepEqual(llm.instructions, []); assert.deepEqual(llm.tag_definitions, {}); validateMap(loaded.document);
});
