import { z } from 'zod';

const taskFieldsSchema = z.object({
  assigned_to: z.string().uuid().optional().nullable(),
  lead_id: z.number().int().optional().nullable(),
  job_id: z.number().int().optional().nullable(),
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  due_date: z.string().min(1).optional().nullable(),
  status: z.string().optional().nullable(),
});

export const createTaskSchema = taskFieldsSchema.refine(
  (data) => data.lead_id != null || data.job_id != null,
  {
    message: 'A task must belong to a lead or a job',
    path: ['lead_id'],
  }
);

export const updateTaskSchema = taskFieldsSchema.partial();
