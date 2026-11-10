import fs from 'fs';
import path from 'path';
import { absoluteUploadPath } from '../services/files.service';

/**
 * Where a company's logo file lives.
 *
 * Uploaded logos are `<companyId>/<file>` under uploads/ (runtime data, not in
 * git). A logo that ships with the code — today only Rooftop Realty's — is
 * `builtin/<file>` and lives in assets/company-logos/. It is referenced from
 * that company's row like any upload, so it is that company's logo and
 * nobody else's. Built-in files are never deleted: replacing or clearing the
 * logo only changes the row.
 */
export const BUILTIN_LOGO_PREFIX = 'builtin/';

const BUILTIN_LOGO_DIR = path.resolve(__dirname, '..', '..', 'assets', 'company-logos');

export function isBuiltinLogoKey(storageKey: string | null | undefined) {
  return typeof storageKey === 'string' && storageKey.startsWith(BUILTIN_LOGO_PREFIX);
}

/** Absolute path of a logo's file. Throws when the key escapes its folder. */
export function companyLogoPath(storageKey: string) {
  if (!isBuiltinLogoKey(storageKey)) return absoluteUploadPath(storageKey);

  const name = storageKey.slice(BUILTIN_LOGO_PREFIX.length);
  const resolved = path.resolve(BUILTIN_LOGO_DIR, name);
  const relative = path.relative(BUILTIN_LOGO_DIR, resolved);
  if (!name || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Logo not found');
  }
  return resolved;
}

/** Delete an uploaded logo's file. A built-in logo's file is left alone. */
export function removeUploadedLogo(storageKey: string | null | undefined) {
  if (!storageKey || isBuiltinLogoKey(storageKey)) return;
  try {
    const filePath = absoluteUploadPath(storageKey);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // a missing or out-of-bounds file is already gone
  }
}
