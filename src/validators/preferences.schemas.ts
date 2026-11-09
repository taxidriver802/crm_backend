import { z } from 'zod';
import { COMPANY_PALETTE_IDS } from '../lib/companySlug';

/**
 * Shape of a workspace preference document.
 *
 * The frontend owns the meaning of navigation ids, widget ids, list column ids
 * and record section ids; the backend bounds them (length, count, character
 * set) so a preference document can never grow without limit or carry markup.
 * Unknown top-level sections are rejected so typos surface instead of being
 * silently stored.
 */

const token = z
  .string()
  .min(1)
  .max(48)
  .regex(/^[a-z0-9][a-z0-9_.:-]*$/i, 'Use letters, numbers, dot, dash, colon or underscore');

export const NAV_ITEM_IDS = [
  'today',
  'inbox',
  'leads',
  'jobs',
  'tasks',
  'money',
  'files',
  'reports',
  'templates',
  'automation',
  'integrations',
  'team',
] as const;

export const HOME_WIDGET_IDS = [
  'agenda',
  'needs-you',
  'money',
  'pipeline',
  'handoffs',
  'team',
  'activity',
  'pinned',
] as const;

export const LIST_KEYS = ['jobs', 'leads', 'tasks', 'invoices'] as const;
export const RECORD_KEYS = ['job', 'lead', 'estimate', 'invoice'] as const;
export const PIN_KINDS = ['job', 'lead', 'task', 'invoice', 'estimate', 'view'] as const;

const appearanceSchema = z
  .object({
    theme: z.enum(['light', 'dark', 'system']).optional(),
    palette: z.enum(COMPANY_PALETTE_IDS).nullable().optional(),
    density: z.enum(['comfortable', 'compact']).optional(),
    reduceMotion: z.boolean().optional(),
  })
  .strict();

const pinSchema = z
  .object({
    id: z.string().min(1).max(80),
    kind: z.enum(PIN_KINDS),
    label: z.string().trim().min(1).max(120),
    href: z
      .string()
      .min(1)
      .max(300)
      .regex(/^\/(?!\/)/, 'Pins must link inside the app'),
  })
  .strict();

const navSchema = z
  .object({
    order: z.array(z.enum(NAV_ITEM_IDS)).max(NAV_ITEM_IDS.length).optional(),
    hidden: z.array(z.enum(NAV_ITEM_IDS)).max(NAV_ITEM_IDS.length).optional(),
    collapsed: z.boolean().optional(),
    pins: z.array(pinSchema).max(20).optional(),
  })
  .strict();

const homeSchema = z
  .object({
    widgets: z
      .array(
        z
          .object({
            id: z.enum(HOME_WIDGET_IDS),
            column: z.enum(['main', 'side']),
            hidden: z.boolean().optional(),
          })
          .strict()
      )
      .max(HOME_WIDGET_IDS.length)
      .optional(),
  })
  .strict();

const listSchema = z
  .object({
    columns: z.array(token).max(24).optional(),
    sort: z
      .object({ key: token, dir: z.enum(['asc', 'desc']) })
      .strict()
      .nullable()
      .optional(),
    view: z.enum(['table', 'board', 'calendar']).optional(),
  })
  .strict();

const recordSchema = z
  .object({
    tab: token.optional(),
    sections: z
      .array(z.object({ id: token, hidden: z.boolean().optional() }).strict())
      .max(16)
      .optional(),
    rail: z.boolean().optional(),
  })
  .strict();

export const preferencesSchema = z
  .object({
    appearance: appearanceSchema.optional(),
    nav: navSchema.optional(),
    home: homeSchema.optional(),
    lists: z.partialRecord(z.enum(LIST_KEYS), listSchema).optional(),
    records: z.partialRecord(z.enum(RECORD_KEYS), recordSchema).optional(),
  })
  .strict();

/**
 * A PATCH carries any subset of sections. A section set to null is cleared,
 * which returns that part of the workspace to the company default.
 */
export const preferencesPatchSchema = z
  .object({
    appearance: appearanceSchema.nullable().optional(),
    nav: navSchema.nullable().optional(),
    home: homeSchema.nullable().optional(),
    lists: z.partialRecord(z.enum(LIST_KEYS), listSchema.nullable()).nullable().optional(),
    records: z
      .partialRecord(z.enum(RECORD_KEYS), recordSchema.nullable())
      .nullable()
      .optional(),
  })
  .strict();

export type Preferences = z.infer<typeof preferencesSchema>;
export type PreferencesPatch = z.infer<typeof preferencesPatchSchema>;
