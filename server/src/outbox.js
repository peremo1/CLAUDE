import { many, q, tx } from "./db.js";
import { deliver } from "./mailer.js";

const MAX_ATTEMPTS = 6;

// Los correos se guardan primero en la base de datos y un proceso en segundo plano los envía.
// Si el proveedor falla, se reintenta más tarde (1, 2, 4, 8 y 16 minutos) en vez de perder el correo.
export async function enqueue({ to, subject, html, text, headers = {} }) {
  await q("insert into email_outbox (to_email, subject, html, text, headers) values ($1, $2, $3, $4, $5)", [to, subject, html, text, headers]);
  kick();
}

let running = false, again = false;
export async function processOutbox() {
  if (running) { again = true; return; }
  running = true;
  try {
    do {
      again = false;
      await tx(async c => {
        const { rows } = await c.query(`select * from email_outbox where sent_at is null and attempts < $1 and next_at <= now()
          order by id limit 20 for update skip locked`, [MAX_ATTEMPTS]);
        for (const m of rows) {
          try {
            await deliver({ to: m.to_email, subject: m.subject, html: m.html, text: m.text, headers: m.headers });
            await c.query("update email_outbox set sent_at = now(), error = null where id = $1", [m.id]);
          } catch (e) {
            await c.query(`update email_outbox set attempts = attempts + 1, error = $2,
              next_at = now() + make_interval(mins => power(2, attempts)::int) where id = $1`, [m.id, String(e.message).slice(0, 500)]);
            console.error(`No se pudo enviar el correo ${m.id}: ${e.message}`);
          }
        }
      });
    } while (again);
  } finally { running = false; }
}

let timer = null;
function kick() { clearTimeout(timer); timer = setTimeout(() => processOutbox().catch(e => console.error(e)), 50); }

export function startOutboxWorker(everyMs = 15000) {
  const t = setInterval(() => processOutbox().catch(e => console.error(e)), everyMs);
  t.unref();
  kick();
}

// Los correos ya enviados se borran a los 30 días: no hace falta guardar su contenido.
export async function cleanOutbox() {
  await q("delete from email_outbox where sent_at < now() - interval '30 days' or (attempts >= $1 and created_at < now() - interval '30 days')", [MAX_ATTEMPTS]);
}

export async function outboxStatus() {
  const [r] = await many(`select
      count(*) filter (where sent_at is null and attempts < $1)::int as pending,
      count(*) filter (where sent_at is null and attempts >= $1)::int as failed,
      count(*) filter (where sent_at > now() - interval '7 days')::int as sent_week,
      (select error from email_outbox where error is not null order by id desc limit 1) as last_error
    from email_outbox`, [MAX_ATTEMPTS]);
  return { pending: r.pending, failed: r.failed, sentWeek: r.sent_week, lastError: r.last_error };
}
