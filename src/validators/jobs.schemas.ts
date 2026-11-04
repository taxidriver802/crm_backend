import { z } from 'zod';
import { JOB_STATUSES } from '../lib/jobLifecycle';

const jobStatus = z.enum(JOB_STATUSES);

export const createJobSchema = z.object({
  assigned_to: z.string().uuid().optional().nullable(),
  lead_id: z.number().min(1),
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  status: jobStatus.optional().nullable(),
  address: z.string().optional().nullable(),
});

export const updateJobSchema = createJobSchema.partial().extend({
  lost_reason: z.string().max(500).optional().nullable(),
});
