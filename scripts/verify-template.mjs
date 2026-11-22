import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, expect } from '@playwright/test';
import { Client } from 'pg';
import { seed } from '../.neander/seed.mjs';

const exec = promisify(execFile);
const image = process.env.NEANDER_TEMPLATE_IMAGE;
const databaseUrl = process.env.NEANDER_TEMPLATE_TEST_DATABASE_URL;
assert.ok(image, 'The shared verifier must supply its built image');
assert.ok(databaseUrl, 'An explicitly disposable test database is required');
assert.equal(process.env.DATABASE_URL, databaseUrl);
const origin = new URL(process.env.NEANDER_TEMPLATE_TEST_ORIGIN || 'http://127.0.0.1:8080');
assert.equal(origin.protocol, 'http:');
assert.ok(['127.0.0.1', 'localhost'].includes(origin.hostname));
const name = `leadform-template-check-${randomUUID().slice(0, 12)}`;
const directory = await mkdtemp(join(tmpdir(), 'leadform-template-'));
const bundle = join(directory, 'neander_environment');
const runtimeDatabase = new URL(databaseUrl);
if (process.platform === 'darwin' && ['localhost', '127.0.0.1'].includes(runtimeDatabase.hostname)) runtimeDatabase.hostname = 'host.docker.internal';
const environment = { DATABASE_URL: runtimeDatabase.href, OWNER_PASSWORD: process.env.OWNER_PASSWORD, SESSION_SECRET: process.env.SESSION_SECRET, APP_ORIGIN: origin.origin };
assert.ok(environment.OWNER_PASSWORD && environment.SESSION_SECRET);
await writeFile(bundle, Object.entries(environment).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o644 });
const db = new Client({ connectionString: databaseUrl });
let browser;
let connected = false;
async function ready() {
  for (let attempt = 0; attempt < 120; attempt++) {
    try { if ((await fetch(`${origin.origin}/api/session`)).ok) return; } catch {}
    await delay(500);
  }
  throw new Error('Built image did not become ready within 60 seconds');
}
async function json(response, status = 200) {
  assert.equal(response.status(), status, await response.text());
  return response.json();
}
try {
  const networking = process.platform === 'linux' ? ['--network', 'host', '--env', `PORT=${origin.port || 80}`] : ['--publish', `127.0.0.1:${origin.port || 80}:8080`];
  await exec('docker', ['run', '--detach', '--name', name, '--mount', `type=bind,src=${bundle},dst=/run/secrets/neander_environment,readonly`, ...networking, image], { timeout: 60000 });
  await ready();
  await db.connect(); connected = true;
  assert.equal((await db.query('SELECT count(*)::int AS count FROM forms')).rows[0].count, 3);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM responses')).rows[0].count, 5);
  assert.deepEqual(await seed(databaseUrl), { created: false });
  await exec('npx', ['playwright', 'install', ...(process.platform === 'linux' ? ['--with-deps'] : []), 'chromium'], { timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'UTC', extraHTTPHeaders: { origin: origin.origin } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.setDefaultTimeout(15000);
  const anonymous = await browser.newContext();
  const ownerRequest = async (method, path, options = {}) => {
    const state = await json(await context.request.get(`${origin.origin}/api/session`));
    return context.request[method](`${origin.origin}${path}`, { ...options, headers: { 'x-csrf-token': state.csrfToken, ...options.headers } });
  };
  const anonymousState = await json(await anonymous.request.get(`${origin.origin}/api/session`));

  assert.equal((await anonymous.request.get(`${origin.origin}/api/forms`)).status(), 401);
  assert.equal((await anonymous.request.post(`${origin.origin}/api/login`, { headers: { origin: origin.origin, 'x-csrf-token': anonymousState.csrfToken }, data: { username: 'admin', password: 'leadform123' } })).status(), 401);
  await page.goto(origin.origin);
  await page.getByLabel('Username').fill('admin');
  await page.getByLabel('Password').fill(environment.OWNER_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your forms' })).toBeVisible();
  await expect(page.locator('.form-card')).toHaveCount(3);
  await expect(page.getByRole('heading', { name: 'Project enquiry', exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  if (process.env.NEANDER_TEMPLATE_SCREENSHOT) await page.screenshot({ path: process.env.NEANDER_TEMPLATE_SCREENSHOT, fullPage: true, animations: 'disabled' });
  await json(await ownerRequest('post', `/api/forms`, { headers: { origin: 'https://attacker.example' }, data: {} }), 403);
  await json(await ownerRequest('post', `/api/forms`, { headers: { origin: '' }, data: {} }), 403);
  await json(await context.request.post(`${origin.origin}/api/forms`, { data: {} }), 403);
  await json(await context.request.post(`${origin.origin}/api/forms`, { headers: { 'x-csrf-token': 'wrong-fixture-token' }, data: {} }), 403);
  const fixture = await json(await context.request.get(`${origin.origin}/api/forms/sample-project-enquiry`));
  await page.goto(`${origin.origin}/edit/${fixture.id}`);
  await expect(page.getByLabel('Form title')).toHaveValue('Project enquiry');
  await page.getByLabel('Form title').fill('Project enquiry — edited');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#save-state')).toHaveText('Saved');

  const respondent = await anonymous.newPage();
  respondent.on('pageerror', error => pageErrors.push(error.message));
  await respondent.goto(`${origin.origin}/f/${fixture.id}`);
  await respondent.getByLabel('What is your name?').fill('Casey Template');
  await respondent.locator('#next').click();
  await respondent.getByLabel('Your email address').fill('casey.template@example.invalid');
  await respondent.locator('#next').click();
  await respondent.getByRole('button', { name: 'Just exploring' }).click();
  await respondent.locator('#next').click();
  await expect(respondent.getByLabel('Anything else we should know?')).toBeVisible();
  await expect(respondent.getByText('What is your budget?', { exact: true })).toHaveCount(0);
  await respondent.getByLabel('Anything else we should know?').fill('A fictional browser submission.');
  await respondent.getByRole('button', { name: 'Submit' }).click();
  await expect(respondent.getByRole('heading', { name: 'Thank you' })).toBeVisible();
  await json(await anonymous.request.post(`${origin.origin}/api/public/forms/${fixture.id}/submit`, { data: { answers: { name: 'Invalid', email: 'not-an-email', service: 'Website' } } }), 400);
  const responses = await json(await context.request.get(`${origin.origin}/api/forms/${fixture.id}/responses`));
  assert.equal(responses.responses.length, 3);
  const added = responses.responses.find(response => response.answers.email === 'casey.template@example.invalid');
  assert.ok(added);
  assert.equal(added.answers.budget, undefined, 'Skipped branching answers must not be recorded');
  await page.goto(`${origin.origin}/responses/${fixture.id}`);
  await expect(page.getByText('casey.template@example.invalid', { exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const download = await downloadPromise;
  const csv = await readFile(await download.path(), 'utf8');
  assert.ok(csv.includes('casey.template@example.invalid') && csv.includes('Alex Rivera'));

  const deletedForm = (await db.query('SELECT * FROM forms WHERE id=$1', ['sample-event-registration'])).rows[0];
  const deletedResponses = (await db.query('SELECT * FROM responses WHERE form_id=$1', [deletedForm.id])).rows;
  await json(await ownerRequest('delete', `/api/forms/${deletedForm.id}`));
  assert.deepEqual(await Promise.all([seed(databaseUrl), seed(databaseUrl)]), [{ created: false }, { created: false }]);
  assert.equal((await context.request.get(`${origin.origin}/api/forms/${deletedForm.id}`)).status(), 404);
  assert.equal((await json(await context.request.get(`${origin.origin}/api/forms/${fixture.id}`))).title, 'Project enquiry — edited');
  await exec('docker', ['restart', name], { timeout: 60000 });
  await ready();
  assert.equal((await json(await context.request.get(`${origin.origin}/api/session`))).owner, true, 'Owner session must survive restart');
  assert.equal((await json(await context.request.get(`${origin.origin}/api/forms/${fixture.id}`))).title, 'Project enquiry — edited');
  assert.equal((await json(await context.request.get(`${origin.origin}/api/forms/${fixture.id}/responses`))).responses.length, 3);
  // Persisted editor content must remain inert in both owner and public views.
  const hostileId = 'q"/><img src=x onerror="window.__xss=1">';
  const hostileForm = await json(await ownerRequest('post', `/api/forms`, { data: { title: '<img src=x onerror="window.__xss=1">' } }), 201);
  const hostileQuestions = [{ id: hostileId, type: 'short', title: '<svg onload="window.__xss=1">', required: false }];
  await json(await ownerRequest('put', `/api/forms/${hostileForm.id}`, { data: { ...hostileForm, questions: hostileQuestions } }));
  await page.goto(`${origin.origin}/edit/${hostileForm.id}`);
  await expect(page.locator('[data-question]')).toHaveCount(1);
  assert.equal(await page.locator('[data-question]').getAttribute('data-question'), hostileId);
  await respondent.goto(`${origin.origin}/f/${hostileForm.id}`);
  await expect(respondent.getByRole('heading', { name: hostileQuestions[0].title, exact: true })).toBeVisible();
  for (const view of [page, respondent]) {
    assert.equal(await view.evaluate(() => window.__xss), undefined);
    assert.equal(await view.locator('img[onerror],svg[onload]').count(), 0);
  }
  await json(await ownerRequest('delete', `/api/forms/${hostileForm.id}`));
  // Failed password attempts are bounded; a different Origin never reaches login.
  assert.equal((await anonymous.request.post(`${origin.origin}/api/login`, { headers: { origin: 'https://attacker.example' }, data: {} })).status(), 403);
  let limited = false;
  for (let attempt = 0; attempt < 11; attempt++) {
    const response = await anonymous.request.post(`${origin.origin}/api/login`, { headers: { origin: origin.origin, 'x-csrf-token': anonymousState.csrfToken }, data: { username: 'admin', password: 'incorrect-fixture-password' } });
    if (response.status() === 429) { limited = true; break; }
    assert.equal(response.status(), 401);
  }
  assert.equal(limited, true, 'Password guessing must be rate limited');
  assert.deepEqual(pageErrors, []);
  await json(await ownerRequest('post', `/api/logout`));
  assert.equal((await context.request.get(`${origin.origin}/api/forms`)).status(), 401);

  // Restore only this verification's mutations to allow a repeated run on its fixture.
  await db.query('UPDATE forms SET title=$1 WHERE id=$2', [fixture.title, fixture.id]);
  await db.query('DELETE FROM responses WHERE id=$1', [added.id]);
  await db.query('INSERT INTO forms (id,title,description,questions,design,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', [deletedForm.id, deletedForm.title, deletedForm.description, deletedForm.questions, deletedForm.design, deletedForm.created_at, deletedForm.updated_at]);
  for (const row of deletedResponses) await db.query('INSERT INTO responses (id,form_id,answers,submitted_at) VALUES ($1,$2,$3,$4)', [row.id, row.form_id, row.answers, row.submitted_at]);
  console.log('Built-image verification passed: mounted runtime secret bundle, owner login, seeded editor, public branching/submission/validation, responses/CSV, concurrent seed retries, preserved edits/deletion, and database/session persistence after restart.');
} catch (error) {
  const logs = await exec('docker', ['logs', '--tail', '80', name]).catch(() => ({ stdout: '', stderr: '' }));
  console.error(logs.stdout, logs.stderr);
  throw error;
} finally {
  if (browser) await browser.close();
  if (connected) await db.end();
  await exec('docker', ['rm', '--force', name]).catch(() => {});
  await rm(directory, { recursive: true, force: true });
}
