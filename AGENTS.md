# Persistent Project Knowledge Map

## Purpose and required workflow

`mindmap.json` is the project's persistent knowledge, research, and development
record. It is a semantic knowledge graph, not a chat transcript. It must remain
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
6. Prefer the project CLI for mutations and validate the result. Do not rewrite
   the whole file unnecessarily.

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

Use the packaged executable's `cli` mode instead of editing recursive JSON. On
Windows PowerShell, a typical invocation is
`& ".\NOVA.exe" cli`; use the actual filename supplied with the
release.

Every command requires `--project <mindmap.json>`, emits JSON, and returns a
nonzero exit code with a JSON error on failure.

```text
init --name "Project name" [--summary TEXT|--summary-file FILE]
validate
id
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
context-get
context-set --summary TEXT|--summary-file FILE
instruction-add --instruction TEXT|--instruction-file FILE
instruction-remove --instruction TEXT|--instruction-file FILE
tag-define --tag TAG --description TEXT|--description-file FILE
tag-remove --tag TAG
```

`init` refuses to overwrite an existing file. `create` generates the UUID and
timestamps and defaults to a main topic beneath the project root. `update`
changes only supplied fields. `delete` is permanent and requires `--yes`; the
root cannot be deleted or moved. Text-file options are preferred for multiline
or shell-sensitive content.

The CLI validates before and after mutations, writes atomically, and rejects a
stale write when the file changed after it was read. If direct JSON editing is
unavoidable, preserve all application-managed fields and run `validate` afterward.

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
