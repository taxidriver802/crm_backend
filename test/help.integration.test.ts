/// <reference types="jest" />
/**
 * Help: the user guide is the only copy of the help words, and each role
 * gets only the articles it can act on.
 */
import request from 'supertest';
import { app } from '../src/app';
import { pool } from '../src/db';
import { resetDb } from './helpers/db';
import { ensureSchema } from './helpers/setup';
import { createAuthedUser } from './helpers/auth';
import { blocksText, loadGuide, parseGuide } from '../src/lib/helpGuide';

jest.setTimeout(30000);

/** Markdown → words, independently of the parser. */
function plain(markdown: string): string {
  return markdown
    .split('\n')
    .filter((line) => !/^<!--.*-->$/.test(line.trim()))
    .map((line) =>
      /^#{1,6}\s/.test(line) ? line.replace(/^#{1,6}\s+/, '') : line.replace(/^\s*([-*]|\d+\.)\s+/, '')
    )
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('help — the guide in docs/guide/using-the-crm.md', () => {
  const guide = loadGuide();

  it('has no section without an article and no marker that disagrees with its section', () => {
    expect(guide.errors).toEqual([]);
  });

  it('has Start here, the overview, and task articles for every role', () => {
    const ids = guide.articles.map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(['what-this-service-is', 'start-here', 'record-a-payment']));
    expect(guide.articles.find((a) => a.id === 'start-here')?.kind).toBe('start');
    expect(guide.articles.filter((a) => a.kind === 'task').length).toBeGreaterThan(20);
  });

  it('serves every word of each section, and nothing else', () => {
    for (const article of guide.articles) {
      expect(blocksText(article.blocks).replace(/\s+/g, ' ')).toBe(plain(guide.sources[article.id]));
    }
  });

  it('keeps the closing skip list out of the panel', () => {
    expect(guide.articles.some((a) => /not in this guide/i.test(a.title))).toBe(false);
  });
});

describe('help — the rules', () => {
  const marker = (fields: string) => `<!-- help: ${fields} -->`;

  it('reports a section that has no article', () => {
    const { errors } = parseGuide(['## How to do a task', marker('none'), '', '### Do a thing', '', 'Words.'].join('\n'));
    expect(errors.join('\n')).toMatch(/"Do a thing".*no article/);
  });

  it('reports a Who line that disagrees with the marker', () => {
    const { errors } = parseGuide(
      [
        '### Do a thing',
        marker('id=do-a-thing; roles=owner,admin'),
        '',
        '**Who can do this:** Owner, admin, agent.',
        '',
        '**Where:** here.',
        '',
        '**When it worked:** done.',
      ].join('\n')
    );
    expect(errors.join('\n')).toMatch(/names admin,agent,owner but the marker says admin,owner/);
  });

  it('reports an id that is not the heading anchor', () => {
    const { errors } = parseGuide(['## Start here', marker('id=begin; roles=owner; kind=start'), '', 'Hi.'].join('\n'));
    expect(errors.join('\n')).toMatch(/id "begin" is not the heading's anchor "start-here"/);
  });
});

describe('help — API', () => {
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

  it('needs a session', async () => {
    expect((await request(app).get('/help')).status).toBe(401);
    expect((await request(app).get('/help/start-here')).status).toBe(401);
  });

  it('gives an owner every article, with its words', async () => {
    const { headers } = await createAuthedUser('owner');
    const list = await request(app).get('/help').set(headers);
    expect(list.status).toBe(200);
    const ids = list.body.articles.map((a: { id: string }) => a.id);
    expect(ids).toContain('start-here');
    expect(ids).toContain('invite-a-teammate');
    expect(list.body.articles[0].blocks).toBeUndefined();

    const one = await request(app).get('/help/record-a-payment').set(headers);
    expect(one.status).toBe(200);
    expect(one.body.article.title).toBe('Record a payment');
    expect(one.body.article.screen).toEqual({ href: '/invoices', label: 'Invoices' });
    expect(one.body.article.blocks.length).toBeGreaterThan(2);
  });

  it('does not give an agent an article for something their role cannot do', async () => {
    const { headers } = await createAuthedUser('agent');
    const list = await request(app).get('/help').set(headers);
    const ids = list.body.articles.map((a: { id: string }) => a.id);
    expect(ids).toContain('record-a-payment');
    expect(ids).not.toContain('invite-a-teammate');
    expect(ids).not.toContain('start-here');

    const refused = await request(app).get('/help/invite-a-teammate').set(headers);
    expect(refused.status).toBe(404);
    expect((await request(app).get('/help/no-such-article').set(headers)).status).toBe(404);
  });
});
