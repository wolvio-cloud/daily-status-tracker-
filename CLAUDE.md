# Founder Cockpit — CLAUDE.md

Private operating dashboard for the Wolvio founders. Data is entered by talking to
Claude (claude.ai → remote MCP server) and viewed on a read-only dashboard.
Built in gates (see README). **Do one gate per session, then STOP.**

> Fill in every `[DECIDE]` before starting Gate 1. Claude: if you hit a `[DECIDE]`
> that is still unfilled and it affects what you are building, ask — do not guess.

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
  FY label format: `[DECIDE: "FY26-27" or "FY2027"]`.
- **IDs**: `[DECIDE: ULID text ids (recommended) or integer autoincrement]`.
- **Soft deletes only** (`deleted_at`). Every read excludes soft-deleted rows.
- **GST**: `[DECIDE: default GST rate, e.g. 18%]`. Invoices store excl-GST, GST and total
  separately; revenue figures use **excl-GST** amounts.
- Every write goes through the repository and writes its audit row in the same
  `db.batch()`.

## Business rules

- **Revenue billed** (MTD/QTD/FY) = sum of `amount_excl_gst_paise` by `invoice_date`.
- **Receivables** = invoice total − payments received, for invoices with outstanding > 0.
  Ageing buckets by days past `due_date`: `[DECIDE: 0–30 / 31–60 / 61–90 / 90+]`.
- **Burn** (monthly) = sum of expenses in the month.
  Include `founder_salary` in burn? `[DECIDE: yes/no]`.
- **Net burn** = burn − cash received (payments) in the month.
- **Runway** (months) = latest cash snapshot balance ÷ average net burn over the last
  `[DECIDE: 3]` months. Zero or negative net burn → runway "∞ / not burning".
- **Project RAG** (unless `rag_override` is set, which requires a reason):
  - Red if: `[DECIDE: e.g. any milestone > 14 days overdue, or any invoice > 60 days overdue]`
  - Amber if: `[DECIDE: e.g. any milestone overdue, or next milestone due in ≤ 7 days and not done]`
  - Green otherwise.
- **Allocation flags** per person per month: over-allocated if total > 100%;
  under-allocated if total < `[DECIDE: 50]`%.
- **Weighted pipeline** = Σ deal value × stage probability. Stages and probabilities:
  `[DECIDE: e.g. lead 10%, qualified 25%, proposal 50%, negotiation 75%, won 100%, lost 0%]`.
- **Focus meter** = share of founder allocation on `[DECIDE: e.g. product vs service
projects]`; target `[DECIDE: e.g. ≥ 40% product]`.

## People

- Founders (FOUNDER_EMAILS allowlist): `[DECIDE: founder1@…, founder2@…]`
  — store as a secret, never commit the real list.

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

## Working rules for Claude

- Stay inside the gate's LIMITS. If a business rule is unclear, ask before coding it.
- Pure functions in `packages/core` get unit tests for edge cases (zero burn, partial
  payments, FY boundary 31 Mar / 1 Apr, allocation > 100%, `3.2L` vs `32L` vs `3.2 Cr`).
- Sample/seed data is clearly marked SAMPLE and uses fake amounts.
- Finish each gate with: tests green, commit, short summary, STOP.
