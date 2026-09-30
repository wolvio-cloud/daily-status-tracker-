// Business rules from CLAUDE.md > Business rules. Pure functions only: callers
// pass live (non-deleted) rows and `today` (IST); nothing here touches D1 or
// the clock. Soft-deleted rows are ignored defensively anyway.
import {
  type DateRange,
  type IsoDate,
  type IsoMonth,
  daysBetween,
  inRange,
  monthRange,
  previousCompleteMonths,
} from './fy';
import type {
  Allocation,
  CashSnapshot,
  Expense,
  Invoice,
  Milestone,
  Payment,
  Person,
  PipelineDeal,
  PipelineStage,
  Project,
  Rag,
} from './schemas';

const live = <T extends { deleted_at?: string | null }>(rows: readonly T[]): T[] =>
  rows.filter((r) => !r.deleted_at);

const sum = (ns: readonly number[]): number => ns.reduce((a, b) => a + b, 0);

// ---- revenue & receivables --------------------------------------------------

/** Revenue billed in a date range = Σ amount excl. GST by invoice_date. */
export function revenueBilled(invoices: readonly Invoice[], range: DateRange): number {
  return sum(
    live(invoices)
      .filter((i) => inRange(i.invoice_date, range))
      .map((i) => i.amount_excl_gst_paise),
  );
}

/** Payments received per invoice id. */
export function paidByInvoice(payments: readonly Payment[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of live(payments))
    out.set(p.invoice_id, (out.get(p.invoice_id) ?? 0) + p.amount_paise);
  return out;
}

/** Outstanding = total − payments (never below zero). */
export function invoiceOutstanding(invoice: Invoice, payments: readonly Payment[]): number {
  const paid = sum(
    live(payments)
      .filter((p) => p.invoice_id === invoice.id)
      .map((p) => p.amount_paise),
  );
  return Math.max(0, invoice.total_paise - paid);
}

export type InvoiceStatus = 'paid' | 'open' | 'overdue';

export function invoiceStatus(
  invoice: Invoice,
  payments: readonly Payment[],
  today: IsoDate,
): InvoiceStatus {
  if (invoiceOutstanding(invoice, payments) === 0) return 'paid';
  return today > invoice.due_date ? 'overdue' : 'open';
}

export const AGEING_BUCKETS = ['not_due', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'] as const;
export type AgeingBucket = (typeof AGEING_BUCKETS)[number];
export const AGEING_BUCKET_LABELS: Record<AgeingBucket, string> = {
  not_due: 'Not due',
  d1_30: '1–30 days',
  d31_60: '31–60 days',
  d61_90: '61–90 days',
  d90_plus: '90+ days',
};

export function ageingBucket(dueDate: IsoDate, today: IsoDate): AgeingBucket {
  const overdue = daysBetween(dueDate, today);
  if (overdue <= 0) return 'not_due';
  if (overdue <= 30) return 'd1_30';
  if (overdue <= 60) return 'd31_60';
  if (overdue <= 90) return 'd61_90';
  return 'd90_plus';
}

export interface ReceivablesAgeing {
  totalPaise: number;
  invoiceCount: number;
  buckets: Record<AgeingBucket, { paise: number; count: number }>;
}

/** Receivables = outstanding on every invoice with a balance, bucketed by days past due. */
export function receivablesAgeing(
  invoices: readonly Invoice[],
  payments: readonly Payment[],
  today: IsoDate,
): ReceivablesAgeing {
  const paid = paidByInvoice(payments);
  const buckets = Object.fromEntries(
    AGEING_BUCKETS.map((b) => [b, { paise: 0, count: 0 }]),
  ) as ReceivablesAgeing['buckets'];
  let totalPaise = 0;
  let invoiceCount = 0;
  for (const inv of live(invoices)) {
    const outstanding = Math.max(0, inv.total_paise - (paid.get(inv.id) ?? 0));
    if (outstanding === 0) continue;
    const b = buckets[ageingBucket(inv.due_date, today)];
    b.paise += outstanding;
    b.count += 1;
    totalPaise += outstanding;
    invoiceCount += 1;
  }
  return { totalPaise, invoiceCount, buckets };
}

// ---- burn & runway ----------------------------------------------------------

/** Monthly burn = Σ expenses dated in the month (founder salary included by default). */
export function burn(
  expenses: readonly Expense[],
  month: IsoMonth,
  opts: { includeFounderSalary?: boolean } = {},
): number {
  const includeFounder = opts.includeFounderSalary ?? true;
  const range = monthRange(month);
  return sum(
    live(expenses)
      .filter((e) => inRange(e.date, range))
      .filter((e) => includeFounder || e.category !== 'founder_salary')
      .map((e) => e.amount_paise),
  );
}

/** Cash received (payments) dated in the month. */
export function cashReceived(payments: readonly Payment[], month: IsoMonth): number {
  const range = monthRange(month);
  return sum(
    live(payments)
      .filter((p) => inRange(p.received_date, range))
      .map((p) => p.amount_paise),
  );
}

/** Net burn = burn − cash received. Negative means cash-positive that month. */
export function netBurn(
  expenses: readonly Expense[],
  payments: readonly Payment[],
  month: IsoMonth,
): number {
  return burn(expenses, month) - cashReceived(payments, month);
}

export const RUNWAY_LOOKBACK_MONTHS = 3;

export type Runway =
  | { kind: 'unknown'; reason: 'no_cash_snapshot' }
  | { kind: 'not_burning'; balancePaise: number; avgNetBurnPaise: number; months: IsoMonth[] }
  | {
      kind: 'months';
      months: number;
      balancePaise: number;
      avgNetBurnPaise: number;
      asOf: IsoDate;
      lookback: IsoMonth[];
    };

export function latestCashSnapshot(snapshots: readonly CashSnapshot[]): CashSnapshot | null {
  let best: CashSnapshot | null = null;
  for (const s of snapshots) {
    if (
      !best ||
      s.as_of_date > best.as_of_date ||
      (s.as_of_date === best.as_of_date && s.created_at > best.created_at)
    ) {
      best = s;
    }
  }
  return best;
}

/**
 * Runway (months) = latest cash balance ÷ average net burn over the last 3
 * complete months. Zero/negative average → not burning. No snapshot → unknown.
 */
export function runway(
  snapshots: readonly CashSnapshot[],
  expenses: readonly Expense[],
  payments: readonly Payment[],
  today: IsoDate,
): Runway {
  const snap = latestCashSnapshot(snapshots);
  if (!snap) return { kind: 'unknown', reason: 'no_cash_snapshot' };
  const lookback = previousCompleteMonths(today, RUNWAY_LOOKBACK_MONTHS);
  const avgNetBurnPaise = Math.round(
    sum(lookback.map((m) => netBurn(expenses, payments, m))) / lookback.length,
  );
  if (avgNetBurnPaise <= 0) {
    return {
      kind: 'not_burning',
      balancePaise: snap.balance_paise,
      avgNetBurnPaise,
      months: lookback,
    };
  }
  const months = Math.max(0, Math.round((snap.balance_paise / avgNetBurnPaise) * 10) / 10);
  return {
    kind: 'months',
    months,
    balancePaise: snap.balance_paise,
    avgNetBurnPaise,
    asOf: snap.as_of_date,
    lookback,
  };
}

// ---- project RAG --------------------------------------------------------------

export interface ProjectRagResult {
  /** null for paused/closed projects (no RAG shown). */
  rag: Rag | null;
  source: 'override' | 'computed' | 'inactive';
  reasons: string[];
}

export const RAG_THRESHOLDS = {
  milestoneRedDays: 14,
  invoiceRedDays: 60,
  invoiceAmberDays: 30,
  milestoneSoonDays: 7,
} as const;

export function nextOpenMilestone(
  milestones: readonly Milestone[],
  projectId: string,
): Milestone | null {
  const open = live(milestones)
    .filter((m) => m.project_id === projectId && m.done_at === null)
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
  return open[0] ?? null;
}

/**
 * Red: open milestone > 14 days late, invoice > 60 days overdue, or end_date
 * passed while active. Amber: milestone 1–14 days late, invoice 31–60 days
 * overdue, or an open milestone due within 7 days. Green otherwise.
 */
export function projectRag(
  project: Project,
  milestones: readonly Milestone[],
  invoices: readonly Invoice[],
  payments: readonly Payment[],
  today: IsoDate,
): ProjectRagResult {
  if (project.status !== 'active') return { rag: null, source: 'inactive', reasons: [] };
  if (project.rag_override) {
    return {
      rag: project.rag_override,
      source: 'override',
      reasons: [project.rag_override_reason ?? 'Manual override'],
    };
  }

  const t = RAG_THRESHOLDS;
  const red: string[] = [];
  const amber: string[] = [];

  for (const m of live(milestones)) {
    if (m.project_id !== project.id || m.done_at !== null) continue;
    const late = daysBetween(m.due_date, today);
    if (late > t.milestoneRedDays) red.push(`Milestone "${m.title}" ${late} days late`);
    else if (late >= 1) amber.push(`Milestone "${m.title}" ${late} days late`);
    else if (-late <= t.milestoneSoonDays) amber.push(`Milestone "${m.title}" due ${m.due_date}`);
  }

  const paid = paidByInvoice(payments);
  for (const inv of live(invoices)) {
    if (inv.project_id !== project.id) continue;
    if (inv.total_paise - (paid.get(inv.id) ?? 0) <= 0) continue;
    const overdue = daysBetween(inv.due_date, today);
    if (overdue > t.invoiceRedDays) red.push(`Invoice ${inv.invoice_no} ${overdue} days overdue`);
    else if (overdue > t.invoiceAmberDays) {
      amber.push(`Invoice ${inv.invoice_no} ${overdue} days overdue`);
    }
  }

  if (project.end_date && today > project.end_date) {
    red.push(`End date ${project.end_date} has passed`);
  }

  if (red.length) return { rag: 'red', source: 'computed', reasons: red };
  if (amber.length) return { rag: 'amber', source: 'computed', reasons: amber };
  return { rag: 'green', source: 'computed', reasons: [] };
}

// ---- allocations ------------------------------------------------------------

export const ALLOCATION_UNDER_PERCENT = 50;
export const ALLOCATION_OVER_PERCENT = 100;

export interface AllocationFlag {
  personId: string;
  name: string;
  totalPercent: number;
  flag: 'over' | 'under' | 'ok';
}

/** Per active person for the month: over if total > 100%, under if < 50%. */
export function allocationFlags(
  people: readonly Person[],
  allocations: readonly Allocation[],
  month: IsoMonth,
): AllocationFlag[] {
  const totals = new Map<string, number>();
  for (const a of live(allocations)) {
    if (a.month !== month) continue;
    totals.set(a.person_id, (totals.get(a.person_id) ?? 0) + a.percent);
  }
  return live(people)
    .filter((p) => p.active)
    .map((p) => {
      const totalPercent = totals.get(p.id) ?? 0;
      const flag =
        totalPercent > ALLOCATION_OVER_PERCENT
          ? 'over'
          : totalPercent < ALLOCATION_UNDER_PERCENT
            ? 'under'
            : 'ok';
      return { personId: p.id, name: p.name, totalPercent, flag } as const;
    });
}

// ---- pipeline -----------------------------------------------------------------

export const STAGE_PROBABILITY: Record<PipelineStage, number> = {
  lead: 10,
  qualified: 25,
  proposal: 50,
  negotiation: 75,
  won: 100,
  lost: 0,
};

export const OPEN_STAGES: readonly PipelineStage[] = [
  'lead',
  'qualified',
  'proposal',
  'negotiation',
];

export interface WeightedPipeline {
  /** Σ value of open deals (won/lost excluded). */
  openTotalPaise: number;
  /** Σ value × stage probability over open deals. */
  weightedPaise: number;
  openCount: number;
  byStage: Record<PipelineStage, { count: number; valuePaise: number; weightedPaise: number }>;
}

/**
 * Weighted pipeline over open deals only. Won deals are already (or soon)
 * invoices and lost deals are worth nothing, so neither counts toward the
 * headline figures; they still appear in `byStage`.
 */
export function weightedPipeline(deals: readonly PipelineDeal[]): WeightedPipeline {
  const byStage = Object.fromEntries(
    (Object.keys(STAGE_PROBABILITY) as PipelineStage[]).map((s) => [
      s,
      { count: 0, valuePaise: 0, weightedPaise: 0 },
    ]),
  ) as WeightedPipeline['byStage'];
  let openTotalPaise = 0;
  let weightedPaise = 0;
  let openCount = 0;
  for (const d of live(deals)) {
    const w = Math.round((d.value_paise * STAGE_PROBABILITY[d.stage]) / 100);
    const s = byStage[d.stage];
    s.count += 1;
    s.valuePaise += d.value_paise;
    s.weightedPaise += w;
    if (OPEN_STAGES.includes(d.stage)) {
      openTotalPaise += d.value_paise;
      weightedPaise += w;
      openCount += 1;
    }
  }
  return { openTotalPaise, weightedPaise, openCount, byStage };
}

// ---- focus meter ------------------------------------------------------------

export const FOCUS_TARGET_PERCENT = 40;
export const FOCUS_RED_BELOW_PERCENT = 25;

export interface FocusMeter {
  /** Share of founders' allocated % on product projects, 0–100 (1 decimal). null if none allocated. */
  productPercent: number | null;
  status: Rag | 'none';
  founderAllocatedPercent: number;
  productAllocatedPercent: number;
  targetPercent: number;
}

/**
 * Share of founders' allocation in the month that sits on `type = product`
 * projects. ≥ 40% green, 25–39% amber, < 25% red.
 */
export function focusMeter(
  people: readonly Person[],
  allocations: readonly Allocation[],
  projects: readonly Project[],
  month: IsoMonth,
): FocusMeter {
  const founders = new Set(
    live(people)
      .filter((p) => p.role === 'founder')
      .map((p) => p.id),
  );
  const projectType = new Map(live(projects).map((p) => [p.id, p.type]));
  let founderAllocatedPercent = 0;
  let productAllocatedPercent = 0;
  for (const a of live(allocations)) {
    if (a.month !== month || !founders.has(a.person_id)) continue;
    const type = projectType.get(a.project_id);
    if (type === undefined) continue;
    founderAllocatedPercent += a.percent;
    if (type === 'product') productAllocatedPercent += a.percent;
  }
  if (founderAllocatedPercent === 0) {
    return {
      productPercent: null,
      status: 'none',
      founderAllocatedPercent,
      productAllocatedPercent,
      targetPercent: FOCUS_TARGET_PERCENT,
    };
  }
  const productPercent =
    Math.round((productAllocatedPercent / founderAllocatedPercent) * 1000) / 10;
  const status: Rag =
    productPercent >= FOCUS_TARGET_PERCENT
      ? 'green'
      : productPercent >= FOCUS_RED_BELOW_PERCENT
        ? 'amber'
        : 'red';
  return {
    productPercent,
    status,
    founderAllocatedPercent,
    productAllocatedPercent,
    targetPercent: FOCUS_TARGET_PERCENT,
  };
}
