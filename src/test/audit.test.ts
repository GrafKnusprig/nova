import assert from "node:assert/strict";
import test from "node:test";
import { auditProject } from "../main/audit";
import { createEmptyProject, createProjectNode, projectRoot } from "../main/project";

test("audit reports artifact nodes, status contradictions, and unrelated results", () => {
  const document = createEmptyProject("Audit fixture", "");
  createProjectNode(document, { title: "Generated experiment report", summary: "Created a PDF report in reports/output.pdf.", tags: ["documentation"] });
  createProjectNode(document, { title: "Adaptive refinement", summary: "Implemented and passed the controlled test.", tags: ["method", "proposed"] });
  createProjectNode(document, { title: "Measured result", summary: "Accuracy was 0.91.", tags: ["result"] });
  const report = auditProject(document);
  assert.ok(report.findings.some((finding) => finding.rule === "activity-or-artifact-node"));
  assert.ok(report.findings.some((finding) => finding.rule === "status-content-contradiction"));
  assert.ok(report.findings.some((finding) => finding.rule === "unrelated-evidence-node"));
  assert.ok(report.findings.some((finding) => finding.rule === "missing-epistemic-tag"));
  assert.equal(projectRoot(document).title, "Audit fixture");
});

test("audit identifies only strong lexical duplicate candidates", () => {
  const document = createEmptyProject("Audit fixture", "");
  createProjectNode(document, { title: "Adaptive boundary refinement method", summary: "Decode uncertain boundary regions with adaptive region refinement and classify reconstructed density values.", tags: ["method"] });
  createProjectNode(document, { title: "Adaptive boundary refinement method", summary: "Decode uncertain boundary regions using adaptive region refinement and classify reconstructed density values.", tags: ["method"] });
  createProjectNode(document, { title: "Unrelated benchmark", summary: "Measure rendering throughput.", tags: ["experiment"] });
  const duplicates = auditProject(document).findings.filter((finding) => finding.rule === "possible-duplicate");
  assert.equal(duplicates.length, 1);
  assert.deepEqual(duplicates[0].titles, ["Adaptive boundary refinement method", "Adaptive boundary refinement method"]);
});
