/**
 * Loads demo CRM data from crm_dev_backup.sql into the current UUID-based schema.
 *
 * Usage (from crm_backend):
 *   npm run db:seed-demo
 *   npm run db:seed-demo -- --dry-run
 *   npm run db:seed-demo -- --reset
 *   npm run db:seed-demo -- --include-users
 *   npm run db:seed-demo -- --owner-email you@example.com
 *
 * Flags:
 *   --dry-run         Print what would be inserted without writing to the DB
 *   --reset           Truncate demo tables (leads/jobs/tasks/files/notifications) first
 *   --include-users   Insert demo users from the backup (skips emails that already exist)
 *   --owner-email     Map all backup user_id references to an existing account
 *
 * Notes:
 *   - File rows are metadata only; binary uploads are not included in the repo backup.
 *   - Default behavior keeps your existing login and assigns demo records to the owner.
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { v5: uuidv5 } = require('uuid');
const { parsePgCopyBlocks } = require('./lib/parse-pg-copy');

const DEMO_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const BACKUP_PATH = path.join(__dirname, '..', 'crm_dev_backup.sql');

const DEMO_TABLES = [
  'notifications',
  'files',
  'tasks',
  'jobs',
  'leads',
];

function parseArgs(argv) {
  return {
    dryRun: argv.includes('--dry-run'),
    reset: argv.includes('--reset'),
    includeUsers: argv.includes('--include-users'),
    ownerEmail: getArgValue(argv, '--owner-email'),
  };
}

function getArgValue(argv, flag) {
  const index = argv.indexOf(flag);
  if (index === -1) return null;
  return argv[index + 1] || null;
}

function demoUserUuid(oldUserId) {
  return uuidv5(`crm-demo-user:${oldUserId}`, DEMO_NAMESPACE);
}

function asInt(value) {
  if (value == null || value === '') return null;
  return Number.parseInt(value, 10);
}

async function loadExistingUsers(pool) {
  const { rows } = await pool.query(
    `SELECT id, email, role FROM users ORDER BY created_at ASC`
  );
  const byEmail = new Map(
    rows.map((row) => [row.email.toLowerCase(), row])
  );
  return { rows, byEmail };
}

async function buildUserIdMap(pool, backupUsers, options) {
  const { byEmail } = await loadExistingUsers(pool);
  const map = new Map();

  for (const user of backupUsers) {
    const oldId = asInt(user.id);
    const email = String(user.email).toLowerCase();

    const existing = byEmail.get(email);
    if (existing) {
      map.set(oldId, existing.id);
      continue;
    }

    if (options.includeUsers) {
      map.set(oldId, demoUserUuid(oldId));
    }
  }

  if (options.ownerEmail) {
    const owner = byEmail.get(options.ownerEmail.toLowerCase());
    if (!owner) {
      throw new Error(
        `No existing user found for --owner-email ${options.ownerEmail}`
      );
    }
    for (const user of backupUsers) {
      map.set(asInt(user.id), owner.id);
    }
    return map;
  }

  const fallbackOwner =
    byEmail.get('jacox12@icloud.com') ||
    [...byEmail.values()].find((user) => user.role === 'owner') ||
    byEmail.values().next().value;

  if (fallbackOwner) {
    for (const user of backupUsers) {
      const oldId = asInt(user.id);
      if (!map.has(oldId)) {
        map.set(oldId, fallbackOwner.id);
      }
    }
  }

  return map;
}

async function resetDemoTables(pool, dryRun) {
  const sql = `TRUNCATE TABLE ${DEMO_TABLES.join(', ')} RESTART IDENTITY CASCADE`;
  if (dryRun) {
    console.log(`[dry-run] ${sql}`);
    return;
  }
  await pool.query(sql);
  console.log('Cleared demo tables: leads, jobs, tasks, files, notifications.');
}

async function insertUsers(pool, backupUsers, userIdMap, dryRun) {
  let inserted = 0;

  for (const user of backupUsers) {
    const oldId = asInt(user.id);
    const id = userIdMap.get(oldId);
    if (!id || id !== demoUserUuid(oldId)) continue;

    const sql = `
      INSERT INTO users (
        id, first_name, last_name, email, password_hash, role, status,
        created_at, updated_at, invited_at, password_set_at, last_login_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12
      )
      ON CONFLICT (email) DO NOTHING
    `;
    const params = [
      id,
      user.first_name,
      user.last_name,
      String(user.email).toLowerCase(),
      user.password_hash,
      user.role,
      user.status,
      user.created_at,
      user.updated_at,
      user.invited_at,
      user.password_set_at,
      user.last_login_at,
    ];

    if (dryRun) {
      console.log(`[dry-run] insert user ${user.email} -> ${id}`);
      inserted += 1;
      continue;
    }

    const result = await pool.query(sql, params);
    if (result.rowCount > 0) inserted += 1;
  }

  return inserted;
}

async function insertLeads(pool, rows, userIdMap, dryRun) {
  let inserted = 0;

  for (const row of rows) {
    const userId = userIdMap.get(asInt(row.user_id));
    if (!userId) continue;

    const sql = `
      INSERT INTO leads (
        id, user_id, first_name, last_name, email, phone, source, status,
        budget_min, budget_max, notes, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13
      )
      ON CONFLICT (id) DO NOTHING
    `;
    const params = [
      asInt(row.id),
      userId,
      row.first_name,
      row.last_name,
      row.email,
      row.phone,
      row.source,
      row.status,
      row.budget_min,
      row.budget_max,
      row.notes,
      row.created_at,
      row.updated_at,
    ];

    if (dryRun) {
      console.log(`[dry-run] insert lead #${row.id} ${row.first_name} ${row.last_name}`);
      inserted += 1;
      continue;
    }

    const result = await pool.query(sql, params);
    if (result.rowCount > 0) inserted += 1;
  }

  return inserted;
}

async function insertJobs(pool, rows, userIdMap, dryRun) {
  let inserted = 0;

  for (const row of rows) {
    const userId = userIdMap.get(asInt(row.user_id));
    if (!userId) continue;

    const sql = `
      INSERT INTO jobs (
        id, user_id, title, description, status, address, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8
      )
      ON CONFLICT (id) DO NOTHING
    `;
    const params = [
      asInt(row.id),
      userId,
      row.title,
      row.description,
      row.status,
      row.address,
      row.created_at,
      row.updated_at,
    ];

    if (dryRun) {
      console.log(`[dry-run] insert job #${row.id} ${row.title}`);
      inserted += 1;
      continue;
    }

    const result = await pool.query(sql, params);
    if (result.rowCount > 0) inserted += 1;
  }

  return inserted;
}

async function insertTasks(pool, rows, userIdMap, dryRun) {
  let inserted = 0;

  for (const row of rows) {
    const userId = userIdMap.get(asInt(row.user_id));
    if (!userId) continue;

    const leadId = asInt(row.lead_id);
    const jobId = asInt(row.job_id);
    if ((leadId == null) === (jobId == null)) {
      console.warn(
        `Skipping task #${row.id}: expected exactly one of lead_id or job_id`
      );
      continue;
    }

    const sql = `
      INSERT INTO tasks (
        id, user_id, lead_id, job_id, title, description, due_date, status,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10
      )
      ON CONFLICT (id) DO NOTHING
    `;
    const params = [
      asInt(row.id),
      userId,
      leadId,
      jobId,
      row.title,
      row.description,
      row.due_date,
      row.status,
      row.created_at,
      row.updated_at,
    ];

    if (dryRun) {
      console.log(`[dry-run] insert task #${row.id} ${row.title}`);
      inserted += 1;
      continue;
    }

    const result = await pool.query(sql, params);
    if (result.rowCount > 0) inserted += 1;
  }

  return inserted;
}

async function insertFiles(pool, rows, userIdMap, dryRun) {
  let inserted = 0;

  for (const row of rows) {
    const uploadedBy = userIdMap.get(asInt(row.uploaded_by_user_id));
    if (!uploadedBy) continue;

    const sql = `
      INSERT INTO files (
        id, uploaded_by_user_id, original_name, storage_key, mime_type, size_bytes,
        lead_id, task_id, job_id, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10
      )
      ON CONFLICT (id) DO NOTHING
    `;
    const params = [
      asInt(row.id),
      uploadedBy,
      row.original_name,
      row.storage_key,
      row.mime_type,
      asInt(row.size_bytes),
      asInt(row.lead_id),
      asInt(row.task_id),
      asInt(row.job_id),
      row.created_at,
    ];

    if (dryRun) {
      console.log(`[dry-run] insert file #${row.id} ${row.original_name}`);
      inserted += 1;
      continue;
    }

    const result = await pool.query(sql, params);
    if (result.rowCount > 0) inserted += 1;
  }

  return inserted;
}

async function insertNotifications(pool, rows, userIdMap, dryRun) {
  let inserted = 0;

  for (const row of rows) {
    const userId = userIdMap.get(asInt(row.user_id));
    if (!userId) continue;

    const sql = `
      INSERT INTO notifications (
        id, user_id, type, title, message, entity_type, entity_id,
        metadata, read_at, created_at, dedupe_key
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11
      )
      ON CONFLICT (id) DO NOTHING
    `;
    const params = [
      asInt(row.id),
      userId,
      row.type,
      row.title,
      row.message,
      row.entity_type,
      asInt(row.entity_id),
      row.metadata,
      row.read_at,
      row.created_at,
      row.dedupe_key,
    ];

    if (dryRun) {
      console.log(`[dry-run] insert notification #${row.id} ${row.type}`);
      inserted += 1;
      continue;
    }

    try {
      const result = await pool.query(sql, params);
      if (result.rowCount > 0) inserted += 1;
    } catch (err) {
      if (err.code === '23505' && err.constraint === 'idx_notifications_dedupe_key') {
        console.warn(`Skipping duplicate notification dedupe_key: ${row.dedupe_key}`);
        continue;
      }
      throw err;
    }
  }

  return inserted;
}

async function syncSequences(pool, dryRun) {
  const sql = `
    SELECT setval(pg_get_serial_sequence('leads', 'id'), COALESCE((SELECT MAX(id) FROM leads), 1), true);
    SELECT setval(pg_get_serial_sequence('jobs', 'id'), COALESCE((SELECT MAX(id) FROM jobs), 1), true);
    SELECT setval(pg_get_serial_sequence('tasks', 'id'), COALESCE((SELECT MAX(id) FROM tasks), 1), true);
    SELECT setval(pg_get_serial_sequence('files', 'id'), COALESCE((SELECT MAX(id) FROM files), 1), true);
    SELECT setval(pg_get_serial_sequence('notifications', 'id'), COALESCE((SELECT MAX(id) FROM notifications), 1), true);
  `;

  if (dryRun) {
    console.log('[dry-run] sync serial sequences for demo tables');
    return;
  }

  await pool.query(sql);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Add it to .env before seeding.');
    process.exit(1);
  }

  if (!fs.existsSync(BACKUP_PATH)) {
    console.error(`Backup file not found: ${BACKUP_PATH}`);
    process.exit(1);
  }

  const backupSql = fs.readFileSync(BACKUP_PATH, 'utf8');
  const data = parsePgCopyBlocks(backupSql);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const userIdMap = await buildUserIdMap(pool, data.users || [], options);

    if (userIdMap.size === 0) {
      throw new Error(
        'No user mapping available. Register a user first, or rerun with --include-users.'
      );
    }

    console.log('Demo seed source:', path.basename(BACKUP_PATH));
    console.log('User ID mapping:', Object.fromEntries(userIdMap));

    if (options.reset) {
      await resetDemoTables(pool, options.dryRun);
    }

    const usersInserted = options.includeUsers
      ? await insertUsers(pool, data.users || [], userIdMap, options.dryRun)
      : 0;

    const leadsInserted = await insertLeads(
      pool,
      data.leads || [],
      userIdMap,
      options.dryRun
    );
    const jobsInserted = await insertJobs(
      pool,
      data.jobs || [],
      userIdMap,
      options.dryRun
    );
    const tasksInserted = await insertTasks(
      pool,
      data.tasks || [],
      userIdMap,
      options.dryRun
    );
    const filesInserted = await insertFiles(
      pool,
      data.files || [],
      userIdMap,
      options.dryRun
    );
    const notificationsInserted = await insertNotifications(
      pool,
      data.notifications || [],
      userIdMap,
      options.dryRun
    );

    await syncSequences(pool, options.dryRun);

    console.log('');
    console.log(options.dryRun ? 'Dry run complete.' : 'Demo seed complete.');
    console.log(
      JSON.stringify(
        {
          users: usersInserted,
          leads: leadsInserted,
          jobs: jobsInserted,
          tasks: tasksInserted,
          files: filesInserted,
          notifications: notificationsInserted,
        },
        null,
        2
      )
    );

    if (!options.dryRun) {
      console.log('');
      console.log(
        'Note: file records were seeded, but upload binaries are not in the repo backup.'
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Demo seed failed:', err.message);
  process.exit(1);
});
