import { z } from 'zod';

export const createLeadSchema = z.object({
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
});

export const updateLeadSchema = createLeadSchema.partial();
