import crypto from "node:crypto";
import { config } from "./config.js";
import { many, one, q } from "./db.js";
import { render } from "./mail/templates.js";
import { enqueue } from "./outbox.js";
import { isOnline, push } from "./realtime.js";

// A qué categoría de correo pertenece cada aviso. Cada persona decide en Preferencias qué categorías recibe.
const CATEGORY = {
  comm_new: "comms", comm_quote: "comms", comm_update: "comms", comm_message: "comms", comm_response: "comms", comm_approval: "comms",
  message: "messages", comment_reply: "social", mention: "social", new_work: "news", event_start: "news",
};
export const MAIL_DEFAULTS = { comms: true, messages: true, social: false, news: false };
export const mailPref = (prefs, cat) => prefs?.[`mail_${cat}`] ?? MAIL_DEFAULTS[cat];

// Para no llenar la bandeja: si la persona tiene la web abierta ya lo ve ahí, y como mucho
// se manda un correo cada X minutos por la misma conversación o encargo.
const SKIP_IF_ONLINE = new Set(["message", "comm_message", "comment_reply", "mention"]);
const THROTTLE_MIN = { message: 15, comm_message: 10, comment_reply: 30, mention: 30 };
const throttleKey = (type, d) => `${type}:${d.userId || d.commissionId || d.workId || ""}`;

export function unsubToken(userId, cat) {
  return crypto.createHmac("sha256", config.appSecret).update(`unsub:${userId}:${cat}`).digest("base64url").slice(0, 24);
}
export const unsubUrl = (userId, cat) => `${config.publicUrl}/api/email/unsubscribe?u=${userId}&c=${cat}&t=${unsubToken(userId, cat)}`;

// Correo directo (código de contraseña, prueba): no depende de las preferencias.
export async function sendDirect(to, type, data, lang) {
  await enqueue({ to, ...render(type, data, lang) });
}

async function queueEmail(userId, type, data, force) {
  const cat = CATEGORY[type];
  if (!cat) return;
  const u = await one("select id, email, lang, prefs from users where id = $1", [userId]);
  if (!u) return;
  if (!force && !mailPref(u.prefs, cat)) return;
  if (SKIP_IF_ONLINE.has(type) && isOnline(userId)) return;
  if (THROTTLE_MIN[type]) {
    const ok = await one(`insert into email_throttle (user_id, key) values ($1, $2)
      on conflict (user_id, key) do update set last_at = now() where email_throttle.last_at < now() - make_interval(mins => $3)
      returning 1`, [userId, throttleKey(type, data), THROTTLE_MIN[type]]);
    if (!ok) return;
  }
  const link = unsubUrl(u.id, cat);
  await enqueue({
    to: u.email,
    ...render(type, data, u.lang, { unsubUrl: link, category: cat }),
    headers: { "List-Unsubscribe": `<${link}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  });
}

// Aviso dentro de la web (campana + tiempo real) y, si corresponde, por correo.
// force: manda el correo aunque la categoría esté desactivada (por ejemplo, si la persona pulsó "Avisarme").
export async function notify(userId, type, data = {}, { force = false } = {}) {
  if (!userId) return;
  const row = await one("insert into notifications (user_id, type, data) values ($1, $2, $3) returning *", [userId, type, data]);
  push(userId, { type: "notification", notification: row });
  try { await queueEmail(userId, type, data, force); } catch (e) { console.error("No se pudo preparar el correo:", e.message); }
}

export const mentionHandles = text => [...new Set([...String(text).matchAll(/@([\p{L}\p{N}_.]{1,40})/gu)].map(m => m[1].toLowerCase()))];

// Avisa a las personas mencionadas con @usuario, salvo a quien escribe y a quien lo tenga desactivado.
export async function notifyMentions(text, authorId, data) {
  const handles = mentionHandles(text);
  if (!handles.length) return;
  const users = await many("select id, prefs from users where lower(handle) = any($1)", [handles]);
  for (const u of users) {
    if (u.id === authorId || u.prefs?.mention === false) continue;
    await notify(u.id, "mention", data);
  }
}

export async function artistId() {
  return (await one("select id from users where role = 'artist' order by id limit 1"))?.id || null;
}

export async function markRead(userId) {
  await q("update notifications set read_at = now() where user_id = $1 and read_at is null", [userId]);
}

// Recordatorio de eventos: cuando empieza uno, avisa a quien pulsó "Avisarme".
export async function remindEvents() {
  const started = await many(`update events set notified_at = now()
    where visible and notified_at is null and starts_at <= now() and starts_at > now() - interval '1 day' returning id, title`);
  for (const e of started) {
    const users = await many("select user_id from event_notify where event_id = $1", [e.id]);
    for (const u of users) await notify(u.user_id, "event_start", { eventId: e.id, title: e.title }, { force: true });
  }
}
