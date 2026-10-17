import { config } from "./config.js";
import { many, one, q } from "./db.js";
import { sendMail } from "./mailer.js";
import { push } from "./realtime.js";

// Tipos que además se mandan por correo si la persona lo tiene activado.
const MAIL = {
  comm_new: { es: "Nuevo pedido de comisión", en: "New commission request" },
  comm_quote: { es: "Tienes un presupuesto de Zaber", en: "You have a quote from Zaber" },
  comm_update: { es: "Novedades en tu encargo", en: "News on your commission" },
  comm_response: { es: "Respuesta a tu presupuesto", en: "Reply to your quote" },
  comm_approval: { es: "Respuesta a tu boceto", en: "Reply to your sketch" },
  message: { es: "Tienes un mensaje nuevo", en: "You have a new message" },
};

export async function notify(userId, type, data = {}) {
  if (!userId) return;
  const row = await one("insert into notifications (user_id, type, data) values ($1, $2, $3) returning *", [userId, type, data]);
  push(userId, { type: "notification", notification: row });
  if (MAIL[type]) {
    const u = await one("select email, lang, prefs from users where id = $1", [userId]);
    if (u && u.prefs?.mail !== false) {
      const lang = u.lang === "en" ? "en" : "es";
      const link = data.commissionId ? `${config.publicUrl}/#encargo-${data.commissionId}` : `${config.publicUrl}/#mensajes`;
      await sendMail({ to: u.email, subject: MAIL[type][lang], text: `${MAIL[type][lang]}.\n\n${link}` });
    }
  }
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
