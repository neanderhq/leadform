import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { Pool } from 'pg';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { initializeSchema } from './db/schema.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const name of ['DATABASE_URL', 'OWNER_PASSWORD', 'SESSION_SECRET']) {
  if (!process.env[name]) throw new Error(`${name} is required`);
}
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
const sessionSecret = process.env.SESSION_SECRET;
const sessionStore = new (connectPgSimple(session))({ pool: pgPool, tableName: 'leadform_sessions', createTableIfMissing: false });
const app = express();
app.set('trust proxy', 1);
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
const ownerOnly = (req, res, next) => req.session.owner ? next() : res.status(401).json({ error: 'Owner login required' });
const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const now = () => new Date().toISOString();
const parseForm = (row) => ({ ...row, ...(row.response_count === undefined ? {} : { response_count: Number(row.response_count) }), questions: JSON.parse(row.questions), design: JSON.parse(row.design) });

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const expectedUser = 'admin';
  const expectedPassword = process.env.OWNER_PASSWORD;
  if (username !== expectedUser || password !== expectedPassword) return res.status(401).json({ error: 'Incorrect username or password' });
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
app.get('/api/session', (req, res) => res.json({ owner: Boolean(req.session.owner), showDefaults: false }));

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
  if (!await db.get('SELECT id FROM forms WHERE id=?', [req.params.id])) return res.status(404).json({ error: 'Form not found' });
  const validation = validateQuestions(questions);
  if (!validation.valid) return res.status(400).json({ error: validation.error, ...(validation.questionIndex === undefined ? {} : { questionIndex: validation.questionIndex }) });
  if (!isValidDesign(design)) return res.status(400).json({ error: 'Invalid design configuration' });
  const savedDesign = { ...defaultDesign, ...design };
  await db.run('UPDATE forms SET title=?,description=?,questions=?,design=?,updated_at=? WHERE id=?', [String(title || 'Untitled form').slice(0, 200), String(description || '').slice(0, 2000), JSON.stringify(questions), JSON.stringify(savedDesign), now(), req.params.id]);
  res.json(parseForm(await db.get('SELECT * FROM forms WHERE id=?', [req.params.id])));
}));
app.delete('/api/forms/:id', ownerOnly, asyncRoute(async (req, res) => {
  const result = await db.run('DELETE FROM forms WHERE id=?', [req.params.id]);
  result.changes ? res.json({ ok: true }) : res.status(404).json({ error: 'Form not found' });
}));
app.get('/api/forms/:id/responses', ownerOnly, asyncRoute(async (req, res) => {
  const form = await db.get('SELECT id,questions FROM forms WHERE id=?', [req.params.id]);
  if (!form) return res.status(404).json({ error: 'Form not found' });
  const responses = await db.all('SELECT id,answers,submitted_at FROM responses WHERE form_id=? ORDER BY submitted_at DESC', [req.params.id]);
  res.json({ questions: JSON.parse(form.questions), responses: responses.map(r => ({ id: r.id, answers: JSON.parse(r.answers), submittedAt: r.submitted_at })) });
}));

const publicForm = id => db.get('SELECT id,title,description,questions,design FROM forms WHERE id=?', [id]);
app.get('/api/public/forms/:id', asyncRoute(async (req, res) => {
  const form = await publicForm(req.params.id);
  if (!form) return res.status(404).json({ error: 'Form not found' });
  res.json({ ...form, questions: JSON.parse(form.questions), design: JSON.parse(form.design) });
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
  if (question.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(answer))) return 'Please enter a valid email address';
  if (question.type === 'number' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(String(answer).trim())) return 'Please enter a valid number';
  if (question.type === 'multiple' && !(question.options || []).includes(answer)) return 'Please choose an available option';
  if (question.type === 'yesno' && !['Yes', 'No'].includes(answer)) return 'Please choose Yes or No';
  if (question.type === 'rating' && !['1', '2', '3', '4', '5'].includes(String(answer))) return 'Please choose a rating from 1 to 5';
  return null;
};
app.post('/api/public/forms/:id/submit', asyncRoute(async (req, res) => {
  const form = await publicForm(req.params.id);
  if (!form) return res.status(404).json({ error: 'Form not found' });
  const questions = JSON.parse(form.questions);
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
  const responseId = crypto.randomUUID();
  await db.run('INSERT INTO responses (id,form_id,answers,submitted_at) VALUES (?,?,?,?)', [responseId, req.params.id, JSON.stringify(cleaned), now()]);
  res.json({ ok: true });
}));

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
const port = Number(process.env.PORT) || 3000;
app.listen(port, '0.0.0.0', () => console.log(`Leadform listening on http://localhost:${port}`));
