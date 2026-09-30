import { describe, expect, it } from 'vitest';
import { ULID_REGEX, seededRandom, ulid } from '../src/ids';
import { buildSampleData, SAMPLE_MARKER } from '../src/sample-data';
import { ENTITY_NAMES, ENTITY_SCHEMAS, invoiceSchema, projectSchema } from '../src/schemas';

describe('ulid', () => {
  it('is 26 Crockford chars, time-sortable, deterministic with a seed', () => {
    const a = ulid(1_000);
    const b = ulid(2_000);
    expect(a).toMatch(ULID_REGEX);
    expect(a < b).toBe(true);
    expect(ulid(5, seededRandom(1))).toBe(ulid(5, seededRandom(1)));
    expect(ulid(0).slice(0, 10)).toBe('0000000000');
  });
});

describe('schemas', () => {
  const base = buildSampleData('2026-09-30');

  it('invoice total must equal excl + GST', () => {
    const inv = base.invoices[0]!;
    expect(invoiceSchema.safeParse({ ...inv, total_paise: inv.total_paise + 1 }).success).toBe(
      false,
    );
  });

  it('rag_override needs a reason', () => {
    const p = base.projects[0]!;
    expect(
      projectSchema.safeParse({ ...p, rag_override: 'red', rag_override_reason: null }).success,
    ).toBe(false);
  });

  it('rejects floats for money', () => {
    const inv = base.invoices[0]!;
    expect(invoiceSchema.safeParse({ ...inv, gst_paise: 0.5 }).success).toBe(false);
  });
});

describe('sample data', () => {
  const data = buildSampleData('2026-09-30');

  it('every row passes its schema', () => {
    for (const e of ENTITY_NAMES) {
      for (const row of data[e]) expect(ENTITY_SCHEMAS[e].safeParse(row).success, e).toBe(true);
    }
  });

  it('covers every Wolvio project and is clearly marked SAMPLE', () => {
    expect(data.projects.map((p) => p.name)).toEqual([
      'RedTaxi',
      'Vayona CEI',
      'IDFIS',
      'RAMS360',
      'India Nippon',
      'MKM',
      'Kunneckt',
    ]);
    for (const p of data.projects) expect(p.notes).toContain(SAMPLE_MARKER);
    for (const i of data.invoices) expect(i.invoice_no).toMatch(/^SAMPLE-/);
    for (const p of data.people) expect(p.name).toMatch(/^Sample /);
  });

  it('is deterministic for a given day', () => {
    expect(buildSampleData('2026-09-30')).toEqual(data);
  });
});
