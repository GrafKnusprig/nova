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
