import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';

import { env } from './config/env';

import { tasksRouter } from './routes/tasks.routes';
import { authRouter } from './routes/auth.routes';
import { leadsRouter } from './routes/leads.routes';
import { dashboardRouter } from './routes/dashboard.routes';
import { usersRouter } from './routes/users.routes';
import { integrationsRouter } from './routes/integrations.routes';
import { errorHandler } from './middleware/error';
import { filesRouter } from './routes/files.routes';
import { notificationRouter } from './routes/notification.routes';
import { runTaskNotificationJob } from './jobs/taskNotifications';
import { runInvoiceReminderJob } from './jobs/invoiceReminders';
import { jobsRouter } from './routes/jobs.routes';
import { estimatesRouter } from './routes/estimates.routes';
import { estimateTemplatesRouter } from './routes/estimateTemplates.routes';
import { publicEstimatesRouter } from './routes/publicEstimates.routes';
import { publicCompaniesRouter } from './routes/publicCompanies.routes';
import { companyRouter } from './routes/company.routes';
import {
  meRouter,
  workspaceDefaultsRouter,
} from './routes/preferences.routes';
import { notesRouter } from './routes/notes.routes';
import { searchRouter } from './routes/search.routes';
import { reportsRouter } from './routes/reports.routes';
import { savedViewsRouter } from './routes/savedViews.routes';
import { helpRouter } from './routes/help.routes';
import {
  invoicesRouter,
  publicInvoicesRouter,
} from './routes/invoices.routes';
import { automationRouter } from './routes/automation.routes';
import { portalRouter, publicPortalRouter } from './routes/portal.routes';
import { intakeRouter, publicIntakeRouter } from './routes/intake.routes';
import { productMetricsRouter } from './routes/productMetrics.routes';
import { requireAuth } from './middleware/auth';
import { asyncHandler } from './utils/asyncHandler';
import * as filesService from './services/files.service';
import { requestScope } from './lib/tenant';
import { trustProxySetting } from './config/production';
import { LIMITS, limitByIp } from './lib/rateLimit';
import { pool } from './db';
import fs from 'fs';

export const app = express();

// The client's address comes from X-Forwarded-For only when the hop that
// sent it is trusted (default: loopback, the frontend's /api rewrite on the
// same host). Rate limits key on req.ip, never on the raw header.
app.set('trust proxy', trustProxySetting());

// Browsers reach the API through the frontend's same-origin /api rewrite,
// so CORS only matters for a direct caller. Extra origins (a LAN address or
// a tunnel in development) go in CORS_ORIGINS, never in code.
const corsOrigins = [
  env.frontendUrl,
  ...(process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
];

app.use(helmet());
app.use(
  cors({
    origin: corsOrigins,
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());
app.use(morgan('dev'));

// Client-facing token pages: reads and answers are limited per client
// address. Tokens are unguessable; this caps load and scraping, not guessing.
const publicReads = limitByIp(LIMITS.publicRead);
const publicAnswers = limitByIp(LIMITS.publicAnswer);
const limitPublic: express.RequestHandler = (req, res, next) =>
  req.method === 'GET' || req.method === 'HEAD'
    ? publicReads(req, res, next)
    : next();
const limitPublicAnswers: express.RequestHandler = (req, res, next) =>
  req.method === 'GET' || req.method === 'HEAD'
    ? next()
    : publicAnswers(req, res, next);

// Routes
app.use('/auth', authRouter);
app.use('/me', meRouter);
app.use('/company/workspace-defaults', workspaceDefaultsRouter);
app.use('/company', companyRouter);
app.use('/leads', leadsRouter);
app.use('/tasks', tasksRouter);
app.use('/dashboard', dashboardRouter);
app.use('/integrations', integrationsRouter);
app.use('/users', usersRouter);
app.use('/files', filesRouter);
app.use('/notifications', notificationRouter);
app.use('/jobs', jobsRouter);
app.use('/estimates', estimatesRouter);
app.use('/estimate-templates', estimateTemplatesRouter);
app.use('/public/estimates', limitPublic, limitPublicAnswers, publicEstimatesRouter);
app.use('/public/companies', publicCompaniesRouter);
app.use('/notes', notesRouter);
app.use('/search', searchRouter);
app.use('/reports', reportsRouter);
app.use('/saved-views', savedViewsRouter);
app.use('/help', helpRouter);
app.use('/invoices', invoicesRouter);
app.use('/public/invoices', limitPublic, publicInvoicesRouter);
app.use('/automation', automationRouter);
app.use('/portal', portalRouter);
app.use('/public/portal', limitPublic, publicPortalRouter);
app.use('/intake', intakeRouter);
app.use('/public/intake', limitPublic, publicIntakeRouter);
app.use('/product-metrics', productMetricsRouter);

app.get(
  '/uploads/{*storageKey}',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { companyId } = requestScope(req);
    const raw = req.params.storageKey;
    const storageKey = (Array.isArray(raw) ? raw.join('/') : String(raw || ''))
      .replace(/^\/+/, '')
      .replace(/\/+$/, '');
    if (!storageKey) {
      return res.status(404).json({ ok: false, error: 'File not found' });
    }

    try {
      const file = await filesService.getFileByStorageKey(companyId, storageKey);
      const filePath = filesService.absoluteUploadPath(file.storage_key);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ ok: false, error: 'File not found' });
      }
      if (file.mime_type) {
        res.type(file.mime_type);
      }
      res.sendFile(filePath);
    } catch (error) {
      if (error instanceof filesService.FileNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      throw error;
    }
  })
);

if (process.env.NODE_ENV !== 'test') {
  setInterval(
    () => {
      runTaskNotificationJob().catch(console.error);
    },
    1000 * 60 * 5
  );

  setInterval(
    () => {
      runInvoiceReminderJob().catch(console.error);
    },
    1000 * 60 * 15
  );
}

const HEALTH_DB_TIMEOUT_MS = 2000;

// Liveness that means something: answers 503 when the database is not
// reachable, so a host's health check restarts or alerts on the real fault.
app.get('/health', async (_req, res) => {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      pool.query('SELECT 1'),
      new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('database timeout')),
          HEALTH_DB_TIMEOUT_MS
        );
      }),
    ]);
    res.json({
      ok: true,
      service: 'crm-backend',
      database: 'ok',
      time: new Date().toISOString(),
    });
  } catch {
    res.status(503).json({
      ok: false,
      service: 'crm-backend',
      database: 'unreachable',
      time: new Date().toISOString(),
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
});

app.use(errorHandler);
