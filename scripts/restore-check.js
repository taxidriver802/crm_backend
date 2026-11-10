/**
 * npm run db:restore-check: restore a backup set into a scratch database and
 * prove it is whole. It never writes to the live database or the live
 * uploads directory.
 *
 *   1. Checks the set's files against the checksums in its manifest.
 *   2. Replaces the scratch database (default joist_restore_check) and runs
 *      pg_restore into it.
 *   3. Unpacks the uploads archive into a scratch directory.
 *   4. Compares every table's row count with the manifest, and checks that
 *      every file row and company logo has its file.
 *   5. Prints one restored job photo to open.
 *
 * Usage (from crm_backend):
 *   npm run db:restore-check                       newest set in BACKUP_DIR
 *   npm run db:restore-check -- --set 20261110T030000Z
 *   npm run db:restore-check -- --from /path/to/copied/sets
 *   npm run db:restore-check -- --target other_restore_check
 *   npm run db:restore-check -- --uploads-to /tmp/joist-restored-uploads
 *   npm run db:restore-check -- --owner joist      the restored database and tables belong to joist
 *   npm run db:restore-check -- --drop             remove the scratch copy after checking
 *
 * Environment:
 *   RESTORE_ADMIN_URL  a role that may CREATE and DROP databases, connected
 *                      to "postgres" (default: DATABASE_URL's server and
 *                      role, database "postgres")
 *   DATABASE_URL       the live database; named only so it is never a target
 *   BACKUP_DIR         where sets are (default: ./backups)
 *   UPLOADS_DIR        the live uploads directory; restored files never go there
 *
 * Exit codes: 0 every check passed; 1 anything failed or was refused.
 */
require('dotenv').config({ quiet: true });

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const lib = require('./lib/backup');

function parseArgs(argv) {
  const value = (flag) => {
    const index = argv.indexOf(flag);
    if (index === -1) return null;
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) throw new lib.BackupError(`${flag} needs a value.`);
    return next;
  };
  return {
    from: value('--from'),
    set: value('--set'),
    target: value('--target') || 'joist_restore_check',
    uploadsTo: value('--uploads-to'),
    owner: value('--owner'),
    drop: argv.includes('--drop'),
  };
}

async function withClient(connectionString, fn) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

const ROLE_RE = /^[a-z_][a-z0-9_]{0,62}$/;

async function recreateDatabase(adminUrl, target, owner) {
  await withClient(adminUrl, async (client) => {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      target,
    ]);
    if (rowCount) await client.query(`DROP DATABASE ${lib.quoteIdent(target)}`);
    await client.query(
      `CREATE DATABASE ${lib.quoteIdent(target)}${owner ? ` OWNER ${lib.quoteIdent(owner)}` : ''}`
    );
  });
}

async function dropDatabase(adminUrl, target) {
  await withClient(adminUrl, (client) =>
    client.query(`DROP DATABASE IF EXISTS ${lib.quoteIdent(target)}`)
  );
}

/** Every file row and uploaded logo, and whether its file came back. */
async function checkFiles(client, uploadsDir) {
  const { rows: files } = await client.query(`
    SELECT f.id, f.storage_key, f.original_name, f.mime_type, f.job_id,
           c.slug AS company_slug
    FROM files f
    LEFT JOIN companies c ON c.id = f.company_id
    ORDER BY f.id
  `);
  const { rows: logos } = await client.query(`
    SELECT slug, logo_storage_key AS storage_key
    FROM companies
    WHERE logo_storage_key IS NOT NULL AND logo_storage_key NOT LIKE 'builtin/%'
    ORDER BY slug
  `);

  const missing = [];
  let jobPhoto = null;
  for (const file of files) {
    const onDisk = lib.resolveInside(uploadsDir, file.storage_key);
    if (!onDisk || !fs.existsSync(onDisk)) {
      missing.push(`file #${file.id} (${file.storage_key})`);
    } else if (!jobPhoto && file.job_id && String(file.mime_type || '').startsWith('image/')) {
      jobPhoto = { ...file, path: onDisk };
    }
  }
  for (const logo of logos) {
    const onDisk = lib.resolveInside(uploadsDir, logo.storage_key);
    if (!onDisk || !fs.existsSync(onDisk)) missing.push(`logo of ${logo.slug} (${logo.storage_key})`);
  }
  return { files: files.length, logos: logos.length, missing, jobPhoto };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const liveUrl = process.env.DATABASE_URL || '';
  const adminUrl =
    process.env.RESTORE_ADMIN_URL || (liveUrl ? lib.withDatabase(liveUrl, 'postgres') : '');
  if (!adminUrl) {
    throw new lib.BackupError('Set RESTORE_ADMIN_URL (or DATABASE_URL) so the scratch database can be made.');
  }
  const setDir = path.resolve(options.from || process.env.BACKUP_DIR || 'backups');
  const liveUploads = path.resolve(process.env.UPLOADS_DIR || 'uploads');
  const extractDir = path.resolve(
    options.uploadsTo || path.join('restore-check', options.target, 'uploads')
  );

  // 1. The set, checked before anything is created.
  const stamps = lib.listStamps(setDir);
  const stamp = options.set && options.set !== 'latest' ? options.set : stamps[stamps.length - 1];
  if (!stamp) throw new lib.BackupError(`No complete backup set in ${setDir}.`);
  console.log(`[restore-check] set      : ${path.join(setDir, `joist-${stamp}`)}`);
  const { manifest, paths } = await lib.verifySet(setDir, stamp);
  console.log(`[restore-check] checksums: dump and uploads match the manifest`);

  // 2. Guards: scratch names only, never the live database or uploads.
  lib.assertSafeRestoreTarget({
    target: options.target,
    liveDatabase: liveUrl ? lib.databaseName(liveUrl, 'DATABASE_URL') : null,
    sourceDatabase: manifest.database,
    adminUrl,
  });
  lib.assertSafeExtractDir({ dir: extractDir, liveUploads });
  if (options.owner && !ROLE_RE.test(options.owner)) {
    throw new lib.BackupError(`--owner "${options.owner}" is not a role name.`);
  }
  console.log(`[restore-check] target   : database ${options.target}, files ${extractDir}`);
  console.log(
    `[restore-check] admin    : ${lib.redactUrl(adminUrl)}` +
      (options.owner ? `, restoring as role ${options.owner}` : '')
  );

  // 3. Restore.
  await lib.toolVersion('pg_restore');
  await recreateDatabase(adminUrl, options.target, options.owner);
  // --no-owner: objects belong to whoever restores them, which is --owner
  // (via SET ROLE) when given, so a recovered copy can be swapped in as is.
  await lib.run(
    'pg_restore',
    [
      '--no-owner',
      '--no-privileges',
      '--exit-on-error',
      '--no-password',
      ...(options.owner ? [`--role=${options.owner}`] : []),
      `--dbname=${options.target}`,
      paths.dump,
    ],
    { env: lib.pgEnv(adminUrl, { database: options.target }) }
  );
  lib.prepareExtractDir(extractDir);
  await lib.run('tar', ['-xzf', paths.uploads, '-C', extractDir]);
  console.log(`[restore-check] restored : database and ${lib.countFiles(extractDir)} uploaded files`);

  // 4. Check it.
  const targetUrl = lib.withDatabase(adminUrl, options.target);
  const { problems, report } = await withClient(targetUrl, async (client) => {
    const counts = await lib.countRows(client);
    const countProblems = lib.compareCounts(manifest.counts, counts);
    const fileReport = await checkFiles(client, extractDir);
    return {
      problems: [...countProblems, ...fileReport.missing.map((m) => `missing ${m}`)],
      report: { tables: Object.keys(counts).length, counts, ...fileReport },
    };
  });

  const totalRows = Object.values(report.counts).reduce((sum, n) => sum + n, 0);
  console.log(
    `[restore-check] rows     : ${report.tables} tables, ${totalRows} rows ` +
      `(${report.counts.companies ?? 0} companies, ${report.counts.jobs ?? 0} jobs, ` +
      `${report.counts.invoices ?? 0} invoices)`
  );
  console.log(
    `[restore-check] files    : ${report.files - report.missing.filter((m) => m.startsWith('file')).length}` +
      ` of ${report.files} file rows and ${report.logos} uploaded logos have their file`
  );
  if (report.jobPhoto) {
    console.log(
      `[restore-check] open     : job #${report.jobPhoto.job_id} photo "${report.jobPhoto.original_name}"` +
        ` (${report.jobPhoto.company_slug}) → ${report.jobPhoto.path}`
    );
  } else {
    console.log('[restore-check] open     : this backup has no job photos to open');
  }

  if (problems.length) {
    console.error(`[restore-check] FAILED: ${problems.length} problem(s)`);
    for (const problem of problems.slice(0, 50)) console.error(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }

  if (options.drop) {
    await dropDatabase(adminUrl, options.target);
    lib.removeExtractDir(extractDir);
    console.log(`[restore-check] dropped  : ${options.target} and ${extractDir}`);
  } else {
    console.log(
      `[restore-check] kept     : ${options.target} and ${extractDir} for inspection; ` +
        're-run with --drop to remove them'
    );
  }
  console.log('[restore-check] OK');
}

main().catch((error) => {
  console.error(`[restore-check] FAILED: ${error.message}`);
  process.exitCode = 1;
});
