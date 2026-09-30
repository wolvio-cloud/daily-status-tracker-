# Founder Cockpit — CLAUDE.md

Private operating dashboard for the Wolvio founders. Data is entered by talking to
Claude (claude.ai → remote MCP server) and viewed on a read-only dashboard.
Built in gates (see README). **Do one gate per session, then STOP.**

> The rules below are **starting defaults** chosen at Gate 0. Change any of them by
> editing this file. Claude: treat them as settled. Ask only when a rule doesn't cover the case.

## Stack

- pnpm workspace, TypeScript strict, ESLint + Prettier, Vitest
  (`@cloudflare/vitest-pool-workers` for Workers, plain Vitest for `packages/core`).
- Cloudflare Workers + D1 (one database, binding `DB`, shared by both apps).
- `packages/core` — pure domain logic (money, FY, rules, Zod schemas, repository).
  **All calculations live here.** Apps never re-implement a rule.
- `apps/mcp` — remote MCP server (Streamable HTTP, Google OAuth, `agents` McpAgent +
  `@cloudflare/workers-oauth-provider`).
- `apps/dashboard` — Hono API + React SPA behind Cloudflare Access. Read-only.
- `migrations/` — D1 SQL migrations (`NNNN_name.sql`), applied by wrangler.
- `scripts/` — seed, restore and other one-off Node scripts.

## Commands

- `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm format`
- `pnpm dev:mcp` · `pnpm dev:dashboard`
- Every change must leave typecheck, lint and test green.

## Data conventions

- **Money** is stored as integer **paise** (`*_paise` columns, INTEGER). Never floats.
  Parse user input with `parseInr`, display with `formatInr` (Indian grouping,
  `₹3,20,000`). Ambiguous input is rejected, never guessed.
- **Dates** are ISO `YYYY-MM-DD` strings in **IST (Asia/Kolkata)**. Timestamps
  (`created_at`, `updated_at`) are ISO-8601 UTC. Months are `YYYY-MM`.
- **Financial year** is Indian: 1 Apr – 31 Mar. Q1 = Apr–Jun … Q4 = Jan–Mar.
  FY label format: `FY26-27` (1 Apr 2026 – 31 Mar 2027); quarter label `Q2 FY26-27`.
- **IDs**: ULID text ids (sortable by creation time, safe to show in URLs/chat).
- **Milestones**: `done_at` is the completion date (`YYYY-MM-DD`), null while open.
- **Soft deletes only** (`deleted_at`). Every read excludes soft-deleted rows.
- **GST**: default rate **18%** (IT services); can be overridden per invoice. Invoices store excl-GST, GST and total
  separately; revenue figures use **excl-GST** amounts.
- Every write goes through the repository and writes its audit row in the same
  `db.batch()`.

## Business rules

- **Revenue billed** (MTD/QTD/FY) = sum of `amount_excl_gst_paise` by `invoice_date`.
- **Receivables** = invoice total − payments received, for invoices with outstanding > 0.
  Ageing buckets by days past `due_date`: **Not due** / **1–30** / **31–60** / **61–90** / **90+**.
- **Burn** (monthly) = sum of all expenses in the month, **including `founder_salary`**
  (it is real cash out). Reports may also show burn excl. founder salary as a secondary figure.
- **Net burn** = burn − cash received (payments) in the month.
- **Runway** (months) = latest cash snapshot balance ÷ average net burn over the **last 3
  complete months**. Zero or negative net burn → runway "∞ / not burning". No cash
  snapshot → runway "unknown".
- **Project RAG** — only for `status = active` projects (paused/closed show no RAG).
  A set `rag_override` wins and must have a reason. Otherwise:
  - **Red** if any open milestone is > 14 days past due, **or** any invoice on the
    project is > 60 days past due, **or** `end_date` has passed while still active.
  - **Amber** if any open milestone is 1–14 days past due, **or** any invoice is 31–60
    days past due, **or** an open milestone is due within the next 7 days (today included).
  - **Green** otherwise.
- **Allocation flags** per person per month: **over-allocated** if total > 100%;
  **under-allocated** if total < 50%. Inactive people are not flagged.
- **Pipeline stages** and probabilities (weighted pipeline = Σ value × probability):
  `lead` 10% · `qualified` 25% · `proposal` 50% · `negotiation` 75% · `won` 100% ·
  `lost` 0%. The headline open total and weighted figure use **open deals only**
  (won/lost excluded — won work shows up as invoices); won/lost still appear per stage.
- **Focus meter** = share of **founders'** allocation % (people with `role = founder`)
  in the month that is on `type = product` projects vs `service`/`retainer`.
  Target **≥ 40% product**. Below 25% = red, 25–39% = amber, ≥ 40% = green.

## People

- Founders are allowlisted via the `FOUNDER_EMAILS` secret (comma-separated). The real
  emails are supplied at deploy time (Gate 2) — never committed to this repo.

## Security model

- Only allowlisted founder emails may do anything. The MCP server checks the email
  at the OAuth callback **and on every tool call**. The dashboard verifies the
  Cloudflare Access JWT (`Cf-Access-Jwt-Assertion`) and the email allowlist.
- Writes are two-phase: `dry_run` (default `true`) returns a preview + single-use
  confirm token (10-min expiry, bound to actor + payload hash); commit requires the token.
- No raw SQL tool. Soft deletes only. Every write is audited (before/after JSON +
  the user's original message as `source_text`) and undoable.
- Rate limit: 60 writes/hour per user.
- **Never log amounts, emails or tokens.** No amounts in URLs. `console.log` is lint-banned.
- Secrets live in `wrangler secret` / `.dev.vars` (git-ignored) — never in the repo.

## Where things live (packages/core)

- `money.ts` parseInr / formatInr / formatInrCompact · `fy.ts` FY, quarters, IST dates
- `rules.ts` every business rule above (thresholds exported as constants)
- `schemas.ts` Zod schemas + enums (mirror the CHECKs in `migrations/0001_init.sql`)
- `repo.ts` D1 repository: write + audit row in one `db.batch()`, optimistic lock on
  `updated_at`, soft delete · `sample-data.ts` SAMPLE dataset · `sql-export.ts` INSERT SQL

## Working rules for Claude

- Stay inside the gate's LIMITS. If a business rule is unclear, ask before coding it.
- Pure functions in `packages/core` get unit tests for edge cases (zero burn, partial
  payments, FY boundary 31 Mar / 1 Apr, allocation > 100%, `3.2L` vs `32L` vs `3.2 Cr`).
- Sample/seed data is clearly marked SAMPLE and uses fake amounts.
- Finish each gate with: tests green, commit, short summary, STOP.
