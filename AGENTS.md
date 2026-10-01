# Persistent Project Knowledge Map

## IDE-agent task workflow and retrieval

`AGENTS.md` defines how to work in this repository; the active project file
(`nova.nova` or legacy `nova.json`) is the authoritative source for NOVA project
knowledge. Do not load the complete map by default.
For non-trivial NOVA tasks, request a compact, task-specific context pack first:

```text
npm.cmd run cli -- context --project nova.nova --query "task description"
```

The IDE reads this `AGENTS.md` separately. The context pack includes project
identity, root `llm_context` guidance, and a compact category index, then ranks
relevant node excerpts. Use its category ID to narrow detail retrieval when
useful:

```text
npm.cmd run cli -- context --project nova.nova --query "task description" --category CATEGORY_ID --token-budget 6000
npm.cmd run cli -- context --project nova.nova --query "architecture-wide task" --scope all --token-budget 16000
npm.cmd run cli -- search --project nova.nova --query "paper DOI or method name"
npm.cmd run cli -- get --project nova.nova --id NODE_ID
```

Category selection is a starting point, not a boundary. Search globally for
exact IDs and normalized titles before proposing a new node; exact matches
outside the selected category must remain visible. Fetch plausible matches by
stable ID, including their parent path and semantic links. If the map has no
match, say that it was not found in the map; absence is not evidence of global
novelty. Inspect repository code separately, and inspect or request the paper
when its identity or method is unclear.

For paper-based implementation tasks, check source, method, implementation,
decision, experiment, result, and limitation knowledge before coding. Report
what is already implemented, attempted, or evaluated and what evidence is
missing. Keep source, method, implementation, experiment, result, and
interpretation as distinct knowledge where applicable. Never infer an
experiment or result from an implementation record. Reuse/update existing
nodes by ID, create only genuinely new project knowledge, link related topics,
and ask when identity or scope uncertainty would change the implementation.

Use the CLI for project reads and mutations; do not inspect or modify the
underlying storage directly. Pass the active project path through `--project`.
During migration, leave the original JSON source intact and use the CLI's
migration/import/export commands as documented. After map mutations, run
`audit`, review findings about touched nodes, and run `validate`.

Write project knowledge in professional scientific language. Do not add emoji
or decorative symbols to node titles, summaries, rationales, or guidance.
Unicode text, including emoji supplied by the user or already present in the
map, is valid project content: preserve it when relevant and do not reject or
rewrite a project because it contains such characters.

The CLI supports both schema-7 JSON and SQLite `.nova` projects. Prefer `.nova`
for active work. Use `migration-status` to inspect a legacy JSON project,
`migrate --project old.json --to new.nova` to make a separate database copy,
`import --project new.nova --from old.json` to create a database from JSON, and
`export --project new.nova --to backup.json` for a portable export. Migration
and import accept schema-7 JSON and convert schema-6 JSON to schema 7 in memory;
they never change the source JSON and refuse an existing destination. Export
refuses to overwrite an existing JSON file unless `--overwrite` is explicit.
The `.nova` file is the project database; SQLite may use transient WAL sidecars
while it is open. Agents must use the CLI and must never access SQLite directly.
In the desktop app, Open, New, Save, and Save As use `.nova` databases. Use
File > Import JSON to migrate a legacy JSON project to a new `.nova` file; the
source stays unchanged. Use File > Export JSON to make a portable copy. If a
remembered legacy JSON path has a sibling `.nova`, startup opens the database;
otherwise startup offers the import flow.

## Purpose and required workflow

This checkout currently contains the legacy `nova.json`; use the CLI migration
command to create a separate `nova.nova` database and keep the JSON source. New
active projects should prefer `.nova`. A project file may use
any filename; commands always operate on the path passed with `--project`. It is
a semantic knowledge graph, not a chat transcript. It must remain
understandable without the conversation that produced it and detailed enough to
reconstruct research, methods, decisions, implementation history, experiments,
evidence, findings, limitations, rejected alternatives, and future work.

For every interaction:

1. Perform the requested work.
2. Decide whether it produced meaningful project knowledge. Ignore filler,
   repetition, and routine confirmations.
3. Inspect relevant existing nodes and the root `llm_context` before classifying
   or changing knowledge.
4. Extend the smallest appropriate existing node or create a non-duplicate node;
   place it semantically and add useful cross-links.
5. Preserve rationale, provenance, evidence, dates, alternatives, and epistemic
   status when meaningful. Ask one concise question if an important rationale is
   materially uncertain.
6. Prefer the project CLI for mutations. After changing project knowledge, run
   `audit`, review every finding involving a node you touched, then run
   `validate`. Do not rewrite the whole file unnecessarily.

The user should not need to request map maintenance explicitly.

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

- **Scientific relevance test:** Every non-root node must contain a question,
  idea, method, evidence, result, interpretation, limitation, decision, or
  future research task. Implementation or documentation is eligible only when
  it conveys one of these forms of knowledge.
- **No activity-log nodes:** Activities such as "created report", "updated
  script", or "generated figures" are not standalone knowledge.
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
- **Periodic audit:** Flag for review nodes whose main purpose is documentation,
  implementation history, or task completion; retain them only if they pass the
  scientific relevance test.

Capture meaningful implementations, decisions and rationale, observations,
ideas, sources, questions, hypotheses, methods, experiments, results,
interpretations, findings, constraints, issues, failures, limitations, TODOs,
and open questions. Prefer concise, factual, specific, self-contained nodes over
chronological notes or excessive fragmentation. Reuse and restructure existing
knowledge when appropriate; never duplicate a concept merely because it belongs
to several areas.

Keep observations, assumptions, hypotheses, methods, results, interpretations,
findings, decisions, and limitations distinct. Never invent evidence, rationale,
results, citations, or conclusions. Never present an interpretation as a result.
Retain superseded and rejected knowledge when it explains project evolution;
mark and link its replacement instead of silently deleting history.

Use `rationale` for the concise reason, motivation, intended benefit, or problem
behind a meaningful request, implementation, method, decision, experiment,
limitation, or future-work item. Add `user` when the user supplied or confirmed
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

For meaningful experiments, retain the available purpose, related question or
hypothesis, setup, method, inputs, configuration, result, interpretation,
limitations, and resulting decisions. Keep results separate from interpretation.

For important decisions, retain the decision, rationale, alternatives,
supporting evidence, consequences, and status when available. Link replacements
with `supersedes`.

## Project CLI

Use the packaged headless CLI instead of editing recursive JSON. On Windows
PowerShell, invoke `& ".\NOVA-CLI.exe" <command> --project <project-file.json|project.nova>`;
installed releases also expose the absolute sidecar path in the per-user
`NOVA_CLI` environment variable, so agents can invoke
`& $env:NOVA_CLI <command> --project <project-file.json|project.nova>`. A newly installed
variable is visible to processes started after installation. `NOVA-CLI.exe`
does not start Electron or Chromium and remains usable when
`ELECTRON_RUN_AS_NODE` is set by an automation environment. In a source
checkout where the packaged sidecar is unavailable, use
`npm.cmd run cli -- <command> --project <project-file.json|project.nova>`.

Every command requires `--project <project-file.json|project.nova>`, emits JSON, and returns a
nonzero exit code with a JSON error on failure.

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
context-get
context-set --summary TEXT|--summary-file FILE
instruction-add --instruction TEXT|--instruction-file FILE
instruction-remove --instruction TEXT|--instruction-file FILE
tag-define --tag TAG --description TEXT|--description-file FILE
tag-remove --tag TAG
migration-status
migrate --to DATABASE.nova
import --from SOURCE.json
export --to DESTINATION.json [--overwrite]
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

The CLI validates before and after mutations and writes SQLite changes in a
transaction with a stale-revision check. JSON writes remain atomic and reject a
stale revision. SQLite FTS5 ranks retrieval candidates; global ID and normalized
title checks still apply, including outside a requested category. Context packs
include mandatory guidance, category summaries, ranked excerpts, semantic
neighbors, and explicit omissions. `--scope all` requests the complete map when
it fits; otherwise it reports omitted IDs and truncation. Token counts are
approximate. If direct JSON
editing is unavoidable, preserve all application-managed fields and run
`validate` afterward.

## Schema-7 invariants

- `version` is `7`; `viewer_version` is non-empty. Both are application-managed.
- `project.root_node_id` identifies the sole entry in `nodes`. The root remains
  expanded and cannot be deleted or reparented.
- Established IDs remain stable lowercase kebab-case values. New nodes use
  collision-checked lowercase UUIDv4 IDs. IDs never depend on position or title.
- Required node fields are `id`, `title`, non-empty unique `tags`, `main_tag`,
  `summary`, ISO-8601 `created_at` and `modified_at`, `children`, and `links`.
  `rationale` is optional. `main_tag` must occur in `tags`.
- `created_at` never changes; content edits update `modified_at`.
- `children` and `links` are arrays even when empty. Link targets exist, differ
  from their source, and use lowercase kebab-case relations.
- `llm_context.summary` is a string, `instructions` is a string array, and
  `tag_definitions` maps lowercase kebab-case IDs to descriptions.
- Legacy `type`, `status`, `categories`, `date`, and `rationale_source` fields
  are invalid; their concepts belong in tags or timestamps.
- `view` is application-managed project presentation state. Preserve it during
  direct edits; knowledge changes normally do not need to modify it.

## Ongoing maintenance and reconstruction goals

When relevant, merge duplicates, clarify hierarchy, improve summaries, add
missing links, mark superseded knowledge, resolve completed TODOs, connect
evidence to findings, and connect experiments to their research questions.
Never destructively remove useful research history.

The map should reliably answer: why architecture and methods were selected;
which alternatives were considered; what evidence supports decisions and
findings; which experiments address which questions; what the actual results,
interpretations, limitations, and future work are; how the project evolved; and
what belongs in methodology, evaluation, discussion, or thesis chapters.
