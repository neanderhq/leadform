import { readFile } from 'node:fs/promises';

// Startup and seed use the same versioned schema, including the session store.
// The deployed app already initializes its schema at startup. Preserve that path
// rather than claiming a migration profile the shared publisher does not support.
export async function initializeSchema(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('leadform-schema-v1'))");
    for (const name of ['001-initial.sql', '002-form-publication.sql', '003-response-alerts.sql']) {
      await client.query(await readFile(new URL(`./schema/${name}`, import.meta.url), 'utf8'));
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
