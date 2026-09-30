// SAMPLE DATA — fake amounts, fake people. For local dev, demos and tests only.
// Project names are Wolvio's real project names; every figure is invented.
// All dates are relative to `today` so the dashboard always looks "live".
import { type IsoDate, addDays, addMonths, monthOf, monthRange } from './fy';
import { seededRandom, ulid } from './ids';
import type {
  Allocation,
  CashSnapshot,
  Dataset,
  Expense,
  ExpenseCategory,
  Invoice,
  Milestone,
  Payment,
  PaymentMode,
  Person,
  PersonRole,
  PipelineDeal,
  PipelineStage,
  Project,
  ProjectStatus,
  ProjectType,
  Rag,
} from './schemas';

export const SAMPLE_MARKER = 'SAMPLE';

const L = 1_00_000 * 100; // one lakh rupees, in paise
const K = 1_000 * 100; // one thousand rupees, in paise

export const SAMPLE_GST_PERCENT = 18;

export function buildSampleData(today: IsoDate): Dataset {
  const rand = seededRandom(20260401);
  let tick = Date.parse('2026-04-01T00:00:00Z');
  const id = () => ulid(tick++, rand);
  const ts = `${today}T04:30:00.000Z`;
  const meta = { created_at: ts, updated_at: ts, deleted_at: null };
  const d = (offset: number) => addDays(today, offset);
  const m0 = monthOf(today);

  // ---- people ----
  const person = (name: string, role: PersonRole, email: string | null, active = true): Person => ({
    id: id(),
    name,
    email,
    role,
    active,
    ...meta,
  });
  const founderA = person('Sample Founder A', 'founder', 'founder-a@example.com');
  const founderB = person('Sample Founder B', 'founder', 'founder-b@example.com');
  const eng1 = person('Sample Engineer 1', 'employee', 'eng1@example.com');
  const eng2 = person('Sample Engineer 2', 'employee', 'eng2@example.com');
  const eng3 = person('Sample Engineer 3', 'employee', 'eng3@example.com');
  const designer = person('Sample Designer', 'employee', 'design@example.com');
  const contractor = person('Sample Contractor', 'contractor', null);
  const alumni = person('Sample Alumni', 'employee', 'alumni@example.com', false);
  const people = [founderA, founderB, eng1, eng2, eng3, designer, contractor, alumni];

  // ---- projects ----
  const project = (
    name: string,
    client: string,
    type: ProjectType,
    owner: Person,
    opts: {
      status?: ProjectStatus;
      contract?: number | null;
      start?: IsoDate | null;
      end?: IsoDate | null;
      override?: [Rag, string];
    } = {},
  ): Project => ({
    id: id(),
    name,
    client,
    type,
    owner_person_id: owner.id,
    status: opts.status ?? 'active',
    rag_override: opts.override?.[0] ?? null,
    rag_override_reason: opts.override?.[1] ?? null,
    contract_value_paise: opts.contract ?? null,
    start_date: opts.start ?? null,
    end_date: opts.end ?? null,
    notes: `${SAMPLE_MARKER} — fake figures for demo only`,
    ...meta,
  });
  const redTaxi = project('RedTaxi', 'RedTaxi', 'service', founderA, {
    contract: 18 * L,
    start: d(-150),
    end: d(60),
  });
  const vayona = project('Vayona CEI', 'Vayona', 'service', founderA, {
    contract: 24 * L,
    start: d(-120),
    end: d(120),
  });
  const idfis = project('IDFIS', 'IDFIS', 'service', founderB, {
    contract: 9 * L,
    start: d(-90),
    end: d(90),
  });
  const rams = project('RAMS360', 'Wolvio (internal product)', 'product', founderB, {
    start: d(-200),
  });
  const indiaNippon = project('India Nippon', 'India Nippon', 'service', founderB, {
    contract: 7.5 * L,
    start: d(-60),
    end: d(150),
    override: ['amber', `${SAMPLE_MARKER}: client stakeholder change, scope under review`],
  });
  const mkm = project('MKM', 'MKM', 'retainer', founderA, {
    contract: 1.5 * L * 12,
    start: d(-300),
  });
  const kunneckt = project('Kunneckt', 'Wolvio (internal product)', 'product', founderB, {
    status: 'paused',
    start: d(-240),
  });
  const projects = [redTaxi, vayona, idfis, rams, indiaNippon, mkm, kunneckt];

  // ---- milestones ----
  const milestone = (
    p: Project,
    title: string,
    due: number,
    doneAt: number | null,
    billing: number | null,
  ): Milestone => ({
    id: id(),
    project_id: p.id,
    title,
    due_date: d(due),
    done_at: doneAt === null ? null : d(doneAt),
    billing_paise: billing,
    ...meta,
  });
  const milestones = [
    milestone(redTaxi, 'Driver app beta', -100, -98, 5 * L),
    milestone(redTaxi, 'Dispatch console v1', -20, null, 4 * L), // 20 days late -> red
    milestone(redTaxi, 'Production launch', 45, null, 5 * L),
    milestone(vayona, 'Discovery & CEI model', -80, -76, 6 * L),
    milestone(vayona, 'Pilot dashboards', 25, null, 6 * L),
    milestone(idfis, 'Data pipeline', -65, -62, 3 * L),
    milestone(idfis, 'Reporting module', 20, null, 3 * L),
    milestone(rams, 'Asset register GA', 30, null, null),
    milestone(indiaNippon, 'Requirements sign-off', -45, -41, 2.5 * L),
    milestone(indiaNippon, 'Phase 1 build', 40, null, 2.5 * L),
    milestone(mkm, 'Monthly support report', 3, null, null), // due in 3 days
    milestone(kunneckt, 'Private beta', -30, null, null), // paused: no RAG
  ];

  // ---- invoices & payments ----
  let invNo = 0;
  const invoice = (p: Project, invoiceDate: IsoDate, dueDays: number, excl: number): Invoice => {
    const gst = Math.round((excl * SAMPLE_GST_PERCENT) / 100);
    invNo += 1;
    return {
      id: id(),
      project_id: p.id,
      invoice_no: `${SAMPLE_MARKER}-INV-${String(invNo).padStart(3, '0')}`,
      invoice_date: invoiceDate,
      due_date: addDays(invoiceDate, dueDays),
      amount_excl_gst_paise: excl,
      gst_paise: gst,
      total_paise: excl + gst,
      notes: SAMPLE_MARKER,
      ...meta,
    };
  };
  const payment = (
    inv: Invoice,
    received: IsoDate,
    amount: number,
    mode: PaymentMode = 'bank_transfer',
  ): Payment => ({
    id: id(),
    invoice_id: inv.id,
    received_date: received,
    amount_paise: amount,
    mode,
    reference: `${SAMPLE_MARKER}-UTR-${received.replace(/-/g, '')}`,
    ...meta,
  });

  const rt1 = invoice(redTaxi, d(-120), 30, 5 * L); // paid across two payments
  const rt2 = invoice(redTaxi, d(-25), 30, 4 * L); // open, not due
  const vc1 = invoice(vayona, d(-75), 30, 6 * L); // 45 days overdue
  const vc2 = invoice(vayona, d(-10), 30, 6 * L); // partially paid, not due
  const id1 = invoice(idfis, d(-60), 30, 3 * L); // paid in full
  const in1 = invoice(indiaNippon, d(-40), 30, 2.5 * L); // 10 days overdue
  const mk1 = invoice(mkm, d(-105), 30, 1.5 * L); // 75 days overdue, part-paid
  const mk2 = invoice(mkm, d(-135), 30, 1.5 * L); // 105 days overdue
  const mk3 = invoice(mkm, monthRange(m0).from, 30, 1.5 * L); // this month
  const invoices = [rt1, rt2, vc1, vc2, id1, in1, mk1, mk2, mk3];

  const payments = [
    payment(rt1, d(-95), 3 * L),
    payment(rt1, d(-80), rt1.total_paise - 3 * L, 'upi'),
    payment(vc2, d(-3), 2 * L),
    payment(id1, d(-28), id1.total_paise),
    payment(mk1, d(-60), 50 * K, 'cheque'),
  ];

  // ---- expenses (6 complete months + month-to-date) ----
  const expense = (
    date: IsoDate,
    category: ExpenseCategory,
    amount: number,
    vendor: string,
  ): Expense => ({
    id: id(),
    date,
    category,
    amount_paise: amount,
    vendor: `${vendor} (${SAMPLE_MARKER})`,
    notes: null,
    ...meta,
  });
  const expenses: Expense[] = [];
  for (let i = 6; i >= 1; i--) {
    const month = addMonths(m0, -i);
    const { from, to } = monthRange(month);
    expenses.push(
      expense(to, 'salary', 6 * L, 'Payroll'),
      expense(to, 'founder_salary', 2 * L, 'Payroll'),
      expense(from, 'rent', 80 * K, 'Office landlord'),
      expense(addDays(from, 4), 'tools', 40 * K + i * 1_500 * 100, 'SaaS tools'),
      expense(addDays(from, 9), 'infra', 60 * K, 'Cloud hosting'),
    );
    if (i % 2 === 0) expenses.push(expense(addDays(from, 14), 'travel', 35 * K, 'Client visits'));
  }
  const monthStart = monthRange(m0).from;
  expenses.push(
    expense(monthStart, 'rent', 80 * K, 'Office landlord'),
    expense(monthStart, 'tools', 42 * K, 'SaaS tools'),
  );

  // ---- cash ----
  const cash = (asOf: IsoDate, balance: number): CashSnapshot => ({
    id: id(),
    as_of_date: asOf,
    balance_paise: balance,
    source: `${SAMPLE_MARKER} bank statement`,
    created_at: ts,
    updated_at: ts,
  });
  const cash_snapshots = [cash(d(-40), 48 * L), cash(d(-2), 42 * L)];

  // ---- allocations (current and previous month) ----
  const allocationsFor = (month: string): Allocation[] => {
    const a = (p: Person, proj: Project, percent: number): Allocation => ({
      id: id(),
      person_id: p.id,
      project_id: proj.id,
      month,
      percent,
      ...meta,
    });
    return [
      a(founderA, redTaxi, 30),
      a(founderA, vayona, 30),
      a(founderA, rams, 20),
      a(founderA, mkm, 10),
      a(founderB, rams, 40),
      a(founderB, kunneckt, 10),
      a(founderB, indiaNippon, 20),
      a(eng1, redTaxi, 60), // eng1 = 110% -> over
      a(eng1, vayona, 50),
      a(eng2, idfis, 100),
      a(eng3, rams, 30), // eng3 = 30% -> under
      a(designer, redTaxi, 40),
      a(designer, rams, 40),
      a(contractor, mkm, 50),
    ];
  };
  const allocations = [...allocationsFor(addMonths(m0, -1)), ...allocationsFor(m0)];

  // ---- pipeline ----
  const deal = (
    name: string,
    client: string,
    stage: PipelineStage,
    value: number,
    close: number | null,
    owner: Person,
  ): PipelineDeal => ({
    id: id(),
    name,
    client,
    stage,
    value_paise: value,
    expected_close: close === null ? null : d(close),
    owner_person_id: owner.id,
    ...meta,
  });
  const pipeline_deals = [
    deal('RedTaxi fleet analytics', 'RedTaxi', 'lead', 10 * L, 90, founderA),
    deal('Vayona CEI phase 2', 'Vayona', 'proposal', 30 * L, 45, founderA),
    deal(`Kunneckt pilot (${SAMPLE_MARKER})`, 'Sample Retail Co', 'qualified', 8 * L, 60, founderB),
    deal('India Nippon AMC', 'India Nippon', 'negotiation', 12 * L, 20, founderB),
    deal('IDFIS extension', 'IDFIS', 'won', 5 * L, -5, founderB),
    deal(`Chatbot RFP (${SAMPLE_MARKER})`, 'Sample Bank', 'lost', 6 * L, -15, founderA),
  ];

  return {
    people,
    projects,
    milestones,
    allocations,
    invoices,
    payments,
    expenses,
    cash_snapshots,
    pipeline_deals,
  };
}
