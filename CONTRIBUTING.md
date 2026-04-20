# Contributing to ThreatMod AI

Thanks for your interest in contributing. This document describes how to report bugs, propose features, and submit pull requests.

## Reporting bugs and requesting features

Open a [GitHub issue](https://github.com/cintelis/threatmod-ai/issues). For bugs, include:
- What you expected to happen
- What actually happened
- Minimal steps to reproduce (including `project_id`, `github_repo`, and `folder_path` if relevant — but do **not** include real credentials)
- Pipeline run ID if applicable (from `POST /api/v1/pipeline/trigger` response)
- Log snippets and stage history from `GET /api/v1/pipeline/:id/status`

For feature requests, describe the use case and the minimal surface area you'd want to see added.

## Development setup

See `README.md` for full setup. TL;DR:

```bash
npm install && (cd client && npm install)
cp .env.example .env            # fill in credentials
cp client/.env.example client/.env
npm run db:migrate
npm run dev                     # backend on :3000
(cd client && npm run dev)      # frontend on :5173 (optional)
```

## Submitting a pull request

1. Fork the repo and create a feature branch off `main`:
   ```bash
   git checkout -b feat/short-description
   ```
2. Make your changes. Keep the scope focused — one logical change per PR.
3. Ensure both typechecks pass:
   ```bash
   npm run typecheck
   (cd client && npm run typecheck)
   ```
4. Add or update tests for new routes, agents, or pipeline stages. See `tests/e2e/fullPipeline.test.ts` for the existing baseline.
5. Commit with a conventional message:
   ```
   type(scope): short description
   ```
   Types: `feat`, `fix`, `chore`, `refactor`, `test`, `docs`, `perf`, `style`.
6. Push your branch and open a PR against `main`. Fill in the PR template.

For larger features, open an issue first to discuss the approach — saves everyone time.

## Code conventions

These are enforced informally today; automated enforcement may come later.

### Both backend and frontend
- **TypeScript strict**. No `any` without a `// justification:` comment on the same line.
- **No new dependencies** without calling them out in the PR description.
- Prefer editing existing files over creating new ones. Add a new file only when the surface area genuinely warrants it.

### Backend (`server/`)
- Routes return JSON via Hono's `c.json()`.
- Config loads from env in `server/config.ts` — never call `process.env` directly from feature code.
- LLM calls go through `server/llm/index.ts` — do not import `@anthropic-ai/sdk` or `openai` directly in agent or orchestrator code.
- Prompts live in `server/prompts/*.md` — do not inline large prompts in TypeScript.
- Database access uses prepared statements via `server/db/client.ts`. Never concatenate SQL strings.
- Migrations in `server/db/migrations/` are **append-only**. Never edit an applied migration; add a new numbered file.
- Pipeline state transitions must be registered in `server/orchestrator/stateMachine.ts`.

### Frontend (`client/`)
- Function components only. Hooks go in `client/src/hooks/` when reused.
- API calls go through `client/src/api/` — no raw `fetch` calls in pages.
- Environment values via `import.meta.env.VITE_*`. Never hardcode URLs or tokens.
- Tailwind utility classes for styling. Avoid adding new CSS files.
- Semantic HTML (`<button>`, `<nav>`, `<main>`) — no `<div onClick>`.

### Tests (`tests/`)
- Unit tests for pure logic (LLM adapters, connectors, state machine, utilities).
- Integration tests for Hono routes and DB migrations.
- End-to-end tests for full pipeline runs with fakes at the connector boundary.
- Never call real LLMs, real GitHub, real Confluence, or real AWS MCP from tests. Fake at the connector interface, not at `fetch`.
- DB tests use a real SQLite instance (file or `:memory:`) with real migrations — do not mock the DB layer.

## Dependency policy

When adding a new dependency or scaffolding new code, prefer the current npm `latest`:

```bash
npm install <pkg>@latest
```

Record any intentional pins below latest (with a reason) in a `DEPENDENCIES.md` file.

## Security

Found a security issue? **Do not open a public issue.** Email `security@cintelis.ai` instead. We'll coordinate a fix and disclosure timeline.

For general hardening feedback that isn't a vulnerability (e.g., "consider rate limiting on `/api/v1/pipeline/trigger`"), a regular issue is fine.

## License

By submitting a pull request, you agree that your contribution will be licensed under the same terms as the project (MIT — see `LICENSE`).
