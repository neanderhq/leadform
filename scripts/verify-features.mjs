import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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
