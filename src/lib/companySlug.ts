import { pool } from '../db';

export const COMPANY_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const COMPANY_PALETTE_IDS = [
  'rooftop',
  'azure',
  'slate',
  'emerald',
  'violet',
  'rose',
  'sand',
  'graphite',
] as const;

export const COMPANY_MARK_IDS = [
  'product',
  'home',
  'briefcase',
  'spark',
  'users',
  'invoice',
] as const;

export const DEFAULT_COMPANY_PALETTE_ID = 'rooftop';
export const DEFAULT_COMPANY_MARK_ID = 'product';

export type CompanyPaletteId = (typeof COMPANY_PALETTE_IDS)[number];
export type CompanyMarkId = (typeof COMPANY_MARK_IDS)[number];

export function isCompanyPaletteId(id: unknown): id is CompanyPaletteId {
  return (
    typeof id === 'string' &&
    (COMPANY_PALETTE_IDS as readonly string[]).includes(id)
  );
}

export function isCompanyMarkId(id: unknown): id is CompanyMarkId {
  return (
    typeof id === 'string' && (COMPANY_MARK_IDS as readonly string[]).includes(id)
  );
}

export function slugifyCompanyName(input: string): string {
  const slug = String(input || '')
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
    .replace(/-$/g, '');

  return slug;
}

export function isPgUniqueViolation(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}

type Queryable = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

export async function insertCompanyWithSlug(
  client: Queryable,
  input: {
    name: string;
    slug: string;
    exactSlug: boolean;
    palette_id?: string;
    mark_id?: string;
  }
) {
  const palette_id = isCompanyPaletteId(input.palette_id)
    ? input.palette_id
    : DEFAULT_COMPANY_PALETTE_ID;
  const mark_id = isCompanyMarkId(input.mark_id)
    ? input.mark_id
    : DEFAULT_COMPANY_MARK_ID;
  const maxAttempts = input.exactSlug ? 1 : 30;

  for (let i = 0; i < maxAttempts; i++) {
    const suffix = i === 0 ? '' : `-${i + 1}`;
    const maxBase = Math.max(1, 60 - suffix.length);
    const candidate =
      i === 0 ? input.slug.slice(0, 60) : `${input.slug.slice(0, maxBase)}${suffix}`;

    if (!COMPANY_SLUG_RE.test(candidate)) {
      continue;
    }

    try {
      const { rows } = await client.query(
        `
        INSERT INTO companies (name, slug, palette_id, mark_id)
        VALUES ($1, $2, $3, $4)
        RETURNING id, name, slug, palette_id, mark_id, logo_storage_key
        `,
        [input.name, candidate, palette_id, mark_id]
      );
      return rows[0] as {
        id: string;
        name: string;
        slug: string;
        palette_id: string;
        mark_id: string;
        logo_storage_key: string | null;
      };
    } catch (error) {
      if (isPgUniqueViolation(error) && i < maxAttempts - 1) {
        continue;
      }
      throw error;
    }
  }

  const conflict = new Error('Company slug already in use');
  (conflict as Error & { status: number }).status = 409;
  throw conflict;
}

export function publicCompany(row: {
  id: string;
  name: string;
  slug: string;
  palette_id: string;
  mark_id?: string | null;
  logo_storage_key?: string | null;
}) {
  const mark_id = isCompanyMarkId(row.mark_id)
    ? row.mark_id
    : DEFAULT_COMPANY_MARK_ID;
  const palette_id = isCompanyPaletteId(row.palette_id)
    ? row.palette_id
    : DEFAULT_COMPANY_PALETTE_ID;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    palette_id,
    mark_id,
    logo_url: row.logo_storage_key
      ? `/public/companies/${row.slug}/logo`
      : null,
  };
}

/** Public branding payload: no company id. */
export function publicCompanyBranding(
  row: Parameters<typeof publicCompany>[0]
) {
  const { id: _id, ...branding } = publicCompany(row);
  return branding;
}

export async function loadPublicBrandingByCompanyId(companyId: string) {
  const result = await pool.query(
    `
    SELECT id, name, slug, palette_id, mark_id, logo_storage_key
    FROM companies
    WHERE id = $1
    LIMIT 1
    `,
    [companyId]
  );
  return result.rows[0] ? publicCompanyBranding(result.rows[0]) : null;
}
