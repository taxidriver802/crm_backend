import type { Request } from 'express';
import { pool } from '../db';

export type TenantScope = {
  userId: string;
  companyId: string;
  includeAll: boolean;
};

export class MissingCompanyError extends Error {
  constructor(message = 'Authenticated user is missing company context') {
    super(message);
    this.name = 'MissingCompanyError';
  }
}

export function canViewAll(role?: string) {
  return role === 'owner' || role === 'admin';
}

export async function resolveCompanyId(
  userId: string,
  companyId?: string | null
): Promise<string> {
  if (companyId) return companyId;
  const result = await pool.query(
    `SELECT company_id FROM users WHERE id = $1 LIMIT 1`,
    [userId]
  );
  const resolved = result.rows[0]?.company_id as string | undefined;
  if (!resolved) {
    throw new MissingCompanyError();
  }
  return resolved;
}

export async function tenantScope(
  userId: string,
  options: { companyId?: string | null; includeAll?: boolean } = {}
): Promise<TenantScope> {
  return {
    userId,
    companyId: await resolveCompanyId(userId, options.companyId),
    includeAll: Boolean(options.includeAll),
  };
}

export function requestScope(
  req: Request,
  includeAllRequested = false
): TenantScope {
  const user = req.user;
  if (!user?.userId || !user.companyId) {
    throw new MissingCompanyError();
  }
  return {
    userId: user.userId,
    companyId: user.companyId,
    includeAll: includeAllRequested && canViewAll(user.role),
  };
}

export type TenantScopeOptions = {
  alias?: string;
  userColumn?: string;
  companyColumn?: string;
  /**
   * Personal view matches work assigned to the user, plus unassigned
   * records that user created. Team view (includeAll) stays company-wide.
   */
  assignedWork?: boolean;
  assigneeColumn?: string;
  /**
   * Company match only. Use after a parent-access check so children on
   * that record are visible without widening every list.
   */
  companyOnly?: boolean;
};

/** Always includes company_id. Adds a personal filter unless includeAll or companyOnly. */
export function applyTenantScope(
  where: string[],
  params: unknown[],
  scope: TenantScope,
  opts?: TenantScopeOptions
) {
  const prefix = opts?.alias ? `${opts.alias}.` : '';
  params.push(scope.companyId);
  where.push(
    `${prefix}${opts?.companyColumn ?? 'company_id'} = $${params.length}`
  );
  if (scope.includeAll || opts?.companyOnly) return;

  params.push(scope.userId);
  const userParam = `$${params.length}`;
  if (opts?.assignedWork) {
    const assignee = `${prefix}${opts.assigneeColumn ?? 'assigned_to'}`;
    const creator = `${prefix}${opts.userColumn ?? 'user_id'}`;
    where.push(
      `(${assignee} = ${userParam} OR (${assignee} IS NULL AND ${creator} = ${userParam}))`
    );
    return;
  }

  where.push(`${prefix}${opts?.userColumn ?? 'user_id'} = ${userParam}`);
}

/**
 * Creator of the row, or a user who can see the parent job via assignment.
 * Team view stays company-wide.
 */
export function applyOwnOrAssignedJob(
  where: string[],
  params: unknown[],
  scope: TenantScope,
  opts?: { alias?: string; jobColumn?: string }
) {
  const prefix = opts?.alias ? `${opts.alias}.` : '';
  params.push(scope.companyId);
  const companyParam = `$${params.length}`;
  where.push(`${prefix}company_id = ${companyParam}`);
  if (scope.includeAll) return;

  params.push(scope.userId);
  const userParam = `$${params.length}`;
  const jobColumn = `${prefix}${opts?.jobColumn ?? 'job_id'}`;
  where.push(
    `(${prefix}user_id = ${userParam} OR EXISTS (
      SELECT 1 FROM jobs parent_job
      WHERE parent_job.id = ${jobColumn}
        AND parent_job.company_id = ${companyParam}
        AND (
          parent_job.assigned_to = ${userParam}
          OR (parent_job.assigned_to IS NULL AND parent_job.user_id = ${userParam})
        )
    ))`
  );
}

const ASSIGNED_TABLES = new Set(['leads', 'jobs', 'tasks']);

export async function assignedRecordVisible(
  table: 'leads' | 'jobs' | 'tasks',
  id: number,
  scope: TenantScope
): Promise<boolean> {
  if (!ASSIGNED_TABLES.has(table)) return false;
  const params: unknown[] = [id];
  const where = ['id = $1'];
  applyTenantScope(where, params, scope, { assignedWork: true });
  const result = await pool.query(
    `SELECT 1 FROM ${table} WHERE ${where.join(' AND ')} LIMIT 1`,
    params
  );
  return (result.rowCount ?? 0) > 0;
}

export function tenantPredicate(
  params: unknown[],
  scope: TenantScope,
  opts?: TenantScopeOptions
) {
  const where: string[] = [];
  applyTenantScope(where, params, scope, opts);
  return where.join(' AND ');
}
