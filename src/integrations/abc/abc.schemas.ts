import { z } from "zod";

export const abcSearchAccountsSchema = z.object({
  soldTo: z.string().min(1).optional(),
  billTo: z.string().min(1).optional(),
  shipTo: z.string().min(1).optional(),
});

export const abcSearchItemsSchema = z.object({
  query: z.string().min(1).optional(),
  itemNumber: z.string().min(1).optional(),
});

export const abcCreateOrderSchema = z.object({
  branchNumber: z.string().min(1),
  soldToNumber: z.string().min(1),
  items: z.array(
    z.object({
      itemNumber: z.string().min(1),
      quantity: z.number().int().positive(),
    })
  ).min(1),
});

export const abcInvoicesHistoryQuerySchema = z.object({
  billToAccount: z.string().min(1),
});