import { z } from 'zod';

export const createEstimateTemplateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().nullable(),
});

export const updateEstimateTemplateSchema = createEstimateTemplateSchema.partial();

export const createTemplateLineItemSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  quantity: z.coerce.number().min(0).optional(),
  unit_price: z.coerce.number().min(0).optional(),
  sort_order: z.coerce.number().int().optional(),
});

export const updateTemplateLineItemSchema = createTemplateLineItemSchema.partial();

export const applyTemplateSchema = z.object({
  template_id: z.coerce.number().int().positive(),
});
