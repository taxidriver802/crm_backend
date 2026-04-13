/// <reference types="jest" />
import request from 'supertest';
import { app } from '../src/app';
import { pool } from '../src/db';
import { ensureSchema } from './helpers/setup';
import { resetDb } from './helpers/db';
import { createAuthedUser } from './helpers/auth';

jest.setTimeout(30000);

describe('Reports integration', () => {
  beforeAll(async () => {
    await ensureSchema();
  });

  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('returns report endpoints for authenticated user', async () => {
    const { headers } = await createAuthedUser('agent');

    const leadRes = await request(app).post('/leads').set(headers).send({
      first_name: 'Riley',
      last_name: 'Jones',
      status: 'New',
    });

    await request(app).post('/jobs').set(headers).send({
      lead_id: leadRes.body.lead.id,
      title: 'Roof update',
      status: 'Contacted',
    });

    const leadFunnel = await request(app)
      .get('/reports/lead-funnel')
      .set(headers);
    const estimateOutcomes = await request(app)
      .get('/reports/estimate-outcomes')
      .set(headers);
    const jobPipeline = await request(app)
      .get('/reports/job-pipeline')
      .set(headers);
    const trends = await request(app)
      .get('/reports/trends')
      .query({ period: 'monthly' })
      .set(headers);

    expect(leadFunnel.status).toBe(200);
    expect(leadFunnel.body.ok).toBe(true);
    expect(Array.isArray(leadFunnel.body.data)).toBe(true);

    expect(estimateOutcomes.status).toBe(200);
    expect(estimateOutcomes.body.ok).toBe(true);
    expect(Array.isArray(estimateOutcomes.body.byStatus)).toBe(true);
    expect(typeof estimateOutcomes.body.approvedRevenue).toBe('number');

    expect(jobPipeline.status).toBe(200);
    expect(jobPipeline.body.ok).toBe(true);
    expect(Array.isArray(jobPipeline.body.data)).toBe(true);

    expect(trends.status).toBe(200);
    expect(trends.body.ok).toBe(true);
    expect(Array.isArray(trends.body.leads)).toBe(true);
    expect(Array.isArray(trends.body.estimates)).toBe(true);
  });
});
