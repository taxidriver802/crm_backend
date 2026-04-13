import { pool } from '../db';

type SearchResult = {
  leads: Array<{
    id: number;
    first_name: string;
    last_name: string;
    email: string | null;
    status: string;
  }>;
  jobs: Array<{
    id: number;
    title: string;
    address: string | null;
    status: string;
  }>;
  tasks: Array<{
    id: number;
    title: string;
    status: string;
    due_date: string | null;
  }>;
};

export async function searchWorkspace(
  userId: string,
  query: string,
  limitPerType = 5
): Promise<SearchResult> {
  const term = `%${query}%`;
  const [leads, jobs, tasks] = await Promise.all([
    pool.query(
      `
      SELECT id, first_name, last_name, email, status
      FROM leads
      WHERE user_id = $1
        AND (
          first_name ILIKE $2
          OR last_name ILIKE $2
          OR email ILIKE $2
          OR phone ILIKE $2
        )
      ORDER BY updated_at DESC, id DESC
      LIMIT $3
      `,
      [userId, term, limitPerType]
    ),
    pool.query(
      `
      SELECT id, title, address, status
      FROM jobs
      WHERE user_id = $1
        AND (
          title ILIKE $2
          OR description ILIKE $2
          OR address ILIKE $2
        )
      ORDER BY updated_at DESC, id DESC
      LIMIT $3
      `,
      [userId, term, limitPerType]
    ),
    pool.query(
      `
      SELECT id, title, status, due_date
      FROM tasks
      WHERE user_id = $1
        AND (
          title ILIKE $2
          OR description ILIKE $2
        )
      ORDER BY updated_at DESC, id DESC
      LIMIT $3
      `,
      [userId, term, limitPerType]
    ),
  ]);

  return {
    leads: leads.rows,
    jobs: jobs.rows,
    tasks: tasks.rows,
  };
}
