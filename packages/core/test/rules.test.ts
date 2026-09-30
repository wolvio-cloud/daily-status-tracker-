import { describe, expect, it } from 'vitest';
import {
  ageingBucket,
  allocationFlags,
  burn,
  cashReceived,
  focusMeter,
  invoiceOutstanding,
  invoiceStatus,
  netBurn,
  nextOpenMilestone,
  projectRag,
  receivablesAgeing,
  revenueBilled,
  runway,
  weightedPipeline,
} from '../src/rules';
import { mtd, qtd } from '../src/fy';
import {
  DELETED,
  K,
  L,
  allocation,
  cash,
  deal,
  expense,
  invoice,
  milestone,
  payment,
  person,
  project,
} from './factories';

const TODAY = '2026-09-30';

describe('revenueBilled', () => {
  it('sums amount excl. GST by invoice_date within the range', () => {
    const invs = [
      invoice({ invoice_date: '2026-09-01', amount_excl_gst_paise: 2 * L }),
      invoice({ invoice_date: '2026-09-30', amount_excl_gst_paise: 1 * L }),
      invoice({ invoice_date: '2026-08-31', amount_excl_gst_paise: 5 * L }),
      invoice({ invoice_date: '2026-07-01', amount_excl_gst_paise: 3 * L }),
      invoice({ invoice_date: '2026-09-10', amount_excl_gst_paise: 9 * L, ...DELETED }),
    ];
    expect(revenueBilled(invs, mtd(TODAY))).toBe(3 * L);
    expect(revenueBilled(invs, qtd(TODAY))).toBe(11 * L);
  });

  it('respects the FY boundary (31 Mar vs 1 Apr)', () => {
    const invs = [
      invoice({ invoice_date: '2027-03-31', amount_excl_gst_paise: 1 * L }),
      invoice({ invoice_date: '2027-04-01', amount_excl_gst_paise: 2 * L }),
    ];
    expect(revenueBilled(invs, qtd('2027-03-31'))).toBe(1 * L);
    expect(revenueBilled(invs, qtd('2027-04-01'))).toBe(2 * L);
  });

  it('is zero with no invoices', () => {
    expect(revenueBilled([], mtd(TODAY))).toBe(0);
  });
});

describe('invoice outstanding & status', () => {
  const inv = invoice({
    id: 'i1',
    amount_excl_gst_paise: 1 * L,
    gst_paise: 18 * K,
    due_date: '2026-09-15',
  });

  it('partial payment leaves the rest outstanding', () => {
    const pays = [payment({ invoice_id: 'i1', amount_paise: 50 * K })];
    expect(invoiceOutstanding(inv, pays)).toBe(1 * L + 18 * K - 50 * K);
    expect(invoiceStatus(inv, pays, TODAY)).toBe('overdue');
    expect(invoiceStatus(inv, pays, '2026-09-15')).toBe('open');
  });

  it('invoice paid across two payments is paid', () => {
    const pays = [
      payment({ invoice_id: 'i1', amount_paise: 60 * K }),
      payment({ invoice_id: 'i1', amount_paise: 58 * K }),
    ];
    expect(invoiceOutstanding(inv, pays)).toBe(0);
    expect(invoiceStatus(inv, pays, TODAY)).toBe('paid');
  });

  it('ignores deleted payments and payments to other invoices', () => {
    const pays = [
      payment({ invoice_id: 'i1', amount_paise: 1 * L + 18 * K, ...DELETED }),
      payment({ invoice_id: 'other', amount_paise: 1 * L }),
    ];
    expect(invoiceOutstanding(inv, pays)).toBe(1 * L + 18 * K);
  });

  it('never goes negative on overpayment', () => {
    expect(invoiceOutstanding(inv, [payment({ invoice_id: 'i1', amount_paise: 5 * L })])).toBe(0);
  });
});

describe('receivablesAgeing', () => {
  it('buckets outstanding by days past due', () => {
    expect(ageingBucket('2026-09-30', TODAY)).toBe('not_due');
    expect(ageingBucket('2026-09-29', TODAY)).toBe('d1_30');
    expect(ageingBucket('2026-08-31', TODAY)).toBe('d1_30'); // 30 days
    expect(ageingBucket('2026-08-30', TODAY)).toBe('d31_60'); // 31 days
    expect(ageingBucket('2026-07-02', TODAY)).toBe('d61_90'); // 90 days
    expect(ageingBucket('2026-07-01', TODAY)).toBe('d90_plus'); // 91 days
  });

  it('totals outstanding only, with partial and split payments', () => {
    const a = invoice({
      id: 'a',
      amount_excl_gst_paise: 1 * L,
      gst_paise: 0,
      due_date: '2026-10-15',
    });
    const b = invoice({
      id: 'b',
      amount_excl_gst_paise: 2 * L,
      gst_paise: 0,
      due_date: '2026-09-10',
    });
    const c = invoice({
      id: 'c',
      amount_excl_gst_paise: 3 * L,
      gst_paise: 0,
      due_date: '2026-06-01',
    });
    const d = invoice({
      id: 'd',
      amount_excl_gst_paise: 4 * L,
      gst_paise: 0,
      due_date: '2026-06-01',
    });
    const pays = [
      payment({ invoice_id: 'b', amount_paise: 50 * K }), // partial
      payment({ invoice_id: 'd', amount_paise: 1 * L }), // paid across two payments
      payment({ invoice_id: 'd', amount_paise: 3 * L }),
    ];
    const r = receivablesAgeing([a, b, c, d], pays, TODAY);
    expect(r.totalPaise).toBe(1 * L + 150 * K + 3 * L);
    expect(r.invoiceCount).toBe(3);
    expect(r.buckets.not_due).toEqual({ paise: 1 * L, count: 1 });
    expect(r.buckets.d1_30).toEqual({ paise: 150 * K, count: 1 });
    expect(r.buckets.d90_plus).toEqual({ paise: 3 * L, count: 1 });
    expect(r.buckets.d31_60.count + r.buckets.d61_90.count).toBe(0);
  });
});

describe('burn, net burn & runway', () => {
  const exps = [
    expense({ date: '2026-08-01', category: 'salary', amount_paise: 6 * L }),
    expense({ date: '2026-08-31', category: 'founder_salary', amount_paise: 2 * L }),
    expense({ date: '2026-09-01', category: 'rent', amount_paise: 80 * K }),
    expense({ date: '2026-08-15', category: 'tools', amount_paise: 9 * L, ...DELETED }),
  ];

  it('includes founder salary by default, and can exclude it', () => {
    expect(burn(exps, '2026-08')).toBe(8 * L);
    expect(burn(exps, '2026-08', { includeFounderSalary: false })).toBe(6 * L);
    expect(burn(exps, '2026-09')).toBe(80 * K);
  });

  it('net burn = burn − cash received', () => {
    const pays = [payment({ invoice_id: 'x', received_date: '2026-08-20', amount_paise: 3 * L })];
    expect(cashReceived(pays, '2026-08')).toBe(3 * L);
    expect(netBurn(exps, pays, '2026-08')).toBe(5 * L);
  });

  it('zero burn -> not burning (no divide by zero)', () => {
    const r = runway([cash('2026-09-28', 10 * L)], [], [], TODAY);
    expect(r).toMatchObject({ kind: 'not_burning', avgNetBurnPaise: 0 });
  });

  it('cash-positive months -> not burning', () => {
    const pays = [payment({ invoice_id: 'x', received_date: '2026-08-20', amount_paise: 20 * L })];
    expect(runway([cash('2026-09-28', 10 * L)], exps, pays, TODAY).kind).toBe('not_burning');
  });

  it('no cash snapshot -> unknown', () => {
    expect(runway([], exps, [], TODAY)).toEqual({ kind: 'unknown', reason: 'no_cash_snapshot' });
  });

  it('averages net burn over the last 3 complete months, using the latest snapshot', () => {
    const e = [
      expense({ date: '2026-06-10', amount_paise: 3 * L }),
      expense({ date: '2026-07-10', amount_paise: 3 * L }),
      expense({ date: '2026-08-10', amount_paise: 3 * L }),
      expense({ date: '2026-09-10', amount_paise: 99 * L }), // current month: ignored
      expense({ date: '2026-05-10', amount_paise: 99 * L }), // too old: ignored
    ];
    const snaps = [cash('2026-08-01', 99 * L), cash('2026-09-28', 30 * L)];
    const r = runway(snaps, e, [], TODAY);
    expect(r).toMatchObject({
      kind: 'months',
      months: 10,
      avgNetBurnPaise: 3 * L,
      balancePaise: 30 * L,
      asOf: '2026-09-28',
      lookback: ['2026-06', '2026-07', '2026-08'],
    });
  });

  it('negative balance gives zero months, not negative', () => {
    const e = [expense({ date: '2026-08-10', amount_paise: 3 * L })];
    expect(runway([cash('2026-09-28', -1 * L)], e, [], TODAY)).toMatchObject({ months: 0 });
  });

  it('uses the newest snapshot when two share a date', () => {
    const e = [expense({ date: '2026-08-10', amount_paise: 3 * L })];
    const snaps = [
      cash('2026-09-28', 1 * L, '2026-09-28T10:00:00.000Z'),
      cash('2026-09-28', 2 * L, '2026-09-28T12:00:00.000Z'),
    ];
    expect(runway(snaps, e, [], TODAY)).toMatchObject({ balancePaise: 2 * L, months: 2 });
  });
});

describe('projectRag', () => {
  const run = (
    p = project({ id: 'p' }),
    ms: Parameters<typeof milestone>[0][] = [],
    invs: Parameters<typeof invoice>[0][] = [],
    pays: Parameters<typeof payment>[0][] = [],
  ) =>
    projectRag(
      p,
      ms.map((m) => milestone(m)),
      invs.map((i) => invoice({ project_id: 'p', ...i })),
      pays.map((x) => payment(x)),
      TODAY,
    );

  it('green with nothing due', () => {
    expect(run(undefined, [{ project_id: 'p', due_date: '2026-10-30' }])).toEqual({
      rag: 'green',
      source: 'computed',
      reasons: [],
    });
  });

  it('amber: milestone due within 7 days (including today)', () => {
    expect(run(undefined, [{ project_id: 'p', due_date: '2026-10-07' }]).rag).toBe('amber');
    expect(run(undefined, [{ project_id: 'p', due_date: TODAY }]).rag).toBe('amber');
    expect(run(undefined, [{ project_id: 'p', due_date: '2026-10-08' }]).rag).toBe('green');
  });

  it('amber at 1–14 days late, red beyond 14', () => {
    expect(run(undefined, [{ project_id: 'p', due_date: '2026-09-16' }]).rag).toBe('amber'); // 14
    expect(run(undefined, [{ project_id: 'p', due_date: '2026-09-15' }]).rag).toBe('red'); // 15
  });

  it('done milestones and other projects do not count', () => {
    expect(
      run(undefined, [
        { project_id: 'p', due_date: '2026-08-01', done_at: '2026-08-01' },
        { project_id: 'other', due_date: '2026-08-01' },
      ]).rag,
    ).toBe('green');
  });

  it('invoice overdue: 31–60 amber, > 60 red, paid ignored', () => {
    expect(run(undefined, [], [{ amount_excl_gst_paise: L, due_date: '2026-08-30' }]).rag).toBe(
      'amber',
    ); // 31
    expect(run(undefined, [], [{ amount_excl_gst_paise: L, due_date: '2026-08-31' }]).rag).toBe(
      'green',
    ); // 30
    expect(run(undefined, [], [{ amount_excl_gst_paise: L, due_date: '2026-07-31' }]).rag).toBe(
      'red',
    ); // 61
    expect(
      run(
        undefined,
        [],
        [{ id: 'paid', amount_excl_gst_paise: L, gst_paise: 0, due_date: '2026-07-01' }],
        [{ invoice_id: 'paid', amount_paise: L }],
      ).rag,
    ).toBe('green');
  });

  it('red when end_date has passed while active', () => {
    const r = run(project({ id: 'p', end_date: '2026-09-29' }));
    expect(r.rag).toBe('red');
    expect(r.reasons[0]).toContain('End date');
  });

  it('override wins, with its reason', () => {
    const p = project({
      id: 'p',
      rag_override: 'green',
      rag_override_reason: 'Client agreed delay',
    });
    expect(run(p, [{ project_id: 'p', due_date: '2026-08-01' }])).toEqual({
      rag: 'green',
      source: 'override',
      reasons: ['Client agreed delay'],
    });
  });

  it('paused/closed projects have no RAG', () => {
    expect(
      run(project({ id: 'p', status: 'paused' }), [{ project_id: 'p', due_date: '2026-08-01' }])
        .rag,
    ).toBeNull();
    expect(
      run(project({ id: 'p', status: 'closed', rag_override: 'red', rag_override_reason: 'x' }))
        .rag,
    ).toBeNull();
  });

  it('nextOpenMilestone picks the earliest open one', () => {
    const ms = [
      milestone({ project_id: 'p', due_date: '2026-11-01', title: 'later' }),
      milestone({ project_id: 'p', due_date: '2026-10-01', title: 'sooner' }),
      milestone({ project_id: 'p', due_date: '2026-09-01', title: 'done', done_at: '2026-09-01' }),
    ];
    expect(nextOpenMilestone(ms, 'p')?.title).toBe('sooner');
    expect(nextOpenMilestone(ms, 'none')).toBeNull();
  });
});

describe('allocationFlags', () => {
  const a = person({ id: 'a', name: 'A' });
  const b = person({ id: 'b', name: 'B' });
  const c = person({ id: 'c', name: 'C' });
  const gone = person({ id: 'gone', active: false });

  it('flags > 100% as over and < 50% as under; 50 and 100 are ok', () => {
    const allocs = [
      allocation({ person_id: 'a', project_id: 'x', percent: 60 }),
      allocation({ person_id: 'a', project_id: 'y', percent: 50 }),
      allocation({ person_id: 'b', project_id: 'x', percent: 49 }),
      allocation({ person_id: 'c', project_id: 'x', percent: 100 }),
      allocation({ person_id: 'c', project_id: 'y', percent: 30, month: '2026-08' }),
      allocation({ person_id: 'b', project_id: 'y', percent: 40, ...DELETED }),
      allocation({ person_id: 'gone', project_id: 'x', percent: 10 }),
    ];
    const flags = allocationFlags([a, b, c, gone], allocs, '2026-09');
    expect(flags).toEqual([
      { personId: 'a', name: 'A', totalPercent: 110, flag: 'over' },
      { personId: 'b', name: 'B', totalPercent: 49, flag: 'under' },
      { personId: 'c', name: 'C', totalPercent: 100, flag: 'ok' },
    ]);
    const edge = allocationFlags(
      [a],
      [allocation({ person_id: 'a', project_id: 'x', percent: 50 })],
      '2026-09',
    );
    expect(edge[0]?.flag).toBe('ok');
  });

  it('unallocated active people are under', () => {
    expect(allocationFlags([a], [], '2026-09')[0]).toMatchObject({
      totalPercent: 0,
      flag: 'under',
    });
  });
});

describe('weightedPipeline', () => {
  it('weights open deals by stage probability; won/lost excluded from headline', () => {
    const r = weightedPipeline([
      deal({ stage: 'lead', value_paise: 10 * L }),
      deal({ stage: 'qualified', value_paise: 8 * L }),
      deal({ stage: 'proposal', value_paise: 30 * L }),
      deal({ stage: 'negotiation', value_paise: 12 * L }),
      deal({ stage: 'won', value_paise: 5 * L }),
      deal({ stage: 'lost', value_paise: 6 * L }),
      deal({ stage: 'proposal', value_paise: 99 * L, ...DELETED }),
    ]);
    expect(r.openTotalPaise).toBe(60 * L);
    expect(r.weightedPaise).toBe(1 * L + 2 * L + 15 * L + 9 * L);
    expect(r.openCount).toBe(4);
    expect(r.byStage.won).toEqual({ count: 1, valuePaise: 5 * L, weightedPaise: 5 * L });
    expect(r.byStage.lost.weightedPaise).toBe(0);
  });

  it('empty pipeline is zero', () => {
    expect(weightedPipeline([])).toMatchObject({
      openTotalPaise: 0,
      weightedPaise: 0,
      openCount: 0,
    });
  });
});

describe('focusMeter', () => {
  const f1 = person({ id: 'f1', role: 'founder' });
  const f2 = person({ id: 'f2', role: 'founder' });
  const emp = person({ id: 'e', role: 'employee' });
  const prod = project({ id: 'prod', type: 'product' });
  const svc = project({ id: 'svc', type: 'service' });
  const ret = project({ id: 'ret', type: 'retainer' });
  const people = [f1, f2, emp];
  const projects = [prod, svc, ret];

  it('share of founder allocation on product projects', () => {
    const allocs = [
      allocation({ person_id: 'f1', project_id: 'prod', percent: 40 }),
      allocation({ person_id: 'f1', project_id: 'svc', percent: 60 }),
      allocation({ person_id: 'f2', project_id: 'ret', percent: 100 }),
      allocation({ person_id: 'e', project_id: 'prod', percent: 100 }), // not a founder
    ];
    const r = focusMeter(people, allocs, projects, '2026-09');
    expect(r).toMatchObject({
      productPercent: 20,
      status: 'red',
      founderAllocatedPercent: 200,
      productAllocatedPercent: 40,
    });
  });

  it('green at ≥ 40%, amber at 25–39%', () => {
    const at = (p: number) =>
      focusMeter(
        people,
        [
          allocation({ person_id: 'f1', project_id: 'prod', percent: p }),
          allocation({ person_id: 'f1', project_id: 'svc', percent: 100 - p }),
        ],
        projects,
        '2026-09',
      ).status;
    expect(at(40)).toBe('green');
    expect(at(39)).toBe('amber');
    expect(at(25)).toBe('amber');
    expect(at(24)).toBe('red');
  });

  it('no founder allocation -> none', () => {
    expect(focusMeter(people, [], projects, '2026-09')).toMatchObject({
      productPercent: null,
      status: 'none',
    });
  });
});
