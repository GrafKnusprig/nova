import { children, flattenNodes, nodes, projectRoot, projectRootId, stringValue, type JsonObject } from "./project";

type FlatNode = ReturnType<typeof flattenNodes>[number];
type SearchHit = {
  id: string;
  title: string;
  parent_id?: string;
  category_id: string;
  category_title: string;
  path: string[];
  tags: unknown[];
  score: number;
  reasons: string[];
  exact_id: boolean;
  exact_title: boolean;
  summary: string;
};

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function categoryFor(node: FlatNode, byId: Map<string, FlatNode>, rootId: string): FlatNode {
  let current: FlatNode = node;
  while (current.depth > 1 && current.parentId) {
    const parent = byId.get(current.parentId);
    if (!parent) break;
    current = parent;
  }
  return current.depth === 1 && current.id !== rootId ? current : node;
}

function nodePath(node: FlatNode, byId: Map<string, FlatNode>): string[] {
  const result: string[] = [];
  let current: FlatNode | undefined = node;
  while (current) {
    result.unshift(stringValue(current.title, "node.title"));
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return result;
}

function scoreNode(node: FlatNode, query: string, terms: string[], indexedScores?: Map<string, number>): SearchHit | undefined {
  const title = stringValue(node.title, "node.title");
  const id = stringValue(node.id, "node.id");
  const normalizedTitle = normalize(title);
  const normalizedQuery = normalize(query);
  const exactId = id.toLowerCase() === query.trim().toLowerCase();
  const exactTitle = normalizedTitle.length > 0 && normalizedTitle === normalizedQuery;
  const summary = stringValue(node.summary, "node.summary");
  const rationale = typeof node.rationale === "string" ? node.rationale : "";
  const tags = Array.isArray(node.tags) ? node.tags : [];
  const titleText = `${normalizedTitle} ${normalize(String(node.main_tag ?? ""))} ${tags.map((tag) => normalize(String(tag))).join(" ")}`;
  const fullText = normalize(`${title} ${summary} ${rationale} ${tags.join(" ")} ${String(node.main_tag ?? "")}`);
  const reasons: string[] = [];
  let score = 0;
  if (exactId) { score += 10000; reasons.push("exact-id"); }
  if (exactTitle) { score += 9000; reasons.push("exact-title"); }
  if (!exactTitle && normalizedTitle.startsWith(normalizedQuery) && normalizedQuery) { score += 500; reasons.push("title-prefix"); }
  if (!exactTitle && normalizedQuery && normalizedTitle.includes(normalizedQuery)) { score += 350; reasons.push("title-phrase"); }
  if (normalizedQuery && fullText.includes(normalizedQuery)) { score += 120; reasons.push("text-phrase"); }
  const titleTerms = terms.filter((term) => titleText.includes(term));
  const allTerms = terms.filter((term) => fullText.includes(term));
  score += titleTerms.length * 30 + Math.max(0, allTerms.length - titleTerms.length) * 8;
  if (titleTerms.length) reasons.push("title-terms");
  if (allTerms.length > titleTerms.length) reasons.push("content-terms");
  const indexedScore = indexedScores?.get(id) ?? 0;
  if (indexedScore > 0) { score += indexedScore; reasons.push("sqlite-fts5"); }
  if (!score) return undefined;
  return {
    id,
    title,
    parent_id: node.parentId,
    category_id: "",
    category_title: "",
    path: [],
    tags,
    score,
    reasons,
    exact_id: exactId,
    exact_title: exactTitle,
    summary: summary.slice(0, 500),
  };
}

function search(document: JsonObject, query: string, categoryId?: string, indexedScores?: Map<string, number>): { hits: SearchHit[]; exact: SearchHit[]; categories: FlatNode[]; byId: Map<string, FlatNode> } {
  const flat = flattenNodes(nodes(document));
  const byId = new Map(flat.map((node) => [stringValue(node.id, "node.id"), node]));
  const rootId = projectRootId(document);
  const categories = children(projectRoot(document)).map((node) => byId.get(stringValue(node.id, "node.id"))!);
  if (categoryId && !categories.some((category) => category.id === categoryId))
    throw new Error(`Category ${categoryId} is not a direct child of the project root.`);
  const terms = [...new Set(normalize(query).split(/\s+/).filter((term) => term.length > 1))];
  const hits = flat.flatMap((node) => {
    const hit = scoreNode(node, query, terms, indexedScores);
    if (!hit) return [];
    const category = categoryFor(node, byId, rootId);
    hit.category_id = stringValue(category.id, "category.id");
    hit.category_title = stringValue(category.title, "category.title");
    hit.path = nodePath(node, byId);
    const inCategory = !categoryId || hit.category_id === categoryId;
    return inCategory || hit.exact_id || hit.exact_title ? [hit] : [];
  }).sort((a, b) => Number(b.exact_id) - Number(a.exact_id) || Number(b.exact_title) - Number(a.exact_title) || b.score - a.score || a.title.localeCompare(b.title));
  const normalizedQuery = normalize(query);
  const exact = flat.flatMap((node) => {
    const id = stringValue(node.id, "node.id"), title = stringValue(node.title, "node.title");
    if (id.toLowerCase() !== query.trim().toLowerCase() && normalize(title) !== normalizedQuery) return [];
    return hits.find((hit) => hit.id === id) ?? [];
  });
  return { hits, exact, categories, byId };
}

function excerpt(node: FlatNode, byId: Map<string, FlatNode>, rootId: string): Record<string, unknown> {
  const category = categoryFor(node, byId, rootId);
  return {
    id: node.id,
    title: node.title,
    path: nodePath(node, byId),
    category_id: category.id,
    category_title: category.title,
    tags: node.tags,
    main_tag: node.main_tag,
    summary: node.summary,
    rationale: node.rationale,
    links: node.links,
  };
}

function estimateTokens(value: unknown): number {
  return Math.ceil((JSON.stringify(value)?.length ?? 0) / 4);
}

export function searchProject(document: JsonObject, query: string, categoryId: string | undefined, limit: number, indexedScores?: Map<string, number>) {
  const result = search(document, query, categoryId, indexedScores);
  return {
    exact_candidates: result.exact,
    matches: result.hits.slice(0, limit),
    total_matches: result.hits.length,
    category_filter: categoryId ?? null,
    category_filter_note: "Exact ID and exact normalized-title matches remain visible across all categories.",
  };
}

export function buildContextPack(document: JsonObject, query: string, categoryId: string | undefined, tokenBudget: number, relatedDepth: number, indexedScores?: Map<string, number>, scope: "category" | "all" = "category") {
  const broad = scope === "all";
  const result = search(document, query, broad ? undefined : categoryId, indexedScores);
  const globalResult = categoryId ? search(document, query, undefined, indexedScores) : result;
  const root = projectRoot(document);
  const selectedCategory = !broad && categoryId
    ? result.categories.find((category) => category.id === categoryId)!
    : !broad && result.hits.length
      ? result.categories.find((category) => category.id === result.hits[0].category_id)
      : undefined;
  const index = result.categories.map((category) => ({ id: category.id, title: category.title, summary: String(category.summary ?? "").slice(0, 240), tags: category.tags }));
  const guidance = {
    project: { root_node_id: root.id, name: root.title, description: root.summary },
    llm_context: document.llm_context,
  };
  const crossCategoryHits = selectedCategory
    ? globalResult.hits.filter((hit) => hit.category_id !== selectedCategory.id).slice(0, 12)
    : [];
  const base = {
    ok: true,
    command: "context",
    query,
    retrieval_scope: broad ? "all" : categoryId ? "category" : "ranked-category",
    selected_category: selectedCategory ? { id: selectedCategory.id, title: selectedCategory.title } : null,
    category_index: index,
    guidance,
    exact_duplicate_candidates: result.exact,
    cross_category_candidates: crossCategoryHits.map(({ id, title, category_id, category_title, path, score, reasons, summary }) => ({ id, title, category_id, category_title, path, score, reasons, summary })),
  };
  const nodesById = result.byId;
  const rootId = projectRootId(document);
  const selectedIds = new Set<string>();
  const ancestorIds = new Set<string>();
  for (const hit of result.hits) {
    const inSelectedCategory = !selectedCategory || hit.category_id === selectedCategory.id;
    if (inSelectedCategory || hit.exact_id || hit.exact_title) selectedIds.add(hit.id);
  }
  for (const hit of crossCategoryHits.slice(0, 5)) selectedIds.add(hit.id);
  for (const hit of result.exact) selectedIds.add(hit.id);
  if (broad) for (const node of flattenNodes(nodes(document))) selectedIds.add(stringValue(node.id, "node.id"));
  for (const id of [...selectedIds]) {
    const node = nodesById.get(id);
    if (!node) continue;
    let parentId = node.parentId;
    while (parentId) {
      selectedIds.add(parentId);
      ancestorIds.add(parentId);
      const parent = nodesById.get(parentId);
      parentId = parent?.parentId;
    }
  }
  let frontier = result.hits.filter((hit) => selectedIds.has(hit.id)).map((hit) => hit.id);
  const related: string[] = [];
  for (let depth = 0; depth < relatedDepth; depth += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      const node = nodesById.get(id);
      if (!node) continue;
      const adjacent = new Set<string>();
      if (result.hits.some((hit) => hit.id === id) && children(node).length <= 8)
        for (const child of children(node)) adjacent.add(stringValue(child.id, "node.id"));
      if (node.parentId) adjacent.add(node.parentId);
      for (const rawLink of node.links as Array<{ target: string }>) adjacent.add(rawLink.target);
      for (const possibleSource of nodesById.values()) {
        if ((possibleSource.links as Array<{ target: string }>).some((link) => link.target === id)) adjacent.add(stringValue(possibleSource.id, "node.id"));
      }
      for (const adjacentId of adjacent) if (!selectedIds.has(adjacentId)) {
        selectedIds.add(adjacentId);
        next.push(adjacentId);
        related.push(adjacentId);
      }
    }
    frontier = next;
  }

  const rankedIds = result.hits.filter((hit) => selectedIds.has(hit.id)).map((hit) => hit.id);
  const included = new Set<string>();
  const contextNodes: Record<string, unknown>[] = [];
  const mandatoryEstimate = estimateTokens(base);
  let used = mandatoryEstimate;
  const allIds = broad ? flattenNodes(nodes(document)).map((node) => stringValue(node.id, "node.id")) : [];
  const candidates = [...rankedIds, ...[...ancestorIds], ...related, ...allIds].filter((id, index, all) => all.indexOf(id) === index);
  let truncated = false;
  for (const id of candidates) {
    const node = nodesById.get(id);
    if (!node) continue;
    const full = excerpt(node, nodesById, rootId);
    const cost = estimateTokens(full);
    if (used + cost > tokenBudget && !result.exact.some((hit) => hit.id === id)) { truncated = true; continue; }
    contextNodes.push({ ...full, match: result.hits.find((hit) => hit.id === id) ? { score: result.hits.find((hit) => hit.id === id)!.score, reasons: result.hits.find((hit) => hit.id === id)!.reasons } : { reason: "related-node" } });
    included.add(id);
    used += cost;
    if (used > tokenBudget) truncated = true;
  }
  const omissions = candidates.filter((id) => !included.has(id));
  const payload = { ...base, nodes: contextNodes, omitted_node_ids: omissions, budget: { requested_tokens: tokenBudget, estimated_tokens: used, estimate: "JSON character count divided by four; approximate, not model-tokenizer exact", mandatory_context_exceeds_budget: mandatoryEstimate > tokenBudget, truncated, full_map_included: broad && omissions.length === 0 && used <= tokenBudget } };
  return payload;
}
