/// <reference types="jest" />
/**
 * Rows can't land in another company, proven route by route
 * (EXPERIMENT_SAAS.md prospect 3).
 *
 * Company B gets a full job: lead, job, measurement, estimate (approved),
 * invoice and payment, file, note, task, portal token, saved view,
 * automation rule, template, invite, intake link. Then company A's owner
 * goes through every route the app has mounted:
 *
 *   - routes that take an id, given B's id: 404 (or an empty list)
 *   - creates that name B's records in the body: refused
 *   - lists and summaries: what A sees is identical before and after B
 *     has data, and a search for B's client finds nothing
 *   - afterwards, every one of B's rows is unchanged.
 *
 * The routes come from Express itself, not from a list kept by hand: a
 * route with neither a case below nor an exemption with a reason fails the
 * test, so a new router can't be added without saying how it is scoped.
 */
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { app } from '../src/app';
import { pool } from '../src/db';
import { ensureSchema } from './helpers/setup';
import { resetDb } from './helpers/db';
import {
  authHeaderFor,
  createTestCompany,
  createTestUser,
  DEFAULT_COMPANY_ID,
} from './helpers/auth';
import { startTestServer } from './helpers/server';

jest.setTimeout(60000);

// One server for the whole matrix (see helpers/server.ts).
let server: Awaited<ReturnType<typeof startTestServer>>;
function api() {
  return server.api();
}

type Headers = Record<string, string>;
type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** What counts as A being kept out. */
type Expectation =
  | 'notFound' // 404
  | 'notFoundOrEmpty' // 404, or 200 whose lists are all empty
  | 'refused' // 400, 403, 404 or 409: a create or edit naming B's record
  | 'ownRowsOnly'; // acts on the caller's own rows; B's rows checked at the end

type Attempt = {
  method: Method;
  url: string;
  body?: Record<string, unknown>;
  expect: Expectation;
};

// ─── The routes Express has mounted ──────────────────────────────────────────

const SRC = path.join(__dirname, '..', 'src');

/** `import { a, b } from './routes/x'` → name → module path, for one file. */
function importsOf(file: string, dirPrefix: string) {
  const source = fs.readFileSync(file, 'utf8');
  const map = new Map<string, string>();
  const re = new RegExp(
    String.raw`import\s*\{([^}]+)\}\s*from\s*'${dirPrefix.replace(/[./]/g, '\\$&')}([\w.]+)'`,
    'g'
  );
  for (const m of source.matchAll(re)) {
    for (const name of m[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)) {
      map.set(name, path.join(SRC, 'routes', m[2]));
    }
  }
  return { source, map };
}

/** Every `<owner>.use('/path', ..., someRouter)` in a file, as router object → path. */
function mountsIn(file: string, owner: string, dirPrefix: string) {
  const { source, map } = importsOf(file, dirPrefix);
  const re = new RegExp(
    String.raw`${owner}\.use\(\s*'([^']+)',(?:[^;]*?,)?\s*(\w+Router)\s*\)`,
    'g'
  );
  const mounts = new Map<unknown, string>();
  for (const m of source.matchAll(re)) {
    const modulePath = map.get(m[2]);
    if (!modulePath)
      throw new Error(`${file}: cannot find where ${m[2]} comes from`);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const router = require(modulePath)[m[2]];
    if (!router) throw new Error(`${modulePath} has no export ${m[2]}`);
    mounts.set(router, m[1]);
  }
  return mounts;
}

function routeKeys(
  router: any,
  prefix: string,
  sourceFile: string | null
): string[] {
  const keys: string[] = [];
  const nested = sourceFile
    ? mountsIn(
        sourceFile,
        path.basename(sourceFile).replace(/\.routes\.ts$/, '') + 'Router',
        './'
      )
    : new Map();
  for (const layer of router.stack) {
    if (layer.route) {
      const sub = layer.route.path === '/' ? '' : layer.route.path;
      for (const method of Object.keys(layer.route.methods)) {
        keys.push(`${method.toUpperCase()} ${prefix}${sub}`);
      }
    } else if (layer.handle?.stack) {
      const mount = nested.get(layer.handle);
      if (mount == null) {
        throw new Error(
          `A router under ${prefix || '/'} is mounted in a way this test cannot read.`
        );
      }
      const file = [...importsOf(sourceFile!, './').map.values()].find(
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        (candidate) => Object.values(require(candidate)).includes(layer.handle)
      );
      keys.push(
        ...routeKeys(
          layer.handle,
          `${prefix}${mount}`,
          file ? `${file}.ts` : null
        )
      );
    }
  }
  return keys;
}

function mountedRouteKeys(): string[] {
  const appFile = path.join(SRC, 'app.ts');
  const mounts = mountsIn(appFile, 'app', './routes/');
  const { map } = importsOf(appFile, './routes/');
  const keys: string[] = [];
  for (const layer of (app as any).router.stack) {
    if (layer.route) {
      for (const method of Object.keys(layer.route.methods)) {
        keys.push(`${method.toUpperCase()} ${layer.route.path}`);
      }
    } else if (layer.handle?.stack) {
      const mount = mounts.get(layer.handle);
      if (mount == null)
        throw new Error(
          'A router is mounted in app.ts in a way this test cannot read.'
        );
      const file = [...map.values()].find(
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        (candidate) => Object.values(require(candidate)).includes(layer.handle)
      );
      keys.push(...routeKeys(layer.handle, mount, file ? `${file}.ts` : null));
    }
  }
  return keys;
}

// ─── Exemptions: routes with no company record to cross, and why ───────────

const EXEMPT: Record<string, string> = {
  'POST /auth/register': 'creates a new company; takes no id',
  'POST /auth/login':
    'signs in by email and password; the company comes from the account',
  'POST /auth/accept-invite':
    'addressed by an unguessable invite token, not an id',
  'POST /auth/logout': 'ends the caller’s own session and clears its cookie',
  'POST /auth/forgot-password':
    'takes a company slug and email, answers the same for any account, and mails only that account (accounts tests)',
  'GET /auth/reset-password/validate':
    'addressed by an unguessable reset token, not an id (accounts tests)',
  'POST /auth/reset-password':
    'addressed by an unguessable reset token, not an id (accounts tests)',
  'GET /users/invites/validate':
    'addressed by an unguessable invite token, not an id',
  'GET /help': 'help articles are product docs, the same for every company',
  'GET /help/:id': 'help articles are product docs, the same for every company',
  'GET /public/estimates/:token':
    'addressed by an unguessable share token (estimates-public tests)',
  'GET /public/estimates/:token/pdf':
    'addressed by an unguessable share token (estimates-public tests)',
  'POST /public/estimates/:token/respond':
    'addressed by an unguessable share token (estimates-public tests)',
  'GET /public/invoices/:token':
    'addressed by an unguessable share token (invoices tests)',
  'GET /public/invoices/:token/pdf':
    'addressed by an unguessable share token (invoices tests)',
  'GET /public/portal/:token':
    'addressed by an unguessable portal token (portal tests)',
  'GET /public/intake/:token':
    'addressed by an unguessable intake token (intake tests)',
  'POST /public/intake/:token':
    'addressed by an unguessable intake token (intake tests)',
  'GET /public/companies/:slug':
    'public by design: a company’s name and colours for its sign-in page',
  'GET /public/companies/:slug/logo':
    'public by design: a company’s logo for its sign-in page',
  'GET /health': 'liveness; reads no company data',
  'POST /automation/rules/from-template/:templateId':
    'templateId names a built-in rule template, not a company row',
  'GET /integrations/abc/status':
    'ABC Supply configuration flags; no company row',
  'GET /integrations/abc/pricing-sample':
    'calls the ABC Supply API; reads and writes no company row',
  'POST /integrations/abc/search/accounts':
    'calls the ABC Supply API; reads and writes no company row',
  'POST /integrations/abc/search/items':
    'calls the ABC Supply API; reads and writes no company row',
  'GET /integrations/abc/branches':
    'calls the ABC Supply API; reads and writes no company row',
  'GET /integrations/abc/invoices/history':
    'calls the ABC Supply API; reads and writes no company row',
  'POST /integrations/abc/orders':
    'calls the ABC Supply API; reads and writes no company row',
  'GET /integrations/quickbooks/auth-url':
    'builds the caller’s QuickBooks sign-in link; no company row',
  'GET /integrations/quickbooks/callback':
    'QuickBooks OAuth return; needs a live QuickBooks app (writes the caller’s own connection)',
  'GET /integrations/quickbooks/payment-status/:qbInvoiceId':
    'a QuickBooks id, answered by QuickBooks; needs a live connection',
};

// ─── Fixtures ────────────────────────────────────────────────────────────────

const B_CLIENT = 'Quillfeather';

async function ok(res: request.Response, status = 201, label = '') {
  if (res.status !== status) {
    throw new Error(
      `${label || res.req?.path}: expected ${status}, got ${res.status} ${JSON.stringify(res.body)}`
    );
  }
  return res.body;
}

async function buildCompany(headers: Headers, label: string, client: string) {
  const lead = (
    await ok(
      await api()
        .post('/leads')
        .set(headers)
        .send({
          first_name: 'Zephyrine',
          last_name: client,
          status: 'New',
          source: 'Referral',
        }),
      201,
      `${label} lead`
    )
  ).lead;
  const job = (
    await ok(
      await api()
        .post('/jobs')
        .set(headers)
        .send({
          lead_id: lead.id,
          title: `${client} re-roof`,
          address: '9 Birch Lane',
        }),
      201,
      `${label} job`
    )
  ).job;
  const measurement = (
    await ok(
      await api()
        .post(`/jobs/${job.id}/measurements`)
        .set(headers)
        .send({ label: 'Roof squares', value: 28, unit: 'sq' }),
      201,
      `${label} measurement`
    )
  ).measurement;
  const estimate = (
    await ok(
      await api()
        .post('/estimates')
        .set(headers)
        .send({ job_id: job.id, title: `${client} roof` }),
      201,
      `${label} estimate`
    )
  ).estimate;
  const estimateLine = (
    await ok(
      await api()
        .post(`/estimates/${estimate.id}/line-items`)
        .set(headers)
        .send({ name: 'Shingles', quantity: 10, unit_price: 100 }),
      201,
      `${label} estimate line`
    )
  ).estimate.line_items[0];
  const note = (
    await ok(
      await api()
        .post('/notes')
        .set(headers)
        .send({
          entity_type: 'job',
          entity_id: job.id,
          body: `${client} prefers mornings`,
        }),
      201,
      `${label} note`
    )
  ).note;
  const task = (
    await ok(
      await api()
        .post('/tasks')
        .set(headers)
        .send({ title: `Call ${client}`, job_id: job.id }),
      201,
      `${label} task`
    )
  ).task;
  const file = (
    await ok(
      await api()
        .post('/files')
        .set(headers)
        .field('job_id', String(job.id))
        .attach(
          'file',
          Buffer.from('roof photo bytes'),
          `${client.toLowerCase()}-roof.jpg`
        ),
      201,
      `${label} file`
    )
  ).file;
  const portal = await ok(
    await api().post(`/portal/generate/${job.id}`).set(headers),
    200,
    `${label} portal`
  );
  const invoice = (
    await ok(
      await api()
        .post('/invoices')
        .set(headers)
        .send({ job_id: job.id, status: 'Sent' }),
      201,
      `${label} invoice`
    )
  ).invoice;
  const invoiceWithLine = (
    await ok(
      await api()
        .post(`/invoices/${invoice.id}/line-items`)
        .set(headers)
        .send({ name: 'Inspection', quantity: 1, unit_price: 250 }),
      201,
      `${label} invoice line`
    )
  ).invoice;
  return {
    lead,
    job,
    measurement,
    estimate,
    estimateLine,
    note,
    task,
    file,
    portalToken: portal.token as string,
    invoice,
    invoiceLine: invoiceWithLine.line_items[0],
  };
}

// ─── Snapshots ───────────────────────────────────────────────────────────────

/** Lists and summaries company A reads. Compared before and after B has data. */
const LIST_URLS: Record<string, string[]> = {
  'GET /auth/me': ['/auth/me'],
  'GET /me/preferences': ['/me/preferences'],
  'GET /company/workspace-defaults': ['/company/workspace-defaults'],
  'GET /company': ['/company'],
  'GET /leads/summary': ['/leads/summary', '/leads/summary?view=all'],
  'GET /leads': ['/leads', '/leads?view=all', `/leads?search=${B_CLIENT}`],
  'GET /tasks/summary': ['/tasks/summary', '/tasks/summary?view=all'],
  'GET /tasks': ['/tasks', '/tasks?view=all'],
  'GET /dashboard': ['/dashboard', '/dashboard?view=all'],
  'GET /dashboard/workload': ['/dashboard/workload'],
  'GET /dashboard/activities': ['/dashboard/activities'],
  'GET /users': ['/users'],
  'GET /files': ['/files'],
  'GET /notifications': ['/notifications'],
  'GET /notifications/unread-count': ['/notifications/unread-count'],
  'GET /jobs/summary': ['/jobs/summary', '/jobs/summary?view=all'],
  'GET /jobs': ['/jobs', '/jobs?view=all'],
  'GET /estimate-templates': ['/estimate-templates'],
  'GET /search': [`/search?q=${B_CLIENT}`, '/search?q=Zephyrine'],
  'GET /reports/lead-funnel': ['/reports/lead-funnel'],
  'GET /reports/estimate-outcomes': ['/reports/estimate-outcomes'],
  'GET /reports/job-pipeline': ['/reports/job-pipeline'],
  'GET /reports/collections': ['/reports/collections'],
  'GET /reports/team': ['/reports/team'],
  'GET /reports/trends': ['/reports/trends'],
  'GET /saved-views': [
    '/saved-views?entityType=leads',
    '/saved-views?entityType=jobs',
  ],
  'GET /invoices': ['/invoices', '/invoices?balance=open'],
  'GET /automation/templates': ['/automation/templates'],
  'GET /automation/rules': ['/automation/rules'],
  'GET /intake': ['/intake'],
  'GET /product-metrics/summary': ['/product-metrics/summary'],
  'GET /product-metrics/timeline/:eventName': [
    '/product-metrics/timeline/lead_created',
    '/product-metrics/timeline/invoice_created',
  ],
  'GET /integrations/quickbooks/status': ['/integrations/quickbooks/status'],
};

async function readLists(headers: Headers) {
  const out: Record<string, unknown> = {};
  for (const urls of Object.values(LIST_URLS)) {
    for (const url of urls) {
      const res = await api().get(url).set(headers);
      out[url] = { status: res.status, body: res.body };
    }
  }
  return out;
}

/** Every row of every company_id table that belongs to the company. */
async function rowsOf(companyId: string) {
  const { rows: tables } = await pool.query(
    `SELECT table_name FROM information_schema.columns
     WHERE table_schema = 'public' AND column_name = 'company_id'
     ORDER BY table_name`
  );
  const out: Record<string, unknown[]> = {};
  for (const { table_name } of tables) {
    const { rows } = await pool.query(
      `SELECT * FROM public.${table_name} WHERE company_id = $1 ORDER BY 1`,
      [companyId]
    );
    out[table_name] = rows;
  }
  const { rows: company } = await pool.query(
    `SELECT * FROM companies WHERE id = $1`,
    [companyId]
  );
  out.companies = company;
  return out;
}

function allListsEmpty(body: any) {
  if (!body || typeof body !== 'object') return false;
  const lists = Object.entries(body).filter(([, v]) => Array.isArray(v));
  return (
    lists.length > 0 && lists.every(([, v]) => (v as unknown[]).length === 0)
  );
}

function judge(attempt: Attempt, res: request.Response): string | null {
  const { status } = res;
  switch (attempt.expect) {
    case 'notFound':
      return status === 404 ? null : `expected 404`;
    case 'notFoundOrEmpty':
      return status === 404 || (status === 200 && allListsEmpty(res.body))
        ? null
        : 'expected 404 or an empty list';
    case 'refused':
      return [400, 403, 404, 409].includes(status)
        ? null
        : 'expected a refusal (400/403/404/409)';
    case 'ownRowsOnly':
      return status < 500 ? null : 'expected no server error';
  }
}

async function send(headers: Headers, attempt: Attempt) {
  const method = attempt.method.toLowerCase() as
    | 'get'
    | 'post'
    | 'patch'
    | 'delete';
  const req = api()[method](attempt.url).set(headers);
  return attempt.body ? req.send(attempt.body) : req;
}

// ─── The matrix ──────────────────────────────────────────────────────────────

describe('tenancy matrix: company A against company B, every mounted route', () => {
  let A: {
    headers: Headers;
    ownerId: string;
    data: Awaited<ReturnType<typeof buildCompany>>;
  };
  let B: {
    id: string;
    headers: Headers;
    ownerId: string;
    agentId: string;
    invitedId: string;
    data: Awaited<ReturnType<typeof buildCompany>>;
    finalInvoiceId: number;
    paymentId: number;
    templateId: number;
    templateLineId: number;
    savedViewId: number;
    ruleId: number;
    notificationId: number;
  };
  let listsBefore: Record<string, unknown>;
  let listsAfter: Record<string, unknown>;
  let bRowsBefore: Record<string, unknown[]>;

  beforeAll(async () => {
    server = await startTestServer();
    await ensureSchema();
    await resetDb();

    // Company A: Rooftop, from the starting rows, with a job of its own.
    const ownerA = await createTestUser({
      role: 'owner',
      company_id: DEFAULT_COMPANY_ID,
      first_name: 'Ava',
      last_name: 'Ashwood',
    });
    const headersA = await authHeaderFor(ownerA);
    A = {
      headers: headersA,
      ownerId: ownerA.id,
      data: await buildCompany(headersA, 'A', 'Ashgrove'),
    };

    listsBefore = await readLists(headersA);

    // Company B: everything a working company has.
    const companyB = await createTestCompany({
      name: 'Northside Roofing',
      slug: 'northside-matrix',
    });
    const ownerB = await createTestUser({
      role: 'owner',
      company_id: companyB.id,
      first_name: 'Blake',
      last_name: 'Bravard',
    });
    const agentB = await createTestUser({
      role: 'agent',
      company_id: companyB.id,
      first_name: 'Bo',
      last_name: 'Bright',
    });
    const headersB = await authHeaderFor(ownerB);
    const data = await buildCompany(headersB, 'B', B_CLIENT);

    // Approve B's estimate the way a client does, bill it and take a payment.
    const share = await ok(
      await api()
        .post(`/estimates/${data.estimate.id}/share`)
        .set(headersB)
        .send({}),
      200,
      'B share'
    );
    const token = String(share.share_url).match(
      /\/public\/estimate\/([^/?#]+)/
    )?.[1];
    await ok(
      await api()
        .post(`/public/estimates/${token}/respond`)
        .send({ decision: 'approve' }),
      200,
      'B approve'
    );
    const final = (
      await ok(
        await api()
          .post(`/invoices/from-estimate/${data.estimate.id}`)
          .set(headersB)
          .send({ kind: 'final' }),
        201,
        'B final invoice'
      )
    ).invoice;
    await ok(
      await api()
        .patch(`/invoices/${final.id}`)
        .set(headersB)
        .send({ status: 'Sent' }),
      200,
      'B send invoice'
    );
    const paid = await ok(
      await api()
        .post(`/invoices/${final.id}/payments`)
        .set(headersB)
        .send({ amount: 400, method: 'check' }),
      201,
      'B payment'
    );
    const template = (
      await ok(
        await api()
          .post('/estimate-templates')
          .set(headersB)
          .send({ name: 'Northside gutters' }),
        201,
        'B template'
      )
    ).template;
    const templateLine = await ok(
      await api()
        .post(`/estimate-templates/${template.id}/line-items`)
        .set(headersB)
        .send({ name: 'Gutter run', quantity: 1, unit_price: 300 }),
      201,
      'B template line'
    );
    const savedView = (
      await ok(
        await api()
          .post('/saved-views')
          .set(headersB)
          .send({ entity_type: 'leads', name: 'Northside new', filters: {} }),
        201,
        'B saved view'
      )
    ).view;
    const rule = (
      await ok(
        await api()
          .post('/automation/rules')
          .set(headersB)
          .send({
            name: 'Northside follow-up',
            trigger_event: 'JOB_STATUS_CHANGED',
            conditions: { to_status: 'Lost' },
            action_type: 'SEND_NOTIFICATION',
            action_config: { title: 'Lost one', message: 'Check in' },
          }),
        201,
        'B rule'
      )
    ).rule;
    await ok(
      await api().post('/intake/generate').set(headersB),
      201,
      'B intake'
    );
    const invited = (
      await ok(
        await api()
          .post('/users/invite')
          .set(headersB)
          .send({
            first_name: 'Ivy',
            last_name: 'Invitee',
            email: 'ivy.invitee@example.com',
          }),
        201,
        'B invite'
      )
    ).user;
    const { rows: notes } = await pool.query(
      `SELECT id FROM notifications WHERE company_id = $1 ORDER BY id LIMIT 1`,
      [companyB.id]
    );
    if (!notes[0]) throw new Error('B has no notification to aim at');

    B = {
      id: companyB.id,
      headers: headersB,
      ownerId: ownerB.id,
      agentId: agentB.id,
      invitedId: invited.id,
      data,
      finalInvoiceId: final.id,
      paymentId: paid.invoice.payments[0].id,
      templateId: template.id,
      templateLineId: templateLine.template.line_items[0].id,
      savedViewId: savedView.id,
      ruleId: rule.id,
      notificationId: notes[0].id,
    };

    listsAfter = await readLists(headersA);
    bRowsBefore = await rowsOf(B.id);
  });

  afterAll(async () => {
    await server.close();
    await resetDb();
  });

  function cases(): Record<string, Attempt[]> {
    const b = B.data;
    const a = A.data;
    const nf = (
      method: Method,
      url: string,
      body?: Record<string, unknown>
    ): Attempt => ({
      method,
      url,
      body,
      expect: 'notFound',
    });
    const empty = (url: string): Attempt => ({
      method: 'GET',
      url,
      expect: 'notFoundOrEmpty',
    });
    const refused = (
      method: Method,
      url: string,
      body: Record<string, unknown>
    ): Attempt => ({
      method,
      url,
      body,
      expect: 'refused',
    });
    const own = (
      method: Method,
      url: string,
      body?: Record<string, unknown>
    ): Attempt => ({
      method,
      url,
      body,
      expect: 'ownRowsOnly',
    });

    return {
      // Caller's own rows: no id to cross. B's rows are compared at the end.
      'PATCH /me/preferences': [
        own('PATCH', '/me/preferences', { theme: 'dark' }),
      ],
      'DELETE /me/preferences': [own('DELETE', '/me/preferences')],
      'PATCH /company/workspace-defaults': [
        own('PATCH', '/company/workspace-defaults', {}),
      ],
      'PATCH /company': [own('PATCH', '/company', { name: 'Rooftop Realty' })],
      'POST /company/logo': [own('POST', '/company/logo')],
      'POST /auth/sessions/end-others': [
        own('POST', '/auth/sessions/end-others'),
      ],
      // A's owner has no password, so this is refused: nothing changes.
      'POST /auth/change-password': [
        own('POST', '/auth/change-password', {
          current_password: 'not-the-password',
          new_password: 'another-password-1',
        }),
      ],
      'POST /users/invite': [
        own('POST', '/users/invite', {
          first_name: 'Al',
          last_name: 'A',
          email: 'al.a@example.com',
        }),
      ],
      'POST /estimate-templates': [
        own('POST', '/estimate-templates', { name: 'A gutters' }),
      ],
      'POST /saved-views': [
        own('POST', '/saved-views', {
          entity_type: 'jobs',
          name: 'A jobs',
          filters: {},
        }),
      ],
      'POST /automation/rules': [
        own('POST', '/automation/rules', {
          name: 'A rule',
          trigger_event: 'JOB_STATUS_CHANGED',
          action_type: 'SEND_NOTIFICATION',
          action_config: { title: 't', message: 'm' },
        }),
      ],
      'PATCH /notifications/read-all': [
        own('PATCH', '/notifications/read-all'),
      ],
      'DELETE /notifications/read': [own('DELETE', '/notifications/read')],
      'POST /intake/generate': [own('POST', '/intake/generate')],
      'POST /intake/regenerate': [own('POST', '/intake/regenerate')],
      'POST /intake/enable': [own('POST', '/intake/enable', { enabled: true })],
      'DELETE /intake': [own('DELETE', '/intake')],
      'POST /integrations/quickbooks/disconnect': [
        own('POST', '/integrations/quickbooks/disconnect'),
      ],

      // Leads
      'GET /leads/:id': [nf('GET', `/leads/${b.lead.id}`)],
      'PATCH /leads/:id': [
        nf('PATCH', `/leads/${b.lead.id}`, { notes: 'mine now' }),
        refused('PATCH', `/leads/${a.lead.id}`, { assigned_to: B.agentId }),
      ],
      'DELETE /leads/:id': [nf('DELETE', `/leads/${b.lead.id}`)],
      'POST /leads': [
        refused('POST', '/leads', {
          first_name: 'X',
          last_name: 'Y',
          status: 'New',
          assigned_to: B.agentId,
        }),
      ],

      // Tasks
      'GET /tasks/:id': [nf('GET', `/tasks/${b.task.id}`)],
      'PATCH /tasks/:id': [
        nf('PATCH', `/tasks/${b.task.id}`, { title: 'mine now' }),
        refused('PATCH', `/tasks/${a.task.id}`, { job_id: b.job.id }),
        refused('PATCH', `/tasks/${a.task.id}`, { assigned_to: B.agentId }),
      ],
      'DELETE /tasks/:id': [nf('DELETE', `/tasks/${b.task.id}`)],
      'POST /tasks': [
        refused('POST', '/tasks', { title: 'X', job_id: b.job.id }),
        refused('POST', '/tasks', { title: 'X', lead_id: b.lead.id }),
        refused('POST', '/tasks', {
          title: 'X',
          job_id: a.job.id,
          assigned_to: B.agentId,
        }),
      ],

      // Users
      'POST /users/invite/:id/resend': [
        nf('POST', `/users/invite/${B.invitedId}/resend`),
      ],
      'POST /users/invite/:id/revoke': [
        nf('POST', `/users/invite/${B.invitedId}/revoke`),
      ],
      'PATCH /users/:id': [
        nf('PATCH', `/users/${B.agentId}`, { role: 'admin' }),
      ],
      'DELETE /users/:id': [nf('DELETE', `/users/${B.agentId}`)],
      'POST /users/:id/reset-link': [
        nf('POST', `/users/${B.agentId}/reset-link`),
      ],
      'GET /users/:id/events': [nf('GET', `/users/${B.agentId}/events`)],

      // Files
      'POST /files': [refused('POST', '/files', { job_id: b.job.id })],
      'PATCH /files/:id': [
        nf('PATCH', `/files/${b.file.id}`, { category: 'before' }),
      ],
      'DELETE /files/:id': [nf('DELETE', `/files/${b.file.id}`)],
      'GET /uploads/{*storageKey}': [
        nf('GET', `/uploads/${b.file.storage_key}`),
      ],

      // Notifications
      'PATCH /notifications/:id/read': [
        nf('PATCH', `/notifications/${B.notificationId}/read`),
      ],
      'DELETE /notifications/:id': [
        nf('DELETE', `/notifications/${B.notificationId}`),
      ],

      // Jobs
      'GET /jobs/:id': [nf('GET', `/jobs/${b.job.id}`)],
      'GET /jobs/:id/tasks': [empty(`/jobs/${b.job.id}/tasks`)],
      'GET /jobs/:id/activity': [empty(`/jobs/${b.job.id}/activity`)],
      'GET /jobs/:id/measurements': [empty(`/jobs/${b.job.id}/measurements`)],
      'POST /jobs/:id/measurements': [
        nf('POST', `/jobs/${b.job.id}/measurements`, {
          label: 'x',
          value: 1,
          unit: 'ft',
        }),
      ],
      'PATCH /jobs/:id/measurements/:measurementId': [
        nf('PATCH', `/jobs/${b.job.id}/measurements/${b.measurement.id}`, {
          value: 99,
        }),
        nf('PATCH', `/jobs/${a.job.id}/measurements/${b.measurement.id}`, {
          value: 99,
        }),
      ],
      'DELETE /jobs/:id/measurements/:measurementId': [
        nf('DELETE', `/jobs/${b.job.id}/measurements/${b.measurement.id}`),
        nf('DELETE', `/jobs/${a.job.id}/measurements/${b.measurement.id}`),
      ],
      'PATCH /jobs/:id': [
        nf('PATCH', `/jobs/${b.job.id}`, { title: 'mine now' }),
        refused('PATCH', `/jobs/${a.job.id}`, { assigned_to: B.agentId }),
      ],
      'DELETE /jobs/:id': [nf('DELETE', `/jobs/${b.job.id}`)],
      'POST /jobs': [
        refused('POST', '/jobs', {
          lead_id: b.lead.id,
          title: 'X',
          address: 'Y',
        }),
      ],

      // Estimates
      'GET /estimates/job/:jobId': [empty(`/estimates/job/${b.job.id}`)],
      'POST /estimates': [
        refused('POST', '/estimates', { job_id: b.job.id, title: 'X' }),
      ],
      'GET /estimates/:id/pdf': [nf('GET', `/estimates/${b.estimate.id}/pdf`)],
      'POST /estimates/:id/share': [
        nf('POST', `/estimates/${b.estimate.id}/share`, {}),
      ],
      'POST /estimates/:id/resend': [
        nf('POST', `/estimates/${b.estimate.id}/resend`, {}),
      ],
      'POST /estimates/:id/change-order': [
        nf('POST', `/estimates/${b.estimate.id}/change-order`, {}),
      ],
      'POST /estimates/:id/apply-template': [
        nf('POST', `/estimates/${b.estimate.id}/apply-template`, {
          template_id: 1,
        }),
        refused('POST', `/estimates/${a.estimate.id}/apply-template`, {
          template_id: B.templateId,
        }),
      ],
      'GET /estimates/:id': [nf('GET', `/estimates/${b.estimate.id}`)],
      'PATCH /estimates/:id': [
        nf('PATCH', `/estimates/${b.estimate.id}`, { title: 'mine now' }),
      ],
      'DELETE /estimates/:id': [nf('DELETE', `/estimates/${b.estimate.id}`)],
      'POST /estimates/:id/line-items': [
        nf('POST', `/estimates/${b.estimate.id}/line-items`, {
          name: 'x',
          quantity: 1,
          unit_price: 1,
        }),
      ],
      'PATCH /estimates/:id/line-items/:lineItemId': [
        nf(
          'PATCH',
          `/estimates/${b.estimate.id}/line-items/${b.estimateLine.id}`,
          { quantity: 2 }
        ),
        nf(
          'PATCH',
          `/estimates/${a.estimate.id}/line-items/${b.estimateLine.id}`,
          { quantity: 2 }
        ),
      ],
      'DELETE /estimates/:id/line-items/:lineItemId': [
        nf(
          'DELETE',
          `/estimates/${b.estimate.id}/line-items/${b.estimateLine.id}`
        ),
        nf(
          'DELETE',
          `/estimates/${a.estimate.id}/line-items/${b.estimateLine.id}`
        ),
      ],

      // Estimate templates
      'GET /estimate-templates/:id': [
        nf('GET', `/estimate-templates/${B.templateId}`),
      ],
      'PATCH /estimate-templates/:id': [
        nf('PATCH', `/estimate-templates/${B.templateId}`, { name: 'mine' }),
      ],
      'DELETE /estimate-templates/:id': [
        nf('DELETE', `/estimate-templates/${B.templateId}`),
      ],
      'POST /estimate-templates/:id/line-items': [
        nf('POST', `/estimate-templates/${B.templateId}/line-items`, {
          name: 'x',
          quantity: 1,
          unit_price: 1,
        }),
      ],
      'PATCH /estimate-templates/:id/line-items/:lineItemId': [
        nf(
          'PATCH',
          `/estimate-templates/${B.templateId}/line-items/${B.templateLineId}`,
          { quantity: 2 }
        ),
        nf('PATCH', `/estimate-templates/1/line-items/${B.templateLineId}`, {
          quantity: 2,
        }),
      ],
      'DELETE /estimate-templates/:id/line-items/:lineItemId': [
        nf(
          'DELETE',
          `/estimate-templates/${B.templateId}/line-items/${B.templateLineId}`
        ),
        nf('DELETE', `/estimate-templates/1/line-items/${B.templateLineId}`),
      ],

      // Notes
      'GET /notes': [
        empty(`/notes?entity_type=job&entity_id=${b.job.id}`),
        empty(`/notes?entity_type=lead&entity_id=${b.lead.id}`),
      ],
      'POST /notes': [
        refused('POST', '/notes', {
          entity_type: 'job',
          entity_id: b.job.id,
          body: 'x',
        }),
      ],
      'DELETE /notes/:id': [nf('DELETE', `/notes/${b.note.id}`)],

      // Reports
      'GET /reports/team/:userId': [nf('GET', `/reports/team/${B.agentId}`)],

      // Saved views
      'PATCH /saved-views/:id': [
        nf('PATCH', `/saved-views/${B.savedViewId}`, { name: 'mine' }),
      ],
      'DELETE /saved-views/:id': [
        nf('DELETE', `/saved-views/${B.savedViewId}`),
      ],

      // Invoices and payments
      'POST /invoices/from-estimate/:estimateId': [
        nf('POST', `/invoices/from-estimate/${b.estimate.id}`, {
          kind: 'final',
        }),
        nf('POST', `/invoices/from-estimate/${b.estimate.id}`, {
          kind: 'deposit',
        }),
      ],
      'GET /invoices/job/:jobId': [empty(`/invoices/job/${b.job.id}`)],
      'POST /invoices': [
        refused('POST', '/invoices', { job_id: b.job.id }),
        refused('POST', '/invoices', {
          job_id: a.job.id,
          estimate_id: b.estimate.id,
        }),
      ],
      'GET /invoices/:id/pdf': [nf('GET', `/invoices/${B.finalInvoiceId}/pdf`)],
      'POST /invoices/:id/share': [
        nf('POST', `/invoices/${B.finalInvoiceId}/share`, {}),
      ],
      'GET /invoices/:id': [nf('GET', `/invoices/${B.finalInvoiceId}`)],
      'PATCH /invoices/:id': [
        nf('PATCH', `/invoices/${B.finalInvoiceId}`, { notes: 'mine' }),
      ],
      'DELETE /invoices/:id': [nf('DELETE', `/invoices/${b.invoice.id}`)],
      'POST /invoices/:id/line-items': [
        nf('POST', `/invoices/${b.invoice.id}/line-items`, {
          name: 'x',
          quantity: 1,
          unit_price: 1,
        }),
      ],
      'PATCH /invoices/:id/line-items/:lineItemId': [
        nf(
          'PATCH',
          `/invoices/${b.invoice.id}/line-items/${b.invoiceLine.id}`,
          { quantity: 2 }
        ),
        nf(
          'PATCH',
          `/invoices/${a.invoice.id}/line-items/${b.invoiceLine.id}`,
          { quantity: 2 }
        ),
      ],
      'DELETE /invoices/:id/line-items/:lineItemId': [
        nf(
          'DELETE',
          `/invoices/${b.invoice.id}/line-items/${b.invoiceLine.id}`
        ),
        nf(
          'DELETE',
          `/invoices/${a.invoice.id}/line-items/${b.invoiceLine.id}`
        ),
      ],
      'GET /invoices/:id/payments': [
        nf('GET', `/invoices/${B.finalInvoiceId}/payments`),
      ],
      'POST /invoices/:id/payments': [
        nf('POST', `/invoices/${B.finalInvoiceId}/payments`, { amount: 1 }),
      ],
      'DELETE /invoices/:id/payments/:paymentId': [
        nf('DELETE', `/invoices/${B.finalInvoiceId}/payments/${B.paymentId}`),
        nf('DELETE', `/invoices/${a.invoice.id}/payments/${B.paymentId}`),
      ],
      'POST /integrations/quickbooks/sync-invoice/:invoiceId': [
        nf('POST', `/integrations/quickbooks/sync-invoice/${B.finalInvoiceId}`),
      ],

      // Automation
      'GET /automation/rules/:id': [nf('GET', `/automation/rules/${B.ruleId}`)],
      'PATCH /automation/rules/:id': [
        nf('PATCH', `/automation/rules/${B.ruleId}`, { enabled: false }),
      ],
      'DELETE /automation/rules/:id': [
        nf('DELETE', `/automation/rules/${B.ruleId}`),
      ],
      'POST /automation/evaluate': [
        nf('POST', '/automation/evaluate', {
          trigger_event: 'JOB_CREATED',
          context: { job_id: b.job.id },
        }),
        nf('POST', '/automation/evaluate', {
          trigger_event: 'LEAD_CREATED',
          context: { lead_id: b.lead.id },
        }),
        nf('POST', '/automation/evaluate', {
          trigger_event: 'JOB_CREATED',
          context: { entity_type: 'job', entity_id: b.job.id },
        }),
      ],

      // Portal
      'POST /portal/generate/:jobId': [
        nf('POST', `/portal/generate/${b.job.id}`),
      ],
      'DELETE /portal/revoke/:jobId': [
        nf('DELETE', `/portal/revoke/${b.job.id}`),
      ],
      'GET /public/portal/:token/files/:fileId': [
        nf('GET', `/public/portal/${a.portalToken}/files/${b.file.id}`),
      ],
      'GET /public/portal/:token/invoices/:invoiceId/pdf': [
        nf(
          'GET',
          `/public/portal/${a.portalToken}/invoices/${B.finalInvoiceId}/pdf`
        ),
      ],
    };
  }

  it('has a case or a written exemption for every mounted route', () => {
    const mounted = mountedRouteKeys();
    expect(mounted.length).toBeGreaterThan(140);
    const covered = new Set([
      ...Object.keys(cases()),
      ...Object.keys(LIST_URLS),
      ...Object.keys(EXEMPT),
    ]);
    const missing = mounted.filter((key) => !covered.has(key));
    expect(missing).toEqual([]);

    // And nothing listed here is stale.
    const mountedSet = new Set(mounted);
    const stale = [...covered].filter((key) => !mountedSet.has(key));
    expect(stale).toEqual([]);
  });

  it('shows company A the same lists and summaries before and after B has data', () => {
    for (const url of Object.keys(listsBefore)) {
      expect({ url, ...(listsAfter[url] as object) }).toEqual({
        url,
        ...(listsBefore[url] as object),
      });
    }
    // The lists were real reads, not refusals.
    for (const [url, result] of Object.entries(listsBefore)) {
      expect({ url, status: (result as { status: number }).status }).toEqual({
        url,
        status: 200,
      });
    }
  });

  it('finds none of B’s records through A’s search', async () => {
    const res = await api().get(`/search?q=${B_CLIENT}`).set(A.headers);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(B_CLIENT);
  });

  it('refuses every route that names B’s records, and leaves B’s rows untouched', async () => {
    const failures: string[] = [];
    for (const [key, attempts] of Object.entries(cases())) {
      for (const attempt of attempts) {
        const res = await send(A.headers, attempt);
        const problem = judge(attempt, res);
        if (problem) {
          failures.push(
            `${key}: ${attempt.method} ${attempt.url} → ${res.status} (${problem}) ${JSON.stringify(res.body).slice(0, 160)}`
          );
        }
        if (
          res.status < 300 &&
          attempt.expect !== 'ownRowsOnly' &&
          attempt.expect !== 'notFoundOrEmpty'
        ) {
          // Should already be a failure above; say plainly that A got through.
          failures.push(
            `${key}: ${attempt.method} ${attempt.url} succeeded for company A`
          );
        }
      }
    }
    expect(failures).toEqual([]);

    const bRowsAfter = await rowsOf(B.id);
    for (const table of Object.keys(bRowsBefore)) {
      expect({ table, rows: bRowsAfter[table] }).toEqual({
        table,
        rows: bRowsBefore[table],
      });
    }

    // Nothing A did created a row in A that points at B's records.
    const { rows: crossed } = await pool.query(
      `SELECT 'tasks' AS t, id FROM tasks WHERE company_id = $1 AND (job_id = $2 OR lead_id = $3)
       UNION ALL SELECT 'files', id FROM files WHERE company_id = $1 AND job_id = $2
       UNION ALL SELECT 'notes', id FROM notes WHERE company_id = $1 AND entity_type = 'job' AND entity_id = $2
       UNION ALL SELECT 'invoices', id FROM invoices WHERE company_id = $1 AND (job_id = $2 OR estimate_id = $4)
       UNION ALL SELECT 'notifications', id FROM notifications WHERE company_id = $1 AND entity_type = 'job' AND entity_id = $2`,
      [DEFAULT_COMPANY_ID, B.data.job.id, B.data.lead.id, B.data.estimate.id]
    );
    expect(crossed).toEqual([]);
  });
});
