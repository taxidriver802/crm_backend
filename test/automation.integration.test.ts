import request from 'supertest';
import { app } from '../src/app';
import { pool } from '../src/db';
import { resetDb } from './helpers/db';
import { ensureSchema } from './helpers/setup';

jest.setTimeout(30000);

let cookie: string;
let jobId: number;

async function register() {
  const res = await request(app)
    .post('/auth/register')
    .send({
      first_name: 'Auto',
      last_name: 'Tester',
      email: `auto-${Date.now()}@test.com`,
      password: 'Testpass1!',
    });
  return res.headers['set-cookie']?.[0] ?? '';
}

async function createJob() {
  const lead = await request(app)
    .post('/leads')
    .set('Cookie', cookie)
    .send({ first_name: 'Jane', last_name: 'Doe' });
  const leadId = lead.body.lead.id;
  const job = await request(app)
    .post('/jobs')
    .set('Cookie', cookie)
    .send({ title: 'Automation Job', lead_id: leadId });
  return job.body.job.id;
}

beforeAll(async () => {
  await ensureSchema();
  await resetDb();
  cookie = await register();
  jobId = await createJob();
});

afterAll(async () => {
  try {
    await pool.end();
  } catch {
    /* already closed */
  }
});

describe('Automation API', () => {
  let ruleId: number;

  it('GET /automation/templates returns templates', async () => {
    const res = await request(app)
      .get('/automation/templates')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.templates.length).toBeGreaterThan(0);
    expect(res.body.templates[0].template_id).toBeTruthy();
  });

  it('POST /automation/rules/from-template creates rule from template', async () => {
    const res = await request(app)
      .post('/automation/rules/from-template/estimate_approved_tasks')
      .set('Cookie', cookie);

    expect(res.status).toBe(201);
    expect(res.body.rule.trigger_event).toBe('ESTIMATE_APPROVED');
    expect(res.body.rule.action_type).toBe('CREATE_TASKS');
    expect(res.body.rule.enabled).toBe(true);
    ruleId = res.body.rule.id;
  });

  it('GET /automation/rules lists rules', async () => {
    const res = await request(app)
      .get('/automation/rules')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.rules.length).toBeGreaterThanOrEqual(1);
  });

  it('PATCH /automation/rules/:id toggles enabled', async () => {
    const res = await request(app)
      .patch(`/automation/rules/${ruleId}`)
      .set('Cookie', cookie)
      .send({ enabled: false });

    expect(res.status).toBe(200);
    expect(res.body.rule.enabled).toBe(false);
  });

  it('POST /automation/rules creates a custom rule', async () => {
    const res = await request(app)
      .post('/automation/rules')
      .set('Cookie', cookie)
      .send({
        name: 'Notify on job close',
        trigger_event: 'JOB_STATUS_CHANGED',
        conditions: { to_status: 'Closed Won' },
        action_type: 'SEND_NOTIFICATION',
        action_config: { title: 'Job done', message: 'Great work' },
      });

    expect(res.status).toBe(201);
    expect(res.body.rule.name).toBe('Notify on job close');
  });

  it('POST /automation/evaluate executes matching rules', async () => {
    const res = await request(app)
      .post('/automation/evaluate')
      .set('Cookie', cookie)
      .send({
        trigger_event: 'JOB_STATUS_CHANGED',
        context: {
          job_id: jobId,
          job_title: 'Automation Job',
          to_status: 'Closed Won',
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.executed_rules.length).toBeGreaterThanOrEqual(1);
  });

  it('DELETE /automation/rules/:id deletes a rule', async () => {
    const res = await request(app)
      .delete(`/automation/rules/${ruleId}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.deletedId).toBe(ruleId);
  });
});
