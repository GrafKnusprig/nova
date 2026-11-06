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
