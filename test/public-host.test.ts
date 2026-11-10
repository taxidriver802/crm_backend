/// <reference types="jest" />
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { app } from '../src/app';
import { pool } from '../src/db';
import { ensureSchema } from './helpers/setup';
import { resetDb } from './helpers/db';
import {
  assertProductionConfig,
  productionConfigProblems,
  trustProxySetting,
} from '../src/config/production';
import { authCookieOptions } from '../src/lib/authCookies';
import { getAppBaseUrl } from '../src/utils/appBase';
import * as qbService from '../src/services/quickbooks.service';

jest.setTimeout(30000);

const GOOD_PRODUCTION_ENV = {
  NODE_ENV: 'production',
  APP_BASE_URL: 'https://joist.example.com',
  FRONTEND_URL: 'https://joist.example.com',
  JWT_SECRET: 'a'.repeat(64),
  DATABASE_URL: 'postgres://joist@localhost/joist',
  TRUST_PROXY: 'loopback',
};

/** Run `fn` with some process.env values replaced, then put them back. */
function withEnv<T>(values: Record<string, string | undefined>, fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(values)) {
    saved[key] = process.env[key];
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

describe('Production boot check', () => {
  it('accepts a complete https configuration', () => {
    expect(productionConfigProblems(GOOD_PRODUCTION_ENV)).toEqual([]);
    expect(() => assertProductionConfig(GOOD_PRODUCTION_ENV)).not.toThrow();
  });

  it('does nothing outside production', () => {
    expect(() => assertProductionConfig({ NODE_ENV: 'development' })).not.toThrow();
    expect(() => assertProductionConfig({ NODE_ENV: 'test' })).not.toThrow();
  });

  it('names every unsafe setting at once', () => {
    const problems = productionConfigProblems({
      NODE_ENV: 'production',
      FRONTEND_URL: 'http://joist.example.com',
      JWT_SECRET: 'short',
      QB_CLIENT_ID: 'x',
      ABC_CLIENT_ID: 'y',
      AUTH_COOKIE_CROSS_SITE: 'true',
      TRUST_PROXY: 'true',
    });
    const text = problems.join('\n');
    expect(problems).toHaveLength(7);
    expect(text).toContain('APP_BASE_URL');
    expect(text).toContain('FRONTEND_URL');
    expect(text).toContain('JWT_SECRET');
    expect(text).toContain('QB_CLIENT_ID');
    expect(text).toContain('ABC_CLIENT_ID');
    expect(text).toContain('AUTH_COOKIE_CROSS_SITE');
    expect(text).toContain('TRUST_PROXY');
    expect(() =>
      assertProductionConfig({ ...GOOD_PRODUCTION_ENV, JWT_SECRET: 'short' })
    ).toThrow(/Refusing to start in production[\s\S]*JWT_SECRET/);
  });

  it('ignores integration variables that are present but empty', () => {
    expect(
      productionConfigProblems({ ...GOOD_PRODUCTION_ENV, QB_CLIENT_ID: '', ABC_API_BASE_URL: ' ' })
    ).toEqual([]);
  });

  it('reads TRUST_PROXY the way Express expects, loopback by default', () => {
    expect(trustProxySetting({})).toBe('loopback');
    expect(trustProxySetting({ TRUST_PROXY: 'false' })).toBe(false);
    expect(trustProxySetting({ TRUST_PROXY: '2' })).toBe(2);
    expect(trustProxySetting({ TRUST_PROXY: '10.0.0.0/8' })).toBe('10.0.0.0/8');
  });
});

describe('Production defaults in the running code', () => {
  it('marks the session cookie Secure in production only', () => {
    withEnv({ NODE_ENV: 'production', AUTH_COOKIE_CROSS_SITE: undefined }, () => {
      expect(authCookieOptions()).toMatchObject({
        secure: true,
        sameSite: 'lax',
        httpOnly: true,
      });
    });
    withEnv({ NODE_ENV: 'development', AUTH_COOKIE_CROSS_SITE: undefined }, () => {
      expect(authCookieOptions().secure).toBe(false);
    });
  });

  it('builds invite links from APP_BASE_URL in production, whatever the request says', () => {
    const forged = {
      headers: {
        'x-app-base-url': 'https://evil.example',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'evil.example',
        origin: 'https://evil.example',
      },
    };
    withEnv({ NODE_ENV: 'production', APP_BASE_URL: 'https://joist.example.com/' }, () => {
      expect(getAppBaseUrl(forged)).toBe('https://joist.example.com');
    });
    withEnv({ NODE_ENV: 'development', APP_BASE_URL: 'https://joist.example.com' }, () => {
      expect(getAppBaseUrl({ headers: { 'x-app-base-url': 'http://192.168.0.6:3000' } })).toBe(
        'http://192.168.0.6:3000'
      );
    });
  });

  it('has no built-in QuickBooks encryption key', () => {
    withEnv(
      {
        QB_CLIENT_ID: 'client',
        QB_REDIRECT_URI: 'https://joist.example.com/integrations/quickbooks',
        ENCRYPTION_KEY: undefined,
      },
      () => {
        expect(() => qbService.buildAuthUrl('user-1')).toThrow(qbService.QuickBooksConfigError);
        expect(() => qbService.buildAuthUrl('user-1')).toThrow(/ENCRYPTION_KEY/);
      }
    );
  });

  it('no longer allows the old tunnel origin through CORS', async () => {
    const res = await request(app)
      .get('/help')
      .set('Origin', 'https://unusuriously-interlocutory-dann.ngrok-free.dev');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('Health', () => {
  beforeAll(async () => {
    await ensureSchema();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reports the database', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, service: 'crm-backend', database: 'ok' });
  });

  it('answers 503 when the database cannot be reached', async () => {
    jest.spyOn(pool, 'query').mockRejectedValueOnce(new Error('connection refused') as never);
    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ ok: false, database: 'unreachable' });
  });
});

describe('Company logos', () => {
  const uploads = path.join(process.cwd(), 'uploads');

  beforeAll(async () => {
    await ensureSchema();
  });

  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
  });

  async function ownerCookie() {
    const register = await request(app).post('/auth/register').send({
      first_name: 'Lia',
      last_name: 'Owner',
      email: 'logo-rules@example.com',
      password: 'Testpass1!',
      company_name: 'Logo Rules Co',
      slug: 'logo-rules',
    });
    expect(register.status).toBe(201);
    return register.headers['set-cookie']?.[0] ?? '';
  }

  function tempFile(name: string, contents: Buffer | string) {
    const file = path.join(uploads, name);
    fs.mkdirSync(uploads, { recursive: true });
    fs.writeFileSync(file, contents);
    return file;
  }

  it('refuses an SVG logo and says which images are accepted', async () => {
    const cookie = await ownerCookie();
    const svg = tempFile(
      'logo-test.svg',
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    );
    const res = await request(app)
      .post('/company/logo')
      .set('Cookie', cookie)
      .attach('file', svg, { filename: 'mark.svg', contentType: 'image/svg+xml' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/PNG, JPEG or WebP/);
  });

  it('judges the file by its bytes, not the type the browser declared', async () => {
    const cookie = await ownerCookie();
    const fake = tempFile('logo-test-fake.png', '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const refused = await request(app)
      .post('/company/logo')
      .set('Cookie', cookie)
      .attach('file', fake, { filename: 'mark.png', contentType: 'image/png' });
    expect(refused.status).toBe(400);

    const webp = tempFile(
      'logo-test.webp',
      Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 ')])
    );
    const accepted = await request(app)
      .post('/company/logo')
      .set('Cookie', cookie)
      .attach('file', webp, { filename: 'mark.webp', contentType: 'image/webp' });
    expect(accepted.status).toBe(201);

    const served = await request(app).get('/public/companies/logo-rules/logo');
    expect(served.status).toBe(200);
    expect(served.headers['content-security-policy']).toContain('sandbox');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
  });
});
