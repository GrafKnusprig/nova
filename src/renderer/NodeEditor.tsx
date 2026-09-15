import { useEffect, useMemo, useRef, useState } from "react";
import type { IndexedNode, MapNode } from "./model";

function tagId(value: string): string { return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
function editable(node: Pick<MapNode, "title" | "tags" | "main_tag" | "summary" | "rationale" | "links">): string { return JSON.stringify({ title: node.title, tags: node.tags, main_tag: node.main_tag, summary: node.summary, rationale: node.rationale ?? "", links: node.links }); }

function FullTextarea({ value, onChange }: { value: string; onChange(value: string): void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { const area = ref.current; if (!area) return; area.style.height = "0"; area.style.height = `${Math.max(132, area.scrollHeight + 2)}px`; }, [value]);
  return <textarea ref={ref} value={value} onChange={(event) => onChange(event.target.value)} />;
}

export function NodeEditor({ node, allNodes, allTags, onApply, onSelectNode, compact = false }: { node: IndexedNode; allNodes: IndexedNode[]; allTags: string[]; onApply(values: Partial<MapNode>): void; onSelectNode?(id: string): void; compact?: boolean }) {
  const [draft, setDraft] = useState<MapNode>(() => ({ ...node, tags: [...node.tags], links: [...node.links] })); const base = useRef<MapNode>({ ...node, tags: [...node.tags], links: [...node.links] });
  const [incoming, setIncoming] = useState<MapNode>(); const [showComparison, setShowComparison] = useState(false); const [addingTag, setAddingTag] = useState(false); const [tagDraft, setTagDraft] = useState(""); const [addingLink, setAddingLink] = useState(false); const [linkTarget, setLinkTarget] = useState(""); const [linkRelation, setLinkRelation] = useState("related");
  const nodeRevision = `${node.id}\u0000${node.modified_at}\u0000${editable(node)}`;
  useEffect(() => {
    const next = { ...node, tags: [...node.tags], links: [...node.links] };
    if (base.current.id !== node.id) { base.current = next; setDraft(next); setIncoming(undefined); return; }
    const draftChanged = editable(draft) !== editable(base.current), incomingChanged = editable(next) !== editable(base.current);
    if (draftChanged && incomingChanged && editable(draft) !== editable(next)) setIncoming(next);
    else { base.current = next; setDraft(next); setIncoming(undefined); setShowComparison(false); }
  }, [nodeRevision]);
  const tags = draft.tags; const suggestions = useMemo(() => allTags.filter((tag) => !tags.includes(tag)), [allTags, tags]);
  const setTags = (next: string[]) => setDraft((current) => { const unique = [...new Set(next)]; return { ...current, tags: unique, main_tag: unique.includes(current.main_tag) ? current.main_tag : (unique[0] ?? "uncategorized") }; });
  const addTag = () => { const value = tagId(tagDraft); if (!value) return; setTags([...tags, value]); setTagDraft(""); setAddingTag(false); };
  const acceptIncoming = () => { if (!incoming) return; const next = { ...incoming, tags: [...incoming.tags], links: [...incoming.links] }; base.current = next; setDraft(next); setIncoming(undefined); setShowComparison(false); };
  const keepDraft = () => { if (incoming) base.current = incoming; setIncoming(undefined); setShowComparison(false); };
  return <form className={`node-editor ${compact ? "compact" : ""}`} onSubmit={(event) => { event.preventDefault(); const submittedTags = draft.tags.length ? draft.tags : ["uncategorized"]; onApply({ title: draft.title.trim() || "Untitled node", tags: submittedTags, main_tag: submittedTags.includes(draft.main_tag) ? draft.main_tag : submittedTags[0], summary: draft.summary, rationale: draft.rationale || undefined, links: draft.links }); }}>
    {incoming && <section className="incoming-warning"><strong>Incoming changes</strong><p>This node changed in the project file while this editor contains unsaved work.</p><div className="incoming-actions"><button type="button" onClick={() => setShowComparison((value) => !value)}>{showComparison ? "Hide comparison" : "Compare"}</button><button type="button" onClick={acceptIncoming}>Use incoming</button><button type="button" className="primary" onClick={keepDraft}>Keep my draft</button></div>{showComparison && <div className="incoming-comparison"><section><h4>Current draft</h4><pre>{editable(draft)}</pre></section><section><h4>Incoming file</h4><pre>{editable(incoming)}</pre></section></div>}</section>}
    <label>Title<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
    <section className="tag-editor"><div className="node-editor-label"><span>Tags</span><button type="button" className="tag-add" title="Add tag" onClick={() => setAddingTag((value) => !value)}>+</button></div>
      <div className="tag-list">{tags.map((tag) => <span className={`tag-chip ${tag === draft.main_tag ? "main" : ""}`} key={tag}><button type="button" className="tag-main" title={tag === draft.main_tag ? "Main color tag" : "Use as main color tag"} onClick={() => setDraft({ ...draft, main_tag: tag })}>{tag === draft.main_tag ? "◆" : "◇"}</button><span>{tag}</span><button type="button" className="tag-remove" title={`Remove ${tag}`} onClick={() => setTags(tags.filter((entry) => entry !== tag))}>×</button></span>)}</div>
      {addingTag && <div className="tag-picker"><input autoFocus list={`tag-options-${node.id}`} placeholder="Choose or create a tag" value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addTag(); } }} /><datalist id={`tag-options-${node.id}`}>{suggestions.map((tag) => <option value={tag} key={tag} />)}</datalist><button type="button" onClick={addTag}>Add</button></div>}
      <small>The main tag controls the node color.</small>
    </section>
    <label>Content<FullTextarea value={draft.summary} onChange={(summary) => setDraft({ ...draft, summary })} /></label>
    <label>Why<FullTextarea value={draft.rationale ?? ""} onChange={(rationale) => setDraft({ ...draft, rationale: rationale || undefined })} /></label>
    <div className="node-timestamps"><span>Created <time>{new Date(node.created_at).toLocaleString()}</time></span><span>Modified <time>{new Date(node.modified_at).toLocaleString()}</time></span></div>
    <div className="link-editor"><div className="section-title"><span>Links</span><button type="button" onClick={() => setAddingLink((value) => !value)}>+</button></div>{addingLink && <div className="link-picker"><select value={linkTarget} onChange={(event) => setLinkTarget(event.target.value)}><option value="">Choose a node</option>{allNodes.filter((entry) => entry.id !== node.id).sort((a, b) => a.title.localeCompare(b.title)).map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}</select><input aria-label="Relationship" placeholder="relationship" value={linkRelation} onChange={(event) => setLinkRelation(event.target.value)} /><button type="button" onClick={() => { const relation = tagId(linkRelation) || "related"; if (!linkTarget || draft.links.some((link) => link.target === linkTarget && link.relation === relation)) return; setDraft({ ...draft, links: [...draft.links, { target: linkTarget, relation }] }); setLinkTarget(""); setLinkRelation("related"); setAddingLink(false); }}>Add</button></div>}{draft.links.map((link, index) => <div key={`${link.target}-${index}`}><button type="button" className="link-target" onClick={() => onSelectNode?.(link.target)}>{link.relation} → {allNodes.find((entry) => entry.id === link.target)?.title ?? "Unavailable node"}</button><button type="button" onClick={() => setDraft({ ...draft, links: draft.links.filter((_, item) => item !== index) })}>×</button></div>)}</div>
    <button className="primary" type="submit">Apply changes</button>
  </form>;
}
