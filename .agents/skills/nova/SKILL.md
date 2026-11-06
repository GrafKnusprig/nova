---
name: nova
description: Retrieve and maintain scientific project knowledge in NOVA .nova databases. Use for research planning, paper-based implementation, experiments, interpretation, research decisions, and knowledge-map maintenance in this repository. Routine coding without research-relevant knowledge does not require map changes.
---

# NOVA Project Knowledge

Use the project's NOVA knowledge graph to retrieve research context and preserve qualifying scientific knowledge. Keep sources, methods, implementation constraints, experiments, results, interpretations, and limitations distinct.

## Retrieve research context

Read [references/workflow.md](references/workflow.md) before NOVA operations. It defines database discovery, focused retrieval, scoped guidance, paper-based implementation checks, and the knowledge maintenance workflow.

Discover exactly one `.nova` file directly in the project root. Resolve its absolute path and pass it with `--project` to every project command. If discovery finds zero or multiple databases, stop NOVA operations and report the issue. Use the CLI exclusively; never inspect or modify SQLite storage directly.

For non-trivial NOVA tasks, begin with a compact task-specific `context` request. Follow root `llm_context` and applicable node guidance, and report conflicting guidance. Retrieve more detail only when the context pack leaves a relevant gap.

For paper-based implementation, check source, method, implementation, decision, experiment, result, and limitation knowledge before coding. Inspect code and source papers separately as needed. Never infer experimental evidence from implementation records.

## Maintain scientific knowledge

Read [references/scientific-knowledge.md](references/scientific-knowledge.md) before proposing map changes. It defines admission criteria, evidence boundaries, rationale, tags, hierarchy, and semantic relationships.

After completing the requested work, preserve qualifying research knowledge without waiting for a separate request. If no knowledge qualifies, make no map mutation. Routine development activity and software verification belong outside the map.

Before creating a node, check globally for its ID or normalized title and inspect plausible existing matches. Extend the smallest appropriate existing node when it represents the concept. Preserve provenance, scientific rationale, alternatives, uncertainty, and useful rejected or superseded knowledge.

## Execute and review changes

Read [references/cli-and-schema.md](references/cli-and-schema.md) when invoking the CLI or changing the map. It contains command syntax, transaction behavior, backup semantics, schema invariants, and maintenance goals.

Review every changed claim against scientific admission rules before committing it. After a related mutation batch, run `audit`, review every finding involving touched nodes, and run `validate`. CLI success does not establish scientific relevance.

Preserve application-managed IDs, timestamps, schema metadata, and presentation state. JSON files are portable backups, not active projects.

Before staging or committing a `.nova` file in version control, run `checkpoint-for-version-control --project <absolute-project.nova>` and require success. It flushes committed WAL changes into the main file while the worker remains available. On failure, finish other database activity and retry. Avoid concurrent writes until staging; rerun after further edits. Never delete or commit WAL/SHM sidecars. This command does not save unsaved desktop edits or invoke Git.
