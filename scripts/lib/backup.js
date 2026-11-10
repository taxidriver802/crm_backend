/**
 * Shared pieces of `npm run db:backup` and `npm run db:restore-check`.
 *
 * A backup SET is three files with one timestamp:
 *
 *   joist-20261110T030000Z.dump              pg_dump, custom format
 *   joist-20261110T030000Z-uploads.tar.gz    the uploads directory
 *   joist-20261110T030000Z.json              manifest: checksums, row counts
 *
 * The manifest is written last, so a set without one is incomplete and is
 * never restored or counted. The pure helpers (names, retention, guards) are
 * exported for Jest.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const MANIFEST_FORMAT = 1;
const STAMP_RE = /^\d{8}T\d{6}Z$/;
const MANIFEST_NAME_RE = /^joist-(\d{8}T\d{6}Z)\.json$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A restore target is a scratch database: its name says so. */
const RESTORE_TARGET_RE = /^[a-z][a-z0-9_]{0,40}_restore_check$/;
const NEVER_RESTORE_INTO = Object.freeze(['postgres', 'template0', 'template1']);
/** Marks a directory restore-check made, so it may be emptied next time. */
const EXTRACT_MARKER = '.joist-restore-check';

class BackupError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BackupError';
  }
}

class UnsafeRestoreTargetError extends Error {
  constructor(message) {
    super(`Refusing to restore: ${message}`);
    this.name = 'UnsafeRestoreTargetError';
  }
}

// ─── Names and retention ─────────────────────────────────

/** 2026-11-10T03:00:00.123Z → 20261110T030000Z */
function stampFor(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function stampToDate(stamp) {
  if (!STAMP_RE.test(stamp)) throw new BackupError(`Not a backup timestamp: ${stamp}`);
  const iso = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(
    9,
    11
  )}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`;
  return new Date(iso);
}

function setPaths(dir, stamp) {
  if (!STAMP_RE.test(stamp)) throw new BackupError(`Not a backup timestamp: ${stamp}`);
  const base = path.join(dir, `joist-${stamp}`);
  return {
    dump: `${base}.dump`,
    uploads: `${base}-uploads.tar.gz`,
    manifest: `${base}.json`,
  };
}

/** Timestamps of the complete sets (those with a manifest) in `dir`, oldest first. */
function listStamps(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((name) => MANIFEST_NAME_RE.exec(name)?.[1])
    .filter(Boolean)
    .sort();
}

/**
 * Which sets retention removes: those older than `keepDays`, except that
 * the newest `keepMin` sets are always kept, however old. A backup job that
 * stopped running for a month must not delete the last good copies.
 */
function stampsToPrune(stamps, { now = new Date(), keepDays = 14, keepMin = 3 } = {}) {
  const sorted = [...stamps].filter((s) => STAMP_RE.test(s)).sort();
  const kept = new Set(sorted.slice(Math.max(0, sorted.length - keepMin)));
  const cutoff = now.getTime() - keepDays * DAY_MS;
  return sorted.filter((stamp) => !kept.has(stamp) && stampToDate(stamp).getTime() < cutoff);
}

/** Delete exactly the three files of each set, nothing else in the directory. */
function pruneSets(dir, stamps) {
  for (const stamp of stamps) {
    const paths = setPaths(dir, stamp);
    // Manifest first: a set without one is already "incomplete".
    for (const file of [paths.manifest, paths.dump, paths.uploads]) {
      fs.rmSync(file, { force: true });
    }
  }
  return stamps;
}

// ─── Postgres connections ────────────────────────────────

function parseDatabaseUrl(connectionString, label = 'DATABASE_URL') {
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new BackupError(`${label} is not a valid connection URL.`);
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new BackupError(`${label} must be a postgres:// URL.`);
  }
  return url;
}

function databaseName(connectionString, label) {
  const url = parseDatabaseUrl(connectionString, label);
  const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!name) throw new BackupError(`${label || 'The connection URL'} does not name a database.`);
  return name;
}

function redactUrl(connectionString) {
  try {
    const url = new URL(connectionString);
    if (url.password) url.password = '***';
    return url.toString();
  } catch {
    return '(unparseable)';
  }
}

/**
 * libpq environment for pg_dump / pg_restore. The password travels in the
 * child's environment, never on its command line, where `ps` would show it.
 */
function pgEnv(connectionString, { database } = {}) {
  const url = parseDatabaseUrl(connectionString);
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('PG')) delete env[key];
  }
  const host = url.searchParams.get('host') || decodeURIComponent(url.hostname);
  if (host) env.PGHOST = host;
  if (url.port) env.PGPORT = url.port;
  if (url.username) env.PGUSER = decodeURIComponent(url.username);
  if (url.password) env.PGPASSWORD = decodeURIComponent(url.password);
  const name = database || decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (name) env.PGDATABASE = name;
  const sslmode = url.searchParams.get('sslmode');
  if (sslmode) env.PGSSLMODE = sslmode;
  return env;
}

/** The same server and credentials, another database. */
function withDatabase(connectionString, name) {
  const url = parseDatabaseUrl(connectionString);
  url.pathname = `/${encodeURIComponent(name)}`;
  return url.toString();
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

// ─── Restore guards ──────────────────────────────────────

/**
 * A restore only ever creates (and replaces) a scratch database:
 *   1. its name ends in `_restore_check` (lowercase letters, digits, _);
 *   2. it is not the live database, nor the one the backup came from;
 *   3. it is not a maintenance or template database;
 *   4. the admin connection that creates it targets "postgres".
 * Pure, so Jest can feed it hostile input.
 */
function assertSafeRestoreTarget({ target, liveDatabase, sourceDatabase, adminUrl }) {
  if (!target || !RESTORE_TARGET_RE.test(target)) {
    throw new UnsafeRestoreTargetError(
      `"${target}" is not a scratch database name. Use lowercase letters, digits and _, ending in _restore_check (for example joist_restore_check).`
    );
  }
  if (NEVER_RESTORE_INTO.includes(target)) {
    throw new UnsafeRestoreTargetError(`"${target}" is a maintenance database.`);
  }
  if (liveDatabase && target === liveDatabase) {
    throw new UnsafeRestoreTargetError(`"${target}" is the live database in DATABASE_URL.`);
  }
  if (sourceDatabase && target === sourceDatabase) {
    throw new UnsafeRestoreTargetError(`"${target}" is the database this backup was taken from.`);
  }
  const adminDb = databaseName(adminUrl, 'RESTORE_ADMIN_URL');
  if (adminDb !== 'postgres') {
    throw new UnsafeRestoreTargetError(
      `RESTORE_ADMIN_URL must target the "postgres" maintenance database, not "${adminDb}".`
    );
  }
}

function isInside(child, parent) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/** Restored files never land in, above or below the live uploads directory. */
function assertSafeExtractDir({ dir, liveUploads }) {
  const target = path.resolve(dir);
  const live = path.resolve(liveUploads);
  if (isInside(target, live) || isInside(live, target)) {
    throw new UnsafeRestoreTargetError(
      `restored uploads would go to ${target}, which overlaps the live uploads directory ${live}.`
    );
  }
}

/**
 * Empty and recreate the extraction directory. One that exists, holds
 * files and lacks restore-check's marker is someone else's: refuse.
 */
function prepareExtractDir(dir) {
  const target = path.resolve(dir);
  if (fs.existsSync(target)) {
    const entries = fs.readdirSync(target);
    if (entries.length && !entries.includes(EXTRACT_MARKER)) {
      throw new UnsafeRestoreTargetError(
        `${target} is not empty and was not made by restore-check. Choose another --uploads-to.`
      );
    }
    fs.rmSync(target, { recursive: true, force: true });
  }
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(target, EXTRACT_MARKER), 'Made by npm run db:restore-check.\n');
  return target;
}

function removeExtractDir(dir) {
  const target = path.resolve(dir);
  if (!fs.existsSync(target)) return;
  if (!fs.existsSync(path.join(target, EXTRACT_MARKER))) {
    throw new UnsafeRestoreTargetError(`${target} was not made by restore-check; not removing it.`);
  }
  fs.rmSync(target, { recursive: true, force: true });
}

/** Resolve a storage key inside `root`, or null when it would escape it. */
function resolveInside(root, storageKey) {
  const resolved = path.resolve(root, storageKey);
  return isInside(resolved, root) && resolved !== path.resolve(root) ? resolved : null;
}

// ─── Files and processes ─────────────────────────────────

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

async function describeFile(file) {
  return {
    name: path.basename(file),
    bytes: fs.statSync(file).size,
    sha256: await sha256File(file),
  };
}

/** Check a set's files against its manifest before anything is restored. */
async function verifySet(dir, stamp) {
  const paths = setPaths(dir, stamp);
  if (!fs.existsSync(paths.manifest)) {
    throw new BackupError(`No manifest for ${stamp} in ${dir}; the set is incomplete.`);
  }
  const manifest = JSON.parse(fs.readFileSync(paths.manifest, 'utf8'));
  if (manifest.format !== MANIFEST_FORMAT) {
    throw new BackupError(`Manifest format ${manifest.format} is not ${MANIFEST_FORMAT}.`);
  }
  for (const key of ['dump', 'uploads']) {
    const file = paths[key];
    const expected = manifest.files?.[key];
    if (!expected || expected.name !== path.basename(file)) {
      throw new BackupError(`The manifest does not describe ${path.basename(file)}.`);
    }
    if (!fs.existsSync(file)) throw new BackupError(`Missing ${path.basename(file)}.`);
    const actual = await describeFile(file);
    if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) {
      throw new BackupError(
        `${path.basename(file)} does not match its manifest checksum; the copy is damaged.`
      );
    }
  }
  return { manifest, paths };
}

function run(command, args, { env, cwd } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { env: env || process.env, cwd, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const missing = error.code === 'ENOENT';
          reject(
            new BackupError(
              missing
                ? `${command} is not installed or not on PATH.`
                : `${command} failed: ${(stderr || error.message).trim()}`
            )
          );
          return;
        }
        resolve({ stdout, stderr });
      }
    );
  });
}

async function toolVersion(command) {
  const { stdout } = await run(command, ['--version']);
  return stdout.trim();
}

/** Row counts of every table in `public`, inside the caller's transaction. */
async function countRows(client) {
  const { rows: tables } = await client.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
  );
  const counts = {};
  for (const { tablename } of tables) {
    const { rows } = await client.query(
      `SELECT count(*)::bigint AS n FROM public.${quoteIdent(tablename)}`
    );
    counts[tablename] = Number(rows[0].n);
  }
  return counts;
}

/** Compare two row-count maps; returns the differences as sentences. */
function compareCounts(expected, actual) {
  const problems = [];
  for (const [table, n] of Object.entries(expected)) {
    if (!(table in actual)) problems.push(`table ${table} is missing`);
    else if (actual[table] !== n) problems.push(`${table}: ${actual[table]} rows, expected ${n}`);
  }
  for (const table of Object.keys(actual)) {
    if (!(table in expected)) problems.push(`table ${table} is not in the backup`);
  }
  return problems;
}

function countFiles(dir) {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === EXTRACT_MARKER) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += countFiles(full);
    else if (entry.isFile()) total += 1;
  }
  return total;
}

module.exports = {
  MANIFEST_FORMAT,
  EXTRACT_MARKER,
  BackupError,
  UnsafeRestoreTargetError,
  stampFor,
  stampToDate,
  setPaths,
  listStamps,
  stampsToPrune,
  pruneSets,
  databaseName,
  redactUrl,
  pgEnv,
  withDatabase,
  quoteIdent,
  assertSafeRestoreTarget,
  assertSafeExtractDir,
  prepareExtractDir,
  removeExtractDir,
  resolveInside,
  sha256File,
  describeFile,
  verifySet,
  run,
  toolVersion,
  countRows,
  compareCounts,
  countFiles,
};
