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
import { jobsRouter } from './routes/jobs.routes';

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

if (process.env.NODE_ENV !== 'test') {
  setInterval(
    () => {
      runTaskNotificationJob().catch(console.error);
    },
    1000 * 60 * 5
  );
} // every 5 minutes

app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'crm-backend',
    time: new Date().toISOString(),
  });
});

app.use(errorHandler);
