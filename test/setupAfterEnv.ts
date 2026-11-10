export {};

// Rate-limit counters live in memory for the life of the process. Start every
// test from zero so suites that sign in or register often never meet them.
beforeEach(() => {
  const { resetRateLimits } = require('../src/lib/rateLimit');
  resetRateLimits();
});

afterAll(async () => {
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
