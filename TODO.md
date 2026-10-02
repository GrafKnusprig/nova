# Open work and implementation status

Updated 2026-10-02. Active projects use `.nova` databases; JSON is for portable
backups. See [README.md](README.md) for app setup and [AGENTS.md](AGENTS.md) for
the agent workflow. The project knowledge map retains implementation decisions,
validation evidence, and limitations.

## Open work

### Desktop assistant: contextual retrieval and cache integration

- [ ] Give the built-in AI Assistant the same task-scoped context retrieval and
  cache benefits as external IDE agents. It currently uses direct project
  callbacks, its own overview/search/get tools, and whole-document reads.
- [ ] Choose the shared backend integration in Electron main; reuse storage and
  retrieval modules rather than assuming the desktop must spawn CLI commands.
- [ ] Return root guidance, applicable node guidance, category orientation,
  original candidate content, paths, and useful semantic neighbors together.
  Preserve global exact ID/title checks and explicit omissions.
- [ ] Keep context preparation out of the edit response: respond after a
  successful database commit, prepare in the background, and make subsequent
  reads wait when the cache is behind. Reject obsolete rebuild results and
  handle external changes and project switching.
- [ ] Preserve Draft/Edit/Full enforcement, one-task approvals, provider support,
  message queues, autosave, editor conflicts, and renderer synchronization.
- [ ] Verify Chat and Add note workflows, own/external edits, scoped instructions,
  duplicate checks, and project isolation. Measure complete assistant turns,
  not only storage operations.

This is open work. The CLI cache is implemented; its desktop assistant
integration is not. The backend design and integration tests remain to be done.
Knowledge-map task: `280b9b64-c5da-4195-b2de-7e9c06c10818`.

### Real agent workflow and retrieval quality

- [ ] Measure tool-call count and end-to-end waiting in a representative agent
  task on the affected project. Separate launcher/runtime time, cache waiting,
  retrieval, output size, and agent scheduling/context ingestion.
- [ ] Compare context-first retrieval with consecutive search/get reads. Include
  read-before-decision/edit-last workflows, immediate reads after writes,
  varied queries, cold starts, and external updates.
- [ ] Evaluate duplicate recall and update-versus-create behavior on realistic
  maps: paraphrases, aliases, cross-category matches, contradictions, rejected
  alternatives, and linked evidence. Current exact-match tests do not establish
  broad semantic recall.
- [ ] Consider tokenizer improvements, local embeddings, reranking, or derived
  digests only when measured retrieval limitations justify them. Keep original
  evidence and mandatory instructions available.

### Storage and larger-map costs

- [ ] Reduce full-document renderer transfer and loading where beneficial,
  preserving rendering, undo/redo, view state, cross-links, and stale-save checks.
- [ ] Reduce write-path validation, cloning, document reload, and diff costs
  without weakening transactional consistency. Background cache preparation
  does not remove these database-write costs.
- [ ] Evaluate selective external invalidation through a change journal or
  persistent revisions. External cache refreshes currently rebuild the full
  snapshot; dependency bookkeeping and memory still scale with graph size.
- [ ] Measure memory and IPC overhead of raw data, prepared indexes, pending
  documents, and helper-process snapshots on larger maps.
- [ ] Extend backup/restore and interrupted-import verification as needed,
  including stable IDs, hierarchy, links, Unicode, guidance, and workspace state.
  Restore must preserve the JSON backup and refuse an existing destination.

### Windows release verification

- [ ] Verify `node:sqlite` and FTS5 in the actual packaged CLI and Electron runtime.
- [ ] Extend packaged smoke coverage to `.nova` projects, named-pipe transport,
  helper-process IPC, fresh reads after own/external changes, idle shutdown,
  crash recovery, and explicit stop. Current source and portable bundled tests
  were run on macOS; they do not verify the Windows package.
- [ ] Verify concurrent desktop/CLI work and clean release packaging with the
  current canonical AGENTS.md and README instructions.
- [ ] Decide how template initialization and updates should preserve custom
  project instructions. Project creation and File > Init AGENTS.md currently
  replace an existing project-local AGENTS.md.

### Distribution

- [ ] License under MIT and obtain an application signing certificate.
- [ ] Establish a GitHub build pipeline and investigate SignPath Foundation
  signing support.

### Local offline AI exploration

- [ ] Evaluate an optional local inference provider with model/tool support,
  practical Windows CPU/GPU and memory requirements, model licensing,
  cancellation, permission enforcement, and installer/update behavior.
- [ ] Keep inference off the renderer thread and measure a suitable worker or
  separate-process design before selecting a native dependency or model.

No local LLM is integrated. The earlier implementation sketch and storage
research notes are preserved in [the planning archive](docs/archive/storage-and-local-ai-planning.md).
Its examples are unverified historical material, not a production-ready guide.

## Implemented

- [x] SQLite `.nova` project storage with WAL, foreign keys, ordered hierarchy and
  semantic links, context/view state, and unknown node-field preservation.
- [x] Desktop `.nova` creation/open/save, JSON backup export/restore, and
  external-change synchronization.
- [x] Transactional CLI mutations; stale-revision checks for document saves
  when an expected revision is supplied. Ordinary CLI updates do not compare
  an agent's earlier retrieved revision.
- [x] Deterministic FTS5 and graph context retrieval, global exact ID/title
  matching, category orientation, scoped instructions, and explicit omissions.
- [x] Automatic CLI worker discovery/startup, retained connections and snapshots,
  direct stable-ID lookup, prepared context indexes, and bounded query caches.
- [x] Background context preparation after committed CLI edits, selective reuse
  of unchanged derived data, and external-change polling/preparation while idle.
- [x] Freshness verification before every cached read; wait for preparation when
  needed, reject obsolete jobs, and keep read transactions request-scoped.
- [x] Idle timeout, authenticated project-bound transport, restart/recovery,
  optional worker diagnostics, and no replay of interrupted submitted mutations.
- [x] Synthetic database generator, phase profiling, and direct/cached/worker
  benchmarks including own/external edit-followed-by-read cases.
- [x] Cache/lifecycle tests and local synthetic benchmarks. The last full suite
  passed 54 tests with main/preload/renderer type checks; Windows packaged and
  real-agent workflow validation remain open above.
- [x] Current AGENTS.md and README guidance for `.nova` projects, JSON backups,
  Windows commands, context reuse, actual assistant permissions, and cache scope.

Implementation and benchmark evidence are recorded in `nova.nova`. Completed
CLI work does not imply desktop assistant integration or measured end-to-end
agent latency savings.
