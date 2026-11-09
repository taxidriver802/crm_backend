# Migrations

Each schema change after the baseline (`../schema.sql`) is one file here,
named with the next four-digit number and a short description:

    0001_add_job_crew.sql

`npm run db:migrate` runs every file not yet recorded in the
`schema_migrations` table, in name order, each in its own transaction.

- Write forward-only SQL. There is no down step.
- Never edit a file once it has run anywhere: the runner refuses a changed
  checksum. Add another migration instead.
- Tests and the QA harness call the same runner, so a new file needs no
  list updated anywhere.
