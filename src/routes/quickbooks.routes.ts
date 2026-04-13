import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import * as qbService from '../services/quickbooks.service';
import * as invoicesService from '../services/invoices.service';

export const quickbooksRouter = Router();

quickbooksRouter.use(requireAuth);

// GET /quickbooks/status
quickbooksRouter.get(
  '/status',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const status = await qbService.getConnectionStatus(userId);
    res.json({ ok: true, integration: status });
  })
);

// GET /quickbooks/auth-url
quickbooksRouter.get(
  '/auth-url',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    try {
      const url = qbService.buildAuthUrl(userId);
      res.json({ ok: true, auth_url: url });
    } catch (error) {
      if (error instanceof qbService.QuickBooksConfigError) {
        return res.status(400).json({ ok: false, error: error.message });
      }
      throw error;
    }
  })
);

// GET /quickbooks/callback
quickbooksRouter.get(
  '/callback',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const code = req.query.code as string;
    const realmId = req.query.realmId as string;

    if (!code || !realmId) {
      return res
        .status(400)
        .json({ ok: false, error: 'Missing code or realmId' });
    }

    try {
      const result = await qbService.handleOAuthCallback(userId, code, realmId);
      res.json({ ok: true, ...result });
    } catch (error) {
      if (error instanceof qbService.QuickBooksConfigError) {
        return res.status(400).json({ ok: false, error: error.message });
      }
      throw error;
    }
  })
);

// POST /quickbooks/disconnect
quickbooksRouter.post(
  '/disconnect',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const result = await qbService.disconnect(userId);
    res.json({ ok: true, ...result });
  })
);

// POST /quickbooks/sync-invoice/:invoiceId
quickbooksRouter.post(
  '/sync-invoice/:invoiceId',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const invoiceId = Number(req.params.invoiceId);

    if (!Number.isFinite(invoiceId)) {
      return res.status(400).json({ ok: false, error: 'Invalid invoice id' });
    }

    try {
      const invoice = await invoicesService.getInvoiceById(userId, invoiceId);

      const result = await qbService.syncInvoiceToQuickBooks(userId, {
        invoice_number: invoice.invoice_number,
        customer_name: invoice.job?.lead_name || 'Customer',
        line_items: invoice.line_items,
        due_date: invoice.due_date,
        grand_total: invoice.grand_total,
        notes: invoice.notes,
      });

      res.json({ ok: true, sync: result });
    } catch (error) {
      if (error instanceof invoicesService.InvoiceNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      if (error instanceof qbService.QuickBooksNotConnectedError) {
        return res.status(400).json({ ok: false, error: error.message });
      }
      throw error;
    }
  })
);

// GET /quickbooks/payment-status/:qbInvoiceId
quickbooksRouter.get(
  '/payment-status/:qbInvoiceId',
  asyncHandler(async (req, res) => {
    const userId = req.user!.userId;
    const qbInvoiceId = Array.isArray(req.params.qbInvoiceId) ? req.params.qbInvoiceId[0] : req.params.qbInvoiceId;

    try {
      const result = await qbService.getPaymentStatus(userId, qbInvoiceId);
      res.json({ ok: true, payment: result });
    } catch (error) {
      if (error instanceof qbService.QuickBooksNotConnectedError) {
        return res.status(400).json({ ok: false, error: error.message });
      }
      throw error;
    }
  })
);
