import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { rateLimit } from 'express-rate-limit';
import { validEmail } from './public/validation.js';
import { Pool } from 'pg';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { initializeSchema } from './db/schema.mjs';
import { createResponseAlerts } from './response-alerts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const name of ['DATABASE_URL', 'OWNER_PASSWORD', 'SESSION_SECRET', 'APP_ORIGIN']) {
  if (!process.env[name]) throw new Error(`${name} is required`);
}
const appUrl = new URL(process.env.APP_ORIGIN);
const appOrigin = appUrl.origin;
const loopback = appUrl.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(appUrl.hostname);
const embedAncestors = loopback
  ? 'https: http://localhost:* http://127.0.0.1:* http://[::1]:*'
  : 'https:';
const pgPool = new Pool({ connectionString: process.env.DATABASE_URL });
const postgresSql = sql => {
  let parameterIndex = 0;
  return sql.replace(/\?/g, () => `$${++parameterIndex}`);
};
const db = {
  async get(sql, values = []) { return (await pgPool.query(postgresSql(sql), values)).rows[0]; },
  async all(sql, values = []) { return (await pgPool.query(postgresSql(sql), values)).rows; },
  async run(sql, values = []) { return { changes: (await pgPool.query(postgresSql(sql), values)).rowCount }; }
};
await initializeSchema(pgPool);
const alerts = createResponseAlerts(pgPool, appOrigin);
const sessionSecret = process.env.SESSION_SECRET;
const sessionStore = new (connectPgSimple(session))({ pool: pgPool, tableName: 'leadform_sessions', createTableIfMissing: false });
const app = express();
app.set('trust proxy', 1);
app.use(rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false }));
app.use(express.json({ limit: '1mb' }));
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
app.use(session({
  name: 'leadform.sid',
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  ...(sessionStore ? { store: sessionStore } : {}),
  cookie: { httpOnly: true, sameSite: 'lax', secure: 'auto', maxAge: 7 * 24 * 60 * 60 * 1000 }
}));
const protectMutation = (req, res, next) => {
  if (req.get('origin') !== appOrigin || !req.session.csrfToken || req.get('x-csrf-token') !== req.session.csrfToken) {
    return res.status(403).json({ error: 'Request origin or CSRF token rejected' });
  }
  next();
};
const ownerOnly = (req, res, next) => {
  if (!req.session.owner) return res.status(401).json({ error: 'Owner login required' });
  return ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? next() : protectMutation(req, res, next);
};
const loginLimit = rateLimit({ windowMs: 15 * 60_000, limit: 10, skipSuccessfulRequests: true, standardHeaders: 'draft-8', legacyHeaders: false });
const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const now = () => new Date().toISOString();
const parseForm = ({ published_snapshot, ...row }) => ({
  ...row,
  ...(row.response_count === undefined ? {} : { response_count: Number(row.response_count) }),
  questions: JSON.parse(row.questions),
  design: JSON.parse(row.design),
  published_version: published_snapshot?.version ?? null
});

app.post('/api/login', protectMutation, loginLimit, (req, res) => {
  const { username, password } = req.body || {};
  const expectedUser = 'admin';
  const expectedPassword = Buffer.from(process.env.OWNER_PASSWORD);
  const suppliedPassword = typeof password === 'string' ? Buffer.from(password) : Buffer.alloc(0);
  if (username !== expectedUser || suppliedPassword.length !== expectedPassword.length || !crypto.timingSafeEqual(suppliedPassword, expectedPassword)) return res.status(401).json({ error: 'Incorrect username or password' });
  req.session.regenerate(error => {
    if (error) return res.status(500).json({ error: 'Unable to create owner session' });
    req.session.owner = true;
    req.session.save(saveError => saveError ? res.status(500).json({ error: 'Unable to create owner session' }) : res.json({ ok: true }));
  });
});
app.post('/api/logout', ownerOnly, (req, res) => req.session.destroy(() => {
  res.clearCookie('leadform.sid', { httpOnly: true, sameSite: 'lax', secure: req.secure });
  res.json({ ok: true });
}));
app.get('/api/session', (req, res) => {
  req.session.csrfToken ||= crypto.randomBytes(32).toString('hex');
  res.json({ owner: Boolean(req.session.owner), showDefaults: false, csrfToken: req.session.csrfToken });
});

app.get('/api/forms', ownerOnly, asyncRoute(async (_req, res) => {
  const rows = await db.all(`SELECT f.*, (SELECT COUNT(*) FROM responses r WHERE r.form_id=f.id) AS response_count FROM forms f ORDER BY f.created_at DESC`);
  res.json(rows.map(parseForm));
}));
app.post('/api/forms', ownerOnly, asyncRoute(async (req, res) => {
  const id = crypto.randomUUID();
  const timestamp = now();
  const title = String(req.body?.title || 'Untitled form').slice(0, 200);
  await db.run('INSERT INTO forms (id,title,description,questions,design,created_at,updated_at) VALUES (?,?,?,?,?,?,?)', [id, title, '', '[]', JSON.stringify(defaultDesign), timestamp, timestamp]);
  res.status(201).json(parseForm(await db.get('SELECT * FROM forms WHERE id=?', [id])));
}));
const defaultDesign = { primary: '#5366d8', background: '#f7f7f5', text: '#202124', logo: '' };
const questionTypes = new Set(['short', 'email', 'number', 'multiple', 'yesno', 'rating']);
const isValidDesign = design => {
  if (!design || typeof design !== 'object' || Array.isArray(design)) return false;
  if (![design.primary, design.background, design.text].every(color => typeof color === 'string' && /^#[\da-f]{6}$/i.test(color))) return false;
  if (typeof design.logo !== 'string') return false;
  if (!design.logo) return true;
  try { return ['http:', 'https:'].includes(new URL(design.logo).protocol); } catch { return false; }
};
const validateQuestions = questions => {
  const invalid = (error, questionIndex) => ({ valid: false, error, questionIndex });
  if (!Array.isArray(questions) || questions.length > 100) return invalid('Invalid question configuration');
  const ids = new Set();
  for (const [index, question] of questions.entries()) {
    if (!question || typeof question !== 'object' || Array.isArray(question)) return invalid('Invalid question configuration', index);
    if (typeof question.id !== 'string' || !question.id || ids.has(question.id)) return invalid('Invalid question configuration', index);
    if (!questionTypes.has(question.type) || typeof question.title !== 'string' || typeof question.required !== 'boolean') return invalid('Invalid question configuration', index);
    if (question.title.length > 500) return invalid('Invalid question configuration', index);
    if (question.type === 'multiple') {
      const options = question.options;
      const normalized = Array.isArray(options) ? options.map(option => typeof option === 'string' ? option.trim() : '') : [];
      if (!Array.isArray(options) || !options.length || options.length > 50 || normalized.some(option => !option) || new Set(normalized).size !== normalized.length) {
        return invalid(`Question ${index + 1}: choice options must be unique and not empty`, index);
      }
    }
    if (['multiple', 'yesno'].includes(question.type)) {
      const allowedChoices = question.type === 'multiple' ? question.options : ['Yes', 'No'];
      if (question.rules !== undefined && (!question.rules || typeof question.rules !== 'object' || Array.isArray(question.rules))) return invalid(`Question ${index + 1}: invalid branch rules`, index);
      for (const [choice, target] of Object.entries(question.rules || {})) {
        if (!allowedChoices.includes(choice) || (target !== '' && target !== 'default' && target !== 'end' && typeof target !== 'string')) return invalid(`Question ${index + 1}: invalid branch rules`, index);
      }
      if (question.defaultNext !== undefined && question.defaultNext !== '' && question.defaultNext !== 'end' && typeof question.defaultNext !== 'string') return invalid(`Question ${index + 1}: invalid default destination`, index);
    }
    ids.add(question.id);
  }
  const indexes = new Map(questions.map((question, index) => [question.id, index]));
  for (const [index, question] of questions.entries()) {
    if (!['multiple', 'yesno'].includes(question.type)) continue;
    const validTarget = target => target === '' || target === 'end' || (indexes.has(target) && indexes.get(target) > index);
    for (const target of Object.values(question.rules || {})) {
      if (target === 'default' || validTarget(target)) continue;
      return invalid(`Question ${index + 1}: branch destinations must be later questions or End`, index);
    }
    if (!validTarget(question.defaultNext)) return invalid(`Question ${index + 1}: branch destinations must be later questions or End`, index);
  }
  return { valid: true };
};
app.get('/api/forms/:id', ownerOnly, asyncRoute(async (req, res) => {
  const row = await db.get('SELECT * FROM forms WHERE id=?', [req.params.id]);
  row ? res.json(parseForm(row)) : res.status(404).json({ error: 'Form not found' });
}));
app.put('/api/forms/:id', ownerOnly, asyncRoute(async (req, res) => {
  const { title, description, questions, design } = req.body || {};
  const validation = validateQuestions(questions);
  if (!validation.valid) return res.status(400).json({ error: validation.error, ...(validation.questionIndex === undefined ? {} : { questionIndex: validation.questionIndex }) });
  if (!isValidDesign(design)) return res.status(400).json({ error: 'Invalid design configuration' });
  const savedDesign = { ...defaultDesign, ...design };
  const row = await db.get(
    'UPDATE forms SET title=?,description=?,questions=?,design=?,updated_at=?,draft_version=draft_version+1 WHERE id=? RETURNING *',
    [String(title || 'Untitled form').slice(0, 200), String(description || '').slice(0, 2000), JSON.stringify(questions), JSON.stringify(savedDesign), now(), req.params.id]
  );
  return row ? res.json(parseForm(row)) : res.status(404).json({ error: 'Form not found' });
}));
app.post('/api/forms/:id/publish', ownerOnly, asyncRoute(async (req, res) => {
  const version = req.body?.version;
  if (!Number.isSafeInteger(version) || version < 1 || version > 2147483647) {
    return res.status(400).json({ error: 'A saved draft version is required' });
  }
  const row = await db.get(`
    UPDATE forms SET published_snapshot=jsonb_build_object(
      'version', draft_version, 'title', title, 'description', description,
      'questions', questions::jsonb, 'design', design::jsonb
    )
    WHERE id=? AND draft_version=? AND jsonb_array_length(questions::jsonb)>0
    RETURNING *
  `, [req.params.id, version]);
  if (row) return res.json(parseForm(row));
  const current = await db.get('SELECT draft_version FROM forms WHERE id=?', [req.params.id]);
  if (!current) return res.status(404).json({ error: 'Form not found' });
  if (current.draft_version !== version) {
    return res.status(409).json({ error: 'The saved draft changed. Reload it before publishing.' });
  }
  return res.status(400).json({ error: 'Add at least one question before publishing' });
}));
app.delete('/api/forms/:id', ownerOnly, asyncRoute(async (req, res) => {
  const result = await db.run('DELETE FROM forms WHERE id=?', [req.params.id]);
  result.changes ? res.json({ ok: true }) : res.status(404).json({ error: 'Form not found' });
}));
app.get('/api/forms/:id/responses', ownerOnly, asyncRoute(async (req, res) => {
  const form = await db.get('SELECT published_snapshot FROM forms WHERE id=?', [req.params.id]);
  if (!form) return res.status(404).json({ error: 'Form not found' });
  const responses = await db.all('SELECT id,answers,submitted_at FROM responses WHERE form_id=? ORDER BY submitted_at DESC', [req.params.id]);
  res.json({ questions: form.published_snapshot?.questions ?? [], responses: responses.map(r => ({ id: r.id, answers: JSON.parse(r.answers), submittedAt: r.submitted_at })) });
}));


const responsePageSize = 20;
const isUtcDay = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

app.post('/api/forms/:id/responses/query', ownerOnly, asyncRoute(async (req, res) => {
  const { search = '', from = '', to = '', page = 1, exportAll = false } = req.body ?? {};
  if (typeof search !== 'string' || search.length > 200 || search.includes(String.fromCharCode(0))) {
    return res.status(400).json({ error: 'Enter search text of up to 200 characters.' });
  }
  if (typeof from !== 'string' || typeof to !== 'string' || (from && !isUtcDay(from)) || (to && !isUtcDay(to))) {
    return res.status(400).json({ error: 'Enter valid UTC dates.' });
  }
  if (from && to && from > to) return res.status(400).json({ error: 'End date must be on or after start date.' });
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000000 || typeof exportAll !== 'boolean') {
    return res.status(400).json({ error: 'Invalid response page.' });
  }

  const form = await db.get('SELECT published_snapshot FROM forms WHERE id=?', [req.params.id]);
  if (!form) return res.status(404).json({ error: 'Form not found' });

  // Submission timestamps are stored as UTC ISO strings, including the existing seed and historical records.
  const term = search.trim();
  const where = ['r.form_id=?'];
  const params = [req.params.id];
  if (from) {
    where.push('r.submitted_at>=?');
    params.push(from + 'T00:00:00.000Z');
  }
  if (to) {
    where.push('left(r.submitted_at,10)<=?');
    params.push(to);
  }
  if (term) {
    where.push('EXISTS (SELECT 1 FROM jsonb_each_text(r.answers::jsonb) answer WHERE strpos(lower(answer.value),lower(?))>0)');
    params.push(term);
  }
  const result = await db.get(`
    WITH matching AS (SELECT r.id, r.answers, r.submitted_at FROM responses r WHERE ${where.join(' AND ')}),
         response_page AS (
           SELECT * FROM matching ORDER BY submitted_at DESC, id DESC ${exportAll ? '' : 'LIMIT ? OFFSET ?'}
         )
    SELECT (SELECT count(*)::int FROM matching) AS total,
           COALESCE(json_agg(response_page ORDER BY submitted_at DESC, id DESC), '[]') AS rows
    FROM response_page
  `, exportAll ? params : [...params, responsePageSize, (page - 1) * responsePageSize]);
  res.json({
    questions: form.published_snapshot?.questions ?? [],
    responses: result.rows.map(row => ({ id: row.id, answers: JSON.parse(row.answers), submittedAt: row.submitted_at })),
    total: result.total,
    pageSize: responsePageSize,
  });
}));

async function alertSettings(id) {
  const form = await db.get('SELECT alerts_enabled FROM forms WHERE id=?', [id]);
  if (!form) return null;
  const status = await db.get(`
    SELECT count(*) FILTER (WHERE a.state IN ('queued','sending'))::int AS queued,
           count(*) FILTER (WHERE a.state='accepted')::int AS accepted,
           count(*) FILTER (WHERE a.state='failed')::int AS failed,
           count(*) FILTER (WHERE a.state='unconfirmed')::int AS unconfirmed
    FROM response_alerts a JOIN responses r ON r.id=a.response_id WHERE r.form_id=?
  `, [id]);
  return { enabled: form.alerts_enabled, configured: alerts.configured, ...status };
}

app.get('/api/forms/:id/alerts', ownerOnly, asyncRoute(async (req, res) => {
  void alerts.processQueue();
  const status = await alertSettings(req.params.id);
  return status ? res.json(status) : res.status(404).json({ error: 'Form not found' });
}));
app.put('/api/forms/:id/alerts', ownerOnly, asyncRoute(async (req, res) => {
  const enabled = req.body?.enabled;
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'Choose whether to enable email alerts.' });
  if (enabled && !alerts.configured) return res.status(409).json({ error: 'Email delivery is not configured for this workspace.' });
  const updated = await db.run('UPDATE forms SET alerts_enabled=? WHERE id=?', [enabled, req.params.id]);
  if (!updated.changes) return res.status(404).json({ error: 'Form not found' });
  res.json(await alertSettings(req.params.id));
}));

const publicForm = async id => {
  const row = await db.get('SELECT published_snapshot FROM forms WHERE id=?', [id]);
  return row?.published_snapshot ? { id, ...row.published_snapshot } : null;
};
app.get('/api/public/forms/:id', asyncRoute(async (req, res) => {
  const form = await publicForm(req.params.id);
  if (!form) return res.status(404).json({ error: 'Form not found' });
  res.json(form);
}));
const nextId = (question, value, allQuestions, index) => {
  let target;
  if (['multiple', 'yesno'].includes(question.type)) {
    const rule = question.rules?.[String(value)];
    target = rule === 'default' ? question.defaultNext : rule ?? question.defaultNext;
  }
  if (target === 'end') return null;
  if (typeof target === 'string' && target) return allQuestions.findIndex(item => item.id === target);
  return index + 1 < allQuestions.length ? index + 1 : null;
};
const pathForAnswers = (questions, answers) => {
  const path = [];
  let index = 0;
  for (let count = 0; index !== null && index >= 0 && count < questions.length + 1; count++) {
    const question = questions[index];
    if (!question || path.includes(question.id)) break;
    path.push(question.id);
    index = nextId(question, answers[question.id], questions, index);
  }
  return path;
};
const validate = (question, answer) => {
  const empty = answer === undefined || answer === null || String(answer).trim() === '';
  if (question.required && empty) return 'This question is required';
  if (empty) return null;
  if (!['string', 'number'].includes(typeof answer)) return 'Invalid answer';
  if (question.type === 'email' && !validEmail(String(answer))) return 'Please enter a valid email address';
  if (question.type === 'number' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(String(answer).trim())) return 'Please enter a valid number';
  if (question.type === 'multiple' && !(question.options || []).includes(answer)) return 'Please choose an available option';
  if (question.type === 'yesno' && !['Yes', 'No'].includes(answer)) return 'Please choose Yes or No';
  if (question.type === 'rating' && !['1', '2', '3', '4', '5'].includes(String(answer))) return 'Please choose a rating from 1 to 5';
  return null;
};
app.post('/api/public/forms/:id/submit', asyncRoute(async (req, res) => {
  const form = await publicForm(req.params.id);
  if (!form) return res.status(404).json({ error: 'Form not found' });
  const requestedVersion = req.body?.version;
  if (requestedVersion !== undefined && requestedVersion !== form.version) {
    return res.status(409).json({ error: 'This form changed while you were answering. Reload to use the current version.' });
  }
  const questions = form.questions;
  if (!questions.length) return res.status(400).json({ error: 'This form has no questions' });
  const incoming = req.body?.answers;
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return res.status(400).json({ error: 'Invalid submission' });
  const path = pathForAnswers(questions, incoming);
  if (!path.length && questions.length) return res.status(400).json({ error: 'Form is not complete' });
  const cleaned = {};
  for (const id of path) {
    const question = questions.find(item => item.id === id);
    if (!question) continue;
    const answer = incoming[id];
    const error = validate(question, answer);
    if (error) return res.status(400).json({ error, questionId: id });
    if (answer !== undefined && answer !== null) cleaned[id] = String(answer);
  }
  if (path.at(-1) && nextId(questions.find(item => item.id === path.at(-1)), cleaned[path.at(-1)], questions, questions.findIndex(q => q.id === path.at(-1))) !== null) return res.status(400).json({ error: 'Form is not complete' });
  const token = req.body?.submissionId;
  if (token !== undefined && (typeof token !== 'string' || !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(token))) {
    return res.status(400).json({ error: 'Invalid submission identifier' });
  }
  const responseId = token
    ? crypto.createHash('sha256').update(JSON.stringify([form.id, token.toLowerCase()])).digest('hex')
    : crypto.randomUUID();
  const answers = JSON.stringify(cleaned);
  const message = alerts.payload(form.id);
  const saved = await db.get(`
    WITH saved AS (
      INSERT INTO responses (id,form_id,answers,submitted_at)
      SELECT ?, id, ?, ? FROM forms WHERE id=? AND published_snapshot->>'version'=?
      ON CONFLICT (id) DO NOTHING
      RETURNING id, form_id
    ), queued AS (
      INSERT INTO response_alerts (response_id,payload)
      SELECT saved.id, delivery.payload
      FROM saved JOIN forms f ON f.id=saved.form_id
      CROSS JOIN (SELECT ?::jsonb AS payload) delivery
      WHERE f.alerts_enabled AND delivery.payload IS NOT NULL
      RETURNING response_id
    )
    SELECT (SELECT id FROM saved) AS id, (SELECT response_id FROM queued) AS queued
  `, [responseId, answers, now(), form.id, String(form.version), message ? JSON.stringify(message) : null]);
  if (!saved.id) {
    const replay = token && await db.get('SELECT answers FROM responses WHERE id=? AND form_id=?', [responseId, form.id]);
    if (replay) return replay.answers === answers
      ? res.json({ ok: true })
      : res.status(409).json({ error: 'This submission was already received with different answers.' });
    return res.status(409).json({ error: 'This form changed while you were answering. Reload to use the current version.' });
  }
  res.json({ ok: true });
  if (saved.queued) void alerts.processQueue();
}));

app.get(/^\/embed\/[^/]+$/, (_req, res) => {
  res.set('Content-Security-Policy', `frame-ancestors ${embedAncestors}`);
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.use((_req, res, next) => {
  res.set('Content-Security-Policy', "frame-ancestors 'none'");
  res.set('X-Frame-Options', 'DENY');
  next();
});
app.get('/vendor/purify.min.js', (_req, res) => res.sendFile(path.join(__dirname, 'node_modules/dompurify/dist/purify.min.js')));
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
const port = Number(process.env.PORT) || 3000;
app.listen(port, '0.0.0.0', () => {
  console.log(`Leadform listening on http://localhost:${port}`);
  if (alerts.configured) {
    void alerts.processQueue();
    setInterval(() => void alerts.processQueue(), 2000).unref();
  }
});
