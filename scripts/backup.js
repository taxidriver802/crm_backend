/**
 * npm run db:backup: one backup set of the database and the uploads.
 *
 *   1. Opens a read-only transaction and exports its snapshot.
 *   2. Counts every table's rows inside that snapshot, and runs pg_dump
 *      (custom format) on the same snapshot, so the counts describe exactly
 *      what the dump holds.
 *   3. Archives the uploads directory (photos, documents, logos).
 *   4. Writes the manifest last: checksums, sizes, counts.
 *   5. Copies the set off this machine when BACKUP_REMOTE is set (rsync:
 *      "user@host:/path" over ssh, or a mounted path).
 *   6. Removes local sets older than BACKUP_KEEP_DAYS, always keeping the
 *      newest BACKUP_KEEP_MIN.
 *
 * Environment (crm_backend/.env, or the process manager's):
 *   DATABASE_URL       the database to back up (required)
 *   BACKUP_DIR         where sets are written (default: ./backups)
 *   UPLOADS_DIR        the uploads directory (default: ./uploads)
 *   BACKUP_REMOTE      rsync destination for the off-host copy
 *   BACKUP_KEEP_DAYS   local retention in days (default: 14)
 *   BACKUP_KEEP_MIN    sets always kept, however old (default: 3)
 *
 * Exit codes: 0 done; 1 failed (nothing new is left half-written);
 * 2 written here but not copied off the host, under NODE_ENV=production.
 *
 * Restore drill: npm run db:restore-check. Runbook: docs/guide/hosting.md.
 */
require('dotenv').config({ quiet: true });

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const lib = require('./lib/backup');

function positiveInt(value, fallback, name) {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new lib.BackupError(`${name} must be a whole number of 0 or more, not "${value}".`);
  }
  return n;
}

function chmodPrivate(file) {
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Not every filesystem keeps modes (a mounted share, for one).
  }
}

async function dumpWithCounts(databaseUrl, dumpFile) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const {
      rows: [{ snapshot }],
    } = await client.query('SELECT pg_export_snapshot() AS snapshot');
    const serverVersion = (await client.query('SHOW server_version')).rows[0].server_version;
    const counts = await lib.countRows(client);

    let latestMigration = null;
    if ('schema_migrations' in counts) {
      const { rows } = await client.query(
        'SELECT name FROM public.schema_migrations ORDER BY name DESC LIMIT 1'
      );
      latestMigration = rows[0]?.name ?? null;
    }

    // pg_dump joins the snapshot while this transaction is still open.
    await lib.run(
      'pg_dump',
      ['--format=custom', '--no-password', `--snapshot=${snapshot}`, `--file=${dumpFile}`],
      { env: lib.pgEnv(databaseUrl) }
    );
    await client.query('COMMIT');
    return { counts, serverVersion, latestMigration };
  } finally {
    await client.end();
  }
}

async function archiveUploads(uploadsDir, archiveFile) {
  if (!fs.existsSync(uploadsDir)) {
    console.warn(`[backup] ${uploadsDir} does not exist; archiving an empty uploads directory.`);
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  await lib.run('tar', ['-czf', archiveFile, '-C', uploadsDir, '.']);
  return lib.countFiles(uploadsDir);
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new lib.BackupError('DATABASE_URL is not set.');

  const backupDir = path.resolve(process.env.BACKUP_DIR || 'backups');
  const uploadsDir = path.resolve(process.env.UPLOADS_DIR || 'uploads');
  const remote = process.env.BACKUP_REMOTE?.trim() || '';
  const keepDays = positiveInt(process.env.BACKUP_KEEP_DAYS, 14, 'BACKUP_KEEP_DAYS');
  const keepMin = Math.max(1, positiveInt(process.env.BACKUP_KEEP_MIN, 3, 'BACKUP_KEEP_MIN'));
  const production = process.env.NODE_ENV === 'production';

  const pgDumpVersion = await lib.toolVersion('pg_dump');
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });

  const stamp = lib.stampFor();
  const paths = lib.setPaths(backupDir, stamp);
  if (fs.existsSync(paths.manifest)) {
    throw new lib.BackupError(`A set named ${stamp} already exists in ${backupDir}.`);
  }
  const partial = {
    dump: `${paths.dump}.partial`,
    uploads: `${paths.uploads}.partial`,
    manifest: `${paths.manifest}.partial`,
  };

  console.log(`[backup] database : ${lib.redactUrl(databaseUrl)}`);
  console.log(`[backup] uploads  : ${uploadsDir}`);
  console.log(`[backup] set      : ${path.join(backupDir, `joist-${stamp}`)}`);

  try {
    const { counts, serverVersion, latestMigration } = await dumpWithCounts(
      databaseUrl,
      partial.dump
    );
    const uploadedFiles = await archiveUploads(uploadsDir, partial.uploads);

    fs.renameSync(partial.dump, paths.dump);
    fs.renameSync(partial.uploads, paths.uploads);
    chmodPrivate(paths.dump);
    chmodPrivate(paths.uploads);

    const manifest = {
      format: lib.MANIFEST_FORMAT,
      stamp,
      created_at: lib.stampToDate(stamp).toISOString(),
      database: lib.databaseName(databaseUrl, 'DATABASE_URL'),
      server_version: serverVersion,
      pg_dump: pgDumpVersion,
      latest_migration: latestMigration,
      counts,
      uploads: { files: uploadedFiles },
      files: {
        dump: await lib.describeFile(paths.dump),
        uploads: await lib.describeFile(paths.uploads),
      },
    };
    fs.writeFileSync(partial.manifest, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(partial.manifest, paths.manifest);

    const totalRows = Object.values(counts).reduce((sum, n) => sum + n, 0);
    console.log(
      `[backup] wrote    : ${Object.keys(counts).length} tables, ${totalRows} rows, ` +
        `${uploadedFiles} uploaded files (` +
        `${(manifest.files.dump.bytes / 1024).toFixed(0)} KB dump, ` +
        `${(manifest.files.uploads.bytes / 1024).toFixed(0)} KB uploads)`
    );
  } catch (error) {
    for (const file of Object.values(partial)) fs.rmSync(file, { force: true });
    throw error;
  }

  if (remote) {
    const destination = remote.endsWith('/') ? remote : `${remote}/`;
    // -a keeps the files' 0600 mode. rsync sends them in name order, so
    // the manifest (which marks a set complete) arrives last.
    await lib.run('rsync', ['-a', paths.dump, paths.uploads, paths.manifest, destination]);
    console.log(`[backup] off host : copied to ${destination}`);
  }

  const pruned = lib.pruneSets(
    backupDir,
    lib.stampsToPrune(lib.listStamps(backupDir), { keepDays, keepMin })
  );
  console.log(
    `[backup] retention: ${pruned.length ? `removed ${pruned.join(', ')}` : 'nothing to remove'} ` +
      `(keep ${keepDays} days, at least ${keepMin} sets)`
  );

  if (!remote) {
    console.warn(
      '[backup] WARNING: BACKUP_REMOTE is not set. This set exists only on this machine; ' +
        'losing the disk loses it too.'
    );
    if (production) process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(`[backup] FAILED: ${error.message}`);
  process.exitCode = 1;
});
