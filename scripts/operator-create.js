/**
 * Creates the operator account, or sets a new password on it
 * (PLAN_operator.md §5). There is no sign-up route for operators: this, run
 * on the host, is the only way one comes to exist.
 *
 * Usage (from crm_backend, with its .env):
 *   npm run operator:create -- you@example.com
 *   npm run operator:create -- you@example.com --reset
 *
 * The password is asked for twice and never echoed. Piped input works too
 * (one line), for scripted setups. Setting a new password with --reset
 * signs the operator out everywhere.
 */
require('dotenv').config();

const bcrypt = require('bcryptjs');
const readline = require('readline');
const { Pool } = require('pg');

const MIN_PASSWORD = 12;

function parseArgs(argv) {
  const options = { email: '', reset: false, help: false };
  for (const arg of argv) {
    if (arg === '--reset') options.reset = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('--')) throw new Error(`Unknown argument: ${arg}`);
    else if (!options.email) options.email = arg.trim().toLowerCase();
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  return options;
}

function checkPassword(password) {
  if (!password || password.length < MIN_PASSWORD)
    throw new Error(`The password must be at least ${MIN_PASSWORD} characters.`);
  if (password.length > 200) throw new Error('The password is too long.');
}

/** Creates or resets the operator. Exported for the tests. */
async function upsertOperator(pool, { email, password, reset = false }) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || ''))
    throw new Error('Give the operator email as the first argument.');
  checkPassword(password);
  const hash = await bcrypt.hash(password, 12);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      `SELECT id FROM operators WHERE lower(email) = $1 FOR UPDATE`,
      [email]
    );
    let id;
    let created = false;
    if (existing.rowCount) {
      if (!reset)
        throw new Error(
          `${email} is already an operator. Pass --reset to set a new password.`
        );
      id = existing.rows[0].id;
      await client.query(
        `UPDATE operators SET password_hash = $2, updated_at = now() WHERE id = $1`,
        [id, hash]
      );
      await client.query(
        `UPDATE operator_sessions SET ended_at = now(), ended_reason = 'password_changed'
         WHERE operator_id = $1 AND ended_at IS NULL`,
        [id]
      );
    } else {
      const inserted = await client.query(
        `INSERT INTO operators (email, password_hash) VALUES ($1, $2) RETURNING id`,
        [email, hash]
      );
      id = inserted.rows[0].id;
      created = true;
    }
    await client.query('COMMIT');
    return { id, created };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Reads one line without echoing it when stdin is a terminal. */
function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: process.stdin.isTTY,
    });
    if (process.stdin.isTTY) {
      rl._writeToOutput = (text) => {
        if (text.includes(question)) rl.output.write(text);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (process.stdin.isTTY) process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !options.email) {
    console.log('npm run operator:create -- <email> [--reset]');
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');

  const password = await askHidden('Password: ');
  checkPassword(password);
  if (process.stdin.isTTY) {
    const again = await askHidden('Again: ');
    if (again !== password) throw new Error('The two passwords differ.');
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { created } = await upsertOperator(pool, { ...options, password });
    console.log(
      created
        ? `Operator ${options.email} created.`
        : `New password set for ${options.email}; its sessions have ended.`
    );
    if (!(process.env.OPERATOR_JWT_SECRET || '').trim()) {
      console.log(
        'Note: OPERATOR_JWT_SECRET is not set, so the operator surface is off on this host.'
      );
    }
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[operator:create] ${error.message}`);
    process.exit(1);
  });
}

module.exports = { upsertOperator, parseArgs };
