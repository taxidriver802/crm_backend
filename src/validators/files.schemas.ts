import { z } from 'zod';

export const FILE_CATEGORIES = ['before', 'after', 'other'] as const;

export const updateFileSchema = z
  .object({
    caption: z.string().max(2000).nullable().optional(),
    category: z.enum(FILE_CATEGORIES).optional(),
    client_visible: z.boolean().optional(),
  })
  .strict();
