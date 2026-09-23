import multer from 'multer';
import path from 'path';
import fs from 'fs';

const uploadRoot = path.join(process.cwd(), 'uploads');

if (!fs.existsSync(uploadRoot)) {
  fs.mkdirSync(uploadRoot);
}

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const companyId = (req as { user?: { companyId?: string } }).user?.companyId;
    if (!companyId) {
      cb(new Error('Missing company context'), '');
      return;
    }
    const dir = path.join(uploadRoot, companyId);
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
