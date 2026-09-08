import { z } from 'zod';

const taskKindSchema = z.enum(['task', 'appointment']);

const taskFieldsSchema = z.object({
  assigned_to: z.string().uuid().optional().nullable(),
  lead_id: z.number().int().optional().nullable(),
  job_id: z.number().int().optional().nullable(),
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  due_date: z.string().min(1).optional().nullable(),
  kind: taskKindSchema.optional().nullable(),
  end_at: z.string().min(1).optional().nullable(),
  location: z.string().optional().nullable(),
  status: z.string().optional().nullable(),
});

function refineTaskTiming(
  data: {
    kind?: string | null;
    due_date?: string | null;
    end_at?: string | null;
  },
  ctx: z.RefinementCtx,
  mode: 'create' | 'update'
) {
  // A create payload is the whole task, so an absent due_date is a missing one.
  // In a patch an absent key means "keep the stored value", so only an explicit
  // null can invalidate an appointment, and only when the patch also names the
  // kind. Patches that leave kind alone are checked by updateTask against the
  // merged row, which is the only place the stored kind is known.
  const kind = mode === 'create' ? (data.kind ?? 'task') : data.kind;
  const clearsDueDate =
    mode === 'create' ? !data.due_date : data.due_date === null;

  if (kind === 'appointment' && clearsDueDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Appointments require a due_date',
      path: ['due_date'],
    });
  }

  if (data.end_at && data.due_date) {
    const due = new Date(data.due_date);
    const end = new Date(data.end_at);
    if (isNaN(due.getTime()) || isNaN(end.getTime()) || end <= due) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'end_at must be after due_date',
        path: ['end_at'],
      });
    }
  }
}

export const createTaskSchema = taskFieldsSchema
  .superRefine((data, ctx) => refineTaskTiming(data, ctx, 'create'))
  .refine((data) => data.lead_id != null || data.job_id != null, {
    message: 'A task must belong to a lead or a job',
    path: ['lead_id'],
  });

export const updateTaskSchema = taskFieldsSchema
  .partial()
  .superRefine((data, ctx) => refineTaskTiming(data, ctx, 'update'));
