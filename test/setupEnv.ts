import dotenv from 'dotenv';
import os from 'os';
import path from 'path';

dotenv.config({
  path: '.env.test',
  quiet: true,
});

// Tests upload and delete files freely. Give them their own directory so a
// test run can never touch the uploads a running app serves, whatever
// .env.test says.
process.env.UPLOADS_DIR = path.join(os.tmpdir(), `joist-jest-uploads-${process.pid}`);
