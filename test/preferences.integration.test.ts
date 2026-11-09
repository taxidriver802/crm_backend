/// <reference types="jest" />
/**
 * Phase 24: workspace preferences follow the person, not the browser.
 */
import request from 'supertest';
import { app } from '../src/app';
import { pool } from '../src/db';
import { resetDb } from './helpers/db';
import { ensureSchema } from './helpers/setup';
import { createAuthedUser, createTestCompany, createTestUser, authHeaderFor } from './helpers/auth';
import {
  applyPreferencesPatch,
  resolveEffective,
} from '../src/services/preferences.service';

jest.setTimeout(30000);

describe('preferences — pure merge rules', () => {
  it('merges one level, replaces arrays, clears with null', () => {
    const start = {
      appearance: { theme: 'dark' as const, density: 'compact' as const },
      nav: { order: ['jobs' as const, 'leads' as const], collapsed: true },
      lists: { jobs: { columns: ['title', 'status'] } },
    };
    const next = applyPreferencesPatch(start, {
      appearance: { density: 'comfortable' },
      nav: { order: ['leads', 'jobs'] },
      lists: { jobs: null, leads: { columns: ['name'] } },
    });
    expect(next.appearance).toEqual({ theme: 'dark', density: 'comfortable' });
    expect(next.nav).toEqual({ order: ['leads', 'jobs'], collapsed: true });
    expect(next.lists).toEqual({ leads: { columns: ['name'] } });

    const cleared = applyPreferencesPatch(next, { appearance: null });
    expect(cleared.appearance).toBeUndefined();
  });

  it('lets the user override workspace defaults section by section', () => {
    const effective = resolveEffective(
      { appearance: { density: 'compact' }, home: { widgets: [{ id: 'agenda', column: 'main' }] } },
      { appearance: { theme: 'dark' } }
    );
    expect(effective.appearance).toEqual({ density: 'compact', theme: 'dark' });
    expect(effective.home?.widgets?.[0].id).toBe('agenda');
  });
});

describe('preferences — API', () => {
  beforeAll(async () => {
    await ensureSchema();
    await resetDb();
  });

  afterAll(async () => {
    try {
      await pool.end();
    } catch {
      /* already closed */
    }
  });

  it('starts empty, saves, and returns the same document on the next request', async () => {
    const { headers } = await createAuthedUser('agent');

    const empty = await request(app).get('/me/preferences').set(headers);
    expect(empty.status).toBe(200);
    expect(empty.body.preferences).toEqual({});
    expect(empty.body.effective).toEqual({});

    const saved = await request(app)
      .patch('/me/preferences')
      .set(headers)
      .send({
        appearance: { theme: 'dark', density: 'compact', palette: 'azure' },
        nav: {
          order: ['today', 'jobs', 'leads'],
          hidden: ['reports'],
          pins: [{ id: 'job:12', kind: 'job', label: 'Webb re-roof', href: '/jobs/12' }],
        },
        home: {
          widgets: [
            { id: 'agenda', column: 'main' },
            { id: 'money', column: 'side', hidden: true },
          ],
        },
        lists: { jobs: { columns: ['title', 'status', 'owed'], sort: { key: 'owed', dir: 'desc' } } },
        records: { job: { tab: 'money', sections: [{ id: 'next-step' }, { id: 'measurements', hidden: true }] } },
      });
    expect(saved.status).toBe(200);
    expect(saved.body.preferences.appearance.density).toBe('compact');

    const again = await request(app).get('/me/preferences').set(headers);
    expect(again.body.preferences).toEqual(saved.body.preferences);
    expect(again.body.effective.nav.pins[0].href).toBe('/jobs/12');

    // A later patch to one section leaves the others alone.
    const partial = await request(app)
      .patch('/me/preferences')
      .set(headers)
      .send({ appearance: { density: 'comfortable' } });
    expect(partial.body.preferences.appearance).toEqual({
      theme: 'dark',
      density: 'comfortable',
      palette: 'azure',
    });
    expect(partial.body.preferences.nav.hidden).toEqual(['reports']);
  });

  it('keeps the details rail choice on estimate and invoice records, and pins a saved view', async () => {
    const { headers } = await createAuthedUser('agent');
    const saved = await request(app)
      .patch('/me/preferences')
      .set(headers)
      .send({
        records: { estimate: { rail: false }, invoice: { rail: false } },
        nav: { pins: [{ id: 'view:7', kind: 'view', label: 'Billing this week', href: '/jobs?view=7' }] },
      });
    expect(saved.status).toBe(200);
    expect(saved.body.preferences.records.estimate).toEqual({ rail: false });
    expect(saved.body.preferences.records.invoice).toEqual({ rail: false });
    expect(saved.body.effective.nav.pins[0].href).toBe('/jobs?view=7');
  });

  it('rejects unknown sections, unknown ids, and links that leave the app', async () => {
    const { headers } = await createAuthedUser('agent');

    const unknownSection = await request(app)
      .patch('/me/preferences')
      .set(headers)
      .send({ sidebarColor: 'red' });
    expect(unknownSection.status).toBe(400);

    const unknownWidget = await request(app)
      .patch('/me/preferences')
      .set(headers)
      .send({ home: { widgets: [{ id: 'stock-ticker', column: 'main' }] } });
    expect(unknownWidget.status).toBe(400);

    const externalPin = await request(app)
      .patch('/me/preferences')
      .set(headers)
      .send({
        nav: { pins: [{ id: 'x', kind: 'view', label: 'Evil', href: '//evil.example.com' }] },
      });
    expect(externalPin.status).toBe(400);

    const badTheme = await request(app)
      .patch('/me/preferences')
      .set(headers)
      .send({ appearance: { theme: 'neon' } });
    expect(badTheme.status).toBe(400);
  });

  it('caps the size of a preference document', async () => {
    const { headers } = await createAuthedUser('agent');
    const pins = Array.from({ length: 20 }, (_, i) => ({
      id: `job:${i}`,
      kind: 'job',
      label: 'x'.repeat(120),
      href: `/jobs/${i}?${'q'.repeat(280)}`,
    }));
    const lists = Object.fromEntries(
      ['jobs', 'leads', 'tasks', 'invoices'].map((key) => [
        key,
        { columns: Array.from({ length: 24 }, (_, i) => `column_${i}_${'c'.repeat(30)}`) },
      ])
    );
    const res = await request(app)
      .patch('/me/preferences')
      .set(headers)
      .send({ nav: { pins }, lists });
    expect(res.status).toBe(413);
  });

  it('keeps each user’s preferences private to that user', async () => {
    const a = await createAuthedUser('agent');
    const b = await createAuthedUser('agent');
    await request(app)
      .patch('/me/preferences')
      .set(a.headers)
      .send({ appearance: { theme: 'dark' } });
    const other = await request(app).get('/me/preferences').set(b.headers);
    expect(other.body.preferences).toEqual({});
  });

  it('applies workspace defaults until the user chooses, and only admins set them', async () => {
    const company = await createTestCompany({ slug: 'prefs-co' });
    const owner = await createTestUser({ role: 'owner', company_id: company.id });
    const agent = await createTestUser({ role: 'agent', company_id: company.id });
    const ownerHeaders = authHeaderFor(owner);
    const agentHeaders = authHeaderFor(agent);

    const forbidden = await request(app)
      .patch('/company/workspace-defaults')
      .set(agentHeaders)
      .send({ appearance: { density: 'compact' } });
    expect(forbidden.status).toBe(403);

    const set = await request(app)
      .patch('/company/workspace-defaults')
      .set(ownerHeaders)
      .send({
        appearance: { density: 'compact' },
        home: { widgets: [{ id: 'needs-you', column: 'main' }, { id: 'agenda', column: 'side' }] },
      });
    expect(set.status).toBe(200);

    const agentView = await request(app).get('/me/preferences').set(agentHeaders);
    expect(agentView.body.preferences).toEqual({});
    expect(agentView.body.effective.appearance.density).toBe('compact');
    expect(agentView.body.effective.home.widgets[0].id).toBe('needs-you');

    await request(app)
      .patch('/me/preferences')
      .set(agentHeaders)
      .send({ appearance: { density: 'comfortable' } });
    const overridden = await request(app).get('/me/preferences').set(agentHeaders);
    expect(overridden.body.effective.appearance.density).toBe('comfortable');

    // Reset returns the agent to the workspace defaults.
    const reset = await request(app).delete('/me/preferences').set(agentHeaders);
    expect(reset.body.effective.appearance.density).toBe('compact');

    // Another company never sees these defaults.
    const outsider = await createAuthedUser('owner');
    const outsiderView = await request(app)
      .get('/company/workspace-defaults')
      .set(outsider.headers);
    expect(outsiderView.body.defaults).toEqual({});
  });

  it('requires a session', async () => {
    const res = await request(app).get('/me/preferences');
    expect(res.status).toBe(401);
  });
});
