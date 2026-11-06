# Persistent Project Knowledge Map

## IDE-agent task workflow and retrieval

`AGENTS.md` defines how to work in this repository. The single `*.nova` file
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

The IDE reads this `AGENTS.md` separately. The context pack includes project
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

For every interaction:

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

## Knowledge quality and research integrity

Apply these admission and structure rules strictly:

- **Scientific admission test:** Every new or revised claim must explain a
  research question, method, hypothesis, research-relevant decision, experiment,
  result, interpretation, limitation, or future research task. State its connection
  to the research. A technical fact, user request, or epistemic tag alone does
  not establish eligibility. These criteria govern every capture instruction
  in this file, including instructions about implementation and maintenance.
- **Implementation boundary:** Retain an algorithmic rule, data constraint,
  measurement definition, or design tradeoff when it affects scientific
  correctness, interpretation, reproducibility, or research feasibility.
  Describe the rule or constraint and its scientific consequence, rather than
  the work performed. For example, a memory measurement's scope affects the
  interpretation of a benchmark; resizing its inspector dialog does not.
  Exclude routine UI changes, refactors, bug-fix reports, feature inventories,
  source-code walkthroughs, and implementation chronology.
- **No activity logs:** Do not create development-protocol or completion nodes,
  or insert activity logs into existing nodes. Routine verification details
  such as test-pass lists, test counts, browser clicks, dialog dimensions,
  commands executed, and "initial/final/latest verification" updates belong
  outside the map. Appending these details to a scientific node does not make
  them scientific knowledge. A scientific experimental protocol qualifies as
  a method when it passes the admission test.
- **Research evidence boundary:** A routine software check is not a research
  result. Retain validation evidence only when it addresses an explicit
  scientific question or a research-relevant validity claim, with the relevant
  conditions, outcome, and limitations. Keep exhaustive test reports outside
  the map and reference them only if necessary as provenance.
- **Date rule:** Creation and modification times are application metadata, not
  summary text. Include a date in content only when it identifies a source,
  experimental condition, or event whose timing matters to the research claim.
  Do not date-stamp development updates.
- **Artifact rule:** Mention files only as provenance within the scientific node
  they support; do not create nodes whose main purpose is cataloguing artifacts.
- **Atomic nodes:** When distinct claims exist, keep methods, results,
  interpretations, and limitations in separate nodes instead of combining them
  in one summary.
- **Duplicate check:** Search existing nodes before creating one. Extend or link
  an existing node when it already represents the knowledge.
- **Relationship requirement:** A new research node should normally connect to
  a question, method, evidence, or decision through hierarchy or a semantic
  link.
- **Semantic review:** Before committing a map change, review every changed
  claim against these admission rules. A successful CLI audit or validation
  does not establish scientific relevance. Flag existing documentation,
  implementation-history, or task-completion nodes for review; preserve only
  their qualifying knowledge when restructuring them.

For claims that pass admission, preserve their scientific content and epistemic
status. Research-relevant observations, sources, constraints, failures, and open
questions qualify; ordinary engineering tasks and backlogs do not. Write concise,
factual, self-contained summaries organized by concept, not by work session.
Reuse and restructure existing knowledge when appropriate; never duplicate a
concept merely because it belongs to several areas.

Keep observations, assumptions, hypotheses, methods, results, interpretations,
findings, decisions, and limitations distinct. Never invent evidence, rationale,
results, citations, or conclusions. Never present an interpretation as a result.
Retain superseded and rejected scientific knowledge when it explains a research
decision or change in method; mark and link its replacement. This does not
require retaining routine development history or inadmissible protocol text.

Use `rationale` for the concise reason, motivation, intended benefit, or problem
behind an admitted method, implementation choice, decision, experiment,
limitation, or future research task. A request alone is not grounds for a node.
Add `user` when the user supplied or confirmed
the reason; add `derived-from-context` only when it follows directly and
unambiguously from established context. A result's causal explanation belongs
in a supported hypothesis or interpretation, not its rationale. Rationale may
be omitted for purely descriptive facts.

## Tags, hierarchy, and relationships

Each node has unique lowercase kebab-case `tags` and selects one included tag as
`main_tag` for graph coloring. Use both an epistemic tag and a work-area tag when
useful. Children normally inherit applicable parent tags but may differ.

Common epistemic tags: `concept`, `research-question`, `hypothesis`, `method`,
`experiment`, `result`, `finding`, `source`, `decision`, `implementation`,
`issue`, `observation`, `idea`, `limitation`, `threat-to-validity`, `todo`, and
`open-question`.

Tags classify admitted knowledge; they do not broaden the admission criteria.
In particular, `tool-development`, `documentation`, and `evaluation-validation`
do not authorize feature catalogues, activity logs, or routine test reports.

Preferred work-area tags:

- `scientific-research`: questions, hypotheses, methods, interpretation.
- `implementation`: algorithm and software implementation.
- `tool-development`: user-facing tools, workflows, editors, infrastructure.
- `evaluation-validation`: tests, experiments, benchmarks, validation.
- `documentation`: sources, generated references, explanatory material.
- `project-governance`: knowledge maintenance, reproducibility, decisions.

Use `uncategorized` only temporarily. Define useful project-only tags in
`llm_context.tag_definitions`, not this reusable file.

Prefer roughly 2-4 useful hierarchy levels. Use nesting for ownership or strong
topic membership and links for other relationships. Prefer `related`,
`depends-on`, `implements`, `supports`, `contradicts`, `supersedes`,
`derived-from`, `evaluates`, `tested-by`, `evidence-for`, `motivated-by`,
`answers`, or `part-of`; introduce another relation only when needed.

## Evidence, experiments, and decisions

Preserve the available origin of research-relevant claims: paper or other
source, experiment, dataset, implementation artifact, code, measurement, user
observation, analysis, or design discussion. Source nodes must contain enough
information to locate the source again. Connect evidence with semantic links
such as `supports`, `supported-by`, or `evidence-for`; do not invent citations.

For scientific experiments, retain the available purpose, related research
question or hypothesis, setup, method, inputs, configuration, result,
interpretation, limitations, and resulting decisions. Include only the detail
needed to assess or reproduce the scientific claim. Keep results separate from
interpretation. Routine application and UI checks are not scientific experiments.

For research-relevant decisions, retain the decision, rationale, alternatives,
supporting evidence, consequences, and status when available. Link replacements
with `supersedes`.

## Project CLI

Use the packaged headless CLI for project operations. After Nova is installed,
the absolute CLI path is available in the per-user `NOVA_CLI` environment
variable. In Windows PowerShell, invoke
`& $env:NOVA_CLI <command> --project <project.nova>`. A newly installed
variable is visible to processes started after installation. In a source
checkout, the local `NOVA-CLI.exe` and npm CLI script are available from the
NOVA repository root. From that directory, use
`& ".\NOVA-CLI.exe" <command> --project <project.nova>` or
`npm.cmd run cli -- <command> --project <project.nova>`. `NOVA-CLI.exe` does
not start Electron or Chromium and remains usable when `ELECTRON_RUN_AS_NODE`
is set by an automation environment.

Project commands require `--project <project.nova>`, emit JSON, and return a
nonzero exit code with a JSON error on failure. `help`/`--help` returns plain-text
usage and does not require a project.

```text
init --name "Project name" [--summary TEXT|--summary-file FILE]
validate
audit
id  Generate a collision-checked UUID candidate; this does not reserve it. Prefer create, which returns the created ID.
list [--parent ID]
get --id ID
create --title TEXT [--parent ID] [--tags a,b] [--main-tag TAG]
       [--summary TEXT|--summary-file FILE]
       [--rationale TEXT|--rationale-file FILE]
update --id ID [--title TEXT] [--tags a,b] [--main-tag TAG]
       [--summary TEXT|--summary-file FILE]
       [--rationale TEXT|--rationale-file FILE] [--clear-rationale]
move --id ID --parent ID
delete --id ID --yes
link-add --source ID --target ID --relation RELATION
link-remove --source ID --target ID --relation RELATION
search --query TEXT [--category ID] [--limit N]
context --query TEXT [--category ID] [--scope category|all] [--token-budget N] [--related-depth N]
context-get [--id ID]
context-set [--id ID] --summary TEXT|--summary-file FILE
instruction-add [--id ID] --instruction TEXT|--instruction-file FILE
instruction-remove [--id ID] --instruction TEXT|--instruction-file FILE
worker-status
worker-stop
checkpoint-for-version-control  Flush committed WAL changes before staging the .nova file
tag-define --tag TAG --description TEXT|--description-file FILE
tag-remove --tag TAG
import --from BACKUP.json  Restore into a NEW .nova destination
export --to BACKUP.json [--overwrite]
```

`audit` is read-only and reports candidate knowledge-quality problems such as
likely duplicates, activity-log or artifact-centric nodes, status/content
contradictions, missing epistemic tags, and weakly related root evidence. It
does not reject or modify a structurally valid project; review its findings in
context, especially those involving nodes changed in the current interaction.

`init` refuses to overwrite an existing file. `create` generates the UUID and
timestamps and defaults to a main topic beneath the project root. `update`
changes only supplied fields. `delete` is permanent and requires `--yes`; the
root cannot be deleted or moved. Text-file options are preferred for multiline
or shell-sensitive content.

The CLI validates the current document and the proposed changes, and applies
SQLite mutations in a transaction that reads the latest committed state while
holding the writer lock. This protects the database transaction; it does not
verify that an agent's earlier retrieved context is still current. Ordinary
`update` commands have no expected-revision option. If you learn that another
writer changed facts your decision depends on, retrieve the affected records
and reconsider the edit. Cache freshness is handled by the CLI; do not add
pre-write reads solely to maintain the cache.

SQLite FTS5 ranks retrieval candidates; global ID and normalized-title checks
still apply, including outside a requested category. Context packs include
mandatory guidance, category summaries, ranked original content, semantic
neighbors, and explicit omissions. `--scope all` requests content from all nodes
when it fits; otherwise it reports omissions and truncation. This is a retrieval
pack, not a backup export. Token counts are approximate. Use the backup commands
for portable copies and the CLI for all active-project changes.

## Schema-7 invariants

- `version` is `7`; `viewer_version` is non-empty. Both are application-managed.
- `project.root_node_id` identifies the sole entry in `nodes`. The root remains
  expanded and cannot be deleted or reparented.
- Established IDs remain stable lowercase kebab-case values. New nodes use
  collision-checked lowercase UUIDv4 IDs. IDs never depend on position or title.
- Required node fields are `id`, `title`, non-empty unique `tags`, `main_tag`,
  `summary`, ISO-8601 `created_at` and `modified_at`, `children`, and `links`.
  `rationale` is optional. Optional `agent_guidance` contains a string `summary` and string array `instructions`, scoped to the node and descendants. `main_tag` must occur in `tags`.
- `created_at` never changes; content edits update `modified_at`.
- `children` and `links` are arrays even when empty. Link targets exist, differ
  from their source, and use lowercase kebab-case relations.
- `llm_context.summary` is a string, `instructions` is a string array, and
  `tag_definitions` maps lowercase kebab-case IDs to descriptions.
- Legacy `type`, `status`, `categories`, `date`, and `rationale_source` fields
  are invalid; their concepts belong in tags or timestamps.
- `view` is application-managed project presentation state. Preserve it during
  project edits; knowledge changes normally do not need to modify it.

## Ongoing maintenance and reconstruction goals

When relevant, merge duplicates, clarify hierarchy, improve summaries, add
missing links, mark superseded knowledge, resolve completed TODOs, connect
evidence to findings, and connect experiments to their research questions.
Preserve useful scientific evidence and rejected research alternatives when
restructuring. Remove inadmissible protocol text from summaries without
discarding any qualifying claims it contains; do not archive that text as new
map nodes.

The map should reliably answer: why research-relevant architecture and methods
were selected; which alternatives were considered; what evidence supports decisions and
findings; which experiments address which questions; what the actual results,
interpretations, limitations, and future work are; how the project evolved; and
what belongs in methodology, evaluation, discussion, or thesis chapters.
