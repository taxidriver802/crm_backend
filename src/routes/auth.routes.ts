import { Router } from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db";
import { asyncHandler } from "../utils/asyncHandler";
import { registerSchema, loginSchema } from "../validators/auth.schemas";
import { requireAuth } from "../middleware/auth";

import jwt, { type Secret, type SignOptions } from "jsonwebtoken";
import { log } from "node:console";

export const authRouter = Router();

function signToken(userId: number, email: string): string {
  const secret: Secret = process.env.JWT_SECRET!;
  
  const options: SignOptions = {
    expiresIn: (process.env.JWT_EXPIRES_IN ?? "7d") as SignOptions["expiresIn"],
  };

  return jwt.sign({ userId, email }, secret, options);
}

// POST /auth/register
authRouter.post(
  "/register",
  asyncHandler(async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

    const { first_name, last_name, email, password } = parsed.data;

    const password_hash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `
      INSERT INTO users (first_name, last_name, email, password_hash)
      VALUES ($1, $2, $3, $4)
      RETURNING id, email, first_name, last_name;
      `,
      [first_name, last_name, email, password_hash]
    );

    const user = result.rows[0];
    const token = signToken(user.id, user.email);

    res.cookie("access_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });


    res.status(201).json({ ok: true, user });
  })
);

// POST /auth/login
authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

    const { email, password } = parsed.data;

    const result = await pool.query(
      `SELECT id, email, password_hash, first_name, last_name FROM users WHERE email = $1`,
      [email]
    );

    

    const user = result.rows[0];

    
    if (!user) return res.status(401).json({ ok: false, error: "Invalid credentials" });

    const matches = await bcrypt.compare(password, user.password_hash);
    
    if (!matches) return res.status(401).json({ ok: false, error: "Invalid credentials" });

    const token = signToken(user.id, user.email);

    res.cookie("access_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });


    res.json({
      ok: true,
      user: { id: user.id, email: user.email, first_name: user.first_name, last_name: user.last_name },
    });
  })
);

// GET /auth/me
authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;

    const result = await pool.query(
      `SELECT id, email, first_name, last_name FROM users WHERE id = $1`,
      [userId]
    );

    res.json({ ok: true, user: result.rows[0] });
  })
);

authRouter.post("/logout", (_req, res) => {
  res.clearCookie("access_token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });

  res.json({ ok: true });
});


