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

/** Always includes company_id. Adds the user column unless includeAll. */
export function applyTenantScope(
  where: string[],
  params: unknown[],
  scope: TenantScope,
  opts?: { alias?: string; userColumn?: string; companyColumn?: string }
) {
  const prefix = opts?.alias ? `${opts.alias}.` : '';
  params.push(scope.companyId);
  where.push(
    `${prefix}${opts?.companyColumn ?? 'company_id'} = $${params.length}`
  );
  if (!scope.includeAll) {
    params.push(scope.userId);
    where.push(
      `${prefix}${opts?.userColumn ?? 'user_id'} = $${params.length}`
    );
  }
}

export function tenantPredicate(
  params: unknown[],
  scope: TenantScope,
  opts?: { alias?: string; userColumn?: string; companyColumn?: string }
) {
  const where: string[] = [];
  applyTenantScope(where, params, scope, opts);
  return where.join(' AND ');
}
