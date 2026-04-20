# ThreatMod AI

**ThreatMod AI** is an AI-powered security threat modelling pipeline. Feed it architecture documentation from a GitHub repository and it returns a reviewed, published threat model — combining **STRIDE**, **MITRE ATT&CK** tactic mapping, and **OWASP LLM Top 10** analysis, with AWS control verification — committed back to GitHub and published to Confluence.

---

## What it does

Give the tool an architecture document (markdown in a GitHub repo) and it will:

1. **Ingest** all architecture docs from a configured folder in that repo.
2. **Analyse** them through three complementary methodologies in parallel: STRIDE, MITRE ATT&CK tactic mapping, and OWASP LLM Top 10 (auto-gated to AI/ML components). Uses an LLM (Anthropic Claude or Azure OpenAI).
3. **Summarise** per-document threats into a unified threat model.
4. **Route for approval** via a Power Automate webhook, pausing until a security reviewer approves or rejects the draft.
5. **Enrich** approved threats by mapping them to STRIDE-to-AWS control mappings.
6. **Verify AWS controls** live by querying an AWS MCP Server for actual configuration state.
7. **Publish** the final threat model markdown back to GitHub and as a Confluence page.

Every state transition is persisted and auditable.

---

## Features

### Multi-methodology threat analysis
- Runs three complementary methodologies per architecture, in parallel:
  - **STRIDE** (Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege) — the baseline threat inventory.
  - **MITRE ATT&CK tactic mapping** — for each STRIDE threat, identifies the ATT&CK Enterprise tactics and techniques an adversary could plausibly use. Defensive framing.
  - **OWASP LLM Top 10** — AI/ML-specific risks (prompt injection, excessive agency, improper output handling, etc.). Gated by a cheap keyword pre-check so non-AI architectures skip the LLM call entirely.
- Dual-provider LLM layer — swap between Anthropic Claude Sonnet 4.6 and Azure OpenAI GPT-4o via one env var (`LLM_PROVIDER`).
- Parallel analysis of large multi-file architectures via `analysisPool`.
- Feature flags: `ENABLE_ATTACK_MAPPING` (`true`/`false`) and `ENABLE_LLM_TOP10` (`true`/`false`/`auto`).
- Versioned prompts in `server/prompts/*.md` — one prompt per methodology, no hardcoded prompts in TypeScript.

### AWS control verification
- `awsExtractor` identifies AWS services referenced in the architecture.
- `awsVerifier` queries an AWS MCP Server for current configuration.
- `enrichment` maps each STRIDE threat to the AWS controls that mitigate it and annotates the threat model with verification status.
- Three verification depths: `BASIC`, `STANDARD`, `DEEP` (configurable per environment).

### Two-stage approval workflow
- After initial analysis, the draft is committed to GitHub and a Power Automate webhook notifies the approver.
- Approval decision returns via callback (`/api/v1/pipeline/approval-callback`).
- Approved → AWS verification runs, then final publication.
- Rejected → run is marked `REJECTED` with reviewer comments logged.
- Configurable approval timeout with secondary approver escalation.

### Dual output
- **GitHub**: markdown committed to `<GITHUB_OUTPUT_FOLDER>/<project_id>-threat-model.md` (default folder `threat-models/`).
- **Confluence**: page published under a configured space and parent page, with markdown-to-storage-format conversion.

### Markdown editor UI
- React + Vite + Tailwind front-end with `@uiw/react-md-editor` for reviewing architecture documents and threat models.
- Browses the configured GitHub repo directly via Octokit.
- Edit and save back to GitHub without leaving the UI.

### Auditable pipeline state machine
- Every run is persisted to SQLite (local) or Azure Cosmos DB (production).
- Strict state transition graph — illegal transitions throw.
- Full stage-by-stage log for every run.

---

## Architecture

```
  ┌───────────────┐      ┌──────────────────┐      ┌─────────────────┐
  │  GitHub repo  │ ───▶ │   ThreatMod AI   │ ───▶ │   Confluence    │
  │  (input:      │      │     pipeline     │      │   (final threat │
  │  architecture │ ◀─── │                  │      │    model page)  │
  │  markdown)    │      │                  │      └─────────────────┘
  └───────────────┘      └──────────────────┘
                                │    ▲
                       approval │    │ approval callback
                       webhook  ▼    │
                          ┌──────────────┐
                          │Power Automate│
                          │  (reviewer)  │
                          └──────────────┘
                                │
                                ▼
                          ┌──────────────┐
                          │ AWS MCP      │
                          │   Server     │
                          │ (live config │
                          │  verification)│
                          └──────────────┘
```

### Pipeline stages

The state machine (`server/orchestrator/stateMachine.ts`) enforces these transitions:

```
IDLE ─▶ INGESTING ─▶ ANALYSING ─▶ SUMMARISING ─▶ AWAITING_APPROVAL
                                                        │
                                                 (approved)
                                                        ▼
                                  ENRICHING ─▶ VERIFYING_AWS ─▶ PUBLISHING ─▶ COMPLETE

                                  (REJECTED is reachable from any state)
```

| Stage | Modules | What happens |
|---|---|---|
| `INGESTING` | `orchestrator/ingestion.ts`, `connectors/github.ts` | Lists architecture docs in the configured GitHub folder and reads each file. |
| `ANALYSING` | `orchestrator/analysisPool.ts`, `agents/strideAgent.ts`, `agents/attackMappingAgent.ts`, `agents/llmTop10Agent.ts` | Runs STRIDE, MITRE ATT&CK mapping, and (auto-gated) OWASP LLM Top 10 in parallel across all docs. |
| `SUMMARISING` | `agents/summariser.ts` | Consolidates per-document threats into a single model. |
| `AWAITING_APPROVAL` | `agents/publisher.ts` (draft commit), `orchestrator/approvalWatcher.ts`, `connectors/powerAutomate.ts` | Commits draft, sends approval webhook, waits. |
| `ENRICHING` | `agents/enrichment.ts`, `db/controlMappings.ts` | Maps approved threats to AWS controls. |
| `VERIFYING_AWS` | `agents/awsExtractor.ts`, `agents/awsVerifier.ts`, `connectors/awsMcp.ts`, `orchestrator/verificationRunner.ts` | Live AWS config verification via MCP. |
| `PUBLISHING` | `agents/publisher.ts`, `connectors/confluence.ts`, `connectors/markdownToConfluence.ts` | Publishes final document to Confluence. |
| `COMPLETE` | — | Success. Confluence page URL logged. |
| `REJECTED` | — | Terminal failure. Reviewer comments or exception detail logged. |

---

## Input

### 1. Architecture documents

One or more markdown files in a GitHub repository, under a configurable folder (default `architectures/`). Each file should describe a system or sub-system — components, data flows, trust boundaries, integration points, environments.

### 2. Pipeline trigger request

JSON POST to `/api/v1/pipeline/trigger` with four required fields:

```json
{
  "project_id": "pepperstone-recon",
  "github_repo": "cintelis/architecture-docs",
  "folder_path": "architectures/pepperstone",
  "approver_email": "security-lead@example.com"
}
```

All four are required. The server returns `400` if any are missing, empty, or malformed.

### 3. Approval decision

After the draft is reviewed, Power Automate (or a test caller) posts to `/api/v1/pipeline/approval-callback`:

```json
{
  "pipeline_run_id": "uuid",
  "decision": "approved",
  "reviewer": "security-lead@example.com",
  "comments": "Threat T-04 needs stronger mitigation before sign-off",
  "timestamp": "2026-04-20T13:30:00Z"
}
```

---

## Output

### GitHub commit
- **Path**: `<GITHUB_OUTPUT_FOLDER>/<project_id>-threat-model.md` (default `threat-models/`).
- **Format**: Markdown consolidated across source architectures, with:
  - STRIDE executive summary, threat inventory, detailed per-threat analysis, AWS services identified, and assumptions.
  - A `## MITRE ATT&CK Tactic Mapping` section — table of STRIDE threats mapped to ATT&CK tactics and technique IDs with defensive rationale.
  - A `## OWASP LLM Top 10 Findings` section — emitted only when AI/ML components are present and findings were identified. Includes coverage notes for skipped or empty analyses.

### Confluence page
- **Space / parent**: `CONFLUENCE_SPACE_ID` / `CONFLUENCE_PARENT_PAGE_ID`.
- **Format**: Confluence Storage Format, converted from markdown.
- **Returned in API response**: `pageUrl`.

### API responses

| Endpoint | Success response |
|---|---|
| `POST /trigger` | `202 { pipeline_run_id, status: "INGESTING", created_at }` |
| `GET /:id/status` | `200 { pipeline_run_id, status, stages_completed[], updated_at }` |
| `POST /:id/publish` | `200 { ok: true, pageUrl }` |
| `POST /approval-callback` | `200 { ok: true }` |

---

## Prerequisites

- **Node.js** 20+ (Node 24 LTS recommended)
- **npm** 10+
- **GitHub personal access token** with read/write on your architecture repo
- **LLM provider credentials** — Anthropic API key *or* Azure OpenAI deployment
- **Confluence API token** for publication
- **Power Automate flow** for approvals (dev-only `/mock-approve` endpoint bypasses this)
- **AWS MCP Server endpoint** (optional if you set `VERIFICATION_DEPTH=BASIC`)

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/cintelis/threatmod-ai.git
cd threatmod-ai
npm install
cd client && npm install && cd ..
```

### 2. Configure environment

```bash
cp .env.example .env
cp client/.env.example client/.env
```

Fill in at minimum:
- `PIPELINE_API_KEY` — bearer token all `/api/v1/pipeline/*` clients must present
- `GITHUB_TOKEN`, `GITHUB_REPO`
- Either `ANTHROPIC_API_KEY` or the `AZURE_OPENAI_*` trio
- `CONFLUENCE_*` (needed for publication)

See the **Configuration reference** table below for the full list.

### 3. Initialize the database

```bash
npm run db:migrate
```

Creates `threatmod.db` (SQLite) with tables for `pipeline_runs`, `pipeline_stages`, `approval_records`, and `control_mappings`.

### 4. Run the backend

```bash
npm run dev
```

Server starts on `http://localhost:3000`. Health check: `GET /health`.

### 5. Run the frontend (optional)

In a second terminal:
```bash
cd client
npm run dev
```

App starts on `http://localhost:5173`.

---

## Usage

### Trigger a pipeline run

```bash
curl -X POST http://localhost:3000/api/v1/pipeline/trigger \
  -H "Authorization: Bearer $PIPELINE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": "pepperstone-recon",
    "github_repo": "cintelis/architecture-docs",
    "folder_path": "architectures/pepperstone",
    "approver_email": "security-lead@example.com"
  }'
```

Response (`202 Accepted`):
```json
{
  "pipeline_run_id": "a3f1e9c2-...",
  "status": "INGESTING",
  "created_at": "2026-04-20T12:00:00.000Z"
}
```

### Poll status

```bash
curl http://localhost:3000/api/v1/pipeline/a3f1e9c2-.../status \
  -H "Authorization: Bearer $PIPELINE_API_KEY"
```

Response includes the full stage history:
```json
{
  "pipeline_run_id": "a3f1e9c2-...",
  "status": "AWAITING_APPROVAL",
  "stages_completed": [
    { "stage": "INGESTING", "status": "started", "created_at": "..." },
    { "stage": "ANALYSING", "status": "started", "created_at": "..." },
    { "stage": "SUMMARISING", "status": "started", "created_at": "..." },
    { "stage": "AWAITING_APPROVAL", "status": "started", "created_at": "..." }
  ],
  "updated_at": "..."
}
```

### Mock an approval (dev only)

```bash
curl -X POST http://localhost:3000/api/v1/pipeline/mock-approve \
  -H "Authorization: Bearer $PIPELINE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "pipeline_run_id": "a3f1e9c2-...", "decision": "approved" }'
```

For rejection: `"decision": "rejected"`.

### Force a Confluence publish

If the pipeline is stuck at `VERIFYING_AWS` or you want to skip ahead:

```bash
curl -X POST http://localhost:3000/api/v1/pipeline/a3f1e9c2-.../publish \
  -H "Authorization: Bearer $PIPELINE_API_KEY"
```

Response:
```json
{ "ok": true, "pageUrl": "https://your-org.atlassian.net/wiki/..." }
```

Includes an automatic one retry with 2 s back-off if the first attempt fails.

### Production approval callback

Configure your Power Automate flow to POST the approver's decision to:

```
POST /api/v1/pipeline/approval-callback
Authorization: Bearer <PIPELINE_API_KEY>
Content-Type: application/json
```

Body schema is documented above under **Input → Approval decision**.

---

## API reference

All `/api/v1/pipeline/*` endpoints require `Authorization: Bearer <PIPELINE_API_KEY>`.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | none | Liveness + DB health |
| POST | `/api/v1/pipeline/trigger` | bearer | Start a new pipeline run |
| GET | `/api/v1/pipeline/:id/status` | bearer | Poll run status and stage history |
| POST | `/api/v1/pipeline/:id/publish` | bearer | Force publish to Confluence |
| POST | `/api/v1/pipeline/approval-callback` | bearer | Power Automate callback for approval decisions |
| POST | `/api/v1/pipeline/mock-approve` | bearer | Dev-only synthetic approval |

---

## Project structure

```
threatmod/
├── server/                      Node.js + Hono backend
│   ├── index.ts                 app bootstrap, approval watcher
│   ├── config.ts                env → typed config
│   ├── middleware/auth.ts       bearer token check
│   ├── routes/
│   │   ├── pipeline.ts          trigger, status, publish
│   │   └── approval.ts          approval-callback, mock-approve
│   ├── orchestrator/            pipeline state machine + stages
│   │   ├── stateMachine.ts      legal transition graph
│   │   ├── runner.ts
│   │   ├── ingestion.ts
│   │   ├── analysisPool.ts      multi-methodology orchestration
│   │   ├── verificationRunner.ts
│   │   └── approvalWatcher.ts
│   ├── agents/                  single-responsibility workers
│   │   ├── strideAgent.ts
│   │   ├── attackMappingAgent.ts
│   │   ├── llmTop10Agent.ts
│   │   ├── summariser.ts
│   │   ├── enrichment.ts
│   │   ├── awsExtractor.ts
│   │   ├── awsVerifier.ts
│   │   └── publisher.ts
│   ├── connectors/              external integrations
│   │   ├── github.ts            Octokit
│   │   ├── confluence.ts
│   │   ├── markdownToConfluence.ts
│   │   ├── powerAutomate.ts
│   │   └── awsMcp.ts
│   ├── llm/                     provider abstraction
│   │   ├── types.ts
│   │   ├── index.ts
│   │   ├── anthropic.ts
│   │   └── azureOpenAI.ts
│   ├── prompts/                 versioned prompt markdown
│   │   ├── stride.md
│   │   ├── attack-mapping.md
│   │   ├── llm-top10.md
│   │   └── summarise.md
│   └── db/                      better-sqlite3 + migrations
│       ├── client.ts
│       ├── migrate.ts
│       ├── controlMappings.ts
│       ├── migrations/
│       └── seeds/
├── client/                      React + Vite frontend
│   └── src/
│       ├── main.tsx             Vite entry
│       ├── App.tsx              router
│       ├── index.css            Tailwind directives
│       ├── pages/
│       │   ├── DocumentList.tsx
│       │   └── DocumentEditor.tsx
│       ├── api/
│       └── hooks/
├── tests/
│   └── e2e/fullPipeline.test.ts
├── _agent-instructions/         junction → C:\code\_agent-instructions
├── .env.example
├── CLAUDE.md                    AI agent entry point
├── package.json
├── tsconfig.json
└── README.md                    this file
```

---

## Development

### Scripts — root

```bash
npm run dev         # tsx watch server/index.ts
npm run build       # tsc
npm run typecheck   # tsc --noEmit
npm run db:migrate  # apply SQLite migrations
```

### Scripts — client

```bash
cd client
npm run dev         # vite dev server
npm run build       # tsc && vite build
npm run typecheck   # tsc --noEmit
```

### Testing

```bash
npx tsx tests/e2e/fullPipeline.test.ts
```

Testing conventions: see `_agent-instructions/threatmod/AGENTS.tester.md`.

### Multi-agent development workflow

This repo uses a multi-agent workflow (orchestrator / backend / frontend / tester). Agent instructions live in `_agent-instructions/threatmod/` with the orchestrator as the entry point. See `AGENTS.orchestrator.md` for the HANDOFF protocol.

### Dependency policy

When scaffolding or adding dependencies, follow the latest-only policy in `_agent-instructions/threatmod/DEPENDENCY_POLICY.md`.

---

## Deployment

- **Local dev**: SQLite (`threatmod.db`) + `tsx watch`.
- **Production** (planned): Azure Container Apps + Azure Cosmos DB + Azure Key Vault for secrets. See the sprint backlog in `_agent-instructions/threatmod/sprint-status/` for the deployment sprint.

---

## Configuration reference

All env vars are loaded in `server/config.ts` and documented in `.env.example`.

| Variable | Default | Required | Purpose |
|---|---|---|---|
| `PORT` | `3000` | no | Backend listen port |
| `PIPELINE_API_KEY` | — | **yes** | Bearer token required on all `/api/v1/pipeline/*` calls |
| `SERVER_BASE_URL` | `http://localhost:$PORT` | no | Used to construct webhook callback URLs |
| `LLM_PROVIDER` | `anthropic` | no | `anthropic` or `azure-openai` |
| `ANTHROPIC_API_KEY` | — | if anthropic | Claude API key |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-6` | no | Model ID |
| `AZURE_OPENAI_ENDPOINT` | — | if azure | Azure OpenAI resource endpoint |
| `AZURE_OPENAI_API_KEY` | — | if azure | Azure OpenAI key |
| `AZURE_OPENAI_DEPLOYMENT` | `gpt-4o` | no | Deployment name |
| `GITHUB_TOKEN` | — | **yes** | PAT with repo read/write |
| `GITHUB_REPO` | — | **yes** | `owner/repo` (architecture docs + threat model output) |
| `GITHUB_FOLDER` | `architectures` | no | Input folder scanned for architecture docs |
| `GITHUB_OUTPUT_FOLDER` | `threat-models` | no | Output folder for committed threat models |
| `POWER_AUTOMATE_WEBHOOK_URL` | — | prod only | Webhook invoked to notify approver |
| `SECONDARY_APPROVER_EMAIL` | — | no | Escalation approver |
| `APPROVER_EMAIL` | — | no | Default primary approver (overridden per-run by request body) |
| `APPROVAL_TIMEOUT_HOURS` | `72` | no | Escalation timeout |
| `ENABLE_ATTACK_MAPPING` | `true` | no | `true` / `false` — enables MITRE ATT&CK tactic mapping alongside STRIDE |
| `ENABLE_LLM_TOP10` | `auto` | no | `true` / `false` / `auto` — OWASP LLM Top 10 analysis (`auto` gates on AI keyword detection in the architecture doc) |
| `MCP_SERVER_ENDPOINT` | — | for verification | AWS MCP Server URL |
| `MCP_AUTH_METHOD` | `api-key` | no | MCP auth method |
| `MCP_API_KEY` | — | if api-key | AWS MCP API key |
| `VERIFICATION_DEPTH` | `STANDARD` | no | `BASIC` / `STANDARD` / `DEEP` |
| `MAX_CONCURRENT_QUERIES` | `5` | no | Parallel MCP calls per run |
| `TOOL_TIMEOUT_SECONDS` | `30` | no | Per-MCP-call timeout |
| `CACHE_TTL_HOURS` | `24` | no | Verification result cache TTL |
| `CONFLUENCE_BASE_URL` | — | **yes** | e.g. `https://your-org.atlassian.net/wiki` |
| `CONFLUENCE_EMAIL` | — | **yes** | Confluence account email |
| `CONFLUENCE_API_TOKEN` | — | **yes** | Confluence API token |
| `CONFLUENCE_SPACE_ID` | — | **yes** | Target space |
| `CONFLUENCE_PARENT_PAGE_ID` | — | **yes** | Parent page under which threat models are published |
| `PIPELINE_CONCURRENCY` | `3` | no | Max concurrent pipeline runs |

Client-side (`client/.env`):

| Variable | Purpose |
|---|---|
| `VITE_GITHUB_TOKEN` | GitHub PAT used by the in-browser Octokit client |
| `VITE_GITHUB_REPO` | `owner/repo` for browsing architecture docs |
| `VITE_GITHUB_FOLDER` | Folder to list (default `architectures`) |

---

## Further reading

- Agent workflow: `_agent-instructions/threatmod/AGENTS.orchestrator.md`
- Dependency policy: `_agent-instructions/threatmod/DEPENDENCY_POLICY.md`
- Sprint history: `_agent-instructions/threatmod/sprint-status/README.md`
