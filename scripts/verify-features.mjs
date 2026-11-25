import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from '@playwright/test';

async function capture(page, name) {
  const directory = process.env.LEADFORM_TEST_CAPTURE_DIR;
  if (directory) await page.screenshot({ path: join(directory, name + '.png'), animations: 'disabled' });
}

async function createPublished(ownerRequest, title, questions) {
  const form = await (await ownerRequest('post', '/api/forms', { data: { title } })).json();
  const saved = await (await ownerRequest('put', `/api/forms/${form.id}`, { data: { ...form, questions } })).json();
  const publication = await ownerRequest('post', `/api/forms/${form.id}/publish`, { data: { version: saved.draft_version } });
  assert.ok(publication.ok());
  return publication.json();
}

export async function verifyResponseFilters({ db, ownerRequest, anonymous, origin, page }) {
  const questions = [
    { id: 'message', title: 'Message', type: 'short', required: true },
    { id: 'extra', title: 'Optional note', type: 'short', required: false },
  ];
  const form = await createPublished(ownerRequest, 'Copper Finch responses', questions);
  const other = await createPublished(ownerRequest, 'Other form', questions);
  const endpoint = `/api/forms/${form.id}/responses/query`;
  const start = '2025-04-10';
  const final = '2025-04-11';
  const addResponse = (formId, stamp, message, extra) => db.query(
    'INSERT INTO responses (id,form_id,answers,submitted_at) VALUES ($1,$2,$3,$4)',
    [randomUUID(), formId, JSON.stringify({ message, extra }), stamp],
  );
  try {
    for (let n = 0; n < 21; n++) {
      const stamp = n === 0 ? start + 'T00:00:00.000Z' : final + 'T23:59:59.999Z';
      await addResponse(form.id, stamp, `Copper % Finch ${n}`, n === 0 ? '=1+1, "note"' : undefined);
    }
    await addResponse(form.id, '2025-04-09T23:59:59.999Z', 'Copper % Finch before');
    await addResponse(form.id, '2025-04-12T00:00:00.000Z', 'Copper % Finch after');
    await addResponse(form.id, '2025-04-10T11:00:00.000Z', 'Copper Finch without percent');
    await addResponse(other.id, '2025-04-10T11:00:00.000Z', 'Copper % Finch other form');

    const filters = { search: 'cOpPeR % fInCh', from: start, to: final };
    const query = async (data, status = 200) => {
      const response = await ownerRequest('post', endpoint, { data });
      assert.equal(response.status(), status, await response.text());
      return response.json();
    };
    const first = await query(filters);
    const second = await query({ ...filters, page: 2 });
    assert.equal(first.total, 21);
    assert.equal(first.responses.length, 20);
    assert.equal(second.responses[0].answers.message, 'Copper % Finch 0');
    assert.equal(second.responses.length, 1);
    assert.equal(new Set([...first.responses, ...second.responses].map(row => row.id)).size, 21);
    const full = await query({ ...filters, exportAll: true });
    assert.deepEqual(full.responses, [...first.responses, ...second.responses]);
    await query({ ...filters, from: final, to: start, exportAll: true }, 400);
    await query({ from: '2025-02-29' }, 400);
    assert.equal((await anonymous.request.post(origin + endpoint, { data: { exportAll: true } })).status(), 401);
    assert.equal((await page.request.post(origin + endpoint, { data: filters })).status(), 403);

    await page.goto(`${origin}/responses/${form.id}`);
    await expect(page.locator('#response-count')).toHaveText('24 completed responses');
    await capture(page, 'filters-desktop-results');
    await page.setViewportSize({ width: 375, height: 812 });
    const search = page.getByRole('searchbox', { name: 'Search answers' });
    await search.fill(filters.search);
    await page.getByLabel('From date (UTC)').fill(start);
    await page.getByLabel('To date (UTC)').fill(final);
    await page.getByRole('button', { name: 'Apply filters' }).press('Enter');
    await expect(page.locator('#response-count')).toHaveText('21 matching responses');
    await expect(page.locator('#active-response-filters')).toContainText('cOpPeR % fInCh');
    await expect(page.locator('#next-response-page')).toBeEnabled();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 375);
    await capture(page, 'filters-phone-results');
    await page.getByRole('button', { name: 'Next page' }).press('Enter');
    await expect(page.getByText('Page 2 of 2')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Previous page' })).toBeFocused();
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV' }).press('Enter');
    const csv = await readFile(await (await downloading).path(), 'utf8');
    assert.equal(csv.split('\r\n').length, 22);
    assert.ok(csv.includes(`"Copper % Finch 0","'=1+1, ""note"""`));
    assert.ok(csv.includes('"Copper % Finch 20",""'));
    assert.ok(!csv.includes('before') && !csv.includes('after') && !csv.includes('other form'));
    await search.fill('No matching fixture');
    await search.press('Enter');
    await expect(page.getByRole('heading', { name: 'No matching responses' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
    await capture(page, 'filters-phone-no-matches');
    await page.getByRole('button', { name: 'Clear filters' }).press('Enter');
    await expect(page.locator('#response-count')).toHaveText('24 completed responses');
    await page.getByLabel('From date (UTC)').fill(final);
    await page.getByLabel('To date (UTC)').fill(start);
    await page.getByRole('button', { name: 'Apply filters' }).press('Enter');
    await expect(page.locator('#response-error')).toBeFocused();
    await expect(page.locator('#response-count')).toHaveText('24 completed responses');
    await page.reload();
    await expect(search).toBeEmpty();
    await expect(page.getByLabel('From date (UTC)')).toBeEmpty();
    await expect(page.locator('#response-count')).toHaveText('24 completed responses');
  } finally {
    await page.setViewportSize({ width: 1440, height: 1000 });
    for (const id of [form.id, other.id]) await ownerRequest('delete', `/api/forms/${id}`);
  }
  console.log('Response filters verified: literal search, UTC boundaries, multiple pages, CSV protections, reload/reset, keyboard and owner/form boundaries.');
}

export async function verifyInlineEmbed({ ownerRequest, anonymous, origin, page }) {
  const questions = [{ id: 'email', title: 'Contact email', type: 'email', required: true }];
  const response = await ownerRequest('post', '/api/forms', { data: { title: 'Copper Finch studio' } });
  assert.equal(response.status(), 201);
  const form = await response.json();
  const editor = `${origin}/edit/${form.id}`;
  const embed = `${origin}/embed/${form.id}`;
  const nested = await anonymous.newPage();
  let snippet = `<iframe title="Leadform response form" src="${embed}"></iframe>`;
  const host = createServer((_request, reply) => {
    reply.setHeader('Content-Type', 'text/html; charset=utf-8');
    reply.end(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Fictional studio</title><style>body{margin:12px;font:16px system-ui}button{margin-bottom:12px}</style>
      <main><h1>Copper Finch studio</h1><button autofocus>Before form</button>${snippet}<button>After form</button></main></html>`);
  });
  await new Promise(resolve => host.listen(0, '127.0.0.1', resolve));
  const hostOrigin = `http://127.0.0.1:${host.address().port}`;
  try {
    const saveDraft = async (earlier, title) => {
      const saved = await ownerRequest('put', `/api/forms/${form.id}`, { data: { ...earlier, title, questions } });
      assert.ok(saved.ok());
      return saved.json();
    };
    const publish = async draft => {
      const published = await ownerRequest('post', `/api/forms/${form.id}/publish`, { data: { version: draft.draft_version } });
      assert.ok(published.ok());
      return published.json();
    };
    const draft = await saveDraft(form, form.title);
    await page.goto(editor);
    await expect(page.getByRole('button', { name: 'Embed on website' })).toBeDisabled();
    await nested.goto(hostOrigin);
    const frame = nested.frameLocator('iframe');
    await expect(frame.getByRole('heading', { name: 'Form not found' })).toBeVisible();
    await capture(nested, 'embed-phone-unavailable');
    await publish(draft);
    await page.reload();
    const embedButton = page.getByRole('button', { name: 'Embed on website' });
    await embedButton.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Embed on your website' });
    await expect(dialog).toBeVisible();
    snippet = await dialog.getByLabel('Embed code').inputValue();
    assert.ok(snippet.includes(`src="${embed}"`) && snippet.includes('title='));
    await capture(page, 'embed-desktop-snippet');
    await dialog.getByRole('button', { name: 'Copy embed code' }).press('Enter');
    await expect(dialog.getByRole('status')).toHaveText(/Embed code copied|Copy the selected embed code/);
    await dialog.getByRole('button', { name: 'Done' }).press('Enter');
    await expect(embedButton).toBeFocused();

    const before = nested.getByRole('button', { name: 'Before form' });
    await nested.reload();
    const input = frame.getByLabel('Contact email');
    await expect(input).toBeVisible();
    await expect(before).toBeFocused();
    assert.equal(await nested.evaluate(() => document.documentElement.scrollWidth), 375);
    await before.press('Tab');
    await expect(input).toBeFocused();
    await input.press('Enter');
    await expect(frame.getByRole('alert')).toHaveText('This question is required');
    await expect(input).toBeFocused();
    await capture(nested, 'embed-phone-validation');
    await input.pressSequentially('copper.embed@example.invalid');
    await input.press('Enter');
    const confirmation = frame.getByRole('heading', { name: 'Thank you' });
    await expect(confirmation).toBeFocused();
    await capture(nested, 'embed-phone-confirmation');
    await confirmation.press('Tab');
    await expect(nested.getByRole('button', { name: 'After form' })).toBeFocused();
    await page.goto(`${origin}/responses/${form.id}`);
    await page.reload();
    await expect(page.getByText('copper.embed@example.invalid', { exact: true })).toBeVisible();
    assert.equal((await (await ownerRequest('get', `/api/forms/${form.id}/responses`)).json()).responses.length, 1);

    const newer = await saveDraft(draft, 'Copper Finch version two');
    await nested.reload();
    await expect(frame.getByRole('heading', { name: form.title })).toBeVisible();
    await publish(newer);
    await nested.reload();
    await expect(frame.getByRole('heading', { name: 'Copper Finch version two' })).toBeVisible();
    for (const route of ['/edit/', '/preview/', '/responses/', '/f/', '/Embed/']) {
      const document = await anonymous.request.get(origin + route + form.id);
      assert.equal(document.headers()['content-security-policy'], "frame-ancestors 'none'");
      assert.equal(document.headers()['x-frame-options'], 'DENY');
    }
    assert.equal((await anonymous.request.post(`${origin}/api/forms/${form.id}/responses/query`, { data: {} })).status(), 401);
    const removed = await ownerRequest('delete', `/api/forms/${form.id}`);
    assert.ok(removed.ok());
    await nested.reload();
    await expect(frame.getByRole('heading', { name: 'Form not found' })).toBeVisible();
  } finally {
    await nested.close();
    await new Promise((resolve, reject) => host.close(error => error ? reject(error) : resolve()));
    await ownerRequest('delete', `/api/forms/${form.id}`);
  }
  console.log('Inline embed verified: external host, publication boundary, protected pages, 375px fit, keyboard recovery, persisted response and deletion.');
}

const controlledAlertConfig = {
  LEADFORM_RESEND_API_KEY: 're_controlled_playwright_fixture',
  LEADFORM_ALERT_FROM: 'forms@copper-finch.example.invalid',
  LEADFORM_ALERT_TO: 'owner@copper-finch.example.invalid',
};

export async function verifyUnconfiguredAlerts({ page, ownerRequest, db, origin }) {
  const endpoint = '/api/forms/sample-project-enquiry/alerts';
  const status = await ownerRequest('get', endpoint);
  assert.deepEqual(await status.json(), { enabled: false, configured: false, queued: 0, accepted: 0, failed: 0, unconfirmed: 0 });
  assert.equal((await ownerRequest('put', endpoint, { data: { enabled: true } })).status(), 409);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM response_alerts')).rows[0].count, 0);
  await page.goto(origin + '/responses/sample-project-enquiry');
  await expect(page.getByText('Email delivery is not configured for this workspace.')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Email me about new responses' })).toBeDisabled();
  await capture(page, 'alerts-desktop-unconfigured');
}

export async function startControlledAlertProvider() {
  const requests = [];
  const responses = [];
  const server = createServer(async (request, reply) => {
    try {
      assert.equal(request.method, 'POST');
      assert.equal(request.url, '/emails');
      assert.equal(request.headers.authorization, `Bearer ${controlledAlertConfig.LEADFORM_RESEND_API_KEY}`);
      let raw = '';
      for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw);
      const key = request.headers['idempotency-key'];
      requests.push({ key, body });
      const response = responses.shift();
      assert.ok(response, 'The fixture only accepts explicitly planned provider requests');
      reply.writeHead(response.status, { 'content-type': 'application/json', ...(response.headers ?? {}) });
      reply.end(JSON.stringify(response.body));
    } catch {
      reply.writeHead(400, { 'content-type': 'application/json' });
      reply.end(JSON.stringify({ name: 'unexpected_fixture_request' }));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const hostname = process.platform === 'darwin' ? 'host.docker.internal' : '127.0.0.1';
  const endpoint = `http://${hostname}:${server.address().port}/emails`;
  // Loaded by the verification container only. Production sends to the fixed Resend URL.
  const preload = `const send = globalThis.fetch;
globalThis.fetch = (url, init) => {
  if (url !== 'https://api.resend.com/emails') throw new Error('Unexpected outbound fixture request');
  return send(${JSON.stringify(endpoint)}, init);
};
`;
  return {
    config: controlledAlertConfig,
    requests,
    responses,
    preload,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

export async function verifyResponseAlerts({ page, ownerRequest, anonymous, db, origin, provider, restart, ownerPassword }) {
  await page.goto(origin);
  await page.getByLabel('Password').fill(ownerPassword);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: 'Your forms' }).waitFor();
  const questions = [
    { id: 'email', type: 'email', title: 'Contact email', required: true },
    { id: 'notes', type: 'short', title: 'Notes', required: false },
  ];
  const form = await createPublished(ownerRequest, 'Copper Finch alert trial', questions);
  const other = await createPublished(ownerRequest, 'Other alert form', questions);
  const endpoint = `/api/forms/${form.id}/alerts`;
  const get = async () => {
    const reply = await ownerRequest('get', endpoint);
    assert.ok(reply.ok());
    return reply.json();
  };
  const post = (data, id = form.id) => anonymous.request.post(`${origin}/api/public/forms/${id}/submit`, { data });

  try {
    assert.deepEqual(await get(), { enabled: false, configured: true, queued: 0, accepted: 0, failed: 0, unconfirmed: 0 });
    assert.equal((await anonymous.request.get(origin + endpoint)).status(), 401);
    assert.equal((await anonymous.request.put(origin + endpoint, { data:{enabled:true} })).status(), 401);
    assert.equal((await page.request.put(origin + endpoint, { data:{enabled:true} })).status(), 403);
    assert.equal((await ownerRequest('put', endpoint, { data:{enabled:'true'} })).status(), 400);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${origin}/responses/${form.id}`);
    const toggle = page.getByRole('checkbox', { name: 'Email me about new responses' });
    await expect(toggle).not.toBeChecked();
    await toggle.press('Space');
    await expect.poll(async () => (await get()).enabled).toBe(true);
    await page.reload();
    await expect(toggle).toBeChecked();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 375);
    await capture(page, 'alerts-phone-enabled');

    const valid = { answers: { email:'casey.alert@example.invalid', notes:'Fictional private answer' }, submissionId: randomUUID(), version: form.published_version };
    assert.equal((await post({ ...valid, submissionId: 'invalid' })).status(), 400);
    assert.equal((await post({ ...valid, answers: { email:'bad' } })).status(), 400);
    assert.equal((await post({ ...valid, version:other.published_version }, other.id)).status(), 200);
    assert.equal(provider.requests.length, 0);

    provider.responses.push(
      { status:503, headers:{'retry-after':'30'}, body:{ name:'service_unavailable' } },
      { status:200, body:{ id:'controlled-accepted' } },
      { status:422, body:{ name:'validation_error' } },
      { status:503, headers:{'retry-after':'60'}, body:{ name:'service_unavailable' } },
    );
    const double = await Promise.all([post(valid), post(valid)]);
    assert.deepEqual(double.map(reply => reply.status()), [200, 200]);
    assert.equal((await post({ ...valid, answers: { ...valid.answers, notes:'Different answer' } })).status(), 409);
    await expect.poll(async () => (await get()).queued).toBe(1);
    await expect.poll(() => provider.requests.length).toBe(1);
    const [first] = provider.requests;
    assert.match(first.key, /^leadform-response\/[\da-f]{64}$/);
    assert.deepEqual(first.body.to, [provider.config.LEADFORM_ALERT_TO]);
    assert.equal(first.body.from, provider.config.LEADFORM_ALERT_FROM);
    assert.ok(first.body.text.includes(`${origin}/responses/${form.id}`));
    assert.ok(!JSON.stringify(first.body).includes('Fictional private answer'));
    assert.ok(!JSON.stringify(first.body).includes('casey.alert@example.invalid'));
    const persisted = await db.query('SELECT id FROM responses WHERE form_id=$1', [form.id]);
    assert.equal(persisted.rowCount, 1);
    const responseId = persisted.rows[0].id;
    await expect.poll(async () => (await db.query('SELECT state FROM response_alerts WHERE response_id=$1', [responseId])).rows[0].state).toBe('queued');
    await db.query('UPDATE response_alerts SET available_at=now() WHERE response_id=$1', [responseId]);
    await restart();
    await expect.poll(async () => (await get()).accepted).toBe(1);
    assert.deepEqual(provider.requests[1], first);
    assert.equal((await db.query('SELECT attempts,provider_id FROM response_alerts WHERE response_id=$1', [responseId])).rows[0].provider_id, 'controlled-accepted');

    assert.equal((await post({ ...valid, submissionId:randomUUID(), answers:{ email:'casey.failed@example.invalid' } })).status(), 200);
    await expect.poll(async () => (await get()).failed).toBe(1);
    await page.reload();
    await expect(page.locator('#alert-delivery')).toContainText('1 failed');
    await expect(page.locator('#alert-delivery')).toContainText('1 accepted by provider');
    await expect(page.getByText('casey.failed@example.invalid', { exact:true })).toBeVisible();
    await capture(page, 'alerts-phone-failed');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await capture(page, 'alerts-desktop-failed');

    assert.equal((await post({ ...valid, submissionId:randomUUID(), answers:{ email:'casey.unconfirmed@example.invalid' } })).status(), 200);
    await expect.poll(() => provider.requests.length).toBe(4);
    await expect.poll(async () => (await db.query(`
      SELECT a.state FROM response_alerts a JOIN responses r ON r.id=a.response_id
      WHERE r.form_id=$1 AND r.answers::jsonb->>'email'=$2`,
    [form.id, 'casey.unconfirmed@example.invalid'])).rows[0]?.state).toBe('queued');
    await db.query(`
      UPDATE response_alerts a SET created_at=now()-interval '24 hours', available_at=now()
      FROM responses r WHERE r.id=a.response_id AND r.form_id=$1 AND r.answers::jsonb->>'email'=$2`,
    [form.id, 'casey.unconfirmed@example.invalid']);
    await expect.poll(async () => (await get()).unconfirmed).toBe(1);
    await page.reload();
    await expect(page.locator('#alert-delivery')).toContainText('1 unconfirmed');
    await toggle.press('Space');
    await expect.poll(async () => (await get()).enabled).toBe(false);
    assert.equal((await post({ ...valid, submissionId:randomUUID() })).status(), 200);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM responses WHERE form_id=$1', [form.id])).rows[0].count, 4);
    assert.equal(provider.requests.length, 4);
    assert.equal(provider.responses.length, 0);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM response_alerts')).rows[0].count, 3);
    const signedOut = await anonymous.newPage();
    await signedOut.goto(`${origin}/responses/${form.id}`);
    await expect(signedOut.getByRole('heading', { name:'Welcome back' })).toBeVisible();
    await signedOut.close();
  } finally {
    await page.setViewportSize({ width: 1440, height: 1000 });
    for (const id of [form.id, other.id]) await ownerRequest('delete', `/api/forms/${id}`);
  }
  console.log('Email alerts verified: unconfigured and configured ownership, durable opt-in, replay isolation, private payload, controlled provider acceptance, retry after restart and terminal failure without losing responses.');
}
