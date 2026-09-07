/// <reference types="jest" />
import request from 'supertest';
import { app } from '../src/app';
import { ensureSchema } from './helpers/setup';
import { resetDb } from './helpers/db';
import { createAuthedUser } from './helpers/auth';

const SEEDED_NAMES = [
  'Inspection',
  'Repair',
  'Replacement',
  'Gutters',
  'Maintenance',
];

describe('Estimate templates integration', () => {
  beforeAll(async () => {
    await ensureSchema();
  });

  beforeEach(async () => {
    await resetDb();
  });

  async function createLead(headers: Record<string, string>) {
    const res = await request(app).post('/leads').set(headers).send({
      first_name: 'Sarah',
      last_name: 'Johnson',
      source: 'Referral',
      status: 'New',
    });
    expect(res.status).toBe(201);
    return res.body.lead;
  }

  async function createJob(headers: Record<string, string>, leadId: number) {
    const res = await request(app).post('/jobs').set(headers).send({
      lead_id: leadId,
      title: 'Roof inspection for Sarah',
      address: '123 Main St',
      status: 'New',
    });
    expect(res.status).toBe(201);
    return res.body.job;
  }

  async function createDraftEstimate(
    headers: Record<string, string>,
    jobId: number
  ) {
    const res = await request(app).post('/estimates').set(headers).send({
      job_id: jobId,
      title: 'Draft quote',
    });
    expect(res.status).toBe(201);
    return res.body.estimate;
  }

  async function getTemplateByName(
    headers: Record<string, string>,
    name: string
  ) {
    const res = await request(app).get('/estimate-templates').set(headers);
    expect(res.status).toBe(200);
    const template = (res.body.templates || []).find(
      (row: { name: string }) =>
        String(row.name).toLowerCase() === name.toLowerCase()
    );
    expect(template).toBeTruthy();
    return template;
  }

  it('seeds five roofing templates after schema reset', async () => {
    const { headers } = await createAuthedUser('agent');
    const res = await request(app).get('/estimate-templates').set(headers);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const names = (res.body.templates || []).map((t: { name: string }) => t.name);
    for (const name of SEEDED_NAMES) {
      expect(names).toContain(name);
    }

    const replacement = res.body.templates.find(
      (t: { name: string }) => t.name === 'Replacement'
    );
    expect(replacement.line_items.length).toBeGreaterThan(0);
    expect(replacement.line_items.map((l: { name: string }) => l.name)).toEqual(
      expect.arrayContaining(['Tear-off', 'Architectural shingles', 'Labor'])
    );
  });

  it('lets an agent apply a seeded template and copies names, qty, prices, and grand_total', async () => {
    const { headers } = await createAuthedUser('agent');
    const lead = await createLead(headers);
    const job = await createJob(headers, lead.id);
    const estimate = await createDraftEstimate(headers, job.id);
    const replacement = await getTemplateByName(headers, 'Replacement');

    const res = await request(app)
      .post(`/estimates/${estimate.id}/apply-template`)
      .set(headers)
      .send({ template_id: replacement.id });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.estimate.line_items).toHaveLength(
      replacement.line_items.length
    );
    expect(res.body.estimate.line_items.map((l: { name: string }) => l.name)).toEqual(
      replacement.line_items.map((l: { name: string }) => l.name)
    );

    const first = res.body.estimate.line_items[0];
    const expectedFirst = replacement.line_items[0];
    expect(first.quantity).toBe(Number(expectedFirst.quantity));
    expect(first.unit_price).toBe(Number(expectedFirst.unit_price));
    expect(first.source).toBe('manual');
    expect(Number(res.body.estimate.grand_total)).toBe(9230);

    const activityRes = await request(app)
      .get(`/jobs/${job.id}/activity`)
      .set(headers);
    const updated = (activityRes.body.activity || []).find(
      (row: { type: string; metadata?: { templateId?: number } }) =>
        row.type === 'ESTIMATE_UPDATED' &&
        row.metadata?.templateId === replacement.id
    );
    expect(updated).toBeTruthy();
  });

  it('appends when the same template is applied twice', async () => {
    const { headers } = await createAuthedUser('agent');
    const lead = await createLead(headers);
    const job = await createJob(headers, lead.id);
    const estimate = await createDraftEstimate(headers, job.id);
    const inspection = await getTemplateByName(headers, 'Inspection');

    const first = await request(app)
      .post(`/estimates/${estimate.id}/apply-template`)
      .set(headers)
      .send({ template_id: inspection.id });
    expect(first.status).toBe(200);
    expect(first.body.estimate.line_items).toHaveLength(2);
    expect(Number(first.body.estimate.grand_total)).toBe(325);

    const second = await request(app)
      .post(`/estimates/${estimate.id}/apply-template`)
      .set(headers)
      .send({ template_id: inspection.id });
    expect(second.status).toBe(200);
    expect(second.body.estimate.line_items).toHaveLength(4);
    expect(Number(second.body.estimate.grand_total)).toBe(650);
  });

  it('returns 400 when applying a template to a Sent estimate', async () => {
    const { headers } = await createAuthedUser('agent');
    const lead = await createLead(headers);
    const job = await createJob(headers, lead.id);
    const estimate = await createDraftEstimate(headers, job.id);
    const inspection = await getTemplateByName(headers, 'Inspection');

    const sent = await request(app)
      .patch(`/estimates/${estimate.id}`)
      .set(headers)
      .send({ status: 'Sent' });
    expect(sent.status).toBe(200);

    const res = await request(app)
      .post(`/estimates/${estimate.id}/apply-template`)
      .set(headers)
      .send({ template_id: inspection.id });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('forbids an agent from creating templates', async () => {
    const { headers } = await createAuthedUser('agent');
    const res = await request(app).post('/estimate-templates').set(headers).send({
      name: 'Agent template',
      description: 'Should be rejected',
    });

    expect(res.status).toBe(403);
    expect(res.body.ok).toBe(false);
  });

  it('lets owner create, update, and delete templates and line items', async () => {
    const { headers } = await createAuthedUser('owner');

    const created = await request(app)
      .post('/estimate-templates')
      .set(headers)
      .send({
        name: 'Custom flashings',
        description: 'One-off flashing kit',
      });
    expect(created.status).toBe(201);
    const templateId = created.body.template.id;

    const withLine = await request(app)
      .post(`/estimate-templates/${templateId}/line-items`)
      .set(headers)
      .send({
        name: 'Step flashing',
        quantity: 12,
        unit_price: 8.5,
      });
    expect(withLine.status).toBe(201);
    expect(withLine.body.template.line_items).toHaveLength(1);
    expect(withLine.body.template.line_items[0].unit_price).toBe(8.5);

    const renamed = await request(app)
      .patch(`/estimate-templates/${templateId}`)
      .set(headers)
      .send({ name: 'Custom flashings v2' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.template.name).toBe('Custom flashings v2');

    const deleted = await request(app)
      .delete(`/estimate-templates/${templateId}`)
      .set(headers);
    expect(deleted.status).toBe(200);
  });
});
