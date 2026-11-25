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
    for (const route of ['/edit/', '/preview/', '/responses/', '/f/']) {
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
