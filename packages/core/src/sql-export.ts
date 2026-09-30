// Render a Dataset as literal INSERT statements (for `wrangler d1 execute --file`
// seeding now, and backup restore later). Column lists come from COLUMNS.
import { COLUMNS } from './repo';
import { type Dataset, ENTITY_NAMES } from './schemas';

function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new RangeError('Cannot export non-finite number');
    return String(v);
  }
  if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`;
  throw new TypeError(`Cannot export value of type ${typeof v}`);
}

/**
 * INSERT statements for every row, parents before children (the order of
 * ENTITY_NAMES), one statement per string.
 */
export function datasetToSql(data: Dataset): string[] {
  const out: string[] = [];
  for (const entity of ENTITY_NAMES) {
    const cols = COLUMNS[entity];
    for (const row of data[entity] as unknown as Record<string, unknown>[]) {
      out.push(
        `INSERT INTO ${entity} (${cols.join(', ')}) VALUES (${cols.map((c) => sqlLiteral(row[c])).join(', ')});`,
      );
    }
  }
  return out;
}
