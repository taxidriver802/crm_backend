import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { createNoteSchema, listNotesSchema } from '../validators/notes.schemas';
import * as notesService from '../services/notes.service';

export const notesRouter = Router();

notesRouter.use(requireAuth);

// GET /notes?entity_type=lead&entity_id=123
notesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const rawEntityType = req.query.entity_type;
    const rawEntityId = req.query.entity_id;
    const parsed = listNotesSchema.safeParse({
      entity_type: rawEntityType,
      entity_id:
        typeof rawEntityId === 'string' ? Number(rawEntityId) : rawEntityId,
    });

    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.flatten() });
    }

    try {
      const notes = await notesService.listNotes(
        req.user!.userId,
        parsed.data.entity_type,
        parsed.data.entity_id
      );
      return res.json({ ok: true, notes });
    } catch (error) {
      if (error instanceof notesService.NoteEntityNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      throw error;
    }
  })
);

// POST /notes
notesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = createNoteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.flatten() });
    }

    try {
      const note = await notesService.createNote(req.user!.userId, parsed.data);
      return res.status(201).json({ ok: true, note });
    } catch (error) {
      if (error instanceof notesService.NoteEntityNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      throw error;
    }
  })
);

// DELETE /notes/:id
notesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid id' });
    }

    try {
      const deletedId = await notesService.deleteNote(req.user!.userId, id);
      return res.json({ ok: true, deletedId });
    } catch (error) {
      if (error instanceof notesService.NoteNotFoundError) {
        return res.status(404).json({ ok: false, error: error.message });
      }
      throw error;
    }
  })
);
