/// <reference types="jest" />
import request from 'supertest';
import { app } from '../src/app';
import { ensureSchema } from './helpers/setup';
import { resetDb } from './helpers/db';
import { createAuthedUser } from './helpers/auth';

describe('Saved views integration', () => {
  beforeAll(async () => {
    await ensureSchema();
  });

  beforeEach(async () => {
    await resetDb();
  });

  it('creates, lists, updates, and deletes saved views', async () => {
    const { headers } = await createAuthedUser('agent');

    const createRes = await request(app)
      .post('/saved-views')
      .set(headers)
      .send({
        entity_type: 'leads',
        name: 'My New Leads',
        filters: { status: 'New', assignedFilter: 'unassigned' },
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.ok).toBe(true);
    expect(createRes.body.view.entity_type).toBe('leads');

    const listRes = await request(app)
      .get('/saved-views')
      .query({ entityType: 'leads' })
      .set(headers);

    expect(listRes.status).toBe(200);
    expect(listRes.body.ok).toBe(true);
    expect(listRes.body.views).toHaveLength(1);
    expect(listRes.body.views[0].name).toBe('My New Leads');

    const patchRes = await request(app)
      .patch(`/saved-views/${createRes.body.view.id}`)
      .set(headers)
      .send({ name: 'Updated Leads View' });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.view.name).toBe('Updated Leads View');

    const deleteRes = await request(app)
      .delete(`/saved-views/${createRes.body.view.id}`)
      .set(headers);

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.ok).toBe(true);
  });
});
