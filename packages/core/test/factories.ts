// Minimal row builders for rule tests. Ids are readable strings: the rules
// never validate ids, only compare them.
import type {
  Allocation,
  CashSnapshot,
  Expense,
  Invoice,
  Milestone,
  Payment,
  Person,
  PipelineDeal,
  Project,
} from '../src/schemas';

const meta = {
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  deleted_at: null,
};
let n = 0;
const nextId = (p: string) => `${p}${++n}`;

export const L = 1_00_000 * 100;
export const K = 1_000 * 100;

export const person = (o: Partial<Person> = {}): Person => ({
  id: nextId('per'),
  name: 'Person',
  email: null,
  role: 'employee',
  active: true,
  ...meta,
  ...o,
});

export const project = (o: Partial<Project> = {}): Project => ({
  id: nextId('prj'),
  name: 'Project',
  client: 'Client',
  type: 'service',
  owner_person_id: null,
  status: 'active',
  rag_override: null,
  rag_override_reason: null,
  contract_value_paise: null,
  start_date: null,
  end_date: null,
  notes: null,
  ...meta,
  ...o,
});

export const milestone = (o: Partial<Milestone> & { project_id: string }): Milestone => ({
  id: nextId('ms'),
  title: 'Milestone',
  due_date: '2026-09-30',
  done_at: null,
  billing_paise: null,
  ...meta,
  ...o,
});

export const invoice = (
  o: Partial<Invoice> & { amount_excl_gst_paise: number; project_id?: string },
): Invoice => {
  const gst = o.gst_paise ?? Math.round(o.amount_excl_gst_paise * 0.18);
  return {
    id: nextId('inv'),
    project_id: 'prj0',
    invoice_no: nextId('INV-'),
    invoice_date: '2026-09-01',
    due_date: '2026-10-01',
    notes: null,
    ...meta,
    ...o,
    gst_paise: gst,
    total_paise: o.total_paise ?? o.amount_excl_gst_paise + gst,
  };
};

export const payment = (
  o: Partial<Payment> & { invoice_id: string; amount_paise: number },
): Payment => ({
  id: nextId('pay'),
  received_date: '2026-09-15',
  mode: 'bank_transfer',
  reference: null,
  ...meta,
  ...o,
});

export const expense = (o: Partial<Expense> & { amount_paise: number; date: string }): Expense => ({
  id: nextId('exp'),
  category: 'tools',
  vendor: null,
  notes: null,
  ...meta,
  ...o,
});

export const allocation = (
  o: Partial<Allocation> & { person_id: string; project_id: string; percent: number },
): Allocation => ({
  id: nextId('alc'),
  month: '2026-09',
  ...meta,
  ...o,
});

export const cash = (
  as_of_date: string,
  balance_paise: number,
  created_at = meta.created_at,
): CashSnapshot => ({
  id: nextId('cash'),
  as_of_date,
  balance_paise,
  source: null,
  created_at,
  updated_at: created_at,
});

export const deal = (
  o: Partial<PipelineDeal> & Pick<PipelineDeal, 'stage' | 'value_paise'>,
): PipelineDeal => ({
  id: nextId('deal'),
  name: 'Deal',
  client: 'Client',
  expected_close: null,
  owner_person_id: null,
  ...meta,
  ...o,
});

export const DELETED = { deleted_at: '2026-09-01T00:00:00.000Z' };
