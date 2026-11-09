/**
 * Bring the database in DATABASE_URL up to date.
 *
 *   npm run db:migrate
 *
 * An empty database gets the baseline (sql/schema.sql); one built from the
 * old patch chain is brought up to it; then every new file in
 * sql/migrations/ runs once. See scripts/lib/migrations.js.
 */
require('dotenv').config({ quiet: true });
const { Client } = require('pg');
const { migrate } = require('./lib/migrations');

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is missing');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const applied = await migrate(client, { log: (line) => console.log(`[migrate] ${line}`) });
    const db = (await client.query('SELECT current_database() AS db')).rows[0].db;
    console.log(applied.length ? `[migrate] ${db} is up to date.` : `[migrate] ${db} was already up to date.`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`[migrate] failed: ${error.message}`);
  process.exit(1);
});
