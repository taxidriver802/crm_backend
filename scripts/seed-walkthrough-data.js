/**
 * Seeds realistic Rooftop Realty walkthrough data for demos.
 *
 * Attaches records to an existing owner account (does not wipe users).
 * Optionally creates demo agent logins with --include-team.
 *
 * Usage (from crm_backend):
 *   npm run db:seed-walkthrough
 *   npm run db:seed-walkthrough -- --dry-run
 *   npm run db:seed-walkthrough -- --reset
 *   npm run db:seed-walkthrough -- --owner-email you@example.com
 *   npm run db:seed-walkthrough -- --include-team
 *   npm run db:seed-walkthrough -- --confirm --reset   # required for non-local DB hosts
 *
 * Flags:
 *   --dry-run         Print planned writes without committing
 *   --reset           Truncate CRM business tables first (keeps users)
 *   --force           Allow appending even if walkthrough leads already exist
 *   --confirm         Required when DATABASE_URL host is not localhost/127.0.0.1
 *   --owner-email     Target a specific active owner (default: oldest active owner)
 *   --include-team    Create/reuse demo agents and assign some work to them
 *
 * Suggested demo path:
 *   Dashboard → Leads (Nelson/Patel) → Jobs → Estimates → Invoices →
 *   Tasks/Appointments → Notifications → Team view (if --include-team)
 */
require('dotenv').config();

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const WALKTHROUGH_LEAD_EMAILS = [
  'marcus.nelson@example.com',
  'priya.patel@example.com',
  'elena.brooks@example.com',
  'david.chen@example.com',
  'tom.andersen@example.com',
  'sofia.rivera@example.com',
  'jordan.hayes@example.com',
];

const DEMO_AGENT_PASSWORD = 'DemoAgent123!';

const DEMO_TABLES = [
  'supplier_webhook_events',
  'supplier_orders',
  'supplier_accounts',
  'supplier_connections',
  'product_events',
  'portal_tokens',
  'automation_rules',
  'notifications',
  'invoice_line_items',
  'invoices',
  'estimate_line_items',
  'estimates',
  'job_measurements',
  'job_activity',
  'files',
  'notes',
  'saved_views',
  'tasks',
  'jobs',
  'leads',
];

function parseArgs(argv) {
  return {
    dryRun: argv.includes('--dry-run'),
    reset: argv.includes('--reset'),
    force: argv.includes('--force'),
    confirm: argv.includes('--confirm'),
    includeTeam: argv.includes('--include-team'),
    ownerEmail: getArgValue(argv, '--owner-email'),
  };
}

function getArgValue(argv, flag) {
  const index = argv.indexOf(flag);
  if (index === -1) return null;
  return argv[index + 1] || null;
}

function daysFromNow(days, hour = 10) {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function daysAgo(days, hour = 14) {
  return daysFromNow(-days, hour);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function randomToken() {
  return crypto.randomBytes(32).toString('hex');
}

function assertSafeDatabaseTarget(databaseUrl, options) {
  let hostname = '';
  try {
    hostname = new URL(databaseUrl).hostname.toLowerCase();
  } catch {
    throw new Error('DATABASE_URL is not a valid URL.');
  }

  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
  if (!isLocal && !options.confirm && !options.dryRun) {
    throw new Error(
      `Refusing to write to non-local database host "${hostname}". ` +
        `Re-run with --confirm (and usually --reset) after reviewing the data impact. ` +
        `Docker-internal hosts like crm-db also require --confirm.`
    );
  }

  return hostname;
}

async function getOwner(pool, ownerEmail) {
  if (ownerEmail) {
    const { rows } = await pool.query(
      `
      SELECT id, email, first_name, last_name, role, status
      FROM users
      WHERE lower(email) = lower($1)
      LIMIT 1
      `,
      [ownerEmail]
    );
    if (!rows[0]) {
      throw new Error(`No user found for --owner-email ${ownerEmail}`);
    }
    if (rows[0].role !== 'owner' || rows[0].status !== 'active') {
      throw new Error(
        `User ${ownerEmail} must be an active owner (found role=${rows[0].role}, status=${rows[0].status}).`
      );
    }
    return rows[0];
  }

  const { rows } = await pool.query(
    `
    SELECT id, email, first_name, last_name, role, status
    FROM users
    WHERE role = 'owner' AND status = 'active'
    ORDER BY created_at ASC
    LIMIT 1
    `
  );
  if (!rows[0]) {
    throw new Error(
      'No active owner found. Register/login once on the hosted site, then rerun this seed.'
    );
  }
  return rows[0];
}

async function ensureDemoAgents(pool, dryRun) {
  const agents = [
    {
      email: 'alex.morgan@example.com',
      first_name: 'Alex',
      last_name: 'Morgan',
      key: 'alex',
    },
    {
      email: 'sam.lee@example.com',
      first_name: 'Sam',
      last_name: 'Lee',
      key: 'sam',
    },
  ];

  const passwordHash = await bcrypt.hash(DEMO_AGENT_PASSWORD, 10);
  const byKey = {};

  for (const agent of agents) {
    if (dryRun) {
      byKey[agent.key] = {
        id: crypto.randomUUID(),
        email: agent.email,
        first_name: agent.first_name,
        last_name: agent.last_name,
      };
      console.log(`[dry-run] ensure agent ${agent.email}`);
      continue;
    }

    const existing = await pool.query(
      `SELECT id, email, first_name, last_name FROM users WHERE lower(email) = lower($1)`,
      [agent.email]
    );
    if (existing.rows[0]) {
      byKey[agent.key] = existing.rows[0];
      continue;
    }

    const { rows } = await pool.query(
      `
      INSERT INTO users (
        first_name, last_name, email, password_hash, role, status,
        invited_at, password_set_at
      ) VALUES ($1, $2, $3, $4, 'agent', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING id, email, first_name, last_name
      `,
      [agent.first_name, agent.last_name, agent.email, passwordHash]
    );
    byKey[agent.key] = rows[0];
  }

  return byKey;
}

async function resetDemoTables(pool, dryRun) {
  const sql = `TRUNCATE TABLE ${DEMO_TABLES.join(', ')} RESTART IDENTITY CASCADE`;
  if (dryRun) {
    console.log(`[dry-run] ${sql}`);
    return;
  }
  await pool.query(sql);
  console.log('Cleared CRM business tables (users preserved).');
}

async function walkthroughAlreadyPresent(pool) {
  const { rows } = await pool.query(
    `
    SELECT email
    FROM leads
    WHERE lower(email) = ANY($1::text[])
    LIMIT 1
    `,
    [WALKTHROUGH_LEAD_EMAILS]
  );
  return Boolean(rows[0]);
}

async function insertReturning(pool, sql, params, dryRun, label) {
  if (dryRun) {
    console.log(`[dry-run] ${label}`);
    return { id: Math.floor(Math.random() * 1000) + 1 };
  }
  const { rows } = await pool.query(sql, params);
  return rows[0];
}

async function seed(pool, owner, agents, dryRun, options) {
  const userId = owner.id;
  const alexId = agents?.alex?.id || userId;
  const samId = agents?.sam?.id || userId;
  const frontendBase = (
    process.env.APP_BASE_URL ||
    process.env.FRONTEND_URL ||
    'https://your-crm-host'
  ).replace(/\/$/, '');

  const counts = {
    leads: 0,
    jobs: 0,
    tasks: 0,
    appointments: 0,
    notes: 0,
    estimates: 0,
    estimate_line_items: 0,
    invoices: 0,
    invoice_line_items: 0,
    measurements: 0,
    job_activity: 0,
    notifications: 0,
    saved_views: 0,
    automation_rules: 0,
    files: 0,
    portal_tokens: 0,
    team_agents: agents ? Object.keys(agents).length : 0,
  };

  const publicLinks = {};

  // ─── Leads ───────────────────────────────────────────────
  const leadDefs = [
    {
      key: 'nelson',
      first_name: 'Marcus',
      last_name: 'Nelson',
      email: 'marcus.nelson@example.com',
      phone: '6125550142',
      source: 'Website',
      status: 'New',
      service_type: 'Roofing',
      preferred_contact_method: 'phone',
      urgency: 'high',
      budget_min: 12000,
      budget_max: 18000,
      assigned_to: alexId,
      notes:
        'Requested a full roof replacement quote after hail damage. Prefers asphalt architectural shingles.',
      created_at: daysAgo(2),
      status_changed_at: daysAgo(2),
    },
    {
      key: 'patel',
      first_name: 'Priya',
      last_name: 'Patel',
      email: 'priya.patel@example.com',
      phone: '7635550198',
      source: 'Referral',
      status: 'Qualified',
      service_type: 'Gutters',
      preferred_contact_method: 'email',
      urgency: 'medium',
      budget_min: 8000,
      budget_max: 14000,
      assigned_to: userId,
      notes:
        'Referred by the Andersens. Interested in seamless gutters and partial siding repair on the south wall.',
      created_at: daysAgo(8),
      status_changed_at: daysAgo(3),
    },
    {
      key: 'brooks',
      first_name: 'Elena',
      last_name: 'Brooks',
      email: 'elena.brooks@example.com',
      phone: '6515550177',
      source: 'Door Knock',
      status: 'Contacted',
      service_type: 'Windows',
      preferred_contact_method: 'text',
      urgency: 'low',
      budget_min: 4000,
      budget_max: 7500,
      assigned_to: samId,
      notes: 'Wants energy-efficient window upgrade for living room and master bedroom.',
      created_at: daysAgo(5),
      status_changed_at: daysAgo(4),
    },
    {
      key: 'chen',
      first_name: 'David',
      last_name: 'Chen',
      email: 'david.chen@example.com',
      phone: '9525550133',
      source: 'Website',
      status: 'New',
      service_type: 'Gutters',
      preferred_contact_method: 'email',
      urgency: 'medium',
      budget_min: 3000,
      budget_max: 5000,
      assigned_to: samId,
      notes: 'Gutter cleaning + downspout extension inquiry.',
      created_at: daysAgo(1),
      status_changed_at: daysAgo(1),
    },
    {
      key: 'andersen',
      first_name: 'Tom',
      last_name: 'Andersen',
      email: 'tom.andersen@example.com',
      phone: '6125550110',
      source: 'Referral',
      status: 'Closed',
      service_type: 'Roofing',
      preferred_contact_method: 'phone',
      urgency: 'medium',
      budget_min: 15000,
      budget_max: 22000,
      assigned_to: userId,
      notes: 'Completed tear-off and re-roof last month. Happy customer; referred Priya Patel.',
      created_at: daysAgo(45),
      status_changed_at: daysAgo(12),
    },
    {
      key: 'rivera',
      first_name: 'Sofia',
      last_name: 'Rivera',
      email: 'sofia.rivera@example.com',
      phone: '7635550166',
      source: 'Website',
      status: 'Inactive',
      service_type: 'Roofing',
      preferred_contact_method: 'email',
      urgency: 'low',
      budget_min: 2000,
      budget_max: 4000,
      assigned_to: alexId,
      notes: 'Went quiet after initial estimate request. Revisit in spring.',
      created_at: daysAgo(60),
      status_changed_at: daysAgo(40),
    },
    {
      key: 'hayes',
      first_name: 'Jordan',
      last_name: 'Hayes',
      email: 'jordan.hayes@example.com',
      phone: '6125550188',
      source: 'Website',
      status: 'Contacted',
      service_type: 'Siding',
      preferred_contact_method: 'phone',
      urgency: 'medium',
      budget_min: 9000,
      budget_max: 15000,
      assigned_to: alexId,
      notes:
        'Price-shopped another contractor. Lost on timing after we could not schedule inspection within 10 days.',
      created_at: daysAgo(21),
      status_changed_at: daysAgo(14),
    },
  ];

  const leads = {};
  for (const lead of leadDefs) {
    const row = await insertReturning(
      pool,
      `
      INSERT INTO leads (
        user_id, assigned_to, first_name, last_name, email, phone,
        source, status, budget_min, budget_max, notes,
        service_type, preferred_contact_method, urgency,
        created_at, updated_at, status_changed_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11,
        $12, $13, $14,
        $15, $15, $16
      )
      RETURNING id
      `,
      [
        userId,
        lead.assigned_to,
        lead.first_name,
        lead.last_name,
        lead.email,
        lead.phone,
        lead.source,
        lead.status,
        lead.budget_min,
        lead.budget_max,
        lead.notes,
        lead.service_type,
        lead.preferred_contact_method,
        lead.urgency,
        lead.created_at,
        lead.status_changed_at,
      ],
      dryRun,
      `lead ${lead.first_name} ${lead.last_name}`
    );
    leads[lead.key] = row.id;
    counts.leads += 1;
  }

  // ─── Jobs ────────────────────────────────────────────────
  const jobDefs = [
    {
      key: 'patelRoof',
      leadKey: 'patel',
      title: 'Patel residence — gutters & south wall siding',
      description:
        'Install 6" seamless gutters, replace damaged Hardie board on south elevation, touch-up trim.',
      status: 'Proposal Sent',
      address: '1842 Birchwood Ave, Plymouth, MN 55441',
      assigned_to: userId,
      created_at: daysAgo(7),
    },
    {
      key: 'nelsonRoof',
      leadKey: 'nelson',
      title: 'Nelson residence — full roof replacement',
      description:
        'Insurance hail claim support. Tear-off existing 3-tab, install architectural shingles, ridge vent, and ice & water shield.',
      status: 'Appointment Scheduled',
      address: '512 Oak Street, Minneapolis, MN 55408',
      assigned_to: alexId,
      created_at: daysAgo(2),
    },
    {
      key: 'andersenDone',
      leadKey: 'andersen',
      title: 'Andersen residence — completed re-roof',
      description: 'Full tear-off and re-roof with GAF Timberline HDZ. Final walkthrough completed.',
      status: 'Closed Won',
      address: '903 Lakeview Dr, Edina, MN 55424',
      assigned_to: userId,
      created_at: daysAgo(40),
    },
    {
      key: 'hayesLost',
      leadKey: 'hayes',
      title: 'Hayes residence — siding estimate (lost)',
      description: 'Partial north elevation Hardie replacement. Lost to competitor on schedule.',
      status: 'Closed Lost',
      address: '2201 Summit Ave, St Paul, MN 55105',
      assigned_to: alexId,
      created_at: daysAgo(18),
    },
  ];

  const jobs = {};
  for (const job of jobDefs) {
    const row = await insertReturning(
      pool,
      `
      INSERT INTO jobs (
        user_id, assigned_to, lead_id, title, description, status, address,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $8
      )
      RETURNING id
      `,
      [
        userId,
        job.assigned_to,
        leads[job.leadKey],
        job.title,
        job.description,
        job.status,
        job.address,
        job.created_at,
      ],
      dryRun,
      `job ${job.title}`
    );
    jobs[job.key] = row.id;
    counts.jobs += 1;
  }

  // ─── Measurements ────────────────────────────────────────
  const measurements = [
    { label: 'Roof squares', value: 28, unit: 'sq', sort: 0 },
    { label: 'Gutter length', value: 145, unit: 'ft', sort: 1 },
    { label: 'Downspouts', value: 6, unit: 'ea', sort: 2 },
  ];
  for (const m of measurements) {
    await insertReturning(
      pool,
      `
      INSERT INTO job_measurements (job_id, label, value, unit, sort_order)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
      `,
      [jobs.patelRoof, m.label, m.value, m.unit, m.sort],
      dryRun,
      `measurement ${m.label}`
    );
    counts.measurements += 1;
  }

  // ─── Tasks + appointments ────────────────────────────────
  const taskDefs = [
    {
      title: 'Call Marcus Nelson to confirm inspection window',
      description: 'Offer Tue/Thu afternoon slots for on-site roof inspection.',
      due_date: daysFromNow(0, 15),
      status: 'Pending',
      leadKey: 'nelson',
      assigned_to: alexId,
      kind: 'task',
    },
    {
      title: 'Follow up on insurance adjuster photos',
      description: 'Marcus said adjuster visited Monday — request photo packet.',
      due_date: daysAgo(1, 11),
      status: 'Pending',
      leadKey: 'nelson',
      assigned_to: alexId,
      kind: 'task',
    },
    {
      title: 'Send Patel proposal PDF after review',
      description: 'Final pricing locked; share estimate link with Priya.',
      due_date: daysFromNow(1, 9),
      status: 'Pending',
      jobKey: 'patelRoof',
      assigned_to: userId,
      kind: 'task',
    },
    {
      title: 'Order gutter coils for Patel job',
      description: 'Color: Colonial Gray. Confirm lead time with supplier.',
      due_date: daysFromNow(3, 10),
      status: 'Pending',
      jobKey: 'patelRoof',
      assigned_to: userId,
      kind: 'task',
    },
    {
      title: 'Window quote call — Elena Brooks',
      description: 'Discuss vinyl vs fiberglass options and lead times.',
      due_date: daysFromNow(2, 14),
      status: 'Pending',
      leadKey: 'brooks',
      assigned_to: samId,
      kind: 'task',
    },
    {
      title: 'Quick quote reply — David Chen gutters',
      description: 'Ballpark clean + extend downspouts.',
      due_date: daysFromNow(0, 16),
      status: 'Pending',
      leadKey: 'chen',
      assigned_to: samId,
      kind: 'task',
    },
    {
      title: 'Andersen final invoice paid confirmation',
      description: 'Payment received; send thank-you and review request.',
      due_date: daysAgo(5, 12),
      status: 'Completed',
      jobKey: 'andersenDone',
      assigned_to: userId,
      kind: 'task',
    },
    {
      title: 'Site photos for Patel south wall',
      description: 'Upload before photos to job file set.',
      due_date: daysAgo(3, 10),
      status: 'Completed',
      jobKey: 'patelRoof',
      assigned_to: userId,
      kind: 'task',
    },
    {
      title: 'On-site roof inspection — Marcus Nelson',
      description: 'Walk northwest slope hail damage with homeowner; capture measurements.',
      due_date: daysFromNow(1, 13),
      end_at: (() => {
        const end = new Date(daysFromNow(1, 13));
        end.setMinutes(end.getMinutes() + 90);
        return end.toISOString();
      })(),
      location: '512 Oak Street, Minneapolis, MN 55408',
      status: 'Pending',
      leadKey: 'nelson',
      assigned_to: alexId,
      kind: 'appointment',
    },
    {
      title: 'Patel material delivery window',
      description: 'Meet supplier truck; stage coils and Hardie in driveway.',
      due_date: daysFromNow(4, 9),
      end_at: daysFromNow(4, 11),
      location: '1842 Birchwood Ave, Plymouth, MN 55441',
      status: 'Pending',
      jobKey: 'patelRoof',
      assigned_to: userId,
      kind: 'appointment',
    },
    {
      title: 'Brooks window showroom consult',
      description: 'Bring vinyl and fiberglass sample boards.',
      due_date: daysFromNow(0, 10),
      end_at: daysFromNow(0, 11),
      location: 'Rooftop Realty office',
      status: 'Pending',
      leadKey: 'brooks',
      assigned_to: samId,
      kind: 'appointment',
    },
  ];

  const tasks = {};
  for (const [index, task] of taskDefs.entries()) {
    const row = await insertReturning(
      pool,
      `
      INSERT INTO tasks (
        user_id, assigned_to, lead_id, job_id, title, description,
        due_date, end_at, location, kind, status, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11, $12, $12
      )
      RETURNING id
      `,
      [
        userId,
        task.assigned_to,
        task.leadKey ? leads[task.leadKey] : null,
        task.jobKey ? jobs[task.jobKey] : null,
        task.title,
        task.description,
        task.due_date,
        task.end_at || null,
        task.location || null,
        task.kind || 'task',
        task.status,
        daysAgo(4 - (index % 4)),
      ],
      dryRun,
      `${task.kind || 'task'} ${task.title}`
    );
    tasks[`t${index}`] = row.id;
    if (task.kind === 'appointment') counts.appointments += 1;
    else counts.tasks += 1;
  }

  // ─── Notes (typed communication) ─────────────────────────
  const noteDefs = [
    {
      entity_type: 'lead',
      entityKey: 'nelson',
      type: 'call',
      direction: 'outbound',
      body: 'Spoke with Marcus — hail hit northwest slope worst. Wants claim assistance and a written estimate before committing.',
    },
    {
      entity_type: 'lead',
      entityKey: 'nelson',
      type: 'text',
      direction: 'inbound',
      body: 'Marcus texted adjuster photo packet link. Saved to follow-up task.',
    },
    {
      entity_type: 'lead',
      entityKey: 'patel',
      type: 'email',
      direction: 'outbound',
      body: 'Sent financing overview and confirmed we can stage gutters first if budget is tight.',
    },
    {
      entity_type: 'job',
      entityKey: 'patelRoof',
      type: 'in_person',
      direction: 'outbound',
      body: 'Measured south wall: ~340 sq ft siding replacement. Gutters continuous run on front and garage.',
    },
    {
      entity_type: 'job',
      entityKey: 'andersenDone',
      type: 'note',
      direction: 'internal',
      body: 'Punch list cleared. Homeowner signed completion form and left a Google review.',
    },
    {
      entity_type: 'lead',
      entityKey: 'brooks',
      type: 'call',
      direction: 'outbound',
      body: 'Left voicemail about showroom consult; she prefers text reminders.',
    },
  ];

  for (const note of noteDefs) {
    const entityId =
      note.entity_type === 'lead' ? leads[note.entityKey] : jobs[note.entityKey];
    await insertReturning(
      pool,
      `
      INSERT INTO notes (
        user_id, entity_type, entity_id, body, type, direction, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
      RETURNING id
      `,
      [
        userId,
        note.entity_type,
        entityId,
        note.body,
        note.type,
        note.direction,
        daysAgo(2),
      ],
      dryRun,
      `note ${note.type} on ${note.entity_type}:${note.entityKey}`
    );
    counts.notes += 1;
  }

  // ─── Job activity ────────────────────────────────────────
  const activityDefs = [
    {
      jobKey: 'patelRoof',
      type: 'STATUS_CHANGED',
      title: 'Status updated',
      message: 'Moved to Proposal Sent',
      created_at: daysAgo(1),
    },
    {
      jobKey: 'patelRoof',
      type: 'NOTE_ADDED',
      title: 'Note added',
      message: 'Measurements captured for gutters and siding',
      created_at: daysAgo(3),
    },
    {
      jobKey: 'nelsonRoof',
      type: 'JOB_CREATED',
      title: 'Job created',
      message: 'Inspection appointment scheduled from website lead',
      created_at: daysAgo(2),
    },
    {
      jobKey: 'andersenDone',
      type: 'STATUS_CHANGED',
      title: 'Status updated',
      message: 'Closed Won — project complete',
      created_at: daysAgo(10),
    },
    {
      jobKey: 'hayesLost',
      type: 'STATUS_CHANGED',
      title: 'Status updated',
      message: 'Closed Lost — competitor scheduled sooner',
      created_at: daysAgo(14),
    },
  ];

  for (const activity of activityDefs) {
    await insertReturning(
      pool,
      `
      INSERT INTO job_activity (
        user_id, job_id, type, title, message, entity_type, entity_id, created_at
      ) VALUES ($1, $2, $3, $4, $5, 'job', $2, $6)
      RETURNING id
      `,
      [
        userId,
        jobs[activity.jobKey],
        activity.type,
        activity.title,
        activity.message,
        activity.created_at,
      ],
      dryRun,
      `activity ${activity.title}`
    );
    counts.job_activity += 1;
  }

  // ─── Estimates ───────────────────────────────────────────
  const patelShareRaw = randomToken();
  const patelEstimate = await insertReturning(
    pool,
    `
    INSERT INTO estimates (
      user_id, job_id, title, status,
      subtotal, tax_total, discount_total, grand_total, notes,
      share_token_hash, share_expires_at,
      created_at, updated_at
    ) VALUES (
      $1, $2, $3, 'Sent',
      $4, $5, 0, $6, $7,
      $8, $9,
      $10, $10
    )
    RETURNING id
    `,
    [
      userId,
      jobs.patelRoof,
      'Patel — gutters & siding proposal',
      11240,
      786.8,
      12026.8,
      'Includes material, labor, haul-away, and 2-year workmanship warranty.',
      sha256(patelShareRaw),
      daysFromNow(21),
      daysAgo(1),
    ],
    dryRun,
    'estimate Patel Sent'
  );
  counts.estimates += 1;
  publicLinks.estimateShare = `${frontendBase}/public/estimate/${patelShareRaw}`;

  const andersenEstimate = await insertReturning(
    pool,
    `
    INSERT INTO estimates (
      user_id, job_id, title, status,
      subtotal, tax_total, discount_total, grand_total, notes,
      client_responded_at, client_response_note,
      created_at, updated_at
    ) VALUES (
      $1, $2, $3, 'Approved',
      $4, $5, $6, $7, $8,
      $9, $10,
      $11, $11
    )
    RETURNING id
    `,
    [
      userId,
      jobs.andersenDone,
      'Andersen — full re-roof',
      18600,
      1302,
      500,
      19402,
      'GAF Timberline HDZ, ridge vent, ice & water shield on eaves.',
      daysAgo(35),
      'Approved — please schedule as soon as materials arrive.',
      daysAgo(38),
    ],
    dryRun,
    'estimate Andersen Approved'
  );
  counts.estimates += 1;

  await insertReturning(
    pool,
    `
    INSERT INTO estimates (
      user_id, job_id, title, status,
      subtotal, tax_total, discount_total, grand_total, notes,
      created_at, updated_at
    ) VALUES (
      $1, $2, $3, 'Draft',
      $4, $5, 0, $6, $7,
      $8, $8
    )
    RETURNING id
    `,
    [
      userId,
      jobs.nelsonRoof,
      'Nelson — draft roofing estimate',
      0,
      0,
      0,
      'Placeholder draft until inspection measurements are confirmed.',
      daysAgo(1),
    ],
    dryRun,
    'estimate Nelson Draft'
  );
  counts.estimates += 1;

  await insertReturning(
    pool,
    `
    INSERT INTO estimates (
      user_id, job_id, title, status,
      subtotal, tax_total, discount_total, grand_total, notes,
      client_responded_at, client_response_note,
      created_at, updated_at
    ) VALUES (
      $1, $2, $3, 'Rejected',
      $4, $5, 0, $6, $7,
      $8, $9,
      $10, $10
    )
    RETURNING id
    `,
    [
      userId,
      jobs.hayesLost,
      'Hayes — north elevation siding',
      11800,
      826,
      12626,
      'Hardie panel + trim package.',
      daysAgo(15),
      'Going with another contractor who can start next week.',
      daysAgo(17),
    ],
    dryRun,
    'estimate Hayes Rejected'
  );
  counts.estimates += 1;

  const estimateLines = [
    {
      estimateId: patelEstimate.id,
      items: [
        {
          name: '6" seamless gutters',
          description: 'Colonial Gray, includes hangers & outlets',
          quantity: 145,
          unit_price: 14,
          sort: 0,
        },
        {
          name: 'Downspouts',
          description: '3x4 white aluminum',
          quantity: 6,
          unit_price: 85,
          sort: 1,
        },
        {
          name: 'Hardie board siding (south wall)',
          description: 'Labor + material, paint-matched',
          quantity: 340,
          unit_price: 18.5,
          sort: 2,
        },
        {
          name: 'Debris haul-away',
          description: 'Single dump trailer',
          quantity: 1,
          unit_price: 350,
          sort: 3,
        },
      ],
    },
    {
      estimateId: andersenEstimate.id,
      items: [
        {
          name: 'Tear-off (1 layer)',
          description: 'Haul-away included',
          quantity: 32,
          unit_price: 95,
          sort: 0,
        },
        {
          name: 'GAF Timberline HDZ',
          description: 'Charcoal, underlayment, ridge cap',
          quantity: 32,
          unit_price: 385,
          sort: 1,
        },
        {
          name: 'Ice & water shield',
          description: 'Eaves and valleys',
          quantity: 1,
          unit_price: 680,
          sort: 2,
        },
      ],
    },
  ];

  for (const group of estimateLines) {
    for (const item of group.items) {
      const lineTotal = Number(item.quantity) * Number(item.unit_price);
      await insertReturning(
        pool,
        `
        INSERT INTO estimate_line_items (
          estimate_id, name, description, quantity, unit_price, line_total,
          sort_order, source
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'manual')
        RETURNING id
        `,
        [
          group.estimateId,
          item.name,
          item.description,
          item.quantity,
          item.unit_price,
          lineTotal,
          item.sort,
        ],
        dryRun,
        `estimate line ${item.name}`
      );
      counts.estimate_line_items += 1;
    }
  }

  // ─── Invoices ────────────────────────────────────────────
  const patelInvoice = await insertReturning(
    pool,
    `
    INSERT INTO invoices (
      user_id, job_id, estimate_id, invoice_number, status,
      subtotal, tax_total, discount_total, grand_total,
      due_date, notes, created_at, updated_at
    ) VALUES (
      $1, $2, $3, 'INV-1001', 'Sent',
      $4, $5, 0, $6,
      $7, $8, $9, $9
    )
    RETURNING id
    `,
    [
      userId,
      jobs.patelRoof,
      patelEstimate.id,
      5620,
      393.4,
      6013.4,
      daysFromNow(14),
      'Deposit invoice — 50% to schedule install.',
      daysAgo(0, 11),
    ],
    dryRun,
    'invoice Patel Sent'
  );
  counts.invoices += 1;

  const andersenInvoice = await insertReturning(
    pool,
    `
    INSERT INTO invoices (
      user_id, job_id, estimate_id, invoice_number, status,
      subtotal, tax_total, discount_total, grand_total,
      due_date, paid_at, notes, created_at, updated_at
    ) VALUES (
      $1, $2, $3, 'INV-0988', 'Paid',
      $4, $5, $6, $7,
      $8, $9, $10, $11, $11
    )
    RETURNING id
    `,
    [
      userId,
      jobs.andersenDone,
      andersenEstimate.id,
      18600,
      1302,
      500,
      19402,
      daysAgo(12),
      daysAgo(8),
      'Final balance paid via check #4412.',
      daysAgo(15),
    ],
    dryRun,
    'invoice Andersen Paid'
  );
  counts.invoices += 1;

  await insertReturning(
    pool,
    `
    INSERT INTO invoices (
      user_id, job_id, estimate_id, invoice_number, status,
      subtotal, tax_total, discount_total, grand_total,
      due_date, notes, created_at, updated_at
    ) VALUES (
      $1, $2, NULL, 'INV-0971', 'Overdue',
      $3, $4, 0, $5,
      $6, $7, $8, $8
    )
    RETURNING id
    `,
    [
      userId,
      jobs.hayesLost,
      1500,
      105,
      1605,
      daysAgo(10),
      'Site visit / design fee left unpaid after job was lost.',
      daysAgo(25),
    ],
    dryRun,
    'invoice Hayes Overdue'
  );
  counts.invoices += 1;

  const invoiceLines = [
    {
      invoiceId: patelInvoice.id,
      items: [
        {
          name: 'Project deposit (50%)',
          description: 'Gutters & siding — deposit to schedule',
          quantity: 1,
          unit_price: 5620,
          sort: 0,
        },
      ],
    },
    {
      invoiceId: andersenInvoice.id,
      items: [
        {
          name: 'Full re-roof — final balance',
          description: 'Per approved estimate (includes referral discount)',
          quantity: 1,
          unit_price: 19402,
          sort: 0,
        },
      ],
    },
  ];

  for (const group of invoiceLines) {
    for (const item of group.items) {
      const lineTotal = Number(item.quantity) * Number(item.unit_price);
      await insertReturning(
        pool,
        `
        INSERT INTO invoice_line_items (
          invoice_id, name, description, quantity, unit_price, line_total, sort_order
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
        `,
        [
          group.invoiceId,
          item.name,
          item.description,
          item.quantity,
          item.unit_price,
          lineTotal,
          item.sort,
        ],
        dryRun,
        `invoice line ${item.name}`
      );
      counts.invoice_line_items += 1;
    }
  }

  // ─── File metadata (binaries not included) ───────────────
  const fileDefs = [
    {
      name: 'patel-south-wall-before-1.jpg',
      jobKey: 'patelRoof',
      category: 'before',
      client_visible: true,
    },
    {
      name: 'patel-south-wall-before-2.jpg',
      jobKey: 'patelRoof',
      category: 'before',
      client_visible: true,
    },
    {
      name: 'andersen-after-front.jpg',
      jobKey: 'andersenDone',
      category: 'after',
      client_visible: true,
    },
    {
      name: 'nelson-adjuster-notes.pdf',
      leadKey: 'nelson',
      category: 'other',
      client_visible: false,
    },
  ];

  for (const [index, file] of fileDefs.entries()) {
    await insertReturning(
      pool,
      `
      INSERT INTO files (
        uploaded_by_user_id, original_name, storage_key, mime_type, size_bytes,
        lead_id, job_id, category, client_visible, caption, created_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10, $11
      )
      RETURNING id
      `,
      [
        userId,
        file.name,
        `demo/walkthrough/${file.name}`,
        file.name.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg',
        240000 + index * 12000,
        file.leadKey ? leads[file.leadKey] : null,
        file.jobKey ? jobs[file.jobKey] : null,
        file.category,
        file.client_visible,
        `Demo placeholder — binary not uploaded (${file.category})`,
        daysAgo(2),
      ],
      dryRun,
      `file ${file.name}`
    );
    counts.files += 1;
  }

  // ─── Client portal token (Patel job) ─────────────────────
  const portalRaw = randomToken();
  await insertReturning(
    pool,
    `
    INSERT INTO portal_tokens (user_id, job_id, token_hash, expires_at)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (job_id) DO UPDATE SET
      token_hash = EXCLUDED.token_hash,
      expires_at = EXCLUDED.expires_at,
      updated_at = CURRENT_TIMESTAMP
    RETURNING id
    `,
    [userId, jobs.patelRoof, sha256(portalRaw), daysFromNow(30)],
    dryRun,
    'portal token Patel'
  );
  counts.portal_tokens += 1;
  publicLinks.portal = `${frontendBase}/public/portal/${portalRaw}`;

  // ─── Notifications ───────────────────────────────────────
  const notificationDefs = [
    {
      type: 'TASK_OVERDUE',
      title: 'Task overdue',
      message: 'Follow up on insurance adjuster photos is overdue',
      entity_type: 'task',
      entityId: tasks.t1,
      created_at: daysAgo(0, 8),
    },
    {
      type: 'TASK_DUE_SOON',
      title: 'Task due soon',
      message: 'Call Marcus Nelson to confirm inspection window is due soon',
      entity_type: 'task',
      entityId: tasks.t0,
      created_at: daysAgo(0, 9),
    },
    {
      type: 'TASK_ASSIGNED',
      title: 'New task assigned',
      message: 'You were assigned: Send Patel proposal PDF after review',
      entity_type: 'task',
      entityId: tasks.t2,
      created_at: daysAgo(1),
    },
    {
      type: 'ESTIMATE_STATUS_CHANGED',
      title: 'Estimate updated',
      message: 'Patel — gutters & siding proposal marked Sent',
      entity_type: 'estimate',
      entityId: patelEstimate.id,
      created_at: daysAgo(1, 16),
    },
    {
      type: 'INVOICE_CREATED',
      title: 'Invoice created',
      message: 'INV-1001 created for Patel residence deposit',
      entity_type: 'invoice',
      entityId: patelInvoice.id,
      created_at: daysAgo(0, 11),
    },
    {
      type: 'INVOICE_PAID',
      title: 'Invoice paid',
      message: 'INV-0988 marked Paid for Andersen re-roof',
      entity_type: 'invoice',
      entityId: andersenInvoice.id,
      created_at: daysAgo(8),
    },
  ];

  for (const [index, n] of notificationDefs.entries()) {
    await insertReturning(
      pool,
      `
      INSERT INTO notifications (
        user_id, type, title, message, entity_type, entity_id,
        created_at, dedupe_key
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
      `,
      [
        userId,
        n.type,
        n.title,
        n.message,
        n.entity_type,
        n.entityId,
        n.created_at,
        `walkthrough:${n.type}:${index}:${Date.now()}`,
      ],
      dryRun,
      `notification ${n.type}`
    );
    counts.notifications += 1;
  }

  // ─── Saved views ─────────────────────────────────────────
  await insertReturning(
    pool,
    `
    INSERT INTO saved_views (user_id, entity_type, name, filters)
    VALUES ($1, 'leads', 'New website leads', $2::jsonb)
    RETURNING id
    `,
    [userId, JSON.stringify({ status: 'New', source: 'Website' })],
    dryRun,
    'saved view leads'
  );
  counts.saved_views += 1;

  await insertReturning(
    pool,
    `
    INSERT INTO saved_views (user_id, entity_type, name, filters)
    VALUES ($1, 'jobs', 'Active proposals', $2::jsonb)
    RETURNING id
    `,
    [userId, JSON.stringify({ status: 'Proposal Sent' })],
    dryRun,
    'saved view jobs'
  );
  counts.saved_views += 1;

  await insertReturning(
    pool,
    `
    INSERT INTO saved_views (user_id, entity_type, name, filters)
    VALUES ($1, 'tasks', 'Appointments this week', $2::jsonb)
    RETURNING id
    `,
    [userId, JSON.stringify({ kind: 'appointment', status: 'Pending' })],
    dryRun,
    'saved view appointments'
  );
  counts.saved_views += 1;

  // ─── Automation ──────────────────────────────────────────
  await insertReturning(
    pool,
    `
    INSERT INTO automation_rules (
      user_id, name, description, trigger_event, conditions,
      action_type, action_config, enabled
    ) VALUES (
      $1, $2, $3, 'ESTIMATE_APPROVED', '{}'::jsonb,
      'CREATE_FOLLOW_UP_TASK', $4::jsonb, true
    )
    RETURNING id
    `,
    [
      userId,
      'Follow up after estimate approval',
      'When a client approves an estimate, create a scheduling follow-up task.',
      JSON.stringify({
        title: 'Schedule install after estimate approval',
        due_in_days: 2,
      }),
    ],
    dryRun,
    'automation rule'
  );
  counts.automation_rules += 1;

  return { counts, publicLinks, options };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Add it to .env or the container environment.');
    process.exit(1);
  }

  const hostname = assertSafeDatabaseTarget(process.env.DATABASE_URL, options);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const owner = await getOwner(pool, options.ownerEmail);
    console.log(
      `Walkthrough seed target owner: ${owner.first_name} ${owner.last_name} <${owner.email}>`
    );
    console.log(`Database host: ${hostname}`);

    if (!options.reset && !options.force) {
      const present = await walkthroughAlreadyPresent(pool);
      if (present) {
        throw new Error(
          'Walkthrough leads already exist (@example.com). ' +
            'Use --reset to wipe CRM business tables and reseed, or --force to append another copy.'
        );
      }
    }

    if (options.reset) {
      if (!options.confirm && hostname !== 'localhost' && hostname !== '127.0.0.1') {
        throw new Error('--reset on a non-local host also requires --confirm.');
      }
      await resetDemoTables(pool, options.dryRun);
    }

    const agents = options.includeTeam
      ? await ensureDemoAgents(pool, options.dryRun)
      : null;

    const { counts, publicLinks } = await seed(
      pool,
      owner,
      agents,
      options.dryRun,
      options
    );

    console.log('');
    console.log(
      options.dryRun ? 'Dry run complete.' : 'Walkthrough seed complete.'
    );
    console.log(JSON.stringify(counts, null, 2));

    if (agents && !options.dryRun) {
      console.log('');
      console.log('Demo agent logins (password for both):', DEMO_AGENT_PASSWORD);
      console.log('  alex.morgan@example.com');
      console.log('  sam.lee@example.com');
    }

    if (!options.dryRun) {
      console.log('');
      console.log('Public demo links (raw tokens; treat as sensitive):');
      console.log('  Portal:', publicLinks.portal);
      console.log('  Estimate share:', publicLinks.estimateShare);
      console.log(
        '  Note: file rows are metadata only; photo binaries are not uploaded.'
      );
    }

    console.log('');
    console.log(
      'Suggested walkthrough path: Dashboard → Leads (Nelson/Patel) → Jobs → Estimates → Invoices → Tasks/Appointments → Notifications'
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Walkthrough seed failed:', err.message);
  process.exit(1);
});
