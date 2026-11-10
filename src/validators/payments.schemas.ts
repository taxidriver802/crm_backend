import { z } from 'zod';

export const PAYMENT_METHODS = ['cash', 'check', 'card', 'ach', 'other'] as const;

const blankToNull = (value: unknown) =>
  value == null || value === '' ? null : value;

export const recordPaymentSchema = z.object({
  amount: z.coerce.number().positive('Amount must be greater than zero.'),
  method: z.enum(PAYMENT_METHODS).optional(),
  reference: z.preprocess(
    blankToNull,
    z.string().trim().max(80).nullable().optional()
  ),
  note: z.preprocess(
    blankToNull,
    z.string().trim().max(500).nullable().optional()
  ),
  received_at: z.preprocess(
    blankToNull,
    z.string().trim().min(1).nullable().optional()
  ),
  invoice_id: z.preprocess(
    blankToNull,
    z.coerce.number().int().positive().nullable().optional()
  ),
});

export const applyPaymentSchema = z.object({
  invoice_id: z.coerce.number().int().positive(),
});

export const createChangeOrderSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  notes: z.preprocess(
    blankToNull,
    z.string().trim().max(4000).nullable().optional()
  ),
});
