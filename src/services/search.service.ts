import { pool } from '../db';

type SearchResult = {
  leads: Array<{
    id: number;
    first_name: string;
    last_name: string;
    email: string | null;
    status: string;
  }>;
  jobs: Array<{
    id: number;
    title: string;
    address: string | null;
    status: string;
  }>;
  tasks: Array<{
    id: number;
    title: string;
    status: string;
    due_date: string | null;
  }>;
  invoices: Array<{
    id: number;
    invoice_number: string;
    status: string;
    grand_total: string | number;
  }>;
  estimates: Array<{
    id: number;
    title: string;
    status: string;
    grand_total: string | number;
  }>;
  files: Array<{
    id: number;
    original_name: string;
    mime_type: string | null;
    lead_id: number | null;
    job_id: number | null;
  }>;
  users: Array<{
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    role: string;
  }>;
};

export type SearchFilters = {
  types?: string[];
  status?: string | null;
  assigned?: string | null;
  includeUsers?: boolean;
  contextType?: string | null;
  contextId?: number | null;
};

export type SearchWorkspaceResult = SearchResult & {
  related: SearchResult;
};

const ALL_TYPES = [
  'leads',
  'jobs',
  'tasks',
  'invoices',
  'estimates',
  'files',
  'users',
] as const;

function emptyResult(): SearchResult {
  return {
    leads: [],
    jobs: [],
    tasks: [],
    invoices: [],
    estimates: [],
    files: [],
    users: [],
  };
}

function wantsType(types: string[] | undefined, type: string) {
  if (!types || types.length === 0) return true;
  return types.includes(type);
}

async function searchRelatedContext(
  userId: string,
  contextType: string,
  contextId: number,
  query: string,
  limitPerType: number
): Promise<SearchResult> {
  const related = emptyResult();
  const trimmed = query.trim();
  const term = trimmed ? `%${trimmed}%` : null;
  const jobs: Array<Promise<void>> = [];

  if (contextType === 'job') {
    jobs.push(
      (async () => {
        const params: unknown[] = [userId, contextId];
        const where = ['user_id = $1', 'job_id = $2'];
        if (term) {
          params.push(term);
          where.push(
            `(title ILIKE $${params.length} OR description ILIKE $${params.length})`
          );
        }
        params.push(limitPerType);
        const { rows } = await pool.query(
          `
          SELECT id, title, status, due_date
          FROM tasks
          WHERE ${where.join(' AND ')}
          ORDER BY updated_at DESC, id DESC
          LIMIT $${params.length}
          `,
          params
        );
        related.tasks = rows;
      })(),
      (async () => {
        const params: unknown[] = [userId, contextId];
        const where = ['uploaded_by_user_id = $1', 'job_id = $2'];
        if (term) {
          params.push(term);
          where.push(
            `(original_name ILIKE $${params.length} OR caption ILIKE $${params.length})`
          );
        }
        params.push(limitPerType);
        const { rows } = await pool.query(
          `
          SELECT id, original_name, mime_type, lead_id, job_id
          FROM files
          WHERE ${where.join(' AND ')}
          ORDER BY created_at DESC, id DESC
          LIMIT $${params.length}
          `,
          params
        );
        related.files = rows;
      })(),
      (async () => {
        const params: unknown[] = [userId, contextId];
        const where = ['user_id = $1', 'job_id = $2'];
        if (term) {
          params.push(term);
          where.push(
            `(invoice_number ILIKE $${params.length} OR notes ILIKE $${params.length} OR status ILIKE $${params.length})`
          );
        }
        params.push(limitPerType);
        const { rows } = await pool.query(
          `
          SELECT id, invoice_number, status, grand_total
          FROM invoices
          WHERE ${where.join(' AND ')}
          ORDER BY updated_at DESC, id DESC
          LIMIT $${params.length}
          `,
          params
        );
        related.invoices = rows;
      })(),
      (async () => {
        const params: unknown[] = [userId, contextId];
        const where = ['user_id = $1', 'job_id = $2'];
        if (term) {
          params.push(term);
          where.push(
            `(title ILIKE $${params.length} OR notes ILIKE $${params.length} OR status ILIKE $${params.length})`
          );
        }
        params.push(limitPerType);
        const { rows } = await pool.query(
          `
          SELECT id, title, status, grand_total
          FROM estimates
          WHERE ${where.join(' AND ')}
          ORDER BY updated_at DESC, id DESC
          LIMIT $${params.length}
          `,
          params
        );
        related.estimates = rows;
      })()
    );
  }

  if (contextType === 'lead') {
    jobs.push(
      (async () => {
        const params: unknown[] = [userId, contextId];
        const where = ['user_id = $1', 'lead_id = $2'];
        if (term) {
          params.push(term);
          where.push(
            `(title ILIKE $${params.length} OR description ILIKE $${params.length} OR address ILIKE $${params.length})`
          );
        }
        params.push(limitPerType);
        const { rows } = await pool.query(
          `
          SELECT id, title, address, status
          FROM jobs
          WHERE ${where.join(' AND ')}
          ORDER BY updated_at DESC, id DESC
          LIMIT $${params.length}
          `,
          params
        );
        related.jobs = rows;
      })(),
      (async () => {
        const params: unknown[] = [userId, contextId];
        const where = ['user_id = $1', 'lead_id = $2'];
        if (term) {
          params.push(term);
          where.push(
            `(title ILIKE $${params.length} OR description ILIKE $${params.length})`
          );
        }
        params.push(limitPerType);
        const { rows } = await pool.query(
          `
          SELECT id, title, status, due_date
          FROM tasks
          WHERE ${where.join(' AND ')}
          ORDER BY updated_at DESC, id DESC
          LIMIT $${params.length}
          `,
          params
        );
        related.tasks = rows;
      })(),
      (async () => {
        const params: unknown[] = [userId, contextId];
        const where = ['uploaded_by_user_id = $1', 'lead_id = $2'];
        if (term) {
          params.push(term);
          where.push(
            `(original_name ILIKE $${params.length} OR caption ILIKE $${params.length})`
          );
        }
        params.push(limitPerType);
        const { rows } = await pool.query(
          `
          SELECT id, original_name, mime_type, lead_id, job_id
          FROM files
          WHERE ${where.join(' AND ')}
          ORDER BY created_at DESC, id DESC
          LIMIT $${params.length}
          `,
          params
        );
        related.files = rows;
      })()
    );
  }

  await Promise.all(jobs);
  return related;
}

export async function searchWorkspace(
  userId: string,
  query: string,
  limitPerType = 5,
  options: SearchFilters = {}
): Promise<SearchWorkspaceResult> {
  const trimmed = query.trim();
  const term = trimmed ? `%${trimmed}%` : null;
  const {
    includeUsers = false,
    status = null,
    assigned = null,
    contextType = null,
    contextId = null,
  } = options;
  const types = (options.types || [])
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  const assignedToMe = assigned === 'me';
  const statusTerm = status ? `%${status}%` : null;

  const result = emptyResult();
  const shouldRunGlobal = Boolean(term || status || assigned || types.length > 0);

  const tasks: Array<Promise<void>> = [];

  if (shouldRunGlobal && wantsType(types, 'leads')) {
    tasks.push(
      (async () => {
        const params: unknown[] = [userId];
        const where = ['user_id = $1'];

        if (term) {
          params.push(term);
          where.push(
            `(first_name ILIKE $${params.length} OR last_name ILIKE $${params.length} OR email ILIKE $${params.length} OR phone ILIKE $${params.length})`
          );
        }
        if (statusTerm) {
          params.push(statusTerm);
          where.push(`status ILIKE $${params.length}`);
        }
        if (assignedToMe) {
          params.push(userId);
          where.push(`assigned_to = $${params.length}`);
        }

        params.push(limitPerType);
        const { rows } = await pool.query(
          `
          SELECT id, first_name, last_name, email, status
          FROM leads
          WHERE ${where.join(' AND ')}
          ORDER BY updated_at DESC, id DESC
          LIMIT $${params.length}
          `,
          params
        );
        result.leads = rows;
      })()
    );
  }

  if (shouldRunGlobal && wantsType(types, 'jobs')) {
    tasks.push(
      (async () => {
        const params: unknown[] = [userId];
        const where = ['user_id = $1'];

        if (term) {
          params.push(term);
          where.push(
            `(title ILIKE $${params.length} OR description ILIKE $${params.length} OR address ILIKE $${params.length})`
          );
        }
        if (statusTerm) {
          params.push(statusTerm);
          where.push(`status ILIKE $${params.length}`);
        }
        if (assignedToMe) {
          params.push(userId);
          where.push(`assigned_to = $${params.length}`);
        }

        params.push(limitPerType);
        const { rows } = await pool.query(
          `
          SELECT id, title, address, status
          FROM jobs
          WHERE ${where.join(' AND ')}
          ORDER BY updated_at DESC, id DESC
          LIMIT $${params.length}
          `,
          params
        );
        result.jobs = rows;
      })()
    );
  }

  if (shouldRunGlobal && wantsType(types, 'tasks')) {
    tasks.push(
      (async () => {
        const params: unknown[] = [userId];
        const where = ['user_id = $1'];

        if (term) {
          params.push(term);
          where.push(
            `(title ILIKE $${params.length} OR description ILIKE $${params.length})`
          );
        }
        if (statusTerm) {
          params.push(statusTerm);
          where.push(`status ILIKE $${params.length}`);
        }
        if (assignedToMe) {
          params.push(userId);
          where.push(`assigned_to = $${params.length}`);
        }

        params.push(limitPerType);
        const { rows } = await pool.query(
          `
          SELECT id, title, status, due_date
          FROM tasks
          WHERE ${where.join(' AND ')}
          ORDER BY updated_at DESC, id DESC
          LIMIT $${params.length}
          `,
          params
        );
        result.tasks = rows;
      })()
    );
  }

  if (shouldRunGlobal && wantsType(types, 'invoices')) {
    tasks.push(
      (async () => {
        const params: unknown[] = [userId];
        const where = ['user_id = $1'];

        if (term) {
          params.push(term);
          where.push(
            `(invoice_number ILIKE $${params.length} OR notes ILIKE $${params.length} OR status ILIKE $${params.length})`
          );
        }
        if (statusTerm) {
          params.push(statusTerm);
          where.push(`status ILIKE $${params.length}`);
        }

        params.push(limitPerType);
        const { rows } = await pool.query(
          `
          SELECT id, invoice_number, status, grand_total
          FROM invoices
          WHERE ${where.join(' AND ')}
          ORDER BY updated_at DESC, id DESC
          LIMIT $${params.length}
          `,
          params
        );
        result.invoices = rows;
      })()
    );
  }

  if (shouldRunGlobal && wantsType(types, 'estimates')) {
    tasks.push(
      (async () => {
        const params: unknown[] = [userId];
        const where = ['user_id = $1'];

        if (term) {
          params.push(term);
          where.push(
            `(title ILIKE $${params.length} OR notes ILIKE $${params.length} OR status ILIKE $${params.length})`
          );
        }
        if (statusTerm) {
          params.push(statusTerm);
          where.push(`status ILIKE $${params.length}`);
        }

        params.push(limitPerType);
        const { rows } = await pool.query(
          `
          SELECT id, title, status, grand_total
          FROM estimates
          WHERE ${where.join(' AND ')}
          ORDER BY updated_at DESC, id DESC
          LIMIT $${params.length}
          `,
          params
        );
        result.estimates = rows;
      })()
    );
  }

  if (shouldRunGlobal && wantsType(types, 'files')) {
    tasks.push(
      (async () => {
        const params: unknown[] = [userId];
        const where = ['uploaded_by_user_id = $1'];

        if (term) {
          params.push(term);
          where.push(
            `(original_name ILIKE $${params.length} OR caption ILIKE $${params.length} OR category ILIKE $${params.length} OR mime_type ILIKE $${params.length})`
          );
        }

        params.push(limitPerType);
        const { rows } = await pool.query(
          `
          SELECT id, original_name, mime_type, lead_id, job_id
          FROM files
          WHERE ${where.join(' AND ')}
          ORDER BY created_at DESC, id DESC
          LIMIT $${params.length}
          `,
          params
        );
        result.files = rows;
      })()
    );
  }

  if (shouldRunGlobal && includeUsers && wantsType(types, 'users')) {
    tasks.push(
      (async () => {
        const params: unknown[] = [];
        const where = [`status = 'active'`];

        if (term) {
          params.push(term);
          where.push(
            `(first_name ILIKE $${params.length} OR last_name ILIKE $${params.length} OR email ILIKE $${params.length} OR role ILIKE $${params.length})`
          );
        }

        params.push(limitPerType);
        const { rows } = await pool.query(
          `
          SELECT id, first_name, last_name, email, role
          FROM users
          WHERE ${where.join(' AND ')}
          ORDER BY last_name ASC, first_name ASC, id ASC
          LIMIT $${params.length}
          `,
          params
        );
        result.users = rows;
      })()
    );
  }

  if (shouldRunGlobal) {
    await Promise.all(tasks);
  }

  let related = emptyResult();
  if (contextType && contextId && Number.isFinite(contextId)) {
    related = await searchRelatedContext(
      userId,
      contextType,
      contextId,
      trimmed,
      limitPerType
    );
  }

  return { ...result, related };
}

export const SEARCH_ENTITY_TYPES = ALL_TYPES;
