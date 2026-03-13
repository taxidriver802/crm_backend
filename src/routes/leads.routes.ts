import { Router } from "express";
import { pool } from "../db";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { createLeadSchema, updateLeadSchema } from "../validators/leads.schemas";

export const leadsRouter = Router();

leadsRouter.use(requireAuth);

// GET /leads/summary
leadsRouter.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;

    const totalResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM leads WHERE user_id = $1`,
      [userId]
    );

    const byStatusResult = await pool.query(
      `
      SELECT status, COUNT(*)::int AS count
      FROM leads
      WHERE user_id = $1
      GROUP BY status
      ORDER BY count DESC;
      `,
      [userId]
    );

    res.json({
      ok: true,
      total: totalResult.rows[0].total,
      byStatus: byStatusResult.rows, // [{status, count}, ...]
    });
  })
);

// GET /leads?status=New&q=john&limit=50&offset=0
leadsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;

    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    const limit = Math.min(Number(req.query.limit || 50), 200);
    const offset = Number(req.query.offset || 0);

    const params: any[] = [userId];
    const where: string[] = ["user_id = $1"];

    if (status) {
      params.push(status);
      where.push(`status = $${params.length}`);
    }

    if (q) {
      params.push(`%${q}%`);
      const p = `$${params.length}`;
      where.push(`(first_name ILIKE ${p} OR last_name ILIKE ${p} OR email ILIKE ${p} OR phone ILIKE ${p})`);
    }

    params.push(limit);
    params.push(offset);

    const sql = `
      SELECT *
      FROM leads
      WHERE ${where.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT $${params.length - 1}
      OFFSET $${params.length};
    `;

    const result = await pool.query(sql, params);
    res.json({ ok: true, leads: result.rows });
  })
);

// GET /leads/:id
leadsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: "Invalid id" });
    } 

    const result = await pool.query(
      `SELECT * FROM leads WHERE user_id = $1 AND id = $2`,
      [userId, id]
    );

    if (result.rowCount === 0) return res.status(404).json({ ok: false, error: "Lead not found" });
    res.json({ ok: true, lead: result.rows[0] });
  })
);

// DELETE /leads/:id
leadsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: "Invalid id" });
    }

    const result = await pool.query(
      `DELETE FROM leads WHERE user_id = $1 AND id = $2 RETURNING id`,
      [userId, id]
    );

    if (result.rowCount === 0) return res.status(404).json({ ok: false, error: "Lead not found" });

    res.json({ ok: true, deletedId: result.rows[0].id });
  })
);

// POST /leads
leadsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;

    const parsed = createLeadSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

    const d = parsed.data;

    const result = await pool.query(
      `
      INSERT INTO leads (
        user_id, first_name, last_name, email, phone, source, status,
        budget_min, budget_max, notes
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *;
      `,
      [
        userId,
        d.first_name,
        d.last_name,
        d.email ?? null,
        d.phone ?? null,
        d.source ?? null,
        d.status ?? "New",
        d.budget_min ?? null,
        d.budget_max ?? null,
        d.notes ?? null,
      ]
    );

    res.status(201).json({ ok: true, lead: result.rows[0] });
  })
);

// PATCH /leads/:id
leadsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: "Invalid id" });
    }

    const parsed = updateLeadSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

    const updates = parsed.data;
    const keys = Object.keys(updates) as (keyof typeof updates)[];

    if (keys.length === 0) return res.status(400).json({ ok: false, error: "No fields to update" });

    const setParts: string[] = [];
    const values: any[] = [userId, id];

    for (const key of keys) {
      values.push((updates as any)[key] ?? null);
      setParts.push(`${key} = $${values.length}`);
    }

    // Also bump updated_at
    setParts.push(`updated_at = CURRENT_TIMESTAMP`);

    const sql = `
      UPDATE leads
      SET ${setParts.join(", ")}
      WHERE user_id = $1 AND id = $2
      RETURNING *;
    `;

    const result = await pool.query(sql, values);
    if (result.rowCount === 0) return res.status(404).json({ ok: false, error: "Lead not found" });

    res.json({ ok: true, lead: result.rows[0] });
  })
);