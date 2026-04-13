import { z } from 'zod';

export const savedViewEntitySchema = z.enum(['leads', 'jobs', 'tasks']);

export const createSavedViewSchema = z.object({
  entity_type: savedViewEntitySchema,
  name: z.string().trim().min(1).max(80),
  filters: z.record(z.string(), z.unknown()).default({}),
});

export const updateSavedViewSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
});
