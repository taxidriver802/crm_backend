import dotenv from 'dotenv';

dotenv.config({ path: '.env.test' });

import { pool } from '../src/db';

export default async function () {
  await pool.end();
}
