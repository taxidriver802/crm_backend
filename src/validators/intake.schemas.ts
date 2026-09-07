import { z } from 'zod';

const optionalContact = z
  .union([z.string().trim().max(200), z.null(), z.undefined()])
  .transform((value) => {
    if (value == null) return null;
    const trimmed = String(value).trim();
    return trimmed ? trimmed : null;
  });

export const publicIntakeSubmitSchema = z
  .object({
    first_name: z.string().trim().min(1).max(100),
    last_name: z.string().trim().min(1).max(100),
    email: optionalContact,
    phone: optionalContact,
    service_type: optionalContact,
    preferred_contact_method: optionalContact,
    message: z
      .union([z.string().trim().max(2000), z.null(), z.undefined()])
      .transform((value) => {
        if (value == null) return null;
        const trimmed = String(value).trim();
        return trimmed ? trimmed : null;
      }),
    company_website: z.string().optional().nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Invalid email',
        path: ['email'],
      });
    }
    if (!value.email && !value.phone) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'email or phone is required',
        path: ['email'],
      });
    }
  });
