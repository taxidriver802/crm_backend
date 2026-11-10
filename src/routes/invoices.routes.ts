import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import * as invoicesService from '../services/invoices.service';
import { env } from '../config/env';
import { requireRole } from '../middleware/requireRole';
import { requestScope } from '../lib/tenant';
import { loadPublicBrandingByCompanyId } from '../lib/companySlug';

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
  return invoicesService.isInvoiceStatus(s) ? s : undefined;
}

function parseOptionalString(value: unknown) {
  if (value === null) return null;
  const s = parseString(value);
  return s === undefined ? undefined : s;
}

invoicesRouter.use(requireAuth);

// GET /invoices?status=Sent&due=this_week&balance=open
invoicesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { userId, companyId, includeAll } = requestScope(req, true);
    const invoices = await invoicesService.listInvoices(userId, {
      companyId,
      includeAll,
      status: parseInvoiceStatus(req.query.status),
      due: parseString(req.query.due),
      balance: parseString(req.query.balance) === 'open' ? 'open' : undefined,
    });
    res.json({ ok: true, invoices });
  })
);

// POST /invoices/from-estimate/:estimateId
invoicesRouter.post(
  '/from-estimate/:estimateId',
  asyncHandler(async (req, res) => {
    const { userId, companyId, includeAll } = requestScope(req, true);
    const estimateId = parseId(req.params.estimateId);
    if (estimateId == null) {
      return res.status(400).json({ ok: false, error: 'Invalid estimate id' });
    }

    try {
      const kind = req.body?.kind === 'deposit' ? 'deposit' : 'final';
      const invoice = await invoicesService.createInvoiceFromEstimate(
        userId,
        estimateId,
        {
          due_date: parseString(req.body?.due_date) ?? null,
          kind,
          deposit_percent: parseOptionalNumber(req.body?.deposit_percent) ?? null,
          deposit_amount: parseOptionalNumber(req.body?.deposit_amount) ?? null,
          companyId,
          includeAll,
        }
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
    const { userId, companyId, includeAll } = requestScope(req, true);
    const jobId = parseId(req.params.jobId);
    if (jobId == null) {
      return res.status(400).json({ ok: false, error: 'Invalid job id' });
    }

    try {
      const invoices = await invoicesService.getInvoicesByJobId(userId, jobId, {
        companyId,
        includeAll,
      });
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
    const { userId, companyId, includeAll } = requestScope(req, true);
    const jobId = parseOptionalNumber(req.body.job_id);
    if (jobId == null) {
      return res.status(400).json({ ok: false, error: 'job_id is required' });
    }

    const status = parseInvoiceStatus(req.body.status);
    if (req.body.status && !status) {
      return res.status(400).json({ ok: false, error: 'Invalid status' });
    }

    try {
      const invoice = await invoicesService.createInvoice(
        userId,
        {
          job_id: jobId,
          estimate_id: parseOptionalNumber(req.body.estimate_id) ?? null,
          status,
          due_date: parseString(req.body.due_date) ?? null,
          notes: parseString(req.body.notes) ?? null,
        },
        { companyId, includeAll }
      );
      res.status(201).json({ ok: true, invoice });
    } catch (error) {
      if (
        error instanceof invoicesService.JobNotFoundError ||
        error instanceof invoicesService.EstimateNotFoundError
      ) {
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
    const { userId, companyId, includeAll } = requestScope(req, true);
    const id = parseId(req.params.id);
    if (id == null) {
      return res.status(400).json({ ok: false, error: 'Invalid invoice id' });
    }

    try {
      const buf = await invoicesService.renderInvoicePdf(userId, id, {
        companyId,
        includeAll,
      });
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
    const { userId, companyId, includeAll } = requestScope(req, true);
    const id = parseId(req.params.id);
    if (id == null) {
      return res.status(400).json({ ok: false, error: 'Invalid invoice id' });
    }

    try {
      const out = await invoicesService.rotateInvoiceShareToken(userId, id, {
        companyId,
        includeAll,
      });
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
    const { userId, companyId, includeAll } = requestScope(req, true);
    const id = parseId(req.params.id);
    if (id == null) {
      return res.status(400).json({ ok: false, error: 'Invalid invoice id' });
    }

    try {
      const invoice = await invoicesService.getInvoiceById(userId, id, {
        companyId,
        includeAll,
      });
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
    const { userId, companyId, includeAll } = requestScope(req, true);
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
    if (invoicesService.isPaymentMethod(req.body.payment_method)) {
      updates.payment_method = req.body.payment_method;
    }

    try {
      const invoice = await invoicesService.updateInvoice(userId, id, updates, {
        companyId,
        includeAll,
      });
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
    const { userId, companyId, includeAll } = requestScope(req, true);
    const id = parseId(req.params.id);
    if (id == null) {
      return res.status(400).json({ ok: false, error: 'Invalid invoice id' });
    }

    try {
      const deletedId = await invoicesService.deleteInvoice(userId, id, {
        companyId,
        includeAll,
      });
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
    const { userId, companyId, includeAll } = requestScope(req, true);
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
        },
        { companyId, includeAll }
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
    const { userId, companyId, includeAll } = requestScope(req, true);
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
        },
        { companyId, includeAll }
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
    const { userId, companyId, includeAll } = requestScope(req, true);
    const invoiceId = parseId(req.params.id);
    const lineItemId = parseId(req.params.lineItemId);
    if (invoiceId == null || lineItemId == null) {
      return res.status(400).json({ ok: false, error: 'Invalid id' });
    }

    try {
      const deletedId = await invoicesService.deleteInvoiceLineItem(
        userId,
        invoiceId,
        lineItemId,
        { companyId, includeAll }
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

// GET /invoices/:id/payments
invoicesRouter.get(
  '/:id/payments',
  asyncHandler(async (req, res) => {
    const { userId, companyId, includeAll } = requestScope(req, true);
    const id = parseId(req.params.id);
    if (id == null) {
      return res.status(400).json({ ok: false, error: 'Invalid invoice id' });
    }
    try {
      const invoice = await invoicesService.getInvoiceById(userId, id, {
        companyId,
        includeAll,
      });
      res.json({
        ok: true,
        payments: invoice.payments,
        amount_paid: invoice.amount_paid,
        balance_due: invoice.balance_due,
      });
    } catch (error) {
      if (error instanceof invoicesService.InvoiceNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      throw error;
    }
  })
);

// POST /invoices/:id/payments  { amount, method, reference?, notes?, received_at? }
invoicesRouter.post(
  '/:id/payments',
  asyncHandler(async (req, res) => {
    const { userId, companyId, includeAll } = requestScope(req, true);
    const id = parseId(req.params.id);
    if (id == null) {
      return res.status(400).json({ ok: false, error: 'Invalid invoice id' });
    }
    const amount = parseOptionalNumber(req.body?.amount);
    if (amount == null) {
      return res.status(400).json({ ok: false, error: 'amount is required' });
    }
    const method = req.body?.method;
    if (method != null && !invoicesService.isPaymentMethod(method)) {
      return res.status(400).json({
        ok: false,
        error: `method must be one of ${invoicesService.PAYMENT_METHODS.join(', ')}`,
      });
    }

    try {
      const result = await invoicesService.recordPayment(
        userId,
        id,
        {
          amount,
          method: method ?? 'other',
          reference: parseOptionalString(req.body?.reference) ?? null,
          notes: parseOptionalString(req.body?.notes) ?? null,
          received_at: parseOptionalString(req.body?.received_at) ?? null,
        },
        { companyId, includeAll }
      );
      res.status(201).json({ ok: true, ...result });
    } catch (error) {
      if (error instanceof invoicesService.InvoiceNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      throw error;
    }
  })
);

// DELETE /invoices/:id/payments/:paymentId — owner/admin only (ledger correction)
invoicesRouter.delete(
  '/:id/payments/:paymentId',
  requireRole('owner', 'admin'),
  asyncHandler(async (req, res) => {
    const { userId, companyId, includeAll } = requestScope(req, true);
    const id = parseId(req.params.id);
    const paymentId = parseId(req.params.paymentId);
    if (id == null || paymentId == null) {
      return res.status(400).json({ ok: false, error: 'Invalid id' });
    }
    try {
      const result = await invoicesService.deletePayment(userId, id, paymentId, {
        companyId,
        includeAll,
      });
      res.json({ ok: true, ...result });
    } catch (error) {
      if (error instanceof invoicesService.InvoiceNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      throw error;
    }
  })
);

// ─── PUBLIC (token-gated, no auth) ─────────────────────

export const publicInvoicesRouter = Router();

publicInvoicesRouter.get(
  '/:token',
  asyncHandler(async (req, res) => {
    const token = String(req.params.token || '').trim();
    if (!token) {
      return res.status(400).json({ ok: false, error: 'Token required' });
    }
    try {
      const invoice = await invoicesService.getInvoiceByShareToken(token);
      const company = await loadPublicBrandingByCompanyId(invoice.company_id);
      res.json({
        ok: true,
        invoice: invoicesService.toPublicInvoice(invoice),
        company,
      });
    } catch (error) {
      if (error instanceof invoicesService.InvalidShareTokenError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      throw error;
    }
  })
);

publicInvoicesRouter.get(
  '/:token/pdf',
  asyncHandler(async (req, res) => {
    const token = String(req.params.token || '').trim();
    if (!token) {
      return res.status(400).json({ ok: false, error: 'Token required' });
    }
    try {
      const buf = await invoicesService.renderInvoicePdfByShareToken(token);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="invoice.pdf"');
      res.send(buf);
    } catch (error) {
      if (error instanceof invoicesService.InvalidShareTokenError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      throw error;
    }
  })
);
