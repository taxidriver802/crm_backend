import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import * as invoicesService from '../services/invoices.service';
import { env } from '../config/env';
import { pool } from '../db';

export const invoicesRouter = Router();

function parseId(value: string | string[] | undefined) {
  const normalized = Array.isArray(value) ? value[0] : value;
  if (normalized == null || normalized === '') return null;
  const id = Number(normalized);
  return Number.isFinite(id) ? id : null;
}

function parseOptionalNumber(value: unknown) {
  if (value == null || value === '') return undefined;
  const normalized = Array.isArray(value) ? value[0] : value;
  if (normalized == null || normalized === '') return undefined;
  const num = Number(normalized);
  return Number.isFinite(num) ? num : undefined;
}

function parseString(value: unknown) {
  if (typeof value === 'string') return value;
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    typeof value[0] === 'string'
  ) {
    return value[0];
  }
  return undefined;
}

function parseInvoiceStatus(
  value: unknown
): invoicesService.InvoiceStatus | undefined {
  const s = parseString(value);
  if (s === 'Draft' || s === 'Sent' || s === 'Paid' || s === 'Overdue') {
    return s;
  }
  return undefined;
}

invoicesRouter.use(requireAuth);

// GET /invoices?status=Sent&due=this_week
invoicesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const status = parseInvoiceStatus(req.query.status);
    const due = parseString(req.query.due);

    let query = `SELECT i.*, j.title AS job_title, j.lead_id AS job_lead_id,
       l.first_name AS lead_first_name, l.last_name AS lead_last_name
     FROM invoices i
     INNER JOIN jobs j ON j.id = i.job_id
     LEFT JOIN leads l ON l.id = j.lead_id
     WHERE i.user_id = $1`;
    const params: any[] = [userId];

    if (status) {
      params.push(status);
      query += ` AND i.status = $${params.length}`;
    }

    if (due === 'this_week') {
      query += ` AND i.due_date IS NOT NULL AND i.due_date >= NOW() AND i.due_date <= NOW() + INTERVAL '7 days'`;
    } else if (due === 'overdue') {
      query += ` AND i.due_date IS NOT NULL AND i.due_date < NOW() AND i.status NOT IN ('Paid')`;
    }

    query += ` ORDER BY i.created_at DESC LIMIT 200`;

    const result = await pool.query(query, params);

    const invoices = result.rows.map((row: any) => ({
      id: row.id,
      invoice_number: row.invoice_number,
      status: row.status,
      subtotal: Number(row.subtotal ?? 0),
      grand_total: Number(row.grand_total ?? 0),
      due_date: row.due_date,
      paid_at: row.paid_at,
      job_id: row.job_id,
      job_title: row.job_title,
      lead_name:
        [row.lead_first_name, row.lead_last_name]
          .filter(Boolean)
          .join(' ')
          .trim() || null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));

    res.json({ ok: true, invoices });
  })
);

// POST /invoices/from-estimate/:estimateId
invoicesRouter.post(
  '/from-estimate/:estimateId',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const estimateId = parseId(req.params.estimateId);
    if (estimateId == null) {
      return res.status(400).json({ ok: false, error: 'Invalid estimate id' });
    }

    try {
      const invoice = await invoicesService.createInvoiceFromEstimate(
        userId,
        estimateId,
        { due_date: parseString(req.body?.due_date) ?? null }
      );
      res.status(201).json({ ok: true, invoice });
    } catch (error) {
      if (error instanceof invoicesService.EstimateNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      throw error;
    }
  })
);

// GET /invoices/job/:jobId
invoicesRouter.get(
  '/job/:jobId',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const jobId = parseId(req.params.jobId);
    if (jobId == null) {
      return res.status(400).json({ ok: false, error: 'Invalid job id' });
    }

    try {
      const invoices = await invoicesService.getInvoicesByJobId(userId, jobId);
      res.json({ ok: true, invoices });
    } catch (error) {
      if (error instanceof invoicesService.JobNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      throw error;
    }
  })
);

// POST /invoices
invoicesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const jobId = parseOptionalNumber(req.body.job_id);
    if (jobId == null) {
      return res.status(400).json({ ok: false, error: 'job_id is required' });
    }

    const status = parseInvoiceStatus(req.body.status);
    if (req.body.status && !status) {
      return res.status(400).json({ ok: false, error: 'Invalid status' });
    }

    try {
      const invoice = await invoicesService.createInvoice(userId, {
        job_id: jobId,
        estimate_id: parseOptionalNumber(req.body.estimate_id) ?? null,
        status,
        due_date: parseString(req.body.due_date) ?? null,
        notes: parseString(req.body.notes) ?? null,
      });
      res.status(201).json({ ok: true, invoice });
    } catch (error) {
      if (error instanceof invoicesService.JobNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      throw error;
    }
  })
);

// GET /invoices/:id/pdf
invoicesRouter.get(
  '/:id/pdf',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const id = parseId(req.params.id);
    if (id == null) {
      return res.status(400).json({ ok: false, error: 'Invalid invoice id' });
    }

    try {
      const buf = await invoicesService.renderInvoicePdf(userId, id);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="invoice-${id}.pdf"`
      );
      res.send(buf);
    } catch (error) {
      if (error instanceof invoicesService.InvoiceNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      throw error;
    }
  })
);

// POST /invoices/:id/share
invoicesRouter.post(
  '/:id/share',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const id = parseId(req.params.id);
    if (id == null) {
      return res.status(400).json({ ok: false, error: 'Invalid invoice id' });
    }

    try {
      const out = await invoicesService.rotateInvoiceShareToken(userId, id);
      const shareUrl = `${env.frontendUrl.replace(/\/$/, '')}/public/invoice/${out.token}`;
      res.json({
        ok: true,
        share_url: shareUrl,
        share_expires_at: out.share_expires_at,
        invoice: out.invoice,
      });
    } catch (error) {
      if (error instanceof invoicesService.InvoiceNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      throw error;
    }
  })
);

// GET /invoices/:id
invoicesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const id = parseId(req.params.id);
    if (id == null) {
      return res.status(400).json({ ok: false, error: 'Invalid invoice id' });
    }

    try {
      const invoice = await invoicesService.getInvoiceById(userId, id);
      res.json({ ok: true, invoice });
    } catch (error) {
      if (error instanceof invoicesService.InvoiceNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      throw error;
    }
  })
);

// PATCH /invoices/:id
invoicesRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const id = parseId(req.params.id);
    if (id == null) {
      return res.status(400).json({ ok: false, error: 'Invalid invoice id' });
    }

    const updates: invoicesService.UpdateInvoiceInput = {};
    if (req.body.status !== undefined) {
      const s = parseInvoiceStatus(req.body.status);
      if (!s)
        return res.status(400).json({ ok: false, error: 'Invalid status' });
      updates.status = s;
    }
    if (req.body.due_date !== undefined) {
      updates.due_date =
        req.body.due_date === null
          ? null
          : (parseString(req.body.due_date) ?? null);
    }
    if (req.body.notes !== undefined) {
      updates.notes =
        req.body.notes === null ? null : (parseString(req.body.notes) ?? null);
    }

    try {
      const invoice = await invoicesService.updateInvoice(userId, id, updates);
      res.json({ ok: true, invoice });
    } catch (error) {
      if (error instanceof invoicesService.InvoiceNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      throw error;
    }
  })
);

// DELETE /invoices/:id
invoicesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const id = parseId(req.params.id);
    if (id == null) {
      return res.status(400).json({ ok: false, error: 'Invalid invoice id' });
    }

    try {
      const deletedId = await invoicesService.deleteInvoice(userId, id);
      res.json({ ok: true, deletedId });
    } catch (error) {
      if (error instanceof invoicesService.InvoiceNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      throw error;
    }
  })
);

// POST /invoices/:id/line-items
invoicesRouter.post(
  '/:id/line-items',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const invoiceId = parseId(req.params.id);
    if (invoiceId == null) {
      return res.status(400).json({ ok: false, error: 'Invalid invoice id' });
    }

    const name = parseString(req.body.name);
    if (!name) {
      return res.status(400).json({ ok: false, error: 'name is required' });
    }

    try {
      const invoice = await invoicesService.addInvoiceLineItem(
        userId,
        invoiceId,
        {
          name: name.trim(),
          description: parseString(req.body.description) ?? null,
          quantity: req.body.quantity,
          unit_price: req.body.unit_price,
          sort_order: parseOptionalNumber(req.body.sort_order),
        }
      );
      res.status(201).json({ ok: true, invoice });
    } catch (error) {
      if (error instanceof invoicesService.InvoiceNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      throw error;
    }
  })
);

// PATCH /invoices/:id/line-items/:lineItemId
invoicesRouter.patch(
  '/:id/line-items/:lineItemId',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const invoiceId = parseId(req.params.id);
    const lineItemId = parseId(req.params.lineItemId);
    if (invoiceId == null || lineItemId == null) {
      return res.status(400).json({ ok: false, error: 'Invalid id' });
    }

    try {
      const invoice = await invoicesService.updateInvoiceLineItem(
        userId,
        invoiceId,
        lineItemId,
        {
          name: parseString(req.body.name)?.trim(),
          description:
            req.body.description === null
              ? null
              : parseString(req.body.description),
          quantity: req.body.quantity,
          unit_price: req.body.unit_price,
          sort_order: parseOptionalNumber(req.body.sort_order),
        }
      );
      res.json({ ok: true, invoice });
    } catch (error) {
      if (error instanceof invoicesService.InvoiceNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      if (error instanceof invoicesService.InvoiceLineItemNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      throw error;
    }
  })
);

// DELETE /invoices/:id/line-items/:lineItemId
invoicesRouter.delete(
  '/:id/line-items/:lineItemId',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const invoiceId = parseId(req.params.id);
    const lineItemId = parseId(req.params.lineItemId);
    if (invoiceId == null || lineItemId == null) {
      return res.status(400).json({ ok: false, error: 'Invalid id' });
    }

    try {
      const deletedId = await invoicesService.deleteInvoiceLineItem(
        userId,
        invoiceId,
        lineItemId
      );
      res.json({ ok: true, deletedId });
    } catch (error) {
      if (error instanceof invoicesService.InvoiceNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      if (error instanceof invoicesService.InvoiceLineItemNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      throw error;
    }
  })
);
