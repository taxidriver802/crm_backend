import { Router } from 'express';
import { abcRouter } from './abc.routes';
import { quickbooksRouter } from './quickbooks.routes';

export const integrationsRouter = Router();

integrationsRouter.use('/abc', abcRouter);
integrationsRouter.use('/quickbooks', quickbooksRouter);
