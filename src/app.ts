import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import path from 'path';

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
import { publicEstimatesRouter } from './routes/publicEstimates.routes';
import { notesRouter } from './routes/notes.routes';
import { searchRouter } from './routes/search.routes';
import { reportsRouter } from './routes/reports.routes';
import { savedViewsRouter } from './routes/savedViews.routes';
import { invoicesRouter } from './routes/invoices.routes';
import { automationRouter } from './routes/automation.routes';
import { portalRouter, publicPortalRouter } from './routes/portal.routes';
import { productMetricsRouter } from './routes/productMetrics.routes';

export const app = express();

app.use(helmet());
app.use(
  cors({
    origin: [
      env.frontendUrl,
      'https://unusuriously-interlocutory-dann.ngrok-free.dev',
    ],
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());
app.use(morgan('dev'));

// Routes
app.use('/auth', authRouter);
app.use('/leads', leadsRouter);
app.use('/tasks', tasksRouter);
app.use('/dashboard', dashboardRouter);
app.use('/integrations', integrationsRouter);
app.use('/users', usersRouter);
app.use('/files', filesRouter);
app.use('/notifications', notificationRouter);
app.use('/jobs', jobsRouter);
app.use('/estimates', estimatesRouter);
app.use('/public/estimates', publicEstimatesRouter);
app.use('/notes', notesRouter);
app.use('/search', searchRouter);
app.use('/reports', reportsRouter);
app.use('/saved-views', savedViewsRouter);
app.use('/invoices', invoicesRouter);
app.use('/automation', automationRouter);
app.use('/portal', portalRouter);
app.use('/public/portal', publicPortalRouter);
app.use('/product-metrics', productMetricsRouter);

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

app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'crm-backend',
    time: new Date().toISOString(),
  });
});

app.use(errorHandler);
