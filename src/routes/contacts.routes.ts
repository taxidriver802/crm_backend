import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { requestScope } from '../lib/tenant';
import * as contactsService from '../services/contacts.service';
import {
  contactHistorySchema,
  createContactSchema,
  listContactsSchema,
  matchContactsSchema,
  updateContactSchema,
} from '../validators/contacts.schemas';

export const contactsRouter = Router();

contactsRouter.use(requireAuth);

function contactId(raw: unknown) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// GET /contacts?tab=customers&kind=adjuster&assignedTo=…&q=…&place=55447&sort=name&limit=50&offset=0
contactsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = listContactsSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.flatten() });
    }
    const { archived, ...filters } = parsed.data;
    const result = await contactsService.listContacts(requestScope(req, true), {
      ...filters,
      includeArchived: archived === 'include',
    });
    res.json({ ok: true, ...result });
  })
);

// GET /contacts/matches?phone=…&email=…&address=…&exclude=12
// Possible duplicates for the create and edit forms: warn, don't block.
contactsRouter.get(
  '/matches',
  asyncHandler(async (req, res) => {
    const parsed = matchContactsSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.flatten() });
    }
    const matches = await contactsService.findMatches(requestScope(req, true), parsed.data);
    res.json({ ok: true, matches });
  })
);

// GET /contacts/:id
contactsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = contactId(req.params.id);
    if (id == null) return res.status(400).json({ ok: false, error: 'Invalid id' });
    const record = await contactsService.getContact(requestScope(req, true), id);
    res.json({ ok: true, ...record });
  })
);

// GET /contacts/:id/history?kind=calls&cursor=…&limit=50
contactsRouter.get(
  '/:id/history',
  asyncHandler(async (req, res) => {
    const id = contactId(req.params.id);
    if (id == null) return res.status(400).json({ ok: false, error: 'Invalid id' });
    const parsed = contactHistorySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.flatten() });
    }
    const history = await contactsService.getContactHistory(requestScope(req, true), id, parsed.data);
    res.json({ ok: true, ...history });
  })
);

// POST /contacts
contactsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = createContactSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.flatten() });
    }
    const record = await contactsService.createContact(
      requestScope(req, true),
      req.user?.role,
      parsed.data
    );
    res.status(201).json({ ok: true, ...record });
  })
);

// PATCH /contacts/:id
contactsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = contactId(req.params.id);
    if (id == null) return res.status(400).json({ ok: false, error: 'Invalid id' });
    const parsed = updateContactSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.flatten() });
    }
    if (Object.keys(parsed.data).length === 0) {
      return res.status(400).json({ ok: false, error: 'No fields to update' });
    }
    try {
      const record = await contactsService.updateContact(
        requestScope(req, true),
        req.user?.role,
        id,
        parsed.data
      );
      res.json({ ok: true, ...record });
    } catch (error) {
      if (error instanceof contactsService.ContactMergedError) {
        return res
          .status(409)
          .json({ ok: false, error: error.message, merged_into_id: error.mergedIntoId });
      }
      // The database's own rule: a contact needs some name.
      if ((error as { code?: string }).code === '23514') {
        return res
          .status(400)
          .json({ ok: false, error: 'A contact needs a name or a company name' });
      }
      throw error;
    }
  })
);
