import { z } from 'zod';

export const createJobSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  status: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
});

export const updateJobSchema = createJobSchema.partial();
