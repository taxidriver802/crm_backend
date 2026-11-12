/**
 * Fills the demo company with a year of believable records, and touches no
 * other company.
 *
 * Every run replaces the demo company's records: it deletes them (a DELETE
 * scoped to that company, never a TRUNCATE) and writes a fresh year dated
 * from today, all in one transaction. Before committing, it checks that every
 * row belonging to any other company is exactly as it was; if anything
 * differs, it rolls back and saves nothing. People and sign-ins stay.
 *
 * Usage (from crm_backend):
 *   npm run db:seed-demo-company -- --dry-run
 *   npm run db:seed-demo-company
 *   npm run db:seed-demo-company -- --confirm            # non-local database
 *   npm run db:seed-demo-company -- --owner-email you@example.com
 *
 * Flags:
 *   --dry-run       Do everything inside the transaction, print the counts,
 *                   then roll back. Nothing is saved.
 *   --confirm       Required to write when DATABASE_URL is not localhost.
 *   --company       Slug of the company to fill. Default: demo. Only "demo"
 *                   or "demo-…" slugs are accepted.
 *   --owner-email   The owner the records belong to. Default: the company's
 *                   oldest active owner.
 *   --tz            Time zone for working hours and appointments. Default:
 *                   DEMO_TZ, else America/Chicago.
 *
 * The company must exist: register it on the site first (company name Demo,
 * slug demo). The seed adds three team members (Maya Ortiz, Luis Brennan,
 * Dana Whitfield) with unguessable passwords, unless DEMO_TEAM_PASSWORD is
 * set when they are first created. To sign in as one, send a reset link from
 * the Users page, or run npm run user:reset-link -- --company demo --email <email>.
 */
require('dotenv').config({ quiet: true });

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const { companyScoped } = require('./lib/company-scope');
const { buildDemoPlan, TEAM, DAY } = require('./lib/demo-plan');
const {
  assertResetTables,
  clearCompanyRecords,
  otherCompaniesFingerprint,
  assertFingerprintUnchanged,
} = require('./lib/company-reset');

const DEFAULT_SLUG = 'demo';
const PLAN_SEED = 'joist-demo-v1';

function isDemoSlug(slug) {
  return (
    slug === DEFAULT_SLUG ||
    /^demo-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(slug))
  );
}

function parseArgs(argv) {
  const value = (flag) => {
    const index = argv.indexOf(flag);
    return index === -1 ? null : argv[index + 1] || null;
  };
  return {
    dryRun: argv.includes('--dry-run'),
    confirm: argv.includes('--confirm'),
    company: value('--company') || DEFAULT_SLUG,
    ownerEmail: value('--owner-email'),
    timeZone: value('--tz') || process.env.DEMO_TZ || 'America/Chicago',
  };
}

function assertTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
  } catch {
    throw new Error(
      `Unknown time zone "${timeZone}". Use an IANA name such as America/Chicago.`
    );
  }
}

function databaseHost(databaseUrl) {
  try {
    return new URL(databaseUrl).hostname.toLowerCase();
  } catch {
    throw new Error('DATABASE_URL is not a valid URL.');
  }
}

function isLocalHost(hostname) {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]'
  );
}

const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());
const sha256 = (value) =>
  crypto.createHash('sha256').update(value).digest('hex');

/** INSERT … RETURNING id, with company_id filled in. Table and column names are constants. */
async function insertRow(db, table, row) {
  const columns = Object.keys(row);
  const placeholders = columns.map((_, index) => `$${index + 1}`);
  const { rows } = await db.query(
    `INSERT INTO ${table} (company_id, ${columns.join(', ')})
     VALUES ($company, ${placeholders.join(', ')})
     RETURNING id`,
    columns.map((column) => row[column])
  );
  return rows[0].id;
}

async function findCompany(client, slug) {
  const { rows } = await client.query(
    `SELECT id, name, slug FROM companies WHERE slug = $1 FOR UPDATE`,
    [slug]
  );
  if (!rows[0]) {
    throw new Error(
      `No company with slug "${slug}". Register it on the site first (company name Demo, slug ${slug}), then rerun.`
    );
  }
  return rows[0];
}

async function findOwner(client, companyId, ownerEmail) {
  const { rows } = await client.query(
    `SELECT id, email, first_name, last_name, role, status
     FROM users
     WHERE company_id = $1 AND role = 'owner' AND status = 'active'
       AND ($2::text IS NULL OR lower(email) = lower($2))
     ORDER BY created_at ASC
     LIMIT 1`,
    [companyId, ownerEmail]
  );
  if (!rows[0]) {
    throw new Error(
      ownerEmail
        ? `${ownerEmail} is not an active owner of this company.`
        : 'This company has no active owner. Register it on the site first, then rerun.'
    );
  }
  return rows[0];
}

/** The demo team, created once and reused on every later run. */
async function ensureTeam(db, client, companyId) {
  const ids = {};
  const created = [];
  for (const member of TEAM) {
    const { rows } = await client.query(
      `SELECT id FROM users WHERE company_id = $1 AND lower(email) = lower($2)`,
      [companyId, member.email]
    );
    if (rows[0]) {
      ids[member.key] = rows[0].id;
      continue;
    }
    const password =
      process.env.DEMO_TEAM_PASSWORD || crypto.randomBytes(24).toString('hex');
    const joined = iso(Date.now() - 400 * DAY);
    ids[member.key] = await insertRow(db, 'users', {
      first_name: member.first_name,
      last_name: member.last_name,
      email: member.email,
      password_hash: await bcrypt.hash(password, 10),
      role: member.role,
      status: 'active',
      invited_at: joined,
      password_set_at: joined,
      created_at: joined,
      updated_at: joined,
    });
    created.push(member.email);
  }
  return { ids, created };
}

async function writePlan(db, plan, people) {
  const user = (key) => {
    if (!people[key]) throw new Error(`No user for "${key}".`);
    return people[key];
  };
  const byCreated = (list) =>
    [...list].sort((a, b) => a.created_at - b.created_at);
  const ids = new Map();
  const id = (key) => {
    if (!ids.has(key)) throw new Error(`Seed bug: nothing written for ${key}.`);
    return ids.get(key);
  };
  const counts = {};
  const bump = (table, n = 1) => {
    counts[table] = (counts[table] || 0) + n;
  };
  const links = {};

  for (const template of plan.estimateTemplates) {
    const templateId = await insertRow(db, 'estimate_templates', {
      name: template.name,
      description: template.description,
    });
    bump('estimate_templates');
    for (const [index, line] of template.lines.entries()) {
      await insertRow(db, 'estimate_template_line_items', {
        template_id: templateId,
        name: line.name,
        description: line.description,
        quantity: line.quantity,
        unit_price: line.unit_price,
        sort_order: index,
      });
      bump('estimate_template_line_items');
    }
  }

  for (const lead of byCreated(plan.leads)) {
    ids.set(
      lead.key,
      await insertRow(db, 'leads', {
        user_id: user(lead.creator),
        assigned_to: user(lead.assignee),
        first_name: lead.first_name,
        last_name: lead.last_name,
        email: lead.email,
        phone: lead.phone,
        source: lead.source,
        status: lead.status,
        budget_min: lead.budget_min,
        budget_max: lead.budget_max,
        notes: lead.notes,
        service_type: lead.service_type,
        preferred_contact_method: lead.preferred_contact_method,
        urgency: lead.urgency,
        created_at: iso(lead.created_at),
        updated_at: iso(lead.updated_at),
        status_changed_at: iso(lead.status_changed_at),
      })
    );
    bump('leads');
  }

  for (const event of [...plan.leadStatusEvents].sort(
    (a, b) => a.changed_at - b.changed_at
  )) {
    await insertRow(db, 'lead_status_events', {
      lead_id: id(event.lead),
      from_status: event.from_status,
      to_status: event.to_status,
      changed_at: iso(event.changed_at),
    });
    bump('lead_status_events');
  }

  for (const job of byCreated(plan.jobs)) {
    const jobId = await insertRow(db, 'jobs', {
      user_id: user(job.creator),
      assigned_to: user(job.assignee),
      lead_id: id(job.lead),
      title: job.title,
      description: job.description,
      status: job.status,
      address: job.address,
      created_at: iso(job.created_at),
      updated_at: iso(job.updated_at),
      status_changed_at: iso(job.status_changed_at),
      sold_at: iso(job.sold_at),
      work_completed_at: iso(job.work_completed_at),
      closed_at: iso(job.closed_at),
      lost_at: iso(job.lost_at),
      lost_reason: job.lost_reason,
    });
    ids.set(job.key, jobId);
    bump('jobs');
    for (const m of job.measurements) {
      await insertRow(db, 'job_measurements', {
        job_id: jobId,
        label: m.label,
        value: m.value,
        unit: m.unit,
        sort_order: m.sort_order,
        created_at: iso(m.created_at),
        updated_at: iso(m.created_at),
      });
      bump('job_measurements');
    }
    if (job.portalLink) {
      const raw = crypto.randomBytes(32).toString('hex');
      await insertRow(db, 'portal_tokens', {
        user_id: user(job.assignee),
        job_id: jobId,
        token_hash: sha256(raw),
        expires_at: iso(Date.now() + 60 * DAY),
      });
      bump('portal_tokens');
      links.portal = { job: job.title, path: `/public/portal/${raw}` };
    }
  }

  for (const event of [...plan.assignmentEvents].sort(
    (a, b) => a.assigned_at - b.assigned_at
  )) {
    await insertRow(db, 'assignment_events', {
      entity_type: event.entity_type,
      entity_id: id(event.entity),
      user_id: user(event.user),
      assigned_at: iso(event.assigned_at),
    });
    bump('assignment_events');
  }

  for (const estimate of byCreated(plan.estimates)) {
    let shareHash = null;
    if (estimate.shareLink) {
      const raw = crypto.randomBytes(32).toString('hex');
      shareHash = sha256(raw);
      links.estimate = {
        title: estimate.title,
        path: `/public/estimate/${raw}`,
      };
    }
    const estimateId = await insertRow(db, 'estimates', {
      user_id: user(estimate.creator),
      job_id: id(estimate.job),
      title: estimate.title,
      status: estimate.status,
      subtotal: estimate.subtotal,
      tax_total: estimate.tax_total,
      discount_total: estimate.discount_total,
      grand_total: estimate.grand_total,
      notes: estimate.notes,
      share_token_hash: shareHash,
      share_expires_at: shareHash ? iso(estimate.shareExpires) : null,
      client_responded_at: iso(estimate.client_responded_at),
      client_response_note: estimate.client_response_note,
      sent_at: iso(estimate.sent_at),
      approved_at: iso(estimate.approved_at),
      created_at: iso(estimate.created_at),
      updated_at: iso(estimate.updated_at),
    });
    ids.set(estimate.key, estimateId);
    bump('estimates');
    for (const line of estimate.lines) {
      await insertRow(db, 'estimate_line_items', {
        estimate_id: estimateId,
        name: line.name,
        description: line.description,
        quantity: line.quantity,
        unit_price: line.unit_price,
        line_total: line.line_total,
        sort_order: line.sort_order,
        source: 'manual',
        created_at: iso(estimate.created_at),
        updated_at: iso(estimate.created_at),
      });
      bump('estimate_line_items');
    }
  }

  for (const invoice of plan.invoices) {
    const invoiceId = await insertRow(db, 'invoices', {
      user_id: user(invoice.creator),
      job_id: id(invoice.job),
      estimate_id: id(invoice.estimate),
      invoice_number: invoice.invoice_number,
      status: invoice.status,
      kind: invoice.kind,
      subtotal: invoice.subtotal,
      tax_total: invoice.tax_total,
      discount_total: invoice.discount_total,
      prior_billed_total: invoice.prior_billed_total,
      grand_total: invoice.grand_total,
      amount_paid: invoice.amount_paid,
      due_date: iso(invoice.due_date),
      paid_at: iso(invoice.paid_at),
      notes: invoice.notes,
      sent_at: iso(invoice.sent_at),
      created_at: iso(invoice.created_at),
      updated_at: iso(invoice.updated_at),
    });
    ids.set(invoice.key, invoiceId);
    bump('invoices');
    for (const line of invoice.lines) {
      await insertRow(db, 'invoice_line_items', {
        invoice_id: invoiceId,
        name: line.name,
        description: line.description,
        quantity: line.quantity,
        unit_price: line.unit_price,
        line_total: line.line_total,
        sort_order: line.sort_order,
        created_at: iso(invoice.created_at),
        updated_at: iso(invoice.created_at),
      });
      bump('invoice_line_items');
    }
    for (const payment of invoice.payments) {
      ids.set(
        payment.key,
        await insertRow(db, 'invoice_payments', {
          invoice_id: invoiceId,
          job_id: id(invoice.job),
          recorded_by_user_id: user('owner'),
          amount: payment.amount,
          method: payment.method,
          reference: payment.reference,
          received_at: iso(payment.received_at),
          created_at: iso(payment.received_at),
        })
      );
      bump('invoice_payments');
    }
  }

  for (const task of byCreated(plan.tasks)) {
    await insertRow(db, 'tasks', {
      user_id: user(task.creator),
      assigned_to: user(task.assignee),
      lead_id: task.lead ? id(task.lead) : null,
      job_id: task.job ? id(task.job) : null,
      title: task.title,
      description: task.description,
      kind: task.kind,
      due_date: iso(task.due_date),
      end_at: iso(task.end_at),
      location: task.location,
      status: task.status,
      completed_at: iso(task.completed_at),
      created_at: iso(task.created_at),
      updated_at: iso(task.updated_at),
    });
    bump('tasks');
  }

  for (const note of byCreated(plan.notes)) {
    ids.set(
      note.key,
      await insertRow(db, 'notes', {
        user_id: user(note.author),
        entity_type: note.entity_type,
        entity_id: id(note.entity),
        body: note.body,
        type: note.type,
        direction: note.direction,
        created_at: iso(note.created_at),
        updated_at: iso(note.created_at),
      })
    );
    bump('notes');
  }

  for (const activity of byCreated(plan.activity)) {
    await insertRow(db, 'job_activity', {
      user_id: user(activity.by),
      job_id: id(activity.job),
      type: activity.type,
      title: activity.title,
      message: activity.message,
      entity_type: activity.entity.type,
      entity_id: id(activity.entity.key),
      metadata: JSON.stringify(activity.metadata),
      created_at: iso(activity.created_at),
    });
    bump('job_activity');
  }

  for (const notification of plan.notifications) {
    await insertRow(db, 'notifications', {
      user_id: user(notification.user),
      type: notification.type,
      title: notification.title,
      message: notification.message,
      entity_type: notification.entity.type,
      entity_id: id(notification.entity.key),
      dedupe_key: notification.dedupe_key,
      read_at: iso(notification.read_at),
      created_at: iso(notification.created_at),
    });
    bump('notifications');
  }

  for (const view of plan.savedViews) {
    await insertRow(db, 'saved_views', {
      user_id: user(view.user),
      entity_type: view.entity_type,
      name: view.name,
      filters: JSON.stringify(view.filters),
    });
    bump('saved_views');
  }

  for (const rule of plan.automationRules) {
    await insertRow(db, 'automation_rules', {
      user_id: user(rule.user),
      name: rule.name,
      description: rule.description,
      trigger_event: rule.trigger_event,
      conditions: JSON.stringify(rule.conditions),
      action_type: rule.action_type,
      action_config: JSON.stringify(rule.action_config),
      enabled: rule.enabled,
    });
    bump('automation_rules');
  }

  // The app's next invoice continues after the seeded ones.
  await db.query(
    `INSERT INTO company_invoice_counters (company_id, last_number)
     VALUES ($company, $1)
     ON CONFLICT (company_id) DO UPDATE SET last_number = EXCLUDED.last_number`,
    [plan.invoices.length]
  );

  return { counts, links };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is not set. Add it to .env or the environment.'
    );
  }
  if (!isDemoSlug(options.company)) {
    throw new Error(
      `Refusing company "${options.company}": this seed replaces a company's records, so it only fills "demo" or "demo-…" companies.`
    );
  }
  assertTimeZone(options.timeZone);
  const host = databaseHost(process.env.DATABASE_URL);
  if (!isLocalHost(host) && !options.confirm && !options.dryRun) {
    throw new Error(
      `Refusing to write to database host "${host}" without --confirm. Run with --dry-run first to see what it would do.`
    );
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  const started = Date.now();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    const company = await findCompany(client, options.company);
    const owner = await findOwner(client, company.id, options.ownerEmail);
    await assertResetTables(client);
    const before = await otherCompaniesFingerprint(client, company.id);

    const db = companyScoped(client, company.id);
    const removed = await clearCompanyRecords(db);
    const team = await ensureTeam(db, client, company.id);
    const plan = buildDemoPlan({
      now: new Date(),
      timeZone: options.timeZone,
      seed: PLAN_SEED,
    });
    const { counts, links } = await writePlan(db, plan, {
      owner: owner.id,
      ...team.ids,
    });

    const after = await otherCompaniesFingerprint(client, company.id);
    assertFingerprintUnchanged(before, after);

    if (options.dryRun) await client.query('ROLLBACK');
    else await client.query('COMMIT');

    const removedTotal = Object.values(removed).reduce((sum, n) => sum + n, 0);
    const base = (
      process.env.APP_BASE_URL ||
      process.env.FRONTEND_URL ||
      ''
    ).replace(/\/$/, '');
    console.log(
      `${options.dryRun ? 'Dry run (rolled back, nothing saved)' : 'Seeded'}: ${company.name} (${company.slug}) on ${host}`
    );
    console.log(
      `Owner: ${owner.first_name} ${owner.last_name} <${owner.email}>`
    );
    console.log(
      `Time zone: ${options.timeZone}. Took ${((Date.now() - started) / 1000).toFixed(1)}s.`
    );
    console.log(
      `Replaced ${removedTotal} existing demo rows${
        removedTotal
          ? ` (${Object.entries(removed)
              .map(([table, n]) => `${table} ${n}`)
              .join(', ')})`
          : ''
      }.`
    );
    if (removed.files) {
      console.log(
        '  Uploaded files lost their rows; their binaries are still in UPLOADS_DIR.'
      );
    }
    console.log('Other companies: unchanged (checked before commit).');
    console.log('');
    console.log('Wrote:', JSON.stringify(counts));
    console.log(
      'Pipeline now:',
      JSON.stringify({
        leads: plan.summary.leadStatus,
        jobs: plan.summary.jobStatus,
        invoices: plan.summary.invoiceStatus,
      })
    );
    console.log(
      `Collected over the year: $${plan.summary.collected.toLocaleString('en-US')}`
    );
    if (team.created.length) {
      console.log('');
      console.log(`New team members: ${team.created.join(', ')}`);
      console.log(
        process.env.DEMO_TEAM_PASSWORD
          ? '  Their password is DEMO_TEAM_PASSWORD.'
          : `  Their passwords are random. To sign in as one: npm run user:reset-link -- --company ${company.slug} --email <email>`
      );
    }
    if (!options.dryRun && (links.estimate || links.portal)) {
      console.log('');
      console.log('Public links (anyone with these can open them):');
      if (links.estimate)
        console.log(
          `  Estimate (${links.estimate.title}): ${base}${links.estimate.path}`
        );
      if (links.portal)
        console.log(
          `  Client portal (${links.portal.job}): ${base}${links.portal.path}`
        );
      if (!base) console.log('  Set APP_BASE_URL to print full URLs.');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`Demo seed failed: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { isDemoSlug };
