<div align="center">
  <img src="images/NOVA_splash.png" alt="NOVA — Networked Organization & Visualization Assistant" width="820">

  <h3>Connected knowledge for projects, work, and research.</h3>

  <p>
    NOVA preserves the questions, decisions, evidence, and rationale behind an evolving project.<br>
    Explore the knowledge graph, maintain it yourself, or work with an AI assistant.
  </p>

  <p>
    <code>Windows</code> · <code>Local SQLite</code> · <code>.nova projects</code> · <code>JSON backups</code> · <code>Electron</code> · <code>React</code> · <code>TypeScript</code>
  </p>
</div>

<img src="images/screenshots/workspace.png" alt="The NOVA workspace with the knowledge graph, AI Assistant, Inspector, tag filters, and Outline" width="100%">

## What NOVA keeps

A NOVA project is a semantic knowledge map. Nodes capture questions, methods, decisions, observations, experiments, results, limitations, and future work. Each node can include its reason, supporting evidence, and links to related knowledge.

This structure helps answer:

- Why was an architecture or method selected?
- Which alternatives were considered or rejected?
- What evidence supports a finding?
- Which experiment addresses a research question?
- What failed, what superseded it, and what remains unresolved?

Use NOVA for software projects, research, theses, investigations, and other work whose reasoning needs to remain understandable over time.

<p align="center">
  <img src="images/screenshots/knowledge-graph.png" alt="NOVA's hierarchical knowledge graph with semantic links" width="640">
</p>

## Install on Windows

Find Windows installers on [GitHub Releases](https://github.com/GrafKnusprig/nova/releases). Run the x64 installer named `NOVA-<version>-x64.exe`.

The installer includes the desktop app, the headless `NOVA-CLI.exe`, and the agent instructions. Using the installed app does not require a separate Node.js or Python installation. An API key and a provider connection are needed only for the built-in AI Assistant; manual editing and the CLI work locally.

To start a project:

1. Choose **File > New** and select a `.nova` database location.
2. Give the project root a name and description, then add main topics and child nodes.
3. Use **File > Open** to reopen an existing `.nova` project. Changes are saved automatically; **File > Save now** saves pending changes immediately.

## Projects and backups

**The `.nova` database is the active project. JSON is the portable backup format.** Knowledge, semantic links, guidance, and workspace state are stored together in the project database. SQLite may create temporary WAL sidecars while the project is open.

| Action | Desktop command |
|---|---|
| Create a project | File > New |
| Open a project | File > Open |
| Save a separate database copy | File > Save As |
| Create a JSON backup | File > Export JSON |
| Restore a JSON backup into a new `.nova` database | File > Import JSON |

Import keeps the backup unchanged and refuses to overwrite an existing database. Keep maintaining the restored `.nova` project through the app or CLI. Use the export/import commands for portable backups rather than editing a JSON copy alongside the active project.

## Explore and edit the graph

NOVA combines a hierarchy with semantic cross-links:

- **Nested nodes** express ownership and strong topic membership.
- **Links** express relationships such as `supports`, `depends-on`, `implements`, `supersedes`, `evaluates`, and `derived-from`.
- **Tags** describe the kind of knowledge and its work area. A node's main tag determines its color.
- **Content and Why fields** preserve the knowledge and its rationale.
- **Semantic zoom and layout options** help navigate large maps. Layouts can emphasize hierarchy or relationships, with optional compact grouping.

The dockable workspace includes Graph, Outline, Search, Inspector, AI Assistant, and Activity panels. Rearrange or pop out panels, and reopen them through **View > Panels**. Individual nodes can also have separate Node Property panels. Search and tag filters help narrow the visible knowledge. Saved workspace state includes expanded branches, positions, zoom, filters, and panel arrangement.

External CLI edits appear in the open desktop project. An editor with an unsaved draft offers a comparison when incoming content changes. The Graph panel's **Live** option reveals branches containing incoming new or updated nodes.

<table>
  <tr>
    <td width="33%" valign="top">
      <img src="images/screenshots/inspector.png" alt="Inspector with node tags, content, and rationale" width="100%">
      <br><strong>Knowledge with reasons</strong><br>
      Edit content, rationale, tags, and semantic links.
    </td>
    <td width="33%" valign="top">
      <img src="images/screenshots/ai-assistant.png" alt="NOVA's project-scoped AI Assistant" width="100%">
      <br><strong>Project-scoped AI</strong><br>
      Discuss knowledge or integrate notes with explicit write permissions.
    </td>
    <td width="33%" valign="top">
      <img src="images/screenshots/search.png" alt="Search results for knowledge nodes" width="100%">
      <br><strong>Find relevant knowledge</strong><br>
      Search, filter by tags, and navigate the Outline.
    </td>
  </tr>
</table>

## Built-in AI Assistant

Open the **AI Assistant** panel, select **OpenAI** or **FhGenie**, save the provider's API key, and choose an available model. Keys are encrypted using Electron's operating-system-backed secure storage and kept outside project files.

Project storage stays local. Using the assistant sends your messages and the project context needed for its tools to the selected provider.

The assistant has two input modes:

- **Chat:** ask questions, discuss decisions, and request project work. Choose Default or Professional response style.
- **Add note:** submit information to integrate into existing knowledge, including possible updates and semantic links. Draft permission previews the proposed changes.

Write permissions are enforced by the app:

| Permission | Available actions |
|---|---|
| Draft | Read, discuss, and propose changes. No project writing under Draft permissions. |
| Edit | Create and update nodes and links. No node deletion. |
| Full | Create, update, link, and permanently delete nodes. |

Edit and Full can apply permitted changes directly. Chat can request approval for a one-task permission increase when necessary. Use Draft when you want a preview. Chat and Add note submissions are queued, with each response kept beside its originating message.

The built-in assistant operates through project tools inside the desktop app. It currently uses its own overview, search, and node-reading tools; the CLI context-pack and retained-cache integration described below applies to external IDE agents. Bringing that integration to the desktop assistant is tracked as [open work](TODO.md#desktop-assistant-contextual-retrieval-and-cache-integration).

## Use NOVA beside an AI-enabled IDE

Keep the `.nova` project and [`AGENTS.md`](AGENTS.md) beside your code, research, or documentation. A compatible agent reads the instructions, gathers relevant knowledge, performs the task, and maintains meaningful project knowledge as part of its work.

The instructions require evidence, rationale, stable identities, duplicate checks, and useful relationships. They direct agents to reuse existing nodes and record meaningful findings rather than append a conversation transcript. After a related batch of map changes, the agent reviews `audit` findings and runs `validate`.

Creating a project in the desktop app or CLI copies the installed `AGENTS.md` into its directory. **File > Init AGENTS.md in Project** does the same for an existing project. Both operations replace an existing file at that location, so preserve any custom instructions you want to retain.

### Start with contextual retrieval

The agent should begin with one task-specific `context` call. The resulting pack includes project guidance, a category index, relevant original node content, paths, semantic neighbors, and applicable topic instructions. Reuse that information; further `search` or `get` calls are needed only when relevant detail is missing or the question needs wider coverage.

The Windows installer sets the per-user `NOVA_CLI` environment variable to the headless CLI's path. Start a new terminal or agent process after installation so it sees the variable:

```powershell
& $env:NOVA_CLI context --project .\my-project.nova --query "Review the storage design and its limitations"

# Fetch additional detail when needed.
& $env:NOVA_CLI search --project .\my-project.nova --query "Cache invalidation"
& $env:NOVA_CLI get --project .\my-project.nova --id "<node-id>"
```

You can also invoke the installed executable by its full path, or use `& ".\NOVA-CLI.exe"` from its directory. The CLI does not initialize Electron or Chromium. Each project command receives an explicit `--project` path and returns JSON; failures return a nonzero exit code and a JSON error on stderr. `help` returns plain-text usage.

For a focused pack, add `--category "<category-id>" --token-budget 6000`. For broad synthesis, use `--scope all --token-budget 16000`. Packs report omissions when content does not fit. Required guidance and exact duplicate candidates can exceed the requested budget. Exact ID and normalized-title matches remain visible across categories; a missing match does not establish global novelty. `get` returns a node subtree, while ancestor paths are supplied by `context` and `search`.

Root `llm_context` stores project instructions. Optional node `agent_guidance` adds instructions scoped to that node and its descendants. Use `context-get`, `context-set`, `instruction-add`, and `instruction-remove`, with `--id` for node guidance. See [AGENTS.md](AGENTS.md) and CLI help for the mutation commands and full maintenance contract.

### Automatic caching and fresh reads

The headless CLI automatically starts or reuses a local worker for an existing `.nova` project. It retains the database connection, validated knowledge, prepared retrieval indexes, and bounded query caches. Agents issue ordinary commands and do not open or close sessions.

Edits return after the database transaction commits. Context preparation follows in a separate helper, reusing unchanged derived data. External changes also trigger background preparation while the worker is idle. **Every read verifies freshness and waits if the cache has not caught up.** Outdated rebuild results are rejected. A read sees a consistent snapshot; changes committed after that snapshot is pinned are observed by the next read.

The worker exits after five idle minutes and starts again when needed. `worker-status` and `worker-stop` are optional diagnostics. This retrieval uses original content, hierarchy metadata, and SQLite FTS5; it does not require embeddings or a model call to prepare context. Database writes still perform validation and transactional work. Cache reuse improves individual reads; fewer tool calls can also reduce agent overhead, but end-to-end savings depend on the agent workflow.

SQLite transactions protect storage consistency. Ordinary CLI updates do not compare an agent's earlier retrieved revision. If you learn that another writer changed facts your decision depends on, retrieve those records and reconsider the edit.

### Back up and validate from the CLI

```powershell
& $env:NOVA_CLI export --project .\my-project.nova --to .\my-project-backup.json
& $env:NOVA_CLI import --project .\restored-project.nova --from .\my-project-backup.json
& $env:NOVA_CLI audit --project .\my-project.nova
& $env:NOVA_CLI validate --project .\my-project.nova
```

Import creates a new database. Export refuses to overwrite an existing backup unless `--overwrite` is explicit. `audit` reports knowledge-quality review candidates; it does not modify the project.

## Build from source on Windows

Use Node.js 22 with `node:sqlite` and SQLite FTS5 support, npm, and a local checkout. The build and packaging scripts target Windows.

```powershell
npm ci
npm run dev
```

Additional commands:

| Command | Purpose |
|---|---|
| `npm run typecheck` | Check main, preload, and renderer TypeScript. |
| `npm test` | Run model, project, assistant, retrieval, and worker tests. |
| `npm run build` | Build the renderer and Electron main/preload code; copy agent instructions. |
| `npm run build:cli` | Build the headless Windows CLI using the current Node runtime. |
| `npm run test:packaged-cli` | Check the packaged CLI; defaults to `dist/win-unpacked/NOVA-CLI.exe`. |
| `npm run package` | Build the app and CLI, then create the Windows installer. |

The CLI executable is written to `out/cli/NOVA-CLI.exe`; the installer is written to `dist/NOVA-<version>-x64.exe`. Packaging embeds the Node runtime used to run the build. To test a standalone CLI build, use `npm run test:packaged-cli -- .\out\cli\NOVA-CLI.exe`. For source CLI work, use `npm.cmd run cli -- <command> --project .\my-project.nova`.

### Performance troubleshooting

Generate a separate synthetic database or run the benchmark against generated fixtures:

```powershell
& $env:NOVA_CLI benchmark-generate --project .\benchmark-300.nova --nodes 300 --branching 6 --summary-chars 1000 --links-per-node 2 --seed 42
npm run benchmark:cli -- --sizes 300,10000 --repeats 5 --include-refresh
```

The generator refuses existing destinations. Its seed reproduces IDs and content; node counts include the root. The benchmark builds a portable Node bundle and records samples, median/p95 timings, machine details, and phase timings in a fresh `out/benchmarks/<timestamp>/report.json`. It measures direct processes, reused processes, retained caches, and, with `--include-refresh`, the actual worker client and edit-followed-by-read scenarios. `--idle-gap-ms` controls the deliberate gap after an edit (default 1000 ms); that gap is excluded from measured edit/read latency.

Other options include `--include-worker`, `--include-npm`, `--warmups`, and `--out-dir`. Repeated queries benefit from caches; warmups exclude initial fills, and OS caches are not cleared. Portable bundled results do not establish packaged Windows or real-agent response times. With five samples, p95 is the maximum.

For an ordinary CLI call, set `$env:NOVA_CLI_PROFILE = "1"` to emit a timing record on stderr alongside normal result JSON on stdout. Timings include a read's `cache.ensure-current` phase. Phases can overlap, so do not add them together. Profiling excludes agent scheduling and context ingestion; `npm.cmd run cli` also retains npm/tsx launcher overhead.

Optional worker settings are `NOVA_CLI_IDLE_MS` (idle timeout at startup), `NOVA_CLI_WORKER=0` (direct execution), and `NOVA_CLI_REQUIRE_WORKER=1` (make worker startup failures explicit). A submitted mutation is never automatically replayed after an interrupted response.

---

<div align="center">
  <img src="images/NOVA_icon.png" alt="NOVA icon" width="96">
  <br>
  <strong>NOVA</strong><br>
  <sub>Networked Organization &amp; Visualization Assistant</sub><br><br>
  Created by <a href="https://philippraven.com">Philipp Unger</a>
</div>
