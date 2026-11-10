import http from 'http';
import type { AddressInfo } from 'net';
import request from 'supertest';
import { app } from '../../src/app';
import { pool } from '../../src/db';

/**
 * One server for a whole test file, bound to 127.0.0.1 itself. supertest's
 * request(app) opens a new ephemeral listener per request; across a few
 * hundred requests one can land on a port another local process holds on
 * the loopback address, and that process answers instead.
 */
export async function startTestServer() {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    api: () => request(server),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/**
 * Waits until at least `count` sessions of this database are blocked on a
 * lock: the requests a test fired have reached the row another transaction
 * holds.
 */
export async function waitForLockWaiters(count: number, timeoutMs = 5000) {
  const started = Date.now();
  for (;;) {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM pg_stat_activity
       WHERE datname = current_database() AND wait_event_type = 'Lock'`
    );
    if (rows[0].n >= count) return;
    if (Date.now() - started > timeoutMs) {
      throw new Error(
        `Expected ${count} request(s) waiting on a row lock; saw ${rows[0].n}.`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
