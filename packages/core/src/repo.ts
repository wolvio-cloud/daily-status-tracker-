// Typed repository over D1. Every write and its audit_log row go in ONE
// db.batch() (a single transaction), so a write can never exist unaudited.
// Table and column names come only from the constants below — never from input.
import { ulid } from './ids';
import {
  type AuditLogEntry,
  type CreateInput,
  type Dataset,
  ENTITY_NAMES,
  ENTITY_SCHEMAS,
  type EntityMap,
  type EntityName,
  type SoftDeletableEntity,
  type UpdatePatch,
  auditLogSchema,
} from './schemas';

export const COLUMNS: { [E in EntityName]: readonly (keyof EntityMap[E] & string)[] } = {
  people: ['id', 'name', 'email', 'role', 'active', 'created_at', 'updated_at', 'deleted_at'],
  projects: [
    'id',
    'name',
    'client',
    'type',
    'owner_person_id',
    'status',
    'rag_override',
    'rag_override_reason',
    'contract_value_paise',
    'start_date',
    'end_date',
    'notes',
    'created_at',
    'updated_at',
    'deleted_at',
  ],
  milestones: [
    'id',
    'project_id',
    'title',
    'due_date',
    'done_at',
    'billing_paise',
    'created_at',
    'updated_at',
    'deleted_at',
  ],
  allocations: [
    'id',
    'person_id',
    'project_id',
    'month',
    'percent',
    'created_at',
    'updated_at',
    'deleted_at',
  ],
  invoices: [
    'id',
    'project_id',
    'invoice_no',
    'invoice_date',
    'due_date',
    'amount_excl_gst_paise',
    'gst_paise',
    'total_paise',
    'notes',
    'created_at',
    'updated_at',
    'deleted_at',
  ],
  payments: [
    'id',
    'invoice_id',
    'received_date',
    'amount_paise',
    'mode',
    'reference',
    'created_at',
    'updated_at',
    'deleted_at',
  ],
  expenses: [
    'id',
    'date',
    'category',
    'amount_paise',
    'vendor',
    'notes',
    'created_at',
    'updated_at',
    'deleted_at',
  ],
  cash_snapshots: ['id', 'as_of_date', 'balance_paise', 'source', 'created_at', 'updated_at'],
  pipeline_deals: [
    'id',
    'name',
    'client',
    'stage',
    'value_paise',
    'expected_close',
    'owner_person_id',
    'created_at',
    'updated_at',
    'deleted_at',
  ],
};

const DEFAULT_ORDER: Record<EntityName, string> = {
  people: 'name COLLATE NOCASE',
  projects: 'name COLLATE NOCASE',
  milestones: 'due_date, id',
  allocations: 'month, person_id, project_id',
  invoices: 'invoice_date, invoice_no',
  payments: 'received_date, id',
  expenses: 'date, id',
  cash_snapshots: 'as_of_date, created_at',
  pipeline_deals: 'expected_close, name COLLATE NOCASE',
};

const AUDIT_COLUMNS = [
  'id',
  'actor_email',
  'at',
  'tool',
  'entity',
  'entity_id',
  'before_json',
  'after_json',
  'source_text',
  'undone_at',
] as const;

const hasSoftDelete = (e: EntityName): e is SoftDeletableEntity => e !== 'cash_snapshots';

/** Runtime guard: table names are interpolated into SQL, so only known ones pass. */
function assertEntity(entity: string): asserts entity is EntityName {
  if (!Object.hasOwn(COLUMNS, entity))
    throw new RepoError(`Unknown entity "${entity}"`, 'validation');
}

// ---- errors -------------------------------------------------------------------

export class RepoError extends Error {
  constructor(
    message: string,
    readonly code: 'validation' | 'not_found' | 'conflict' | 'duplicate' | 'reference',
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'RepoError';
  }
}

function mapDbError(e: unknown): never {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes('UNIQUE constraint failed')) {
    throw new RepoError('A record with the same unique value already exists', 'duplicate', msg);
  }
  if (msg.includes('FOREIGN KEY constraint failed')) {
    throw new RepoError('Referenced record does not exist', 'reference', msg);
  }
  if (msg.includes('CHECK constraint failed')) {
    throw new RepoError('Value rejected by a database rule', 'validation', msg);
  }
  throw e;
}

// ---- row mapping ----------------------------------------------------------------

type DbValue = string | number | null;

function toDb(entity: EntityName, row: Record<string, unknown>): Record<string, DbValue> {
  const out: Record<string, DbValue> = {};
  for (const col of COLUMNS[entity]) {
    const v = row[col];
    out[col] = typeof v === 'boolean' ? (v ? 1 : 0) : ((v ?? null) as DbValue);
  }
  return out;
}

function fromDb<E extends EntityName>(entity: E, raw: Record<string, unknown>): EntityMap[E] {
  const row: Record<string, unknown> = { ...raw };
  if (entity === 'people') row.active = row.active === 1 || row.active === true;
  return row as unknown as EntityMap[E];
}

function validate<E extends EntityName>(entity: E, row: unknown): EntityMap[E] {
  const parsed = ENTITY_SCHEMAS[entity].safeParse(row);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || entity}: ${i.message}`);
    throw new RepoError(`Invalid ${entity}: ${issues.join('; ')}`, 'validation', issues);
  }
  return parsed.data as EntityMap[E];
}

// ---- repository -----------------------------------------------------------------

export interface AuditContext {
  actorEmail: string;
  /** MCP tool (or script) that performed the write. */
  tool: string;
  /** The user's original message, verbatim. */
  sourceText?: string | null;
}

export interface WriteResult<T> {
  before: T | null;
  after: T | null;
  auditId: string;
}

export interface RepoOptions {
  now?: () => Date;
  newId?: () => string;
}

export class Repo {
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(
    private readonly db: D1Database,
    opts: RepoOptions = {},
  ) {
    this.now = opts.now ?? (() => new Date());
    this.newId = opts.newId ?? (() => ulid());
  }

  // -- reads --

  async list<E extends EntityName>(
    entity: E,
    opts: { includeDeleted?: boolean } = {},
  ): Promise<EntityMap[E][]> {
    assertEntity(entity);
    const where = hasSoftDelete(entity) && !opts.includeDeleted ? 'WHERE deleted_at IS NULL' : '';
    const { results } = await this.db
      .prepare(`SELECT * FROM ${entity} ${where} ORDER BY ${DEFAULT_ORDER[entity]}`)
      .all<Record<string, unknown>>();
    return results.map((r) => fromDb(entity, r));
  }

  async get<E extends EntityName>(
    entity: E,
    id: string,
    opts: { includeDeleted?: boolean } = {},
  ): Promise<EntityMap[E] | null> {
    assertEntity(entity);
    const extra = hasSoftDelete(entity) && !opts.includeDeleted ? ' AND deleted_at IS NULL' : '';
    const row = await this.db
      .prepare(`SELECT * FROM ${entity} WHERE id = ?${extra}`)
      .bind(id)
      .first<Record<string, unknown>>();
    return row ? fromDb(entity, row) : null;
  }

  /** All live rows of every business table, for the rules. */
  async loadDataset(): Promise<Dataset> {
    const lists = await Promise.all(ENTITY_NAMES.map((e) => this.list(e)));
    return Object.fromEntries(ENTITY_NAMES.map((e, i) => [e, lists[i]])) as unknown as Dataset;
  }

  async listAuditLog(opts: { limit?: number; entity?: EntityName } = {}): Promise<AuditLogEntry[]> {
    const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 20), 1), 200);
    if (opts.entity !== undefined) assertEntity(opts.entity);
    const stmt = opts.entity
      ? this.db
          .prepare('SELECT * FROM audit_log WHERE entity = ? ORDER BY at DESC, id DESC LIMIT ?')
          .bind(opts.entity, limit)
      : this.db.prepare('SELECT * FROM audit_log ORDER BY at DESC, id DESC LIMIT ?').bind(limit);
    const { results } = await stmt.all<Record<string, unknown>>();
    return results.map((r) => auditLogSchema.parse(r));
  }

  // -- writes (each = entity statement + audit row, one batch) --

  async create<E extends EntityName>(
    entity: E,
    input: CreateInput<E>,
    ctx: AuditContext,
  ): Promise<WriteResult<EntityMap[E]> & { after: EntityMap[E] }> {
    assertEntity(entity);
    const ts = this.now().toISOString();
    const draft: Record<string, unknown> = {};
    for (const col of COLUMNS[entity]) draft[col] = null;
    Object.assign(draft, input, { id: this.newId(), created_at: ts, updated_at: ts });
    if (hasSoftDelete(entity)) draft.deleted_at = null;
    const after = validate(entity, draft);

    const values = toDb(entity, after);
    const cols = COLUMNS[entity];
    const insert = this.db
      .prepare(
        `INSERT INTO ${entity} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      )
      .bind(...cols.map((c) => values[c] ?? null));
    const auditId = this.newId();
    const audit = this.auditStatement(auditId, ts, ctx, entity, after.id, null, after, false);
    await this.db.batch([insert, audit]).catch(mapDbError);
    return { before: null, after, auditId };
  }

  async update<E extends EntityName>(
    entity: E,
    id: string,
    patch: UpdatePatch<E>,
    ctx: AuditContext,
  ): Promise<WriteResult<EntityMap[E]> & { before: EntityMap[E]; after: EntityMap[E] }> {
    assertEntity(entity);
    const before = await this.get(entity, id);
    if (!before) throw new RepoError(`${entity} ${id} not found`, 'not_found');
    const ts = this.now().toISOString();
    const allowed = new Set<string>(COLUMNS[entity]);
    for (const k of ['id', 'created_at', 'updated_at', 'deleted_at']) allowed.delete(k);
    const cleanPatch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (!allowed.has(k)) throw new RepoError(`Cannot update ${entity}.${k}`, 'validation');
      if (v !== undefined) cleanPatch[k] = v;
    }
    const after = validate(entity, { ...before, ...cleanPatch, updated_at: ts });
    return this.writeChange(entity, before, after, ts, ctx);
  }

  async softDelete<E extends SoftDeletableEntity>(
    entity: E,
    id: string,
    ctx: AuditContext,
  ): Promise<WriteResult<EntityMap[E]> & { before: EntityMap[E]; after: EntityMap[E] }> {
    assertEntity(entity);
    const before = await this.get(entity, id);
    if (!before) throw new RepoError(`${entity} ${id} not found`, 'not_found');
    const ts = this.now().toISOString();
    const after = validate(entity, { ...before, updated_at: ts, deleted_at: ts });
    return this.writeChange(entity, before, after, ts, ctx);
  }

  /**
   * UPDATE guarded by the row's previous updated_at (optimistic lock); the
   * audit INSERT only fires if the UPDATE touched exactly one row.
   */
  private async writeChange<E extends EntityName>(
    entity: E,
    before: EntityMap[E],
    after: EntityMap[E],
    ts: string,
    ctx: AuditContext,
  ): Promise<WriteResult<EntityMap[E]> & { before: EntityMap[E]; after: EntityMap[E] }> {
    const values = toDb(entity, after);
    const cols = COLUMNS[entity].filter((c) => c !== 'id' && c !== 'created_at');
    const update = this.db
      .prepare(
        `UPDATE ${entity} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ? AND updated_at = ?`,
      )
      .bind(...cols.map((c) => values[c] ?? null), before.id, before.updated_at);
    const auditId = this.newId();
    const audit = this.auditStatement(auditId, ts, ctx, entity, before.id, before, after, true);
    const results = await this.db.batch([update, audit]).catch(mapDbError);
    if (results[1]?.meta.changes !== 1) {
      throw new RepoError(`${entity} ${before.id} changed concurrently; retry`, 'conflict');
    }
    return { before, after, auditId };
  }

  private auditStatement(
    auditId: string,
    ts: string,
    ctx: AuditContext,
    entity: EntityName,
    entityId: string,
    before: unknown,
    after: unknown,
    guardOnPreviousChange: boolean,
  ): D1PreparedStatement {
    const values = [
      auditId,
      ctx.actorEmail.toLowerCase(),
      ts,
      ctx.tool,
      entity,
      entityId,
      before === null ? null : JSON.stringify(before),
      after === null ? null : JSON.stringify(after),
      ctx.sourceText ?? null,
      null,
    ];
    const placeholders = AUDIT_COLUMNS.map(() => '?').join(', ');
    const sql = guardOnPreviousChange
      ? `INSERT INTO audit_log (${AUDIT_COLUMNS.join(', ')}) SELECT ${placeholders} WHERE changes() = 1`
      : `INSERT INTO audit_log (${AUDIT_COLUMNS.join(', ')}) VALUES (${placeholders})`;
    return this.db.prepare(sql).bind(...values);
  }
}
