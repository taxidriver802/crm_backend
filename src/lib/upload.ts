import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { uploadsRoot } from './uploadsDir';

fs.mkdirSync(uploadsRoot(), { recursive: true });

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const companyId = (req as { user?: { companyId?: string } }).user?.companyId;
    if (!companyId) {
      cb(new Error('Missing company context'), '');
      return;
    }
    const dir = path.join(uploadsRoot(), companyId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const ext = path.extname(file.originalname);
    cb(null, `${unique}${ext}`);
  },
});

export const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
});
