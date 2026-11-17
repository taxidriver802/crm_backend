import { z } from 'zod';

const leadFields = z.object({
  assigned_to: z.string().uuid().optional().nullable(),
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  source: z.string().optional().nullable(),
  status: z.string().optional().nullable(),
  budget_min: z.number().optional().nullable(),
  budget_max: z.number().optional().nullable(),
  notes: z.string().optional().nullable(),
  service_type: z.string().optional().nullable(),
  preferred_contact_method: z.string().optional().nullable(),
  urgency: z.string().optional().nullable(),
});

/**
 * A new inquiry: either from an existing contact (contact_id), or from a
 * person typed in, which makes a contact (first and last name required, and
 * optionally their home address).
 */
export const createLeadSchema = leadFields
  .partial({ first_name: true, last_name: true })
  .extend({
    contact_id: z.number().int().positive().optional().nullable(),
    address: z.string().trim().max(300).optional().nullable(),
  })
  .refine(
    (data) => data.contact_id != null || (Boolean(data.first_name) && Boolean(data.last_name)),
    { message: 'First and last name are required for a new contact', path: ['first_name'] }
  );

export const updateLeadSchema = leadFields.partial();
