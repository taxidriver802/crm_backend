/**
 * Prints a one-hour link that sets a new password for one person: the
 * operator's way back in for an owner when nobody else in their company can
 * send one and this host can't send email.
 *
 * Usage (from crm_backend, on the host, with its .env):
 *   npm run user:reset-link -- --company <slug> --email <email>
 *
 * The link is made exactly as the app makes one (a 32-byte token, only its
 * SHA-256 stored, one hour, works once; src/lib/passwordResets.ts) and any
 * open link for that person stops working. Nothing is emailed: give it to
 * the person yourself, over a channel you trust. Setting the new password
 * signs them out everywhere. The person's account history records it, as
 * done by the operator.
 *
 * The base address is APP_BASE_URL (else FRONTEND_URL, else
 * http://localhost:3000).
 */
require('dotenv').config();

const crypto = require('crypto');
const { Pool } = require('pg');

const RESET_LIFETIME_MINUTES = 60;

function parseArgs(argv) {
  const options = { company: '', email: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--company')
      options.company = String(argv[++i] || '')
        .trim()
        .toLowerCase();
    else if (arg === '--email')
      options.email = String(argv[++i] || '')
        .trim()
        .toLowerCase();
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function baseUrl() {
  const configured =
    (process.env.APP_BASE_URL || '').trim() ||
    (process.env.FRONTEND_URL || '').trim() ||
    'http://localhost:3000';
  return configured.replace(/\/+$/, '');
}

/** Makes the link. Exported for the tests. */
async function issueResetLink(pool, { company, email, base = baseUrl() }) {
  if (!company || !email)
    throw new Error(
      'Name the person with --company <slug> and --email <email>.'
    );

  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.status, u.company_id, c.name AS company_name
     FROM users u JOIN companies c ON c.id = u.company_id
     WHERE c.slug = $1 AND LOWER(u.email) = LOWER($2)`,
    [company, email]
  );
  const user = rows[0];
  if (!user)
    throw new Error(
      `No one with the email ${email} in the company "${company}".`
    );
  if (user.status !== 'active') {
    throw new Error(
      `${email} is ${user.status}, not active. ` +
        (user.status === 'invited'
          ? 'Resend their invite from the Users page instead.'
          : 'An owner turns the account back on first.')
    );
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE password_resets SET superseded_at = now()
       WHERE user_id = $1 AND used_at IS NULL AND superseded_at IS NULL`,
      [user.id]
    );
    const token = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const inserted = await client.query(
      `INSERT INTO password_resets (user_id, company_id, token_hash, via, requested_by, expires_at)
       VALUES ($1, $2, $3, 'operator', NULL, now() + make_interval(mins => $4))
       RETURNING expires_at`,
      [user.id, user.company_id, hash, RESET_LIFETIME_MINUTES]
    );
    await client.query(
      `INSERT INTO account_events (company_id, user_id, actor_id, event, detail)
       VALUES ($1, $2, NULL, 'reset_link_issued', '{"by":"operator","emailed":false}')`,
      [user.company_id, user.id]
    );
    await client.query('COMMIT');
    return {
      url: `${base}/reset-password?token=${token}`,
      expiresAt: inserted.rows[0].expires_at,
      user,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('npm run user:reset-link -- --company <slug> --email <email>');
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { url, expiresAt, user } = await issueResetLink(pool, options);
    const name =
      [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email;
    console.log(
      `Reset link for ${name} (${user.email}, ${user.role}) at ${user.company_name}:`
    );
    console.log('');
    console.log(`  ${url}`);
    console.log('');
    console.log(`It works once, until ${new Date(expiresAt).toISOString()}.`);
    console.log(
      'Give it to them yourself. Setting the new password signs them out everywhere.'
    );
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[reset-link] ${error.message}`);
    process.exit(1);
  });
}

module.exports = { issueResetLink, parseArgs };
