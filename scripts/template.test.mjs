import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { examples } from '../.neander/seed.mjs';

for (const missing of ['DATABASE_URL', 'OWNER_PASSWORD', 'SESSION_SECRET', 'APP_ORIGIN']) {
  test(`startup rejects missing ${missing} before serving the app`, () => {
    const env = { ...process.env, DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:9/unused', OWNER_PASSWORD: 'a-local-test-password', SESSION_SECRET: 'a-local-test-session-secret', APP_ORIGIN: 'http://127.0.0.1:8080' };
    delete env[missing];
    const result = spawnSync(process.execPath, ['server.js'], { env, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`${missing} is required`));
  });
}
test('seed contains fictional responses and a forward-only branching example', () => {
  assert.equal(new Set(examples.map(form => form.id)).size, examples.length);
  for (const form of examples) {
    for (const response of form.responses) if (response.email) assert.ok(response.email.endsWith('@example.invalid'));
    for (const [index, question] of form.questions.entries()) {
      for (const target of Object.values(question.rules || {})) {
        assert.ok(form.questions.findIndex(candidate => candidate.id === target) > index);
      }
    }
  }
});

import { validEmail } from '../public/validation.js';
test('email validation handles long hostile values without regex backtracking', () => {
  for (const value of ['a@example.test', 'person+tag@sub.example.test']) assert.equal(validEmail(value), true);
  for (const value of ['missing-at', 'a@b', 'a@b.', 'a@@b.test', 'a b@c.test', 'a@' + '.'.repeat(100000)]) assert.equal(validEmail(value), false);
});
