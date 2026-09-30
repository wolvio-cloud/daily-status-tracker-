# Founder Cockpit

Private founder dashboard for Wolvio: projects, billing, receivables, burn, runway,
allocations and pipeline — updated by chatting with Claude via a remote MCP server,
viewed on a read-only dashboard. Runs on Cloudflare Workers + D1.

See [`CLAUDE.md`](./CLAUDE.md) for conventions, business rules and the security model.

## Layout

| Path             | What                                                         |
| ---------------- | ------------------------------------------------------------ |
| `packages/core`  | Pure domain logic: money, FY helpers, rules, schemas, repo   |
| `apps/mcp`       | Remote MCP server Worker (Google OAuth, read + write tools)  |
| `apps/dashboard` | Read-only dashboard Worker (Hono API + React SPA, CF Access) |
| `migrations/`    | D1 SQL migrations, shared by both Workers                    |
| `scripts/`       | Seed / restore / maintenance scripts                         |

## Setup

Prerequisites: Node 22+ (`.nvmrc`), pnpm 10 (`corepack enable`), a Cloudflare account
(only needed from Gate 2 for deploys — local dev and tests run fully offline).

```sh
corepack enable
pnpm install
pnpm typecheck
pnpm lint
pnpm test
```

Run a Worker locally (uses a local D1 under `.wrangler/`):

```sh
pnpm dev:mcp         # http://localhost:8787/health
pnpm dev:dashboard
```

### Cloudflare D1 (from Gate 1/2)

```sh
pnpm --filter @cockpit/mcp exec wrangler login
pnpm --filter @cockpit/mcp exec wrangler d1 create founder-cockpit
# paste the returned database_id into BOTH apps/mcp/wrangler.toml and apps/dashboard/wrangler.toml
pnpm --filter @cockpit/mcp exec wrangler d1 migrations apply founder-cockpit --local
```

### Secrets

Local: copy `.dev.vars.example` to `apps/mcp/.dev.vars` and fill in. Production:
`wrangler secret put <NAME>` from the app directory. Never commit secrets.

## Build gates

| Gate | Scope                                    | Status |
| ---- | ---------------------------------------- | ------ |
| 0    | Scaffold                                 | ✅     |
| 1    | Schema, money & business rules           |        |
| 2    | MCP server: Google OAuth + read tools    |        |
| 3    | Write tools, confirm tokens, audit, undo |        |
| 4    | Dashboard (Cloudflare Access)            |        |
| 5    | Backups & hardening                      |        |
