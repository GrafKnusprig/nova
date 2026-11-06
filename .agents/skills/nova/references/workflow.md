# Persistent Project Knowledge Map

## IDE-agent task workflow and retrieval

This skill defines the NOVA scientific knowledge workflow. The single `*.nova` file
directly in the current project root is the authoritative source for NOVA
project knowledge. Discover it by extension; do not assume a filename or search
subdirectories. If there are no matches or multiple matches, stop NOVA operations
and report the missing or ambiguous database; do not choose one or create a
replacement automatically. JSON files are portable backups, not active projects.
Resolve the database to an absolute path and use that path for `--project`.
For example, in PowerShell from the project root:

```powershell
$novaFiles = @(Get-ChildItem -LiteralPath . -Filter '*.nova' -File -Force)
if ($novaFiles.Count -ne 1) {
    throw "Expected exactly one .nova file in the project root; found $($novaFiles.Count)."
}
$novaProject = $novaFiles[0].FullName
```

Do not load the complete map by default.
For non-trivial NOVA tasks, request a compact, task-specific context pack first:

```text
& $env:NOVA_CLI context --project $novaProject --query "task description"
```

The context pack includes project
identity, root `llm_context` guidance, and a compact category index, then ranks
relevant node excerpts. Use its category ID to narrow detail retrieval when
useful:

```text
& $env:NOVA_CLI context --project $novaProject --query "task description" --category CATEGORY_ID --token-budget 6000
& $env:NOVA_CLI context --project $novaProject --query "architecture-wide task" --scope all --token-budget 16000
& $env:NOVA_CLI search --project $novaProject --query "paper DOI or method name"
& $env:NOVA_CLI get --project $novaProject --id NODE_ID
```

Use the context pack as the initial working context. It already includes root
guidance, category orientation, relevant original node content, paths and links.
Do not automatically follow it with `context-get`, `list`, `search`, or `get`
for information already supplied. Request further reads only for missing or
omitted detail, unresolved identity, or a wider question. Use a focused query
or category to fill the specific gap; avoid repeatedly requesting the full map.

Category selection is a starting point, not a boundary. Before creating a node,
check globally for its exact ID or normalized proposed title and inspect
plausible existing matches. A prior context/search result can satisfy this check
when its query covers that identity; otherwise issue a focused global search.
Exact matches outside the selected category must remain visible. Reuse original
candidate content already included in the context pack; use `get --id ID` when
you need the complete record or subtree. Ancestor paths come from `context` or
`search`; `get` returns the node and its descendants with their semantic links,
without an ancestor path. If the map has no match, say that it was not found in
the map; absence is not evidence of global novelty. Inspect repository code
separately, and inspect or request the paper when its identity or method is
unclear.

For paper-based implementation tasks, check source, method, implementation,
decision, experiment, result, and limitation knowledge before coding. Report
what is already implemented, attempted, or evaluated and what evidence is
missing. Keep source, method, implementation, experiment, result, and
interpretation as distinct knowledge where applicable. Never infer an
experiment or result from an implementation record. Reuse/update existing
nodes by ID, create only genuinely new project knowledge, link related topics,
and ask when identity or scope uncertainty would change the implementation.

For an existing `.nova` project, the headless CLI manages a local cached worker automatically. Continue issuing normal commands; agents do not need to open or close a session. Edits return after the database commit; context preparation then runs in a helper. The worker also checks for external changes while idle. Every read verifies freshness and waits if preparation has not caught up. It exits after an idle timeout. Optional `worker-status` and `worker-stop` are diagnostics, not required workflow steps.

Before staging or committing a `.nova` file in version control, finish the
intended database edits and run:

```powershell
& $env:NOVA_CLI checkpoint-for-version-control --project $novaProject
```

Require a successful exit before staging the `.nova` file. This command runs
after earlier requests in the worker queue and checkpoints committed SQLite
WAL changes into the main database file, even while the worker remains running.
It also works without a worker. A busy or incomplete checkpoint returns a
nonzero exit code; finish other database activity and retry. Do not delete WAL
or SHM sidecars manually or stage them in version control. Avoid concurrent
writes between checkpointing and staging; rerun the command after further
edits. The command does not save unsaved desktop edits or run Git commands.

Root `llm_context` instructions always apply. Nodes may additionally contain `agent_guidance` with a `summary` and `instructions[]`, scoped to that node and its descendants. Context packs return relevant scopes in `guidance.topic_guidance`, including scopes for returned cross-category records. Preserve instruction text; report conflicting guidance rather than silently overriding project rules. Use `context-get --id ID`, `context-set --id ID`, and `instruction-add`/`instruction-remove --id ID` to maintain node guidance. Category overviews are navigation aids; inspect original candidate content before updating or declaring information new. Original content already returned in a context pack can satisfy this requirement; fetch missing detail only when needed. Context omission IDs may be truncated to 50; `omitted_node_count` and `omitted_ids_truncated` report the full extent of omissions.

Use the CLI for project reads and mutations; do not inspect or modify the
underlying storage directly. Pass the active project path through `--project`.
After completing a batch of related map mutations, run `audit`, review findings
about touched nodes, then run `validate`. Do not repeat these checks after each
individual mutation unless a failure or unresolved finding requires it.

Write project knowledge in professional scientific language. Do not add emoji
or decorative symbols to node titles, summaries, rationales, or guidance.
Unicode text, including emoji supplied by the user or already present in the
map, is valid project content: preserve it when relevant and do not reject or
rewrite a project because it contains such characters.

Active projects use SQLite `.nova` databases. JSON is used for portable backups:
`export --project project.nova --to backup.json` creates a backup;
`import --project restored.nova --from backup.json` restores it into a new
`.nova` database. Import leaves the backup unchanged and refuses an existing
destination. Export refuses to overwrite a backup unless `--overwrite` is
explicit. Do not edit or maintain the JSON backup as an active project.
The `.nova` file is the project database; SQLite may use transient WAL sidecars
while it is open. Agents must use the CLI and must never access SQLite directly.
In the desktop app, Open, New, Save, and Save As use `.nova` databases.
File > Export JSON creates a portable backup; File > Import JSON restores a
backup into a new `.nova` file.

## Purpose and required workflow

Use the database resolved by the discovery rule above; its filename is not fixed.
Commands always operate on the path passed with `--project`. It is a scientific
knowledge graph. Its content must
explain research questions, methods, research-relevant decisions, experiments,
evidence, findings, limitations, rejected alternatives, and future research.
Retain implementation details only when needed to understand or reproduce that
knowledge. Development activity belongs in code, tests, run records, or version
control, not in the map.

For each task using this skill:

1. Perform the requested work.
2. Apply the scientific admission rules below. If no qualifying knowledge was
   produced, make no map mutation. Routine coding interactions normally end here.
3. If knowledge qualifies, inspect relevant existing nodes and the root
   `llm_context` before changing the map.
4. Extend the smallest appropriate existing node or create a non-duplicate node.
   Integrate the claim into a self-contained summary; do not append an update
   log. Place it semantically and add useful cross-links.
5. Preserve research-relevant rationale, provenance, evidence, alternatives, and
   epistemic status. Ask one concise question if an important rationale is
   materially uncertain. Apply the date rule below.
6. Use the project CLI for mutations. After the related mutation batch, run
   `audit`, review every finding involving a node you touched, then run
   `validate`. Do not rewrite the whole file unnecessarily.

Maintain qualifying knowledge without waiting for an explicit request. This
does not require a mutation after every interaction or a completion-log node.

## Project format

This instruction file describes schema 7. The packaged executable and its
`validate` command are authoritative for format compatibility. Treat `version`,
`viewer_version`, generated IDs, timestamps, and presentation state as
application-managed metadata. Do not reinterpret them as research evidence or
manually migrate an unsupported project.

## How to read the map

Schema 7 has one protected project-root node. Its `title` and `summary` are the
project name and description; its direct children are main topics. Every node
recursively contains complete child records in `children`. There are no stored
`parent` or `items` fields.

Nesting expresses the strong parent/child hierarchy. `links` express semantic
cross-references and never duplicate the parent relation. `llm_context` contains
project-specific interpretation instructions and custom tag meanings. `view`
contains presentation state and normally has no bearing on project knowledge.

Conceptual shape:

```text
document
|- version, viewer_version
|- project.root_node_id
|- llm_context { summary, instructions[], tag_definitions{} }
|- nodes[ exactly one project root ]
|  `- node { id, title, tags[], main_tag, summary, rationale?,
|            created_at, modified_at, children[], links[] }
`- view { application-managed presentation state }

link { target, relation }
```
