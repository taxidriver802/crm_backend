import { z } from "zod";

export const createTaskSchema = z.object({
  lead_id: z.number().int(),
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  due_date: z.string().datetime().optional().nullable(), // ISO string from client
  status: z.string().optional().nullable(), // Pending/Completed/etc
});

export const updateTaskSchema = createTaskSchema.partial();