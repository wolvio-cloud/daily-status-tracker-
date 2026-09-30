// Zod schemas for every entity. Enum values mirror the CHECK constraints in
// migrations/0001_init.sql — change both together.
import { z } from 'zod';
import { isIsoDate, isIsoMonth } from './fy';
import { ULID_REGEX } from './ids';

export const PERSON_ROLES = ['founder', 'employee', 'contractor'] as const;
export const PROJECT_TYPES = ['service', 'product', 'retainer'] as const;
export const PROJECT_STATUSES = ['active', 'paused', 'closed'] as const;
export const RAGS = ['red', 'amber', 'green'] as const;
export const PAYMENT_MODES = ['bank_transfer', 'upi', 'cheque', 'cash', 'other'] as const;
export const EXPENSE_CATEGORIES = [
  'salary',
  'founder_salary',
  'tools',
  'infra',
  'rent',
  'travel',
  'other',
] as const;
export const PIPELINE_STAGES = [
  'lead',
  'qualified',
  'proposal',
  'negotiation',
  'won',
  'lost',
] as const;

export type PersonRole = (typeof PERSON_ROLES)[number];
export type ProjectType = (typeof PROJECT_TYPES)[number];
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export type Rag = (typeof RAGS)[number];
export type PaymentMode = (typeof PAYMENT_MODES)[number];
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

// ---- primitives -----------------------------------------------------------

export const idSchema = z.string().regex(ULID_REGEX, 'must be a ULID');
export const isoDateSchema = z.string().refine(isIsoDate, 'must be a date YYYY-MM-DD');
export const isoMonthSchema = z.string().refine(isIsoMonth, 'must be a month YYYY-MM');
export const timestampSchema = z.iso.datetime();
/** Non-negative whole paise. */
export const paiseSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const text = z.string().trim().min(1).max(500);
const longText = z.string().trim().max(5000);
const emailSchema = z.email().transform((e) => e.toLowerCase());

const timestamps = {
  created_at: timestampSchema,
  updated_at: timestampSchema,
};
const softDelete = { deleted_at: timestampSchema.nullable() };

// ---- entities -------------------------------------------------------------

export const personSchema = z.object({
  id: idSchema,
  name: text,
  email: emailSchema.nullable(),
  role: z.enum(PERSON_ROLES),
  active: z.boolean(),
  ...timestamps,
  ...softDelete,
});

export const projectSchema = z
  .object({
    id: idSchema,
    name: text,
    client: text,
    type: z.enum(PROJECT_TYPES),
    owner_person_id: idSchema.nullable(),
    status: z.enum(PROJECT_STATUSES),
    rag_override: z.enum(RAGS).nullable(),
    rag_override_reason: text.nullable(),
    contract_value_paise: paiseSchema.nullable(),
    start_date: isoDateSchema.nullable(),
    end_date: isoDateSchema.nullable(),
    notes: longText.nullable(),
    ...timestamps,
    ...softDelete,
  })
  .refine((p) => p.rag_override === null || p.rag_override_reason !== null, {
    message: 'rag_override needs a rag_override_reason',
    path: ['rag_override_reason'],
  })
  .refine((p) => !p.start_date || !p.end_date || p.end_date >= p.start_date, {
    message: 'end_date is before start_date',
    path: ['end_date'],
  });

export const milestoneSchema = z.object({
  id: idSchema,
  project_id: idSchema,
  title: text,
  due_date: isoDateSchema,
  /** Date the milestone was completed (IST), or null while open. */
  done_at: isoDateSchema.nullable(),
  billing_paise: paiseSchema.nullable(),
  ...timestamps,
  ...softDelete,
});

export const allocationSchema = z.object({
  id: idSchema,
  person_id: idSchema,
  project_id: idSchema,
  month: isoMonthSchema,
  percent: z.number().int().min(0).max(100),
  ...timestamps,
  ...softDelete,
});

export const invoiceSchema = z
  .object({
    id: idSchema,
    project_id: idSchema,
    invoice_no: text.max(64),
    invoice_date: isoDateSchema,
    due_date: isoDateSchema,
    amount_excl_gst_paise: paiseSchema,
    gst_paise: paiseSchema,
    total_paise: paiseSchema,
    notes: longText.nullable(),
    ...timestamps,
    ...softDelete,
  })
  .refine((i) => i.total_paise === i.amount_excl_gst_paise + i.gst_paise, {
    message: 'total must equal amount excl. GST + GST',
    path: ['total_paise'],
  })
  .refine((i) => i.due_date >= i.invoice_date, {
    message: 'due_date is before invoice_date',
    path: ['due_date'],
  });

export const paymentSchema = z.object({
  id: idSchema,
  invoice_id: idSchema,
  received_date: isoDateSchema,
  amount_paise: paiseSchema.positive(),
  mode: z.enum(PAYMENT_MODES),
  reference: text.nullable(),
  ...timestamps,
  ...softDelete,
});

export const expenseSchema = z.object({
  id: idSchema,
  date: isoDateSchema,
  category: z.enum(EXPENSE_CATEGORIES),
  amount_paise: paiseSchema.positive(),
  vendor: text.nullable(),
  notes: longText.nullable(),
  ...timestamps,
  ...softDelete,
});

export const cashSnapshotSchema = z.object({
  id: idSchema,
  as_of_date: isoDateSchema,
  /** Can be negative (overdraft). */
  balance_paise: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
  source: text.nullable(),
  ...timestamps,
});

export const pipelineDealSchema = z.object({
  id: idSchema,
  name: text,
  client: text,
  stage: z.enum(PIPELINE_STAGES),
  value_paise: paiseSchema,
  expected_close: isoDateSchema.nullable(),
  owner_person_id: idSchema.nullable(),
  ...timestamps,
  ...softDelete,
});

export const auditLogSchema = z.object({
  id: idSchema,
  actor_email: z.string(),
  at: timestampSchema,
  tool: z.string(),
  entity: z.string(),
  entity_id: z.string(),
  before_json: z.string().nullable(),
  after_json: z.string().nullable(),
  source_text: z.string().nullable(),
  undone_at: timestampSchema.nullable(),
});

export const confirmTokenSchema = z.object({
  token: z.string().min(16),
  actor_email: z.string(),
  payload_hash: z.string(),
  expires_at: timestampSchema,
  used_at: timestampSchema.nullable(),
});

export type Person = z.infer<typeof personSchema>;
export type Project = z.infer<typeof projectSchema>;
export type Milestone = z.infer<typeof milestoneSchema>;
export type Allocation = z.infer<typeof allocationSchema>;
export type Invoice = z.infer<typeof invoiceSchema>;
export type Payment = z.infer<typeof paymentSchema>;
export type Expense = z.infer<typeof expenseSchema>;
export type CashSnapshot = z.infer<typeof cashSnapshotSchema>;
export type PipelineDeal = z.infer<typeof pipelineDealSchema>;
export type AuditLogEntry = z.infer<typeof auditLogSchema>;
export type ConfirmToken = z.infer<typeof confirmTokenSchema>;

/** Entities written through the repository (audited). */
export const ENTITY_SCHEMAS = {
  people: personSchema,
  projects: projectSchema,
  milestones: milestoneSchema,
  allocations: allocationSchema,
  invoices: invoiceSchema,
  payments: paymentSchema,
  expenses: expenseSchema,
  cash_snapshots: cashSnapshotSchema,
  pipeline_deals: pipelineDealSchema,
} as const;

export type EntityName = keyof typeof ENTITY_SCHEMAS;
export const ENTITY_NAMES = Object.keys(ENTITY_SCHEMAS) as EntityName[];

export interface EntityMap {
  people: Person;
  projects: Project;
  milestones: Milestone;
  allocations: Allocation;
  invoices: Invoice;
  payments: Payment;
  expenses: Expense;
  cash_snapshots: CashSnapshot;
  pipeline_deals: PipelineDeal;
}

/** Entities that support soft delete (everything except cash snapshots). */
export type SoftDeletableEntity = Exclude<EntityName, 'cash_snapshots'>;

type MetaKeys = 'id' | 'created_at' | 'updated_at' | 'deleted_at';
type NullableKeys<T> = { [K in keyof T]-?: null extends T[K] ? K : never }[keyof T];

/** Create input: meta columns omitted; nullable columns optional (default null). */
export type CreateInput<E extends EntityName> = Omit<
  EntityMap[E],
  MetaKeys | NullableKeys<EntityMap[E]>
> &
  Partial<Pick<EntityMap[E], Exclude<NullableKeys<EntityMap[E]>, MetaKeys>>>;

/** Update patch: any subset of the non-meta columns. */
export type UpdatePatch<E extends EntityName> = Partial<Omit<EntityMap[E], MetaKeys>>;

/** All live (non-deleted) business data, as consumed by the rules. */
export interface Dataset {
  people: Person[];
  projects: Project[];
  milestones: Milestone[];
  allocations: Allocation[];
  invoices: Invoice[];
  payments: Payment[];
  expenses: Expense[];
  cash_snapshots: CashSnapshot[];
  pipeline_deals: PipelineDeal[];
}
