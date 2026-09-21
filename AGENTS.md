# NOVA Development Guide

NOVA is a local Electron application for creating, viewing, and maintaining
schema-7 knowledge-map JSON projects. It is independent of any particular
knowledge-map project or research domain.

## Project data

- Treat the currently opened JSON file as user data. Do not embed project
  content, datasets, credentials, or absolute local paths in application code.
- Schema validation and all project mutations belong in the shared main-process
  project layer and CLI. Keep the renderer focused on presentation and IPC.
- Preserve application-managed document metadata and validate project changes
  through the provided CLI or shared validation functions.

## Development

- Run `npm run typecheck` after TypeScript changes and `npm test` for relevant
  behavioral changes.
- `npm run build` emits the renderer to `dist/`, copies this file to
  `dist/AGENTS.md`, and compiles Electron main/preload code. Electron Builder
  packages `dist/**` with the application.
- Do not commit `node_modules`, build outputs, local settings, `.env` files,
  API keys, or generated credentials.

## Security

- Keep Electron's context isolation and renderer sandboxing enabled.
- Store provider credentials only through the operating-system secure-storage
  integration; never log, commit, or expose them to the renderer.
- Constrain assistant operations to the explicitly opened project file and the
  validated project-tool interface.
