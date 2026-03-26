import { z } from 'zod';

export const listNotificationsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  unreadOnly: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => v === 'true')
    .default(false),
});

export const markNotificationReadParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});
