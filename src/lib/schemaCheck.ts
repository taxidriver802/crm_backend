import path from 'path';
import { pool } from '../db';

/**
 * Startup check: is the database on the schema this code expects?
 *
 * A backend started against a database that is a migration behind runs, then
 * fails request by request ("relation … does not exist"). This names the
 * missing migrations at startup instead. Production refuses to start, like
 * the other production checks; development warns and starts.
 */

export type SchemaStatus = {
  database: string;
  pending: string[];
  edited: string[];
  unknown: string[];
};

type Queryable = { query: (sql: string, params?: unknown[]) => Promise<any> };

// The one migration runner, plain CommonJS shared with `npm run db:migrate`,
// the Jest setup and crm_qa. src/ and dist/ sit at the same depth, so this
// path holds for `npm run dev` and for the built server.
const runner = require(
  path.join(__dirname, '..', '..', 'scripts', 'lib', 'migrations.js')
) as {
  schemaStatus: (
    client: Queryable,
    options?: { sqlDir?: string }
  ) => Promise<SchemaStatus>;
};

function plural(n: number, one: string, many: string) {
  return n === 1 ? one : many;
}

/**
 * What to say about a status. `blocking` stops a production start; `notes`
 * are warnings everywhere.
 */
export function describeSchemaStatus(status: SchemaStatus): {
  blocking: string[];
  notes: string[];
} {
  const blocking: string[] = [];
  const notes: string[] = [];
  const db = status.database;
  if (status.pending[0] === 'baseline') {
    blocking.push(`${db} has no schema yet.`);
  } else if (status.pending.length) {
    const n = status.pending.length;
    blocking.push(
      `${db} is ${n} ${plural(n, 'migration', 'migrations')} behind: ${status.pending.join(', ')}.`
    );
  }
  if (status.edited.length) {
    blocking.push(
      `${plural(status.edited.length, 'A migration was', 'Migrations were')} edited after ${db} applied ${plural(status.edited.length, 'it', 'them')}: ${status.edited.join(', ')}. Put the change in a new migration.`
    );
  }
  if (status.unknown.length) {
    notes.push(
      `${db} has ${plural(status.unknown.length, 'a migration', 'migrations')} this code doesn't have: ${status.unknown.join(', ')}. It was migrated from a newer branch; this code may not match its schema.`
    );
  }
  return { blocking, notes };
}

/**
 * Logs what is wrong with the schema, if anything. Returns false when the
 * server should not start (production, and the schema is behind or edited).
 * A database that can't be reached is not this check's call: it warns and
 * lets the server start, as before, and /health reports it.
 */
export async function checkSchemaAtStartup({
  production,
  db = pool,
  sqlDir,
  timeoutMs = 5000,
  log = console.warn,
  fail = console.error,
}: {
  production: boolean;
  db?: Queryable;
  sqlDir?: string;
  timeoutMs?: number;
  log?: (line: string) => void;
  fail?: (line: string) => void;
}): Promise<boolean> {
  let status: SchemaStatus;
  let timer: NodeJS.Timeout | undefined;
  try {
    status = await Promise.race([
      runner.schemaStatus(db, sqlDir ? { sqlDir } : {}),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`no answer in ${timeoutMs} ms`)),
          timeoutMs
        );
      }),
    ]);
  } catch (error) {
    log(
      `[schema] Couldn't check the database schema (${(error as Error).message}). Starting anyway.`
    );
    return true;
  } finally {
    if (timer) clearTimeout(timer);
  }

  const { blocking, notes } = describeSchemaStatus(status);
  for (const note of notes) log(`[schema] ${note}`);
  if (!blocking.length) return true;

  if (production) {
    for (const line of blocking) fail(`[schema] ${line}`);
    fail(
      '[schema] Refusing to start. Run `npm run db:migrate`, then start again.'
    );
    return false;
  }
  for (const line of blocking) log(`[schema] ${line}`);
  log(
    '[schema] Requests that need the missing tables will fail. Run `npm run db:migrate`.'
  );
  return true;
}
