import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Repo, RepoError } from '../src/repo';
import { buildSampleData } from '../src/sample-data';
import { ENTITY_NAMES } from '../src/schemas';
import { datasetToSql } from '../src/sql-export';
import {
  allocationFlags,
  focusMeter,
  projectRag,
  receivablesAgeing,
  runway,
  weightedPipeline,
} from '../src/rules';
import { formatInr } from '../src/money';

const ctx = { actorEmail: 'Founder-A@Example.com', tool: 'test', sourceText: 'add RedTaxi please' };
const TABLES = [...ENTITY_NAMES, 'audit_log', 'confirm_tokens'];

async function wipe() {
  // Children first so foreign keys never block the delete.
  for (const t of [...TABLES].reverse()) await env.DB.prepare(`DELETE FROM ${t}`).run();
}

async function count(table: string): Promise<number> {
  const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
  return r?.n ?? 0;
}

let repo: Repo;
beforeEach(async () => {
  await wipe();
  let t = Date.parse('2026-09-30T06:00:00Z');
  repo = new Repo(env.DB, { now: () => new Date((t += 1000)) });
});

async function newProject(name = 'RedTaxi') {
  const person = await repo.create(
    'people',
    { name: 'Founder A', role: 'founder', active: true },
    ctx,
  );
  const project = await repo.create(
    'projects',
    {
      name,
      client: 'RedTaxi',
      type: 'service',
      status: 'active',
      owner_person_id: person.after.id,
    },
    ctx,
  );
  return { person: person.after, project: project.after };
}

describe('Repo writes', () => {
  it('create writes the row and exactly one audit row, atomically', async () => {
    const res = await repo.create(
      'people',
      { name: 'Sample Engineer', email: 'ENG@example.com', role: 'employee', active: true },
      ctx,
    );
    expect(res.after).toMatchObject({ email: 'eng@example.com', active: true, deleted_at: null });
    expect(await repo.get('people', res.after.id)).toEqual(res.after);
    expect(await count('audit_log')).toBe(1);
    const [audit] = await repo.listAuditLog();
    expect(audit).toMatchObject({
      id: res.auditId,
      actor_email: 'founder-a@example.com',
      tool: 'test',
      entity: 'people',
      entity_id: res.after.id,
      before_json: null,
      source_text: 'add RedTaxi please',
      undone_at: null,
    });
    expect(JSON.parse(audit!.after_json!)).toEqual(res.after);
  });

  it('update records exact before/after and bumps updated_at', async () => {
    const { project } = await newProject();
    const res = await repo.update(
      'projects',
      project.id,
      { status: 'paused', notes: 'waiting on client' },
      ctx,
    );
    expect(res.before).toEqual(project);
    expect(res.after).toMatchObject({ status: 'paused', notes: 'waiting on client' });
    expect(res.after.updated_at > project.updated_at).toBe(true);
    const [audit] = await repo.listAuditLog({ entity: 'projects', limit: 1 });
    expect(JSON.parse(audit!.before_json!)).toEqual(project);
    expect(JSON.parse(audit!.after_json!)).toEqual(res.after);
    expect(await count('audit_log')).toBe(3);
  });

  it('rejects invalid updates without writing anything', async () => {
    const { project } = await newProject();
    await expect(
      repo.update('projects', project.id, { rag_override: 'red' }, ctx),
    ).rejects.toMatchObject({ code: 'validation' });
    await expect(
      repo.update('projects', project.id, { id: 'x' } as never, ctx),
    ).rejects.toMatchObject({ code: 'validation' });
    expect(await repo.get('projects', project.id)).toEqual(project);
    expect(await count('audit_log')).toBe(2);
  });

  it('soft delete hides the row but keeps it, and is audited', async () => {
    const { project } = await newProject();
    await repo.softDelete('projects', project.id, ctx);
    expect(await repo.get('projects', project.id)).toBeNull();
    expect(await repo.list('projects')).toEqual([]);
    const kept = await repo.get('projects', project.id, { includeDeleted: true });
    expect(kept?.deleted_at).not.toBeNull();
    expect(await count('audit_log')).toBe(3);
    await expect(repo.softDelete('projects', project.id, ctx)).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('duplicate invoice_no is rejected and leaves no audit row', async () => {
    const { project } = await newProject();
    const inv = {
      project_id: project.id,
      invoice_no: 'W-001',
      invoice_date: '2026-09-01',
      due_date: '2026-10-01',
      amount_excl_gst_paise: 100_000_00,
      gst_paise: 18_000_00,
      total_paise: 118_000_00,
    };
    await repo.create('invoices', inv, ctx);
    const before = await count('audit_log');
    await expect(repo.create('invoices', inv, ctx)).rejects.toMatchObject({ code: 'duplicate' });
    expect(await count('audit_log')).toBe(before);
    expect(await count('invoices')).toBe(1);
  });

  it('unknown foreign keys are rejected', async () => {
    await expect(
      repo.create(
        'milestones',
        { project_id: '01JAAAAAAAAAAAAAAAAAAAAAAA', title: 'x', due_date: '2026-10-01' },
        ctx,
      ),
    ).rejects.toBeInstanceOf(RepoError);
    expect(await count('audit_log')).toBe(0);
  });

  it('a concurrent change makes the second write fail with no audit row', async () => {
    const { project } = await newProject();
    await repo.update('projects', project.id, { notes: 'first' }, ctx);
    vi.spyOn(repo, 'get').mockResolvedValueOnce(project); // stale read
    await expect(
      repo.update('projects', project.id, { notes: 'second' }, ctx),
    ).rejects.toMatchObject({
      code: 'conflict',
    });
    expect((await repo.get('projects', project.id))?.notes).toBe('first');
    expect(await count('audit_log')).toBe(3);
  });

  it('rejects unknown table names at runtime', async () => {
    await expect(repo.list('people; DROP TABLE people' as never)).rejects.toMatchObject({
      code: 'validation',
    });
    await expect(repo.get('audit_log' as never, 'x')).rejects.toMatchObject({ code: 'validation' });
  });

  it('cash snapshots are append-only (no soft delete column)', async () => {
    await repo.create('cash_snapshots', { as_of_date: '2026-09-28', balance_paise: -500 }, ctx);
    expect(await repo.list('cash_snapshots')).toHaveLength(1);
  });

  it('listAuditLog is newest first and clamps the limit', async () => {
    await newProject();
    const log = await repo.listAuditLog({ limit: 0 });
    expect(log).toHaveLength(1);
    expect(log[0]?.entity).toBe('projects');
  });
});

describe('sample data in D1', () => {
  const TODAY = '2026-09-30';

  it('loads through the SQL exporter and round-trips via loadDataset', async () => {
    const data = buildSampleData(TODAY);
    await env.DB.batch(datasetToSql(data).map((s) => env.DB.prepare(s)));
    const loaded = await repo.loadDataset();
    for (const e of ENTITY_NAMES) {
      const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
      expect([...loaded[e]].sort(byId), e).toEqual([...data[e]].sort(byId));
    }
  });

  it('produces the expected headline figures', () => {
    const d = buildSampleData(TODAY);
    const rag = Object.fromEntries(
      d.projects.map((p) => [
        p.name,
        projectRag(p, d.milestones, d.invoices, d.payments, TODAY).rag,
      ]),
    );
    expect(rag).toEqual({
      RedTaxi: 'red',
      'Vayona CEI': 'amber',
      IDFIS: 'green',
      RAMS360: 'green',
      'India Nippon': 'amber',
      MKM: 'red',
      Kunneckt: null,
    });

    const pipe = weightedPipeline(d.pipeline_deals);
    expect(formatInr(pipe.weightedPaise)).toBe('₹27,00,000');
    expect(formatInr(pipe.openTotalPaise)).toBe('₹60,00,000');

    const flags = allocationFlags(d.people, d.allocations, '2026-09');
    expect(flags.filter((f) => f.flag !== 'ok').map((f) => [f.name, f.flag])).toEqual([
      ['Sample Engineer 1', 'over'],
      ['Sample Engineer 3', 'under'],
    ]);

    expect(focusMeter(d.people, d.allocations, d.projects, '2026-09')).toMatchObject({
      productPercent: 43.8,
      status: 'green',
    });

    const ageing = receivablesAgeing(d.invoices, d.payments, TODAY);
    expect(ageing.invoiceCount).toBe(7);
    expect(ageing.buckets.d90_plus.count).toBe(1);
    expect(ageing.buckets.d61_90.count).toBe(1);

    expect(runway(d.cash_snapshots, d.expenses, d.payments, TODAY).kind).toBe('months');
  });
});
