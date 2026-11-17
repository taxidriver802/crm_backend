import { z } from 'zod';
import { CONTACT_KINDS } from '../lib/contacts';
import { HISTORY_KINDS } from '../services/contacts.service';

const text = (max: number) => z.string().trim().max(max).optional().nullable();

const contactFields = z.object({
  kind: z.enum(CONTACT_KINDS).optional(),
  first_name: text(100),
  last_name: text(100),
  display_name: text(200),
  company_name: text(200),
  phone: text(50),
  email: z
    .union([z.literal(''), z.string().trim().email().max(254)])
    .optional()
    .nullable(),
  address: text(300),
  mailing_address: text(300),
  preferred_contact_method: text(50),
  source: text(100),
  assigned_to: z.string().uuid().optional().nullable(),
});

function hasAName(data: {
  first_name?: string | null;
  last_name?: string | null;
  display_name?: string | null;
  company_name?: string | null;
}) {
  return [data.first_name, data.last_name, data.display_name, data.company_name].some(
    (value) => String(value ?? '').trim() !== ''
  );
}

export const createContactSchema = contactFields.refine(hasAName, {
  message: 'A contact needs a name or a company name',
  path: ['first_name'],
});

export const updateContactSchema = contactFields.partial();

export const listContactsSchema = z.object({
  tab: z.enum(['all', 'customers', 'open_leads', 'past_customers', 'partners']).optional(),
  kind: z.enum(CONTACT_KINDS).optional(),
  assignedTo: z.union([z.literal('unassigned'), z.string().uuid()]).optional(),
  q: z.string().max(200).optional(),
  place: z.string().max(100).optional(),
  archived: z.enum(['include']).optional(),
  sort: z.enum(['last_activity', 'name', 'created']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const matchContactsSchema = z.object({
  phone: z.string().max(50).optional(),
  email: z.string().max(254).optional(),
  address: z.string().max(300).optional(),
  exclude: z.coerce.number().int().positive().optional(),
});

export const contactHistorySchema = z.object({
  kind: z.enum(HISTORY_KINDS).optional(),
  cursor: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
