/// <reference types="jest" />
/**
 * Step 5 (PLAN_operator.md §3): a company's export. The owner exports
 * directly, or asks for a final export while the company is closing and the
 * operator approves it. The archive goes to the owner only.
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { app } from '../src/app';
import { pool } from '../src/db';
import { uploadsRoot } from '../src/lib/uploadsDir';
import {
  EXPORTED_TABLES,
  SKIPPED_TABLES,
  exportsRoot,
  runExportBuilds,
  sweepExports,
} from '../src/services/companyExport.service';
import { clearStorageCacheForTests } from '../src/services/operator.service';
import { ensureSchema } from './helpers/setup';
import { resetDb } from './helpers/db';
import { authHeaderFor, createTestCompany, createTestUser } from './helpers/auth';
const { upsertOperator } = require('../scripts/operator-create');

jest.setTimeout(60000);

const OP_EMAIL = 'op@example.com';
const OP_PASSWORD = 'a-long-operator-password';
const OWNER_PASSWORD = 'owner-password-1';
let savedSecret: string | undefined;
let opCookie = '';

/** Reads a zip's central directory and inflates each entry. */
function readZip(buf: Buffer): Record<string, Buffer> {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(end).toBeGreaterThan(-1);
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const out: Record<string, Buffer> = {};
  for (let i = 0; i < count; i += 1) {
    expect(buf.readUInt32LE(at)).toBe(0x02014b50);
    const method = buf.readUInt16LE(at + 10);
    const crc = buf.readUInt32LE(at + 16);
    const compressed = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);
    const localNameLen = buf.readUInt16LE(local + 26);
    const data = buf.subarray(local + 30 + localNameLen, local + 30 + localNameLen + compressed);
    const raw = method === 8 ? zlib.inflateRawSync(data) : data;
    expect(zlib.crc32(raw) >>> 0).toBe(crc);
    out[name] = raw;
    at += 46 + nameLen;
  }
  return out;
}

const binary = (res: any, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

async function companyWithOwner(slug: string) {
  const company = await createTestCompany({ slug, name: `${slug} Co` });
  const owner = await createTestUser({ role: 'owner', company_id: company.id, email: `owner@${slug}.test` });
  await pool.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [
    owner.id,
    await bcrypt.hash(OWNER_PASSWORD, 4),
  ]);
  const agent = await createTestUser({ role: 'agent', company_id: company.id });
  return {
    company,
    owner,
    headers: await authHeaderFor(owner),
    agentHeaders: await authHeaderFor(agent),
  };
}

async function setStatus(companyId: string, status: string) {
  await pool.query(
    `UPDATE companies SET status = $2,
       held_from_status = CASE WHEN $2 = 'on_hold' THEN 'active' END,
       next_status_at = CASE WHEN $2 = 'pending_deletion' THEN now() + interval '30 days' END
     WHERE id = $1`,
    [companyId, status]
  );
}

async function exportRow(id: string) {
  const { rows } = await pool.query(`SELECT * FROM company_exports WHERE id = $1`, [id]);
  return rows[0];
}

beforeAll(async () => {
  await ensureSchema();
  savedSecret = process.env.OPERATOR_JWT_SECRET;
  process.env.OPERATOR_JWT_SECRET = 'operator-test-secret-'.padEnd(64, 'x');
});

afterAll(() => {
  if (savedSecret === undefined) delete process.env.OPERATOR_JWT_SECRET;
  else process.env.OPERATOR_JWT_SECRET = savedSecret;
  fs.rmSync(exportsRoot(), { recursive: true, force: true });
});

beforeEach(async () => {
  await resetDb();
  clearStorageCacheForTests();
  fs.rmSync(exportsRoot(), { recursive: true, force: true });
  await upsertOperator(pool, { email: OP_EMAIL, password: OP_PASSWORD });
  const res = await request(app).post('/operator/auth/login').send({ email: OP_EMAIL, password: OP_PASSWORD });
  const raw = res.headers['set-cookie'] as unknown as string[];
  opCookie = raw.find((c) => c.startsWith('joist_op='))!.split(';')[0];
});

describe('what an export carries', () => {
  it('names every table that has a company_id, as exported or skipped with a reason', async () => {
    const { rows } = await pool.query(
      `SELECT table_name FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name = 'company_id'`
    );
    const listed = new Set<string>([...EXPORTED_TABLES, ...Object.keys(SKIPPED_TABLES)]);
    const missing = rows.map((r) => r.table_name).filter((t) => !listed.has(t));
    expect(missing).toEqual([]);
  });

  it('holds the company’s records and files, and no secrets', async () => {
    const { company, headers } = await companyWithOwner('acme');
    const other = await companyWithOwner('other');
    await request(app).post('/leads').set(headers).send({ first_name: 'Pat', last_name: 'Lee', status: 'New' });
    await request(app).post('/leads').set(other.headers).send({ first_name: 'Not', last_name: 'Ours', status: 'New' });
    const dir = path.join(uploadsRoot(), company.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'photo.txt'), 'roof photo');

    const started = await request(app).post('/company-export').set(headers);
    expect(started.status).toBe(201);
    expect(started.body.export).toMatchObject({ kind: 'self_serve', status: 'approved' });
    await runExportBuilds();

    const row = await exportRow(started.body.export.id);
    expect(row.status).toBe('built');
    const hours = (new Date(row.expires_at).getTime() - Date.now()) / 3600000;
    expect(hours).toBeGreaterThan(71.9);

    const res = await request(app)
      .get(`/company-export/${row.id}/download`)
      .set(headers)
      .buffer(true)
      .parse(binary);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    const files = readZip(res.body);

    expect(Object.keys(files)).toEqual(
      expect.arrayContaining(['README.txt', 'data/company.json', 'data/leads.json', 'data/leads.csv'])
    );
    const leads = JSON.parse(files['data/leads.json'].toString());
    expect(leads.map((l: any) => l.first_name)).toEqual(['Pat']);
    expect(files['data/leads.csv'].toString()).toMatch(/first_name/);
    expect(files[`files/${company.id}/photo.txt`].toString()).toBe('roof photo');

    const users = JSON.parse(files['data/users.json'].toString());
    expect(users.length).toBeGreaterThan(0);
    for (const user of users) {
      expect(user).not.toHaveProperty('password_hash');
      expect(user).not.toHaveProperty('invite_token_hash');
    }
    expect(Object.keys(files).some((n) => n.includes('user_sessions'))).toBe(false);
    const company_ = JSON.parse(files['data/company.json'].toString());
    expect(company_).not.toHaveProperty('operator_notes');

    const after = await exportRow(row.id);
    expect(after.status).toBe('downloaded');
    expect(after.download_count).toBe(1);
  });
});

describe('the owner exports directly', () => {
  it('is for the owner only, once a day', async () => {
    const { headers, agentHeaders } = await companyWithOwner('acme');
    expect((await request(app).post('/company-export').set(agentHeaders)).status).toBe(403);
    expect((await request(app).get('/company-export').set(agentHeaders)).status).toBe(403);
    expect((await request(app).post('/company-export').set(headers)).status).toBe(201);
    expect((await request(app).post('/company-export').set(headers)).status).toBe(429);
    const list = await request(app).get('/company-export').set(headers);
    expect(list.body.exports).toHaveLength(1);
  });

  it('works while suspended, and not while on hold', async () => {
    const suspended = await companyWithOwner('slow-payer');
    await setStatus(suspended.company.id, 'suspended');
    expect((await request(app).post('/company-export').set(suspended.headers)).status).toBe(201);

    const held = await companyWithOwner('held');
    await setStatus(held.company.id, 'on_hold');
    const res = await request(app).post('/company-export').set(held.headers);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('company_on_hold');
  });

  it('never hands one company’s archive to another', async () => {
    const a = await companyWithOwner('acme');
    const b = await companyWithOwner('other');
    const started = await request(app).post('/company-export').set(a.headers);
    await runExportBuilds();
    const id = started.body.export.id;
    expect((await request(app).get(`/company-export/${id}/download`).set(b.headers)).status).toBe(404);
    expect((await request(app).get(`/company-export/${id}/download`).set(a.agentHeaders)).status).toBe(403);
    expect((await request(app).get(`/company-export/${id}/download`).set(a.headers)).status).toBe(200);
  });

  it('removes an archive once its 72 hours are up', async () => {
    const { headers } = await companyWithOwner('acme');
    const started = await request(app).post('/company-export').set(headers);
    await runExportBuilds();
    const id = started.body.export.id;
    const file = path.join(exportsRoot(), `${id}.zip`);
    expect(fs.existsSync(file)).toBe(true);
    await pool.query(`UPDATE company_exports SET expires_at = now() - interval '1 minute' WHERE id = $1`, [id]);
    expect(await sweepExports()).toBe(1);
    expect(fs.existsSync(file)).toBe(false);
    expect((await exportRow(id)).status).toBe('expired');
    expect((await request(app).get(`/company-export/${id}/download`).set(headers)).status).toBe(410);
  });
});

describe('the final export, while the company is closing', () => {
  const op = (method: 'get' | 'post', url: string, body: object = {}) =>
    request(app)[method](url).set('Cookie', opCookie).send(body);

  it('is asked for by the owner with their password, and approved by the operator', async () => {
    const { company, headers, agentHeaders } = await companyWithOwner('closing');
    expect(
      (await request(app).post('/company-export/final').set(headers).send({ password: OWNER_PASSWORD })).status
    ).toBe(403);

    await setStatus(company.id, 'pending_deletion');
    // Nothing else works for a closing company; the export does.
    expect((await request(app).get('/leads').set(headers)).body.role).toBe('owner');
    expect((await request(app).post('/company-export').set(headers)).status).toBe(403);
    expect(
      (await request(app).post('/company-export/final').set(agentHeaders).send({ password: 'x' })).status
    ).toBe(403);
    expect(
      (await request(app).post('/company-export/final').set(headers).send({ password: 'wrong' })).status
    ).toBe(400);
    const asked = await request(app).post('/company-export/final').set(headers).send({ password: OWNER_PASSWORD });
    expect(asked.status).toBe(201);
    expect(asked.body.export).toMatchObject({ kind: 'final', status: 'requested' });
    expect(
      (await request(app).post('/company-export/final').set(headers).send({ password: OWNER_PASSWORD })).status
    ).toBe(409);

    // The operator's queue: who asked and when, never what is in it.
    expect((await request(app).get('/operator/exports').set(headers)).status).toBe(401);
    const queue = await op('get', '/operator/exports');
    expect(queue.body.requests).toEqual([
      expect.objectContaining({
        id: asked.body.export.id,
        final_sent_before: false,
        company: expect.objectContaining({ slug: 'closing' }),
        requested_by: expect.objectContaining({ email: 'owner@closing.test' }),
      }),
    ]);
    const overview = await op('get', '/operator/overview');
    expect(overview.body.export_requests).toHaveLength(1);

    const approved = await op('post', `/operator/exports/${asked.body.export.id}/approve`);
    expect(approved.status).toBe(200);
    expect(approved.body.company.exports[0]).toMatchObject({ kind: 'final', status: 'approved' });
    expect((await op('post', `/operator/exports/${asked.body.export.id}/approve`)).status).toBe(409);

    await runExportBuilds();
    const dl = await request(app)
      .get(`/company-export/${asked.body.export.id}/download`)
      .set(headers)
      .buffer(true)
      .parse(binary);
    expect(dl.status).toBe(200);
    expect(Object.keys(readZip(dl.body))).toContain('data/leads.json');

    const { rows } = await pool.query(
      `SELECT event, operator_id IS NOT NULL AS by_operator FROM operator_events
       WHERE company_id = $1 ORDER BY id`,
      [company.id]
    );
    expect(rows.map((r) => r.event)).toEqual([
      'export_requested',
      'export_approved',
      'export_built',
      'export_downloaded',
    ]);
    expect(rows.find((r) => r.event === 'export_approved').by_operator).toBe(true);
  });

  it('can be denied, with a reason', async () => {
    const { company, headers } = await companyWithOwner('closing');
    await setStatus(company.id, 'pending_deletion');
    const asked = await request(app).post('/company-export/final').set(headers).send({ password: OWNER_PASSWORD });
    const id = asked.body.export.id;
    expect((await op('post', `/operator/exports/${id}/deny`)).status).toBe(400);
    const denied = await op('post', `/operator/exports/${id}/deny`, { reason: 'sent one last week' });
    expect(denied.status).toBe(200);
    expect((await exportRow(id)).status).toBe('denied');
    await runExportBuilds();
    expect(fs.existsSync(path.join(exportsRoot(), `${id}.zip`))).toBe(false);
  });
});
