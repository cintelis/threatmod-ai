# ThreatMod AI — AI Assistant Guide

Context for Claude Code, Cursor, and similar AI coding assistants. For humans, see `README.md`.

## What this is

AI-powered security threat modelling pipeline. Ingests architecture docs from GitHub, runs STRIDE analysis via LLM (Anthropic or Azure OpenAI), routes through an approval workflow, verifies AWS controls via MCP, and publishes the final threat model to Confluence.

## Stack

Node.js 20+ / TypeScript (strict) / Hono backend · better-sqlite3 (local) or Azure Cosmos DB (prod) · React 18 + Vite + Tailwind + `@uiw/react-md-editor` frontend · Anthropic Claude + Azure OpenAI dual-provider LLM · GitHub / Confluence / Power Automate / AWS MCP integrations.

## Quick start

```bash
npm install && (cd client && npm install)
cp .env.example .env     # fill in credentials (see README.md)
cp client/.env.example client/.env
npm run db:migrate
npm run dev              # backend on :3000
```

Full setup, API reference, and env var table live in `README.md`.

## Conventions

- TypeScript strict — no `any` without a `// justification:` comment on the same line.
- Branches: `feat/…` / `fix/…` / `chore/…`. Commits: `type(scope): description`.
- Migrations in `server/db/migrations/` are append-only — never edit an applied migration; add a new numbered file.
- Prompts live in `server/prompts/*.md` — don't inline large prompts in TypeScript.
- LLM calls go through `server/llm/index.ts` — no direct `@anthropic-ai/sdk` or `openai` imports in feature code.
- Frontend API calls go through `client/src/api/` — no raw `fetch` in pages.
- Pipeline state transitions are enforced by `server/orchestrator/stateMachine.ts` — new stages must register their legal transitions there.

## Layout

- `server/` — routes, orchestrator, agents, connectors, llm, prompts, db
- `client/` — React pages, hooks, API client
- `tests/` — unit and end-to-end tests

See `README.md` for the full annotated tree and pipeline stage map.

## Contributing

Keep changes scoped. Add tests for new routes or pipeline stages. Run `npm run typecheck` in both root and `client/` before opening a PR. For larger features, open an issue first to discuss the approach.
