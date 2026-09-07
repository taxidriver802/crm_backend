import crypto from 'crypto';
import { pool } from '../db';
import { createNotification } from '../lib/notifications';
import { createLead } from './leads.service';
import { createNote } from './notes.service';
import { env } from '../config/env';

export class IntakeTokenNotFoundError extends Error {
  constructor(message = 'Intake link not found') {
    super(message);
    this.name = 'IntakeTokenNotFoundError';
  }
}

export class IntakeDisabledError extends Error {
  constructor(message = 'Intake link is disabled') {
    super(message);
    this.name = 'IntakeDisabledError';
  }
}

export type PublicIntakeSubmitInput = {
  first_name: string;
  last_name: string;
  email?: string | null;
  phone?: string | null;
  service_type?: string | null;
  preferred_contact_method?: string | null;
  message?: string | null;
  company_website?: string | null;
};

function sha256(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function blankToNull(value?: string | null) {
  const trimmed = String(value ?? '').trim();
  return trimmed ? trimmed : null;
}

function publicIntakeUrl(rawToken: string) {
  return `${env.frontendUrl.replace(/\/$/, '')}/public/intake/${rawToken}`;
}

async function upsertIntakeToken(userId: string) {
  const raw = crypto.randomBytes(32).toString('hex');
  const hash = sha256(raw);

  const existing = await pool.query(
    `SELECT id FROM intake_tokens WHERE singleton = TRUE LIMIT 1`
  );

  if ((existing.rowCount ?? 0) > 0) {
    await pool.query(
      `
      UPDATE intake_tokens
      SET user_id = $1,
          token_hash = $2,
          enabled = TRUE,
          updated_at = CURRENT_TIMESTAMP
      WHERE singleton = TRUE
      `,
      [userId, hash]
    );
  } else {
    await pool.query(
      `
      INSERT INTO intake_tokens (user_id, token_hash, enabled, singleton)
      VALUES ($1, $2, TRUE, TRUE)
      `,
      [userId, hash]
    );
  }

  return {
    token: raw,
    enabled: true,
    public_url: publicIntakeUrl(raw),
  };
}

export async function generateIntakeToken(userId: string) {
  return upsertIntakeToken(userId);
}

export async function regenerateIntakeToken(userId: string) {
  return upsertIntakeToken(userId);
}

export async function getIntakeStatus(userId: string) {
  const result = await pool.query(
    `
    SELECT id, user_id, enabled, created_at, updated_at
    FROM intake_tokens
    WHERE singleton = TRUE
    LIMIT 1
    `
  );

  if (result.rowCount === 0) {
    return {
      configured: false,
      enabled: false,
      public_url: null as string | null,
      owned_by_current_user: false,
      created_at: null as string | null,
      updated_at: null as string | null,
    };
  }

  const row = result.rows[0];
  return {
    configured: true,
    enabled: Boolean(row.enabled),
    // Raw token is never stored; URL only available at generate/regenerate time
    public_url: null as string | null,
    owned_by_current_user: row.user_id === userId,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function disableIntakeToken(userId: string) {
  const result = await pool.query(
    `
    UPDATE intake_tokens
    SET enabled = FALSE, updated_at = CURRENT_TIMESTAMP
    WHERE singleton = TRUE
    RETURNING id
    `
  );
  if (result.rowCount === 0) {
    throw new IntakeTokenNotFoundError();
  }
  return { enabled: false };
}

export async function enableIntakeToken(userId: string) {
  const result = await pool.query(
    `
    UPDATE intake_tokens
    SET enabled = TRUE,
        user_id = $1,
        updated_at = CURRENT_TIMESTAMP
    WHERE singleton = TRUE
    RETURNING id
    `,
    [userId]
  );
  if (result.rowCount === 0) {
    throw new IntakeTokenNotFoundError();
  }
  return { enabled: true };
}

async function resolveIntakeToken(rawToken: string) {
  const hash = sha256(String(rawToken).trim());
  const result = await pool.query(
    `
    SELECT id, user_id, enabled
    FROM intake_tokens
    WHERE token_hash = $1
    LIMIT 1
    `,
    [hash]
  );
  if (result.rowCount === 0) {
    throw new IntakeTokenNotFoundError();
  }
  const row = result.rows[0];
  if (!row.enabled) {
    throw new IntakeDisabledError();
  }
  return row;
}

/**
 * Public intake submit. Returns { ok: true, ignored?: true }.
 * Honeypot hits return success without writing.
 */
export async function submitPublicIntake(
  rawToken: string,
  input: PublicIntakeSubmitInput
) {
  // Honeypot: pretend success
  if (String(input.company_website || '').trim()) {
    return { ok: true, ignored: true };
  }

  const tokenRow = await resolveIntakeToken(rawToken);
  const ownerId = String(tokenRow.user_id);

  const email = blankToNull(input.email);
  const phone = blankToNull(input.phone);
  const message = blankToNull(input.message);

  const lead = await createLead(
    ownerId,
    {
      first_name: input.first_name.trim(),
      last_name: input.last_name.trim(),
      email,
      phone,
      source: 'Website',
      status: 'New',
      service_type: blankToNull(input.service_type),
      preferred_contact_method: blankToNull(input.preferred_contact_method),
    },
    { role: 'owner' }
  );

  if (message) {
    await createNote(ownerId, {
      entity_type: 'lead',
      entity_id: lead.id,
      body: message,
      type: 'note',
      direction: 'inbound',
    });
  }

  const contactBits = [email, phone].filter(Boolean).join(' · ');
  await createNotification({
    userId: ownerId,
    type: 'LEAD_CREATED',
    title: 'New website lead',
    message: `${lead.first_name} ${lead.last_name}${
      contactBits ? ` — ${contactBits}` : ''
    }`.trim(),
    entityType: 'lead',
    entityId: lead.id,
    metadata: {
      source: 'Website',
      intake: true,
    },
  });

  return { ok: true, lead_id: lead.id };
}
