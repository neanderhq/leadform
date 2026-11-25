import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';
import { initializeSchema } from '../db/schema.mjs';

const design = { primary: '#5366d8', background: '#f7f7f5', text: '#202124', logo: '' };
const question = (id, title, type = 'short', required = true) => ({ id, title, type, required });
export const examples = [
  {
    id: 'sample-project-enquiry', title: 'Project enquiry', description: 'Tell our fictional creative studio about your next project.',
    questions: [question('name', 'What is your name?'), question('email', 'Your email address', 'email'), { ...question('service', 'How can we help?', 'multiple'), options: ['Website', 'Branding', 'Just exploring'], rules: { 'Just exploring': 'notes' }, defaultNext: '' }, question('budget', 'What is your budget?', 'number', false), question('notes', 'Anything else we should know?', 'short', false)],
    responses: [{ name: 'Alex Rivera', email: 'alex.rivera@example.invalid', service: 'Website', budget: '4000', notes: 'A welcoming website for our fictional community studio.' }, { name: 'Sam Taylor', email: 'sam.taylor@example.invalid', service: 'Just exploring', notes: 'Looking for ideas for a future launch.' }],
  },
  {
    id: 'sample-workshop-feedback', title: 'Workshop feedback', description: 'Help us improve our fictional design workshop.',
    questions: [question('name', 'Your name'), question('rating', 'How was the workshop?', 'rating'), { ...question('recommend', 'Would you recommend it?', 'yesno'), rules: {}, defaultNext: '' }, question('notes', 'What could we improve?', 'short', false)],
    responses: [{ name: 'Jordan Lee', rating: '5', recommend: 'Yes', notes: 'More time for the hands-on exercise.' }, { name: 'Casey Morgan', rating: '4', recommend: 'Yes', notes: 'The examples were easy to follow.' }],
  },
  {
    id: 'sample-event-registration', title: 'Community meetup', description: 'Register for our fictional community meetup.',
    questions: [question('name', 'Your name'), question('email', 'Your email address', 'email'), { ...question('topic', 'Which topic interests you?', 'multiple'), options: ['Design', 'Development', 'Community'], rules: {}, defaultNext: '' }],
    responses: [{ name: 'Taylor Brooks', email: 'taylor.brooks@example.invalid', topic: 'Design' }],
  },
];

export async function seed(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 10000, statement_timeout: 30000 });
  let client;
  try {
    await initializeSchema(pool);
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('leadform-template-seed-v1'))");
    if ((await client.query('SELECT value FROM app_settings WHERE key=$1', ['template_seed_v1'])).rowCount) {
      await client.query('COMMIT');
      return { created: false };
    }
    for (const [formIndex, form] of examples.entries()) {
      const created = new Date(Date.now() - (3 - formIndex) * 86400000).toISOString();
      const snapshot = { version: 1, title: form.title, description: form.description, questions: form.questions, design };
      await client.query(
        'INSERT INTO forms (id,title,description,questions,design,created_at,updated_at,published_snapshot) VALUES ($1,$2,$3,$4,$5,$6,$6,$7)',
        [form.id, form.title, form.description, JSON.stringify(form.questions), JSON.stringify(design), created, JSON.stringify(snapshot)]
      );
      for (const [index, answers] of form.responses.entries()) {
        await client.query('INSERT INTO responses (id,form_id,answers,submitted_at) VALUES ($1,$2,$3,$4)', [`${form.id}-response-${index}`, form.id, JSON.stringify(answers), new Date(Date.now() - (index + 1) * 3600000).toISOString()]);
      }
    }
    await client.query('INSERT INTO app_settings (key,value) VALUES ($1,$2)', ['template_seed_v1', 'complete']);
    await client.query('COMMIT');
    return { created: true };
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    throw error;
  } finally {
    if (client) client.release();
    await pool.end();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await seed();
  console.log(result.created ? 'Fictional forms and responses initialized.' : 'Template already initialized; user changes preserved.');
}
