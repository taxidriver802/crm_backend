import { pool } from "../../src/db";

export async function resetDb() {
  await pool.query("TRUNCATE tasks, leads, users RESTART IDENTITY CASCADE;");
}