import { z } from 'zod';
import { COMPANY_MARK_IDS, COMPANY_PALETTE_IDS } from '../lib/companySlug';

export const updateCompanySchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  palette_id: z.enum(COMPANY_PALETTE_IDS).optional(),
  mark_id: z.enum(COMPANY_MARK_IDS).optional(),
  clear_logo: z.boolean().optional(),
});
