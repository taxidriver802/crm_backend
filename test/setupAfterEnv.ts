export {};

// Rate-limit counters live in memory for the life of the process. Start every
// test from zero so suites that sign in or register often never meet them.
beforeEach(() => {
  const { resetRateLimits } = require('../src/lib/rateLimit');
  resetRateLimits();
});

afterAll(async () => {
  // The per-run uploads directory from test/setupEnv.ts.
  const fs = require('fs');
  const { uploadsRoot } = require('../src/lib/uploadsDir');
  fs.rmSync(uploadsRoot(), { recursive: true, force: true });

  const { pool } = require('../src/db');
  const pgPool = pool as any;

  if (!pgPool) return;

  if (pgPool.ending || pgPool.ended) return;

  try {
    await pgPool.end();
  } catch (err: any) {
    if (
      typeof err?.message === 'string' &&
      err.message.includes('Called end on pool more than once')
    ) {
      return;
    }

    throw err;
  }
});
