import { validEmail } from './public/validation.js';

const resendEndpoint = 'https://api.resend.com/emails';
const maxAttempts = 5;
// Resend retains idempotency keys for 24 hours. Leave margin for clocks and requests in flight.
const retryWindow = '23 hours';

export function createResponseAlerts(pool, appOrigin, environment = process.env, fetchEmail = fetch) {
  const key = environment.LEADFORM_RESEND_API_KEY?.trim();
  const from = environment.LEADFORM_ALERT_FROM?.trim();
  const to = environment.LEADFORM_ALERT_TO?.trim();
  const plainAddress = value => validEmail(value) && !/[<>,;"]/.test(value);
  const configured = Boolean(key?.startsWith('re_') && plainAddress(from) && plainAddress(to));
  let running = false;

  function payload(formId) {
    if (!configured) return null;
    return {
      from,
      to: [to],
      subject: 'New Leadform response',
      text: `A form received a new response. Sign in to view it:\n\n${appOrigin}/responses/${encodeURIComponent(formId)}`,
    };
  }

  async function attempt(job) {
    if (job.payload.from !== from || job.payload.to[0] !== to) return { state: 'failed' };

    try {
      const reply = await fetchEmail(resendEndpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `leadform-response/${job.response_id}`,
        },
        body: JSON.stringify(job.payload),
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
      const data = await reply.json().catch(() => null);
      if (reply.ok && typeof data?.id === 'string' && data.id) {
        return { state: 'accepted', id: data.id };
      }
      if (![408, 429].includes(reply.status) && reply.status < 500 && !reply.ok
          && !(reply.status === 409 && data?.name === 'concurrent_idempotent_requests')) {
        return { state: 'failed' };
      }
      const retryAfter = Number(reply.headers.get('retry-after'));
      return { state: 'queued', delay: Math.max(Number.isFinite(retryAfter) ? retryAfter : 0, 2 ** job.attempts) };
    } catch {
      return { state: 'queued', delay: 2 ** job.attempts };
    }
  }

  async function processQueue() {
    if (!configured || running) return;
    running = true;
    try {
      await pool.query(`
        UPDATE response_alerts SET state='failed'
        WHERE state IN ('queued','sending')
          AND (created_at <= now() - $1::interval OR (attempts >= $2 AND available_at <= now()))
      `, [retryWindow, maxAttempts]);

      for (let i = 0; i < 10; i++) {
        const { rows: [job] } = await pool.query(`
          UPDATE response_alerts
          SET state='sending', attempts=attempts+1, available_at=now()+interval '30 seconds'
          WHERE response_id=(
            SELECT response_id FROM response_alerts
            WHERE state IN ('queued','sending') AND attempts < $1 AND available_at <= now()
              AND created_at > now() - $2::interval
            ORDER BY available_at, response_id
            FOR UPDATE SKIP LOCKED LIMIT 1
          )
          RETURNING response_id, payload, attempts
        `, [maxAttempts, retryWindow]);
        if (!job) break;
        const result = await attempt(job);
        const state = result.state === 'queued' && job.attempts >= maxAttempts ? 'failed' : result.state;
        await pool.query(`
          UPDATE response_alerts
          SET state=$1, provider_id=$2, available_at=now()+$3::integer*interval '1 second'
          WHERE response_id=$4 AND state='sending' AND attempts=$5
        `, [state, result.id ?? null, Math.min(86400, Math.ceil(result.delay ?? 0)), job.response_id, job.attempts]);
      }
    } catch {
      console.error('Leadform response alert queue could not be processed.');
    } finally {
      running = false;
    }
  }

  return { configured, payload, processQueue };
}
