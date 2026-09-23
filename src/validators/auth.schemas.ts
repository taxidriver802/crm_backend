import { z } from "zod";
import { COMPANY_SLUG_RE, COMPANY_MARK_IDS, COMPANY_PALETTE_IDS } from "../lib/companySlug";

export const registerSchema = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  company_name: z.string().trim().min(1).max(100),
  slug: z.preprocess((value) => {
    if (value == null) return undefined;
    if (typeof value !== "string") return value;
    const normalized = value.trim().toLowerCase();
    return normalized === "" ? undefined : normalized;
  }, z.string().max(60).regex(COMPANY_SLUG_RE).optional()),
  mark_id: z.enum(COMPANY_MARK_IDS).optional(),
  palette_id: z.enum(COMPANY_PALETTE_IDS).optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  company_slug: z.preprocess((value) => {
    if (value == null) return value;
    if (typeof value !== "string") return value;
    return value.trim().toLowerCase();
  }, z.string().min(1).max(60).regex(COMPANY_SLUG_RE)),
});

export const acceptInviteSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
});
