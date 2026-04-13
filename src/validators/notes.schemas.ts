import { z } from 'zod';

const entityTypeSchema = z.enum(['lead', 'job']);

export const createNoteSchema = z.object({
  entity_type: entityTypeSchema,
  entity_id: z.number().int().positive(),
  body: z.string().trim().min(1).max(2000),
});

export const listNotesSchema = z.object({
  entity_type: entityTypeSchema,
  entity_id: z.number().int().positive(),
});
