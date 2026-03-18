import { z } from 'zod';

export const inviteUserSchema = z.object({
  first_name: z.string().trim().min(1, 'First name is required').max(100),
  last_name: z.string().trim().min(1, 'Last name is required').max(100),
  email: z.string().trim().email('Valid email is required'),
  role: z.enum(['admin', 'agent']).default('agent'),
});
