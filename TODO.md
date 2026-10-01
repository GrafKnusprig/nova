# Open TODOs, issues and ideas

## Future work / ideas

- License under MIT and obtain an application signing certificate.
- Establish a GitHub build pipeline with a SignPath Foundation code-signing certificate.

### Local offline project storage and assistant context

**Status:** Implementation is in progress on `feature/sqlite-agent-context`. JSON remains supported for compatibility. The goal is one SQLite `.nova` database as the active local project, with the CLI as the agent-facing storage boundary. SQLite WAL permits concurrent readers and one writer at a time; competing writes must serialize or return a clear conflict.

Use one SQLite database per project as authoritative local storage and retain JSON as portable import/export. CortexaDB is a local retrieval engine, not an agent context manager or LLM. Its `add` inserts unconditionally and it does not deduplicate or update existing knowledge. Its vector search and outgoing-edge expansion do not supply NOVA's persistent research instructions, global duplicate checks, category-aware context packing, or map-writing policy. Use CortexaDB as a design reference, not a direct dependency. Start with SQLite FTS5 and deterministic graph retrieval; consider local embeddings only if measured recall requires them. References: [CortexaDB](https://github.com/anaslimem/CortexaDB), [SQLite WAL](https://www.sqlite.org/wal.html), [SQLite-Memory](https://github.com/sqliteai/sqlite-memory), and [mcp-memory-sqlite](https://github.com/spences10/mcp-memory-sqlite).

#### Implemented in the current branch

- Added a versioned SQLite `.nova` schema with normalized node hierarchy, ordered semantic links, project context, view state, unknown node-field preservation, foreign keys, WAL, a busy timeout, and FTS5 indexes.
- Routed shared project read/write/create and mutation APIs through `.nova` while retaining schema-7 JSON support. CLI mutations compare the current document under a write lock and apply transactional row-level changes. GUI snapshot saves remain transactional and reject stale revisions.
- Added `migrate`, `import`, `export`, and `migration-status`. Schema-7 JSON imports directly; schema-6 JSON is upgraded in memory without rewriting the source. Migration preserves existing node IDs and map state, refuses an existing destination, and leaves the source intact. Export refuses overwrite unless `--overwrite` is passed.
- Added desktop File > Import JSON and File > Export JSON flows. Normal Open/New/Save As dialogs are restricted to `.nova`; startup offers migration for a remembered legacy JSON path and automatically prefers an existing sibling `.nova` database. Import errors show the schema or validation failure.
- Added FTS5 candidate ranking for `.nova` `search` and `context`, retaining global exact ID and normalized-title checks, category indexes, hierarchy/link neighborhood, mandatory project guidance, and explicit context-pack truncation. `context --scope all` includes the complete map when it fits its budget. Token sizing remains an approximate character-based estimate.
- Wired Electron open/new/save, remembered project paths, SQLite external-change polling, and assistant document access to the shared project API. The renderer still sends full-document snapshots, but SQLite now diffs them under the write lock and persists only changed node/link/context/view rows. Loading and IPC still reconstruct/send the full graph.
- Updated `AGENTS.md` with `.nova` support, the migration workflow, agent retrieval/write policy, and the rule against direct database access. Map validation enforces the project's plain-ASCII storage rule, including rejecting emoji.

#### Remaining implementation and review

1. **Reduce renderer transfer and read costs.** Replace full-document load/IPC where beneficial with focused reads while preserving graph rendering, undo/redo, view state, cross-links, and stale-write behavior. SQLite writes now apply diffs; confirm connections close cleanly and document transient WAL sidecars.
2. **Complete migration safeguards.** Add a non-mutating dry-run report with source and destination counts, IDs, hierarchy, and link verification. Improve interrupted-import recovery and backup/restore guidance. Migration must continue to leave the source JSON unchanged and refuse an existing destination.
3. **Audit CLI semantics.** Keep `id` as a documented non-reserving UUID candidate for scripts, while preferring `create` because it returns the persisted ID. Document `list` as compact navigation and `get` as subtree retrieval. `export` provides the portable backup workflow; add a separate backup command only if it has a distinct need. Keep delete explicit and all commands headless with JSON output and nonzero errors.
4. **Improve retrieval efficiency and quality.** Avoid loading the entire graph for bounded `.nova` queries; retrieve candidates, ancestors, descendants, and inbound/outbound links through indexed queries. Exact global IDs and normalized titles must remain visible even under a category filter. Consider a configured tokenizer and local semantic retrieval only after measuring recall on realistic maps. Category selection is a starting point, not a boundary.
5. **Document packaged runtime compatibility.** Confirm `node:sqlite` and FTS5 in the packaged Electron and CLI runtime without native addon packaging. Document `.nova` location, migration/export, JSON compatibility, backup/restore, WAL sidecars, and conflict behavior. Keep initialized project-local `AGENTS.md` synchronized with the canonical file.
6. **Verify before release.** Check import/export fidelity, constraints, non-ASCII rejection, duplicate retrieval, context truncation, concurrent GUI/CLI access, migration failure handling, and packaged CLI access. Add regression tests for these cases when verification is authorized.

#### Paper-method task workflow

Read `AGENTS.md` and mandatory project guidance first. Identify the paper by DOI/title/authors; search globally for the source, method, and aliases; retrieve likely source, method, implementation, and decision nodes; check repository code separately; and inspect linked experiment/result/finding records. Report whether NOVA has a matching paper or method, what is implemented or attempted, what was evaluated, and where evidence is recorded. A map miss is not global novelty. Reuse stable IDs, distinguish source/method/implementation/results, link across categories, and record experiments/results only when performed. Ask only when paper identity or scope uncertainty would change the work.
