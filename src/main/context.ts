import { children, flattenNodes, nodes, projectRoot, stringValue, type JsonObject } from "./project";

type FlatNode = ReturnType<typeof flattenNodes>[number];
type PreparedNode = { normalizedTitle: string; titleText: string; fullText: string; hierarchyText: string };
type TopicGuidance = { id: string; title: string; summary: string; instructions: string[] };
interface ContextIndex {
  flat: FlatNode[];
  byId: Map<string, FlatNode>;
  categories: FlatNode[];
  categoryById: Map<string, FlatNode>;
  paths: Map<string, string[]>;
  incoming: Map<string, string[]>;
  prepared: Map<string, PreparedNode>;
  guidance: Map<string, TopicGuidance[]>;
  excerpts: Map<string, Record<string, unknown>>;
  excerptTokens: Map<string, number>;
  searches: Map<string, { scores?: Map<string, number>; value: SearchResult }>;
}
type SearchResult = { hits: SearchHit[]; exact: SearchHit[]; categories: FlatNode[]; byId: Map<string, FlatNode> };
const indexes = new WeakMap<JsonObject, ContextIndex>();

// Derived navigation/search data are built once per immutable document snapshot.
function contextIndex(document: JsonObject): ContextIndex {
  const cached = indexes.get(document);
  if (cached) return cached;
  const flat = flattenNodes(nodes(document));
  const byId = new Map(flat.map(node => [String(node.id), node]));
  const categories = children(projectRoot(document)).map(node => byId.get(String(node.id))!);
  const categoryById = new Map<string, FlatNode>(), paths = new Map<string, string[]>();
  const incoming = new Map<string, string[]>(), prepared = new Map<string, PreparedNode>();
  const guidance = new Map<string, TopicGuidance[]>();
  for (const node of flat) {
    const id = String(node.id), parent = node.parentId ? byId.get(node.parentId) : undefined;
    const path = [...(parent ? paths.get(String(parent.id))! : []), String(node.title)];
    paths.set(id, path);
    categoryById.set(id, node.depth === 1 || !parent ? node : categoryById.get(String(parent.id))!);
    const scopes = parent ? guidance.get(String(parent.id))! : [];
    const own = node.agent_guidance as { summary: string; instructions: string[] } | undefined;
    guidance.set(id, own ? [...scopes, { id, title: String(node.title), summary: own.summary, instructions: own.instructions }] : scopes);
    prepared.set(id, {
      normalizedTitle: normalize(String(node.title)),
      titleText: normalize(`${node.title} ${node.main_tag} ${(node.tags as string[]).join(" ")}`),
      fullText: normalize(`${node.title} ${node.summary} ${node.rationale ?? ""} ${(node.tags as string[]).join(" ")} ${node.main_tag}`),
      hierarchyText: normalize(path.slice(0, -1).join(" ")),
    });
    for (const link of node.links as Array<{ target: string }>) {
      const sources = incoming.get(link.target) ?? [];
      sources.push(id); incoming.set(link.target, sources);
    }
  }
  const excerpts = new Map<string, Record<string, unknown>>(), excerptTokens = new Map<string, number>();
  const index: ContextIndex = { flat, byId, categories, categoryById, paths, incoming, prepared, guidance, excerpts, excerptTokens, searches: new Map() };
  if (Object.isFrozen(document)) indexes.set(document, index);
  return index;
}

function cachedExcerpt(index: ContextIndex, id: string): Record<string, unknown> {
  const cached = index.excerpts.get(id);
  if (cached) return cached;
  const node = index.byId.get(id)!, category = index.categoryById.get(id)!;
  const record = { id: node.id, title: node.title, path: index.paths.get(id), category_id: category.id, category_title: category.title, tags: node.tags, main_tag: node.main_tag, summary: node.summary, rationale: node.rationale, links: node.links };
  index.excerpts.set(id, record); index.excerptTokens.set(id, estimateTokens(record));
  return record;
}
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

function scoreNode(node: FlatNode, query: string, normalizedQuery: string, terms: string[], prepared: PreparedNode, indexedScores?: Map<string, number>): SearchHit | undefined {
  const title = stringValue(node.title, "node.title");
  const id = stringValue(node.id, "node.id");
  const { normalizedTitle, titleText, fullText, hierarchyText } = prepared;
  const exactId = id.toLowerCase() === query.trim().toLowerCase();
  const exactTitle = normalizedTitle.length > 0 && normalizedTitle === normalizedQuery;
  const summary = stringValue(node.summary, "node.summary");
  const tags = Array.isArray(node.tags) ? node.tags : [];
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
  const contextTerms = terms.filter(term => !fullText.includes(term) && hierarchyText.includes(term));
  if (contextTerms.length) { score += contextTerms.length * 4; reasons.push("hierarchy-context"); }
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

function search(document: JsonObject, query: string, categoryId?: string, indexedScores?: Map<string, number>, preparedIndex?: ContextIndex): SearchResult {
  const index = preparedIndex ?? contextIndex(document);
  const { flat, byId, categories } = index;
  if (categoryId && !categories.some((category) => category.id === categoryId))
    throw new Error(`Category ${categoryId} is not a direct child of the project root.`);
  const key = JSON.stringify([query, categoryId]);
  const cached = index.searches.get(key);
  if (cached && cached.scores === indexedScores) return cached.value;
  const normalizedQuery = normalize(query);
  const terms = [...new Set(normalizedQuery.split(/\s+/).filter((term) => term.length > 1))];
  const hits = flat.flatMap((node) => {
    const hit = scoreNode(node, query, normalizedQuery, terms, index.prepared.get(String(node.id))!, indexedScores);
    if (!hit) return [];
    const category = index.categoryById.get(hit.id)!;
    hit.category_id = stringValue(category.id, "category.id");
    hit.category_title = stringValue(category.title, "category.title");
    hit.path = index.paths.get(hit.id)!;
    const inCategory = !categoryId || hit.category_id === categoryId;
    return inCategory || hit.exact_id || hit.exact_title ? [hit] : [];
  }).sort((a, b) => Number(b.exact_id) - Number(a.exact_id) || Number(b.exact_title) - Number(a.exact_title) || b.score - a.score || a.title.localeCompare(b.title));
  const exact = hits.filter(hit => hit.exact_id || hit.exact_title);
  const value = { hits, exact, categories, byId };
  if (value.hits.length <= 10000) {
    let cachedHits = [...index.searches.values()].reduce((sum, entry) => sum + entry.value.hits.length, 0);
    while (index.searches.size && (index.searches.size >= 64 || cachedHits + value.hits.length > 10000)) {
      const oldest = index.searches.keys().next().value!;
      cachedHits -= index.searches.get(oldest)!.value.hits.length; index.searches.delete(oldest);
    }
    index.searches.set(key, { scores: indexedScores, value });
  }
  return value;
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
  const lookup = contextIndex(document);
  const result = search(document, query, broad ? undefined : categoryId, indexedScores, lookup);
  const globalResult = categoryId ? search(document, query, undefined, indexedScores, lookup) : result;
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
    topic_guidance: [...(selectedCategory ? lookup.guidance.get(String(selectedCategory.id))! : lookup.guidance.get(String(root.id))!)],
    instruction_scope: "Project instructions always apply. Topic instructions supplement them for the listed node and its descendants; report conflicts rather than silently overriding project instructions.",
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
  const hitsById = new Map(result.hits.map(hit => [hit.id, hit]));
  const related: string[] = [];
  for (let depth = 0; depth < relatedDepth; depth += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      const node = nodesById.get(id);
      if (!node) continue;
      const adjacent = new Set<string>();
      if (hitsById.has(id) && children(node).length <= 8)
        for (const child of children(node)) adjacent.add(stringValue(child.id, "node.id"));
      if (node.parentId) adjacent.add(node.parentId);
      for (const rawLink of node.links as Array<{ target: string }>) adjacent.add(rawLink.target);
      for (const sourceId of lookup.incoming.get(id) ?? []) adjacent.add(sourceId);
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
  const allIds = broad ? lookup.flat.map(node => String(node.id)) : [];
  const candidates = [...new Set([...rankedIds, ...ancestorIds, ...related, ...allIds])];
  const exactIds = new Set(result.exact.map(hit => hit.id));
  const includedScopes = new Set(guidance.topic_guidance.map(scope => scope.id));
  let truncated = false;
  for (const id of candidates) {
    const node = nodesById.get(id);
    if (!node) continue;
    const full = cachedExcerpt(lookup, id);
    const scopes = lookup.guidance.get(id)!.filter(scope => !includedScopes.has(scope.id));
    const hit = hitsById.get(id);
    const match = hit ? { score: hit.score, reasons: hit.reasons } : { reason: "related-node" };
    const record = { ...full, match };
    const cost = lookup.excerptTokens.get(id)! + estimateTokens(match) + scopes.reduce((sum, scope) => sum + estimateTokens(scope), 0);
    if (used + cost > tokenBudget && !exactIds.has(id)) { truncated = true; continue; }
    contextNodes.push(record);
    for (const scope of scopes) { guidance.topic_guidance.push(scope); includedScopes.add(scope.id); }
    included.add(id);
    used += cost;
    if (used > tokenBudget) truncated = true;
  }
  const omissions = () => candidates.filter(id => !included.has(id));
  const payload = { ...base, nodes: contextNodes, omitted_node_ids: omissions().slice(0, 50), omitted_node_count: omissions().length, omitted_ids_truncated: omissions().length > 50, budget: { requested_tokens: tokenBudget, estimated_tokens: used, estimate: "JSON character count divided by four; approximate, not model-tokenizer exact", mandatory_context_exceeds_budget: mandatoryEstimate > tokenBudget, truncated, full_map_included: false } };
  // Include omission metadata and scope guidance in the output budget. Exact
  // duplicates and mandatory instructions remain visible even if they exceed it.
  while (estimateTokens(payload) > tokenBudget) {
    let removable = contextNodes.length - 1;
    while (removable >= 0 && exactIds.has(String(contextNodes[removable].id))) removable--;
    if (removable < 0) break;
    included.delete(String(contextNodes[removable].id)); contextNodes.splice(removable, 1);
    const scopes = new Map((selectedCategory ? lookup.guidance.get(String(selectedCategory.id))! : lookup.guidance.get(String(root.id))!).map(scope => [scope.id, scope]));
    for (const id of included) for (const scope of lookup.guidance.get(id)!) scopes.set(scope.id, scope);
    guidance.topic_guidance = [...scopes.values()];
    const omitted = omissions(); payload.omitted_node_ids = omitted.slice(0, 50); payload.omitted_node_count = omitted.length; payload.omitted_ids_truncated = omitted.length > 50;
    payload.budget.truncated = true;
  }
  while (estimateTokens(payload) > tokenBudget && payload.omitted_node_ids.length) payload.omitted_node_ids.pop();
  payload.omitted_ids_truncated = payload.omitted_node_count > payload.omitted_node_ids.length;
  payload.budget.estimated_tokens = estimateTokens(payload);
  payload.budget.truncated ||= payload.omitted_node_count > 0 || payload.budget.estimated_tokens > tokenBudget;
  payload.budget.full_map_included = broad && payload.omitted_node_count === 0 && payload.budget.estimated_tokens <= tokenBudget;
  payload.budget.estimated_tokens = estimateTokens(payload);
  return payload;
}
