import path from 'path';

/**
 * Where uploaded files (job photos, documents, company logos) live on disk.
 *
 * `UPLOADS_DIR` when set, otherwise `uploads/` under the working directory.
 * A host keeps it outside the code checkout (docs/guide/hosting.md), so a
 * redeploy never touches it; `npm run db:backup` archives this directory,
 * and Jest points it at a temporary one so tests can never delete it.
 */
export function uploadsRoot(): string {
  const configured = process.env.UPLOADS_DIR?.trim();
  return path.resolve(configured || path.join(process.cwd(), 'uploads'));
}
