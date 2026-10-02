<div align="center">
  <img src="images/NOVA_splash.png" alt="NOVA — Networked Organization & Visualization Assistant" width="820">

  <h3>Your work does not happen in a list.<br>Why should its memory?</h3>

  <p>
    <strong>An automated, AI-assisted work, project, and research protocol.</strong><br>
    NOVA turns the meaningful parts of an evolving project into a living knowledge network.
  </p>

  <p>
    <code>Electron</code> · <code>React</code> · <code>TypeScript</code> · <code>Schema 7</code> · <code>Local JSON</code> · <code>Windows</code>
  </p>
</div>

<img src="images/screenshots/workspace.png" alt="The NOVA workspace showing the knowledge graph, AI Assistant, Inspector, tag filters, and Outline" width="100%">

---

## The anti-notebook

Most project notes become a graveyard of headings: long, linear, increasingly difficult to navigate, and detached from the decisions that created them.

NOVA keeps the *externalized thought process* instead—the questions, decisions, rationale, evidence, experiments, limitations, failures, implementation history, and open work that make a project understandable.

```text
chronological notes                   NOVA
──────────────────                    ────
what happened next?         →         what belongs together?
one document                →         nested concepts + semantic links
manual housekeeping         →         AI-assisted maintenance
search for a sentence       →         navigate the structure
remember the context        →         preserve the rationale
```

The result is not a prettier list. It is a categorized, searchable and filterable network graph. Related work gathers into visible neighborhoods. Important hubs grow. Cross-cutting relationships remain visible. Regions of interest begin to form almost by themselves.

<p align="center">
  <img src="images/screenshots/knowledge-graph.png" alt="A close view of NOVA's linked and categorized knowledge graph" width="640">
</p>

## A protocol that works while you work

NOVA is meant to answer questions ordinary notes cannot answer reliably:

- Why was this architecture or method selected?
- Which alternatives were considered or rejected?
- What evidence supports a finding?
- Which experiment addresses which research question?
- What failed, what superseded it, and what remains unresolved?
- What belongs in implementation, evaluation, discussion, or future work?

The included [`AGENTS.md`](AGENTS.md) gives an IDE-integrated AI agent a durable maintenance contract. While the agent helps with the actual work, it also decides whether the interaction produced meaningful project knowledge. If it did, the agent extends the smallest appropriate part of the map, preserves rationale and provenance, creates useful semantic links, and validates the result. If it did not, the map stays untouched.

That distinction matters: **automatic does not mean indiscriminate**. NOVA is designed to resist transcript dumping, duplicate notes, and ceremonial updates. It records the information needed to reconstruct the work—not every sentence spoken along the way.

## Two ways to use NOVA

### 01 — Standalone

Open a project, explore the graph, edit nodes, search, filter, rearrange the workspace, and use the built-in AI Assistant. OpenAI and FhGenie providers are supported directly in the application. (More will follow.)

API credentials remain outside the project file and renderer. They are **encrypted with Electron's OS-backed secure storage**. Draft, Edit, and Full modes make the assistant's project permissions explicit, giving you the veto right to every change before it is applied.

### 02 — Beside an AI-enabled IDE

This is where NOVA becomes a background memory system for serious work. Keep the project JSON beside the code, research, or documentation. The included agent instructions and deterministic CLI let an IDE agent maintain the map as part of normal work—without asking you to manually curate a second record afterward.

The application watches the open project file, so external agent updates appear in the workspace. The file remains ordinary, portable JSON rather than an opaque database.

## One workspace, several ways into the same knowledge

<table>
  <tr>
    <td width="33%" valign="top">
      <img src="images/screenshots/inspector.png" alt="NOVA Inspector showing a node's tags, content, and rationale" width="100%">
      <br><strong>Knowledge with reasons</strong><br>
      Nodes carry titles, tags, content, rationale, timestamps, children, and semantic links—not just loose text.
    </td>
    <td width="33%" valign="top">
      <img src="images/screenshots/ai-assistant.png" alt="NOVA's built-in project-scoped AI Assistant" width="100%">
      <br><strong>Project-scoped AI</strong><br>
      Work conversationally in Draft, Edit, or Full mode through narrow, validated project operations.
    </td>
    <td width="33%" valign="top">
      <img src="images/screenshots/search.png" alt="NOVA Search showing matching knowledge nodes and their tags" width="100%">
      <br><strong>Find the concept</strong><br>
      Search titles, summaries, and tags; filter the graph inclusively or exclusively; navigate through the Outline.
    </td>
  </tr>
</table>

## What the graph knows

NOVA combines a strict hierarchy with free semantic relationships:

- **Nested nodes** express ownership and strong topic membership.
- **Links** express relationships such as `supports`, `depends-on`, `implements`, `supersedes`, `evaluates`, or `derived-from`.
- **Tags** describe epistemic role and work area: decision, hypothesis, method, result, limitation, implementation, documentation, and more.
- **A main tag** gives every node a stable color identity, while depth shading keeps hierarchy legible.
- **Semantic zoom** reveals the right amount of detail for the current scale.
- **Layout profiles** can emphasize hierarchy or relationships, with optional compact grouping.
- **Collapsed-link bubbling** keeps relationships visible even when their exact endpoints are hidden inside a branch.

The map stores its own view state—expanded branches, node positions, zoom, viewport, filters, and dock layout—so the working context travels with the knowledge.

## Built for durable project memory

| Concern | NOVA's approach |
|---|---|
| Open data | One human-readable JSON project file. |
| Safe writes | Schema validation, atomic replacement, and stale-revision detection. |
| Concurrent work | External-file watching and conflict-aware editor drafts. |
| Stable identity | Collision-checked UUIDs and protected project-root semantics. |
| Automation | A deterministic JSON-in/JSON-out CLI shared with the desktop domain layer. |
| Portability | Project knowledge and workspace state travel together; machine-local paths and credentials do not. |
| Focus | The maintenance contract records meaningful knowledge and rejects conversational bloat. |

## Get NOVA

NOVA currently targets Windows.

### Pre-built — Windows

Download the current x64 installer from **[GitHub Releases](https://github.com/GrafKnusprig/nova/releases/latest)** and run `NOVA-<version>-x64.exe`.

The installer contains the complete desktop application. Node.js, Python, and a separate backend are not required to use it. Bring an existing schema-7 project JSON or start a new knowledge map from the application.

### Self-built

Install the dependencies and start the development application:

```powershell
npm ci
npm run dev
```

Build the renderer and Electron main/preload processes:

```powershell
npm run build
```

Create the Windows x64 installer yourself:

```powershell
npm run package
```

The packaged installer is written to `dist/NOVA-<version>-x64.exe`.

## Let an agent maintain a project

Keep [`AGENTS.md`](AGENTS.md) next to the project file so a compatible IDE agent can discover the schema and maintenance policy. Every CLI command operates on the explicit path you provide—the project filename is yours to choose.

```powershell
NOVA-CLI.exe validate --project .\my-research-project.nova
NOVA-CLI.exe audit --project .\my-research-project.nova
NOVA-CLI.exe list --project .\my-research-project.nova
NOVA-CLI.exe get --project .\my-research-project.nova --id <node-id>
NOVA-CLI.exe migrate --project .\legacy-project.json --to .\my-research-project.nova
NOVA-CLI.exe export --project .\my-research-project.nova --to .\my-research-project.json
```

`NOVA-CLI.exe` is the installer's headless automation sidecar: it does not initialize Electron or Chromium and remains independent of `ELECTRON_RUN_AS_NODE`. `NOVA.exe cli ...` remains available for compatibility in normal desktop environments. The desktop app opens and saves `.nova` databases. Use **File > Import JSON** to migrate a schema-6 or schema-7 `.json` project into a new database; schema 6 is upgraded in memory, the source stays unchanged, and an existing database is never overwritten. Use **File > Export JSON** for a portable copy. The CLI also supports search and bounded context retrieval, project creation, node creation and updates, moves, deletion, semantic links, LLM context, project instructions, and custom tag definitions. Every operation validates before and after mutation and emits machine-readable JSON.

The installer sets the per-user `NOVA_CLI` environment variable to the sidecar's absolute path. New agent or terminal processes can therefore invoke it in PowerShell as `& $env:NOVA_CLI validate --project .\my-research-project.nova` without knowing NOVA's installation directory.

The installer also places the canonical `AGENTS.md` beside `NOVA.exe`. Creating a project in NOVA or with `NOVA-CLI.exe init` copies that guidance into the new project directory. For existing projects, **File → Init AGENTS.md in Project** replaces the project-local file with the installed version.

### Cached agent retrieval

The headless CLI automatically reuses a local worker for an existing `.nova` project. Agents keep using ordinary `context`, `search`, `get`, and mutation commands; no session setup or teardown is needed. The worker keeps a validated immutable map snapshot, category and node directories, normalized original text with ancestor-title context, incoming/outgoing link indexes, and bounded query caches. Only selected records and context packs are serialized for output. Whole-map loading, validation and revision serialization happen once on startup and again after a database change, rather than on every read.

Before each read, the worker checks file identity and SQLite's connection-local `data_version` inside a request-scoped read transaction. It refreshes the snapshot after desktop or other-process commits, and reopens a replaced database. A request sees one consistent snapshot. Writes retain the existing transactional mutation implementation; they trigger a refresh before the next cached read. The first version rebuilds the cache after a change, rather than tracking individual changed rows. Memory therefore scales with map content; it is not a summary-only cache.

Workers exit after five minutes with no pending requests. Set `NOVA_CLI_IDLE_MS` to change this timeout. `worker-status --project FILE.nova` reports the worker PID, cache generation, reload count and timeout; `worker-stop --project FILE.nova` closes it after queued work. These are optional diagnostics. `NOVA_CLI_WORKER=0` uses direct execution for troubleshooting. `NOVA_CLI_REQUIRE_WORKER=1` makes worker startup failures explicit; ordinary commands otherwise fall back to direct execution if startup fails before submission. A submitted mutation is never automatically retried after an interrupted response. Source and bundle fingerprints keep incompatible workers separate. JSON projects, creation/import/migration, and the legacy `NOVA.exe cli` path remain direct.

Project guidance stays in root `llm_context`. Optional node `agent_guidance` contains `{ summary, instructions[] }` and applies to that node and its descendants. Manage it with `context-set --id ID`, `instruction-add --id ID`, `instruction-remove --id ID`, and `context-get --id ID`. Context packs list applicable scopes explicitly, including scopes for returned cross-category records. Project instructions always apply; topic instructions supplement them and conflicts should be reported. Mandatory instructions and exact duplicate candidates can exceed a requested context budget and are never silently discarded. Omitted IDs are capped at 50, with total counts and a truncation flag. Summaries orient the agent; original text remains searchable and original records remain available by stable ID.

This implements deterministic context retrieval with hierarchy metadata and FTS5, without external embedding calls or generated LLM digests. The integrated desktop assistant currently calls project helpers directly rather than invoking the CLI, so it does not yet use the retained worker or these context tools. Its integration is separate future work. The shared retrieval and storage modules can support that integration.

### CLI performance troubleshooting

Use a Node runtime with `node:sqlite` and FTS5 support (the packaged CLI uses Node 22). Generate a separate synthetic database through the CLI; an existing destination is never overwritten. Node counts include the root. The seed reproduces IDs and content. `--branching` controls hierarchy breadth, `--summary-chars` controls text volume, and `--links-per-node` controls semantic link density. Fixtures contain explicitly synthetic methods and do not modify the active knowledge map.

```powershell
NOVA-CLI.exe benchmark-generate --project benchmark-300.nova --nodes 300 --branching 6 --summary-chars 1000 --links-per-node 2 --seed 42
npm run benchmark:cli -- --sizes 300,1000,10000 --repeats 5
```

The benchmark builds a portable Node bundle, creates fixtures in a fresh `out/benchmarks/<timestamp>` directory, and saves raw samples, machine details, median/p95 timings, and phase timings in `report.json`. It measures `context-get`, leaf `get`, `search`, `context`, and real `update` operations. Options include `--warmups`, `--out-dir`, and the generator dimensions above. `--include-npm` measures direct `npm run cli`; `--include-worker` measures the bundled client over IPC and stops its workers afterward. The output directory must not already exist. Run on the affected machine; the portable bundle is not the Windows packaged executable.

Default modes are a fresh direct bundled process, a fresh direct source process using `node --import tsx`, repeated direct calls within one process (`warm`), and repeated calls with a retained connection and snapshot (`cached`). Warm mode still reloads the graph; cached mode excludes initial cache filling through warmup and measures reuse. Fresh runs use the operating system's normal file cache, not a cold disk cache. Profiling has overhead; with five samples p95 is the maximum. In-process modes count serialized output bytes but discard output, whereas fresh client modes capture output through a pipe. A repeated query benefits from query caches; use different queries and writes to assess misses and invalidation costs. npm/tsx startup overhead still exists with the npm launcher; use the packaged headless client for a lightweight invocation.

Set `NOVA_CLI_PROFILE=1` to profile an ordinary CLI call, including a call on the affected real project. Result JSON stays on stdout; one timing record is emitted on stderr. Timings distinguish connection opening, node/link queries, document loading, validation, revision JSON, FTS queries, mutation cloning/diff application, and output serialization/enqueue. `sqlite.load-document` includes queries and validation: do not add overlapping phases. Internal timing starts after module imports; compare it with elapsed process time to estimate launcher/import/exit overhead. It does not measure agent tool scheduling or context ingestion.

The local worker manages its lifetime through the idle timeout and signal cleanup. Connection reuse, snapshot reuse and prepared context indexes address separate costs; mutation work and agent tool scheduling are separate from cached reads. Profile cache fills and unchanged reads separately.

## The short version

> NOVA is a memory layer for work that has structure.

Use it for software projects, research, theses, investigations, product development, long-running creative work—anything where the path, evidence, and reasoning matter as much as the final artifact.

Instead of writing the retrospective at the end, let the project explain itself while it grows.

---

<div align="center">
  <img src="images/NOVA_icon.png" alt="NOVA icon" width="96">
  <br>
  <strong>NOVA</strong><br>
  <sub>Networked Organization &amp; Visualization Assistant</sub><br><br>
  Created by <a href="https://philippraven.com">Philipp Unger</a>
</div>
