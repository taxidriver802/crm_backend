/**
 * Seeds realistic Rooftop Realty walkthrough data for demos.
 *
 * Attaches everything to your existing owner account (does not create users).
 *
 * Usage (from crm_backend):
 *   npm run db:seed-walkthrough
 *   npm run db:seed-walkthrough -- --dry-run
 *   npm run db:seed-walkthrough -- --reset
 *
 * --reset clears demo tables first (keeps users).
 */
require('dotenv').config();

const { Pool } = require('pg');

function parseArgs(argv) {
  return {
    dryRun: argv.includes('--dry-run'),
    reset: argv.includes('--reset'),
  };
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

async function getOwner(pool) {
  const { rows } = await pool.query(
    `
    SELECT id, email, first_name, last_name, role
    FROM users
    WHERE role = 'owner' AND status = 'active'
    ORDER BY created_at ASC
    LIMIT 1
    `
  );
  if (!rows[0]) {
    throw new Error(
      'No active owner found. Register a user first, then rerun this seed.'
    );
  }
  return rows[0];
}

async function resetDemoTables(pool, dryRun) {
  const sql = `TRUNCATE TABLE ${DEMO_TABLES.join(', ')} RESTART IDENTITY CASCADE`;
  if (dryRun) {
    console.log(`[dry-run] ${sql}`);
    return;
  }
  await pool.query(sql);
  console.log('Cleared demo tables (users preserved).');
}

async function insertReturning(pool, sql, params, dryRun, label) {
  if (dryRun) {
    console.log(`[dry-run] ${label}`);
    return { id: Math.floor(Math.random() * 1000) + 1 };
  }
  const { rows } = await pool.query(sql, params);
  return rows[0];
}

async function seed(pool, owner, dryRun) {
  const userId = owner.id;
  const counts = {
    leads: 0,
    jobs: 0,
    tasks: 0,
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
  };

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
      budget_min: 12000,
      budget_max: 18000,
      notes:
        'Requested a full roof replacement quote after hail damage. Prefers asphalt architectural shingles.',
      created_at: daysAgo(2),
    },
    {
      key: 'patel',
      first_name: 'Priya',
      last_name: 'Patel',
      email: 'priya.patel@example.com',
      phone: '7635550198',
      source: 'Referral',
      status: 'Qualified',
      budget_min: 8000,
      budget_max: 14000,
      notes:
        'Referred by the Andersens. Interested in seamless gutters and partial siding repair on the south wall.',
      created_at: daysAgo(8),
    },
    {
      key: 'brooks',
      first_name: 'Elena',
      last_name: 'Brooks',
      email: 'elena.brooks@example.com',
      phone: '6515550177',
      source: 'Door Knock',
      status: 'Contacted',
      budget_min: 4000,
      budget_max: 7500,
      notes: 'Wants energy-efficient window upgrade for living room and master bedroom.',
      created_at: daysAgo(5),
    },
    {
      key: 'chen',
      first_name: 'David',
      last_name: 'Chen',
      email: 'david.chen@example.com',
      phone: '9525550133',
      source: 'Website',
      status: 'New',
      budget_min: 3000,
      budget_max: 5000,
      notes: 'Gutter cleaning + downspout extension inquiry.',
      created_at: daysAgo(1),
    },
    {
      key: 'andersen',
      first_name: 'Tom',
      last_name: 'Andersen',
      email: 'tom.andersen@example.com',
      phone: '6125550110',
      source: 'Referral',
      status: 'Closed',
      budget_min: 15000,
      budget_max: 22000,
      notes: 'Completed tear-off and re-roof last month. Happy customer; referred Priya Patel.',
      created_at: daysAgo(45),
    },
    {
      key: 'rivera',
      first_name: 'Sofia',
      last_name: 'Rivera',
      email: 'sofia.rivera@example.com',
      phone: '7635550166',
      source: 'Website',
      status: 'Inactive',
      budget_min: 2000,
      budget_max: 4000,
      notes: 'Went quiet after initial estimate request. Revisit in spring.',
      created_at: daysAgo(60),
    },
  ];

  const leads = {};
  for (const lead of leadDefs) {
    const row = await insertReturning(
      pool,
      `
      INSERT INTO leads (
        user_id, assigned_to, first_name, last_name, email, phone,
        source, status, budget_min, budget_max, notes, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11, $12, $12
      )
      RETURNING id
      `,
      [
        userId,
        userId,
        lead.first_name,
        lead.last_name,
        lead.email,
        lead.phone,
        lead.source,
        lead.status,
        lead.budget_min,
        lead.budget_max,
        lead.notes,
        lead.created_at,
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
      created_at: daysAgo(2),
    },
    {
      key: 'andersenDone',
      leadKey: 'andersen',
      title: 'Andersen residence — completed re-roof',
      description: 'Full tear-off and re-roof with GAF Timberline HDZ. Final walkthrough completed.',
      status: 'Closed Won',
      address: '903 Lakeview Dr, Edina, MN 55424',
      created_at: daysAgo(40),
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
        userId,
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

  // ─── Measurements (strong job) ───────────────────────────
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

  // ─── Tasks ───────────────────────────────────────────────
  const taskDefs = [
    {
      title: 'Call Marcus Nelson to confirm inspection window',
      description: 'Offer Tue/Thu afternoon slots for on-site roof inspection.',
      due_date: daysFromNow(0, 15),
      status: 'Pending',
      leadKey: 'nelson',
    },
    {
      title: 'Follow up on insurance adjuster photos',
      description: 'Marcus said adjuster visited Monday — request photo packet.',
      due_date: daysAgo(1, 11),
      status: 'Pending',
      leadKey: 'nelson',
    },
    {
      title: 'Send Patel proposal PDF after review',
      description: 'Final pricing locked; share estimate link with Priya.',
      due_date: daysFromNow(1, 9),
      status: 'Pending',
      jobKey: 'patelRoof',
    },
    {
      title: 'Order gutter coils for Patel job',
      description: 'Color: Colonial Gray. Confirm lead time with supplier.',
      due_date: daysFromNow(3, 10),
      status: 'Pending',
      jobKey: 'patelRoof',
    },
    {
      title: 'Window quote call — Elena Brooks',
      description: 'Discuss vinyl vs fiberglass options and lead times.',
      due_date: daysFromNow(2, 14),
      status: 'Pending',
      leadKey: 'brooks',
    },
    {
      title: 'Quick quote reply — David Chen gutters',
      description: 'Ballpark clean + extend downspouts.',
      due_date: daysFromNow(0, 16),
      status: 'Pending',
      leadKey: 'chen',
    },
    {
      title: 'Andersen final invoice paid confirmation',
      description: 'Payment received; send thank-you and review request.',
      due_date: daysAgo(5, 12),
      status: 'Completed',
      jobKey: 'andersenDone',
    },
    {
      title: 'Site photos for Patel south wall',
      description: 'Upload before photos to job file set.',
      due_date: daysAgo(3, 10),
      status: 'Completed',
      jobKey: 'patelRoof',
    },
  ];

  const tasks = {};
  for (const [index, task] of taskDefs.entries()) {
    const row = await insertReturning(
      pool,
      `
      INSERT INTO tasks (
        user_id, assigned_to, lead_id, job_id, title, description,
        due_date, status, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $9
      )
      RETURNING id
      `,
      [
        userId,
        userId,
        task.leadKey ? leads[task.leadKey] : null,
        task.jobKey ? jobs[task.jobKey] : null,
        task.title,
        task.description,
        task.due_date,
        task.status,
        daysAgo(4 - (index % 4)),
      ],
      dryRun,
      `task ${task.title}`
    );
    tasks[`t${index}`] = row.id;
    counts.tasks += 1;
  }

  // ─── Notes ───────────────────────────────────────────────
  const noteDefs = [
    {
      entity_type: 'lead',
      entityKey: 'nelson',
      body: 'Spoke with Marcus — hail hit northwest slope worst. Wants claim assistance and a written estimate before committing.',
    },
    {
      entity_type: 'lead',
      entityKey: 'patel',
      body: 'Priya asked about financing options and whether we can stage gutters first, siding second if budget is tight.',
    },
    {
      entity_type: 'job',
      entityKey: 'patelRoof',
      body: 'Measured south wall: ~340 sq ft siding replacement. Gutters continuous run on front and garage.',
    },
    {
      entity_type: 'job',
      entityKey: 'andersenDone',
      body: 'Punch list cleared. Homeowner signed completion form and left a Google review.',
    },
  ];

  for (const note of noteDefs) {
    const entityId =
      note.entity_type === 'lead' ? leads[note.entityKey] : jobs[note.entityKey];
    await insertReturning(
      pool,
      `
      INSERT INTO notes (user_id, entity_type, entity_id, body, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $5)
      RETURNING id
      `,
      [userId, note.entity_type, entityId, note.body, daysAgo(2)],
      dryRun,
      `note on ${note.entity_type}:${note.entityKey}`
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
  const patelEstimate = await insertReturning(
    pool,
    `
    INSERT INTO estimates (
      user_id, job_id, title, status,
      subtotal, tax_total, discount_total, grand_total, notes,
      created_at, updated_at
    ) VALUES (
      $1, $2, $3, 'Sent',
      $4, $5, 0, $6, $7,
      $8, $8
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
      daysAgo(1),
    ],
    dryRun,
    'estimate Patel Sent'
  );
  counts.estimates += 1;

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

  const nelsonDraft = await insertReturning(
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

  // keep nelsonDraft referenced so unused var warning is avoided in dry logic
  void nelsonDraft;

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
        `walkthrough:${n.type}:${index}`,
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
    [
      userId,
      JSON.stringify({ status: 'New', source: 'Website' }),
    ],
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

  // ─── Automation (one example rule) ───────────────────────
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

  return counts;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Add it to .env before seeding.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const owner = await getOwner(pool);
    console.log(
      `Walkthrough seed target owner: ${owner.first_name} ${owner.last_name} <${owner.email}>`
    );

    if (options.reset) {
      await resetDemoTables(pool, options.dryRun);
    }

    const counts = await seed(pool, owner, options.dryRun);

    console.log('');
    console.log(
      options.dryRun ? 'Dry run complete.' : 'Walkthrough seed complete.'
    );
    console.log(JSON.stringify(counts, null, 2));
    console.log('');
    console.log(
      'Suggested walkthrough path: Dashboard → Leads (Nelson/Patel) → Jobs → Estimates → Invoices → Tasks/Notifications'
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Walkthrough seed failed:', err.message);
  process.exit(1);
});
