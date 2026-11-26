import dotenv from 'dotenv';
import os from 'os';
import path from 'path';

dotenv.config({
  path: '.env.test',
  quiet: true,
});

// Tests TRUNCATE every table. Refuse any database whose name doesn't end in
// `_test` before anything connects: on a host without .env.test, a
// production DATABASE_URL in the environment would otherwise be emptied.
{
  const url = process.env.DATABASE_URL ?? '';
  let database = '';
  try {
    database = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  } catch {
    // Not a URL: refused below.
  }
  if (!/_test$/.test(database)) {
    throw new Error(
      `Refusing to run tests against database "${database || url.replace(/\/\/[^@]*@/, '//***@') || '(unset)'}": ` +
        'tests empty every table, so DATABASE_URL must name a database ending in _test (see .env.test).'
    );
  }
}

// Tests upload and delete files freely. Give them their own directory so a
// test run can never touch the uploads a running app serves, whatever
// .env.test says.
process.env.UPLOADS_DIR = path.join(os.tmpdir(), `joist-jest-uploads-${process.pid}`);
