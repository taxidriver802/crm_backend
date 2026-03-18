import { z } from "zod";

export const registerSchema = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const acceptInviteSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
});