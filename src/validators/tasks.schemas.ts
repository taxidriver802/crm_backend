import { z } from 'zod';

export const createTaskSchema = z.object({
  lead_id: z.number().int(),
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  due_date: z.string().min(1).optional().nullable(),
  status: z.string().optional().nullable(), // Pending/Completed/etc
});

export const updateTaskSchema = createTaskSchema.partial();
