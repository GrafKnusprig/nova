import { children, flattenNodes, nodes, projectRootId } from "./project";

export type AuditSeverity = "warning" | "info";

export interface AuditFinding {
  rule: string;
  severity: AuditSeverity;
  node_ids: string[];
  titles: string[];
  evidence: string;
  suggestion: string;
  score?: number;
}

export interface AuditReport {
  node_count: number;
  finding_count: number;
  warning_count: number;
  info_count: number;
  findings: AuditFinding[];
}

type ProjectNode = Record<string, unknown>;

const EPISTEMIC_TAGS = new Set([
  "concept", "research-question", "hypothesis", "method", "experiment", "result", "finding",
  "source", "decision", "implementation", "issue", "observation", "idea", "limitation",
  "threat-to-validity", "todo", "open-question", "requirement", "constraint",
]);
const ACTIVITY_TITLE = /\b(created|generated|updated|regenerated|produced|built|wrote|added)\b.*\b(report|slides?|figures?|screenshots?|documentation|docs?|file|artifact)\b|\b(report|slides?|figures?|screenshots?|documentation|docs?|file|artifact)\b.*\b(created|generated|updated|regenerated|produced|built|added)\b/i;
const ARTIFACT_ONLY_TITLE = /\b(main file|build artifact|generated (?:node )?reference|report|slide deck|screenshots?)\b/i;
const COMPLETION_LANGUAGE = /\b(implemented|completed|finished)\b|\bnow (?:supports|uses|works|contains)\b|\btests? passed\b/i;
const OPEN_TAGS = new Set(["todo", "open", "proposed"]);

function strings(value: unknown): string[] { return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []; }
function text(value: unknown): string { return typeof value === "string" ? value : ""; }
function normalizedWords(value: string): Set<string> {
  const stop = new Set(["a", "an", "and", "as", "at", "by", "for", "from", "in", "into", "of", "on", "or", "the", "to", "with"]);
  return new Set(value.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((word) => word.length > 2 && !stop.has(word)));
}
function similarity(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const word of left) if (right.has(word)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}
function incomingCounts(all: ProjectNode[]): Map<string, number> {
  const counts = new Map(all.map((node) => [text(node.id), 0]));
  for (const node of all) for (const link of Array.isArray(node.links) ? node.links as ProjectNode[] : []) {
    const target = text(link.target);
    counts.set(target, (counts.get(target) ?? 0) + 1);
  }
  return counts;
}

export function auditProject(document: Record<string, unknown>): AuditReport {
  const all = flattenNodes(nodes(document)) as ProjectNode[];
  const rootId = projectRootId(document);
  const incoming = incomingCounts(all);
  const findings: AuditFinding[] = [];

  for (const node of all) {
    const id = text(node.id), title = text(node.title), summary = text(node.summary), tags = strings(node.tags);
    if (id === rootId) continue;
    if (ACTIVITY_TITLE.test(title) || (ARTIFACT_ONLY_TITLE.test(title) && /\b(created|generated|copies|contains|located|resides)\b/i.test(summary))) {
      findings.push({ rule: "activity-or-artifact-node", severity: "warning", node_ids: [id], titles: [title], evidence: "The title and summary emphasize producing or locating an artifact rather than the knowledge it supports.", suggestion: "Reframe around the underlying decision, evidence, result, limitation, or requirement; keep the artifact path only as provenance." });
    }
    if (!tags.some((tag) => EPISTEMIC_TAGS.has(tag))) {
      findings.push({ rule: "missing-epistemic-tag", severity: "info", node_ids: [id], titles: [title], evidence: `Tags do not identify a knowledge role: ${tags.join(", ")}.`, suggestion: "Add the most specific applicable epistemic tag, or merge the node if it contains no durable knowledge." });
    }
    if (tags.some((tag) => OPEN_TAGS.has(tag)) && COMPLETION_LANGUAGE.test(summary)) {
      findings.push({ rule: "status-content-contradiction", severity: "warning", node_ids: [id], titles: [title], evidence: "The node is tagged open/todo/proposed but its content uses completion language.", suggestion: "Update the status tags, or split completed work from the remaining open question." });
    }
    const outgoing = Array.isArray(node.links) ? node.links.length : 0;
    if (node.parentId === rootId && children(node).length === 0 && outgoing === 0 && (incoming.get(id) ?? 0) === 0 && (tags.includes("result") || tags.includes("finding") || tags.includes("experiment"))) {
      findings.push({ rule: "unrelated-evidence-node", severity: "info", node_ids: [id], titles: [title], evidence: "This evidence-bearing leaf has no semantic links in either direction.", suggestion: "Link it to the question, method, decision, or claim it evaluates or supports when hierarchy alone is insufficient." });
    }
  }

  const candidates = all.filter((node) => text(node.id) !== rootId).map((node) => ({ node, words: normalizedWords(`${text(node.title)} ${text(node.summary)}`) }));
  for (let left = 0; left < candidates.length; left += 1) for (let right = left + 1; right < candidates.length; right += 1) {
    const a = candidates[left], b = candidates[right];
    const titleScore = similarity(normalizedWords(text(a.node.title)), normalizedWords(text(b.node.title)));
    const contentScore = similarity(a.words, b.words);
    if (titleScore < 0.8 || contentScore < 0.55) continue;
    findings.push({ rule: "possible-duplicate", severity: "warning", node_ids: [text(a.node.id), text(b.node.id)], titles: [text(a.node.title), text(b.node.title)], evidence: `High lexical overlap in title and content (title ${titleScore.toFixed(2)}, combined ${contentScore.toFixed(2)}).`, suggestion: "Compare the nodes semantically; merge them or clarify their distinct scopes and connect them if both are needed.", score: Number(((titleScore + contentScore) / 2).toFixed(3)) });
  }

  findings.sort((a, b) => Number(b.severity === "warning") - Number(a.severity === "warning") || a.rule.localeCompare(b.rule) || a.titles[0].localeCompare(b.titles[0]));
  return { node_count: all.length, finding_count: findings.length, warning_count: findings.filter((finding) => finding.severity === "warning").length, info_count: findings.filter((finding) => finding.severity === "info").length, findings };
}
