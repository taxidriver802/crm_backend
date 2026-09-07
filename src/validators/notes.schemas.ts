import { z } from 'zod';

const entityTypeSchema = z.enum(['lead', 'job']);

export const NOTE_TYPES = ['call', 'text', 'email', 'in_person', 'note'] as const;
export const NOTE_DIRECTIONS = ['inbound', 'outbound', 'internal'] as const;

export const createNoteSchema = z.object({
  entity_type: entityTypeSchema,
  entity_id: z.coerce.number().int().positive(),
  body: z.string().trim().min(1).max(2000),
  type: z.enum(NOTE_TYPES).optional().default('note'),
  direction: z.enum(NOTE_DIRECTIONS).optional().default('internal'),
  follow_up_date: z.preprocess(
    (value) => (value === '' || value === null ? undefined : value),
    z.string().min(1).optional()
  ),
});

export const listNotesSchema = z.object({
  entity_type: entityTypeSchema,
  entity_id: z.coerce.number().int().positive(),
});
