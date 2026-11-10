/// <reference types="jest" />
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import request from 'supertest';
import { app } from '../src/app';
import { pool } from '../src/db';
import { uploadsRoot } from '../src/lib/uploadsDir';
import { ensureSchema } from './helpers/setup';
import { resetDb } from './helpers/db';
import { createAuthedUser } from './helpers/auth';

const lib = require('../scripts/lib/backup');

jest.setTimeout(120000);

const BACKEND_ROOT = path.resolve(__dirname, '..');
const RESTORE_TARGET = 'crm_test_restore_check';
const ADMIN_URL = process.env.RESTORE_ADMIN_URL || '';
// The round trip creates and drops a database, which the test role usually
// may not do. Run it with a role that can:
//   RESTORE_ADMIN_URL=postgresql://<superuser>@localhost:5432/postgres npm test -- backup
const roundTrip = ADMIN_URL ? it : it.skip;

const made: string[] = [];
function tempDir(name: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `joist-${name}-`));
  made.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});

function runScript(script: string, args: string[], env: Record<string, string>) {
  const result = spawnSync(process.execPath, [path.join('scripts', script), ...args], {
    cwd: BACKEND_ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      BACKUP_REMOTE: '',
      UPLOADS_DIR: uploadsRoot(),
      ...env,
    },
  });
  return { status: result.status, out: `${result.stdout}\n${result.stderr}` };
}

describe('Backup sets: names, retention, guards', () => {
  it('names a set by its UTC second and reads the name back', () => {
    const stamp = lib.stampFor(new Date('2026-11-10T03:04:05.678Z'));
    expect(stamp).toBe('20261110T030405Z');
    expect(lib.stampToDate(stamp).toISOString()).toBe('2026-11-10T03:04:05.000Z');
    expect(lib.setPaths('/b', stamp)).toEqual({
      dump: '/b/joist-20261110T030405Z.dump',
      uploads: '/b/joist-20261110T030405Z-uploads.tar.gz',
      manifest: '/b/joist-20261110T030405Z.json',
    });
  });

  it('prunes sets past the window but always keeps the newest few', () => {
    const now = new Date('2026-11-30T03:00:00Z');
    const daily = Array.from({ length: 30 }, (_, i) =>
      lib.stampFor(new Date(Date.UTC(2026, 10, i + 1, 3)))
    );
    const pruned = lib.stampsToPrune(daily, { now, keepDays: 14, keepMin: 3 });
    expect(pruned[0]).toBe('20261101T030000Z');
    expect(pruned[pruned.length - 1]).toBe('20261115T030000Z');
    expect(pruned).toHaveLength(15);

    // The job stopped a month ago: the last three sets stay anyway.
    const stale = daily.slice(0, 5);
    const later = new Date('2027-01-01T00:00:00Z');
    expect(lib.stampsToPrune(stale, { now: later, keepDays: 14, keepMin: 3 })).toEqual(
      stale.slice(0, 2)
    );
  });

  it('removes only the files of a pruned set', () => {
    const dir = tempDir('prune');
    const old = lib.setPaths(dir, '20260101T000000Z');
    for (const file of Object.values(old) as string[]) fs.writeFileSync(file, 'x');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'keep me');
    lib.pruneSets(dir, ['20260101T000000Z']);
    expect(fs.readdirSync(dir)).toEqual(['notes.txt']);
  });

  it('passes the database password in the environment, never on a command line', () => {
    const env = lib.pgEnv('postgresql://joist:s3cr%40t@db.internal:5433/joist?sslmode=require');
    expect(env).toMatchObject({
      PGHOST: 'db.internal',
      PGPORT: '5433',
      PGUSER: 'joist',
      PGPASSWORD: 's3cr@t',
      PGDATABASE: 'joist',
      PGSSLMODE: 'require',
    });
    expect(lib.redactUrl('postgresql://joist:s3cr%40t@db.internal/joist')).not.toContain('s3cr');
  });

  it('restores only into a scratch database, never the live one or the source', () => {
    const admin = 'postgresql://admin@localhost:5432/postgres';
    const ok = { liveDatabase: 'joist', sourceDatabase: 'joist', adminUrl: admin };
    expect(() =>
      lib.assertSafeRestoreTarget({ ...ok, target: 'joist_restore_check' })
    ).not.toThrow();

    for (const target of [
      'joist',
      'crm_dev',
      'postgres',
      'template1',
      'Joist_restore_check',
      'joist_restore_check; DROP DATABASE joist',
      'joist_restore_check_old',
      '',
    ]) {
      expect(() => lib.assertSafeRestoreTarget({ ...ok, target })).toThrow(
        lib.UnsafeRestoreTargetError
      );
    }
    expect(() =>
      lib.assertSafeRestoreTarget({ ...ok, target: 'joist_restore_check', liveDatabase: 'joist_restore_check' })
    ).toThrow(/live database/);
    expect(() =>
      lib.assertSafeRestoreTarget({
        ...ok,
        target: 'joist_restore_check',
        adminUrl: 'postgresql://admin@localhost:5432/joist',
      })
    ).toThrow(/"postgres" maintenance database/);
  });

  it('never unpacks restored files into, above or below the live uploads', () => {
    const live = '/srv/joist/uploads';
    for (const dir of ['/srv/joist/uploads', '/srv/joist/uploads/restored', '/srv/joist', '/']) {
      expect(() => lib.assertSafeExtractDir({ dir, liveUploads: live })).toThrow(
        lib.UnsafeRestoreTargetError
      );
    }
    expect(() =>
      lib.assertSafeExtractDir({ dir: '/srv/joist/restore-check/uploads', liveUploads: live })
    ).not.toThrow();
    expect(lib.resolveInside('/r', '../etc/passwd')).toBeNull();
    expect(lib.resolveInside('/r', 'c1/photo.png')).toBe('/r/c1/photo.png');
  });

  it('empties only a directory restore-check made', () => {
    const someone = tempDir('theirs');
    fs.writeFileSync(path.join(someone, 'important.txt'), 'x');
    expect(() => lib.prepareExtractDir(someone)).toThrow(/not made by restore-check/);
    expect(fs.existsSync(path.join(someone, 'important.txt'))).toBe(true);

    const ours = path.join(tempDir('ours'), 'uploads');
    lib.prepareExtractDir(ours);
    fs.writeFileSync(path.join(ours, 'old.png'), 'x');
    lib.prepareExtractDir(ours);
    expect(fs.readdirSync(ours)).toEqual([lib.EXTRACT_MARKER]);
  });
});

describe('npm run db:backup and db:restore-check', () => {
  let setsDir: string;

  beforeAll(async () => {
    await ensureSchema();
    // Never dump anything but the test database.
    expect(lib.databaseName(process.env.DATABASE_URL, 'DATABASE_URL')).toMatch(/_test$/);
  });

  beforeEach(async () => {
    await resetDb();
    setsDir = tempDir('sets');
  });

  afterAll(async () => {
    if (ADMIN_URL) {
      const { Client } = require('pg');
      const admin = new Client({ connectionString: ADMIN_URL });
      await admin.connect();
      await admin.query(`DROP DATABASE IF EXISTS ${RESTORE_TARGET}`);
      await admin.end();
    }
    await resetDb();
  });

  /** A company with a job and one photo on it, uploaded the normal way. */
  async function companyWithJobPhoto() {
    const { headers } = await createAuthedUser('owner');
    const lead = await request(app)
      .post('/leads')
      .set(headers)
      .send({ first_name: 'Dana', last_name: 'Drill', source: 'Referral', status: 'New' });
    const job = await request(app)
      .post('/jobs')
      .set(headers)
      .send({ lead_id: lead.body.lead.id, title: 'Ridge repair', address: '1 Drill St', status: 'New' });
    const photo = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('drill photo')]);
    const upload = await request(app)
      .post('/files')
      .set(headers)
      .field('job_id', String(job.body.job.id))
      .attach('file', photo, { filename: 'ridge.png', contentType: 'image/png' });
    expect(upload.status).toBe(201);
    return { jobId: job.body.job.id as number, photo, storageKey: upload.body.file.storage_key };
  }

  it('writes a set whose counts match the database and whose checksums verify', async () => {
    await companyWithJobPhoto();
    const result = runScript('backup.js', [], { BACKUP_DIR: setsDir });
    expect(result.status).toBe(0);
    expect(result.out).toContain('BACKUP_REMOTE is not set');

    const [stamp] = lib.listStamps(setsDir);
    const { manifest } = await lib.verifySet(setsDir, stamp);
    const live = await pool.query('SELECT count(*)::int AS n FROM files');
    expect(manifest.counts.files).toBe(live.rows[0].n);
    expect(manifest.counts.jobs).toBe(1);
    expect(manifest.uploads.files).toBe(1);
    for (const file of fs.readdirSync(setsDir)) {
      expect(fs.statSync(path.join(setsDir, file)).mode & 0o077).toBe(0);
    }
  });

  it('fails a production backup that stays on this machine', async () => {
    const result = runScript('backup.js', [], { BACKUP_DIR: setsDir, NODE_ENV: 'production' });
    expect(result.status).toBe(2);
    expect(lib.listStamps(setsDir)).toHaveLength(1);
  });

  it('copies the set off the host when BACKUP_REMOTE is set', async () => {
    const remote = tempDir('remote');
    const result = runScript('backup.js', [], { BACKUP_DIR: setsDir, BACKUP_REMOTE: remote });
    expect(result.status).toBe(0);
    const [stamp] = lib.listStamps(remote);
    await expect(lib.verifySet(remote, stamp)).resolves.toBeTruthy();
  });

  it('refuses a damaged set before touching any database', async () => {
    runScript('backup.js', [], { BACKUP_DIR: setsDir });
    const [stamp] = lib.listStamps(setsDir);
    fs.appendFileSync(lib.setPaths(setsDir, stamp).dump, 'x');
    const result = runScript('restore-check.js', ['--target', RESTORE_TARGET], {
      BACKUP_DIR: setsDir,
      RESTORE_ADMIN_URL: ADMIN_URL || 'postgresql://nobody@127.0.0.1:1/postgres',
    });
    expect(result.status).toBe(1);
    expect(result.out).toMatch(/does not match its manifest checksum/);
  });

  it('refuses to restore over the database the backup came from', async () => {
    runScript('backup.js', [], { BACKUP_DIR: setsDir });
    const live = lib.databaseName(process.env.DATABASE_URL, 'DATABASE_URL');
    const result = runScript('restore-check.js', ['--target', live], {
      BACKUP_DIR: setsDir,
      RESTORE_ADMIN_URL: ADMIN_URL || 'postgresql://nobody@127.0.0.1:1/postgres',
    });
    expect(result.status).toBe(1);
    expect(result.out).toMatch(/Refusing to restore/);
  });

  roundTrip('restores the database and the photos, and fails when a photo is missing', async () => {
    const { jobId, photo, storageKey } = await companyWithJobPhoto();
    expect(runScript('backup.js', [], { BACKUP_DIR: setsDir }).status).toBe(0);

    // Restored as the app's own role, so a recovered copy can be swapped in.
    const appRole = new URL(String(process.env.DATABASE_URL)).username;
    const restoredDir = path.join(tempDir('restored'), 'uploads');
    const restore = runScript(
      'restore-check.js',
      ['--target', RESTORE_TARGET, '--uploads-to', restoredDir, '--owner', appRole],
      { BACKUP_DIR: setsDir, RESTORE_ADMIN_URL: ADMIN_URL }
    );
    expect(restore.out).toContain('[restore-check] OK');
    expect(restore.status).toBe(0);
    expect(restore.out).toContain(`job #${jobId} photo "ridge.png"`);
    expect(fs.readFileSync(path.join(restoredDir, storageKey))).toEqual(photo);

    const { Client } = require('pg');
    const restored = new Client({ connectionString: lib.withDatabase(ADMIN_URL, RESTORE_TARGET) });
    await restored.connect();
    try {
      const owners = await restored.query(
        `SELECT DISTINCT tableowner FROM pg_tables WHERE schemaname = 'public'`
      );
      expect(owners.rows).toEqual([{ tableowner: appRole }]);
    } finally {
      await restored.end();
    }

    // A file row whose photo is gone: the next backup's restore must say so.
    fs.rmSync(path.join(uploadsRoot(), storageKey));
    const later = tempDir('sets-later');
    expect(runScript('backup.js', [], { BACKUP_DIR: later }).status).toBe(0);
    const broken = runScript(
      'restore-check.js',
      ['--target', RESTORE_TARGET, '--uploads-to', restoredDir, '--drop'],
      { BACKUP_DIR: later, RESTORE_ADMIN_URL: ADMIN_URL }
    );
    expect(broken.status).toBe(1);
    expect(broken.out).toContain(`missing file #`);
    expect(broken.out).toContain(storageKey);
  });
});
