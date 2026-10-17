import crypto from "node:crypto";
import { Router } from "express";
import { requireArtist } from "../auth.js";
import { config } from "../config.js";
import { one, q } from "../db.js";
import { ah } from "../http.js";
import { mailConfigured, verifyTransport } from "../mailer.js";
import { MAIL_DEFAULTS, sendDirect, unsubToken } from "../notify.js";
import { outboxStatus, processOutbox } from "../outbox.js";

export const email = Router();

const NAMES = {
  es: { comms: "encargos", messages: "mensajes", social: "respuestas y menciones", news: "obras nuevas y eventos" },
  en: { comms: "commissions", messages: "messages", social: "replies and mentions", news: "new works and events" },
};
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const page = (lang, title, body) => `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0e0813;color:#eee3ec;font:16px/1.5 system-ui,sans-serif;padding:20px}
main{max-width:420px;background:#1a1022;border:1px solid rgba(238,227,236,.12);border-radius:20px;padding:30px}h1{margin:0 0 10px;font-size:1.5rem}
p{color:#c9b7d1}button,a.b{display:inline-block;margin-top:14px;background:#ffd10b;color:#1c1206;border:0;border-radius:999px;padding:.7em 1.3em;font:inherit;font-weight:700;text-decoration:none;cursor:pointer}
a{color:#c45dea}</style></head><body><main>${body}</main></body></html>`;

async function checkLink(req) {
  const id = Number(req.query.u), cat = String(req.query.c || ""), t = String(req.query.t || "");
  if (!Number.isSafeInteger(id) || !(cat in MAIL_DEFAULTS)) return null;
  const good = unsubToken(id, cat);
  if (t.length !== good.length || !crypto.timingSafeEqual(Buffer.from(t), Buffer.from(good))) return null;
  const u = await one("select id, lang from users where id = $1", [id]);
  return u && { u, cat, lang: u.lang === "en" ? "en" : "es" };
}

// Enlace "dejar de recibir estos correos". Al abrirlo se pide confirmar (así los antivirus que
// abren enlaces no te dan de baja sin querer). Los programas de correo que admiten la baja con
// un clic (List-Unsubscribe-Post) envían directamente el POST.
email.get("/email/unsubscribe", ah(async (req, res) => {
  const ok = await checkLink(req);
  res.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'");
  if (!ok) return res.status(400).type("html").send(page("es", "Enlace no válido", `<h1>Enlace no válido</h1><p>Este enlace no es correcto. Puedes cambiar tus avisos desde <a href="${config.publicUrl}/#perfil">tu perfil</a>.</p>`));
  const es = ok.lang === "es", n = NAMES[ok.lang][ok.cat];
  res.type("html").send(page(ok.lang, es ? "Dejar de recibir correos" : "Unsubscribe", `<h1>${es ? "¿Dejar de recibir estos correos?" : "Stop these emails?"}</h1>
    <p>${es ? `Ya no te escribiremos por <b>${n}</b>. Seguirás viendo los avisos dentro de la web.` : `We'll stop emailing you about <b>${n}</b>. You'll still see notifications on the site.`}</p>
    <form method="post"><button>${es ? "Sí, dejar de recibirlos" : "Yes, stop them"}</button></form>`));
}));

email.post("/email/unsubscribe", ah(async (req, res) => {
  const ok = await checkLink(req);
  res.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
  if (!ok) return res.status(400).type("html").send(page("es", "Enlace no válido", "<h1>Enlace no válido</h1>"));
  await q("update users set prefs = prefs || jsonb_build_object($2::text, false) where id = $1", [ok.u.id, `mail_${ok.cat}`]);
  const es = ok.lang === "es";
  res.type("html").send(page(ok.lang, es ? "Hecho" : "Done", `<h1>${es ? "Hecho" : "Done"}</h1>
    <p>${es ? `Ya no recibirás correos de ${NAMES.es[ok.cat]}. Puedes volver a activarlos cuando quieras en tus preferencias.` : `You won't get ${NAMES.en[ok.cat]} emails anymore. You can turn them back on any time in your preferences.`}</p>
    <a class="b" href="${config.publicUrl}/#perfil">${es ? "Ir a mis preferencias" : "Go to my preferences"}</a>`));
}));

// Estado del correo para el panel de la artista.
email.get("/admin/mail", requireArtist, ah(async (_req, res) => {
  const from = config.mailFrom.replace(/^.*<|>$/g, "");
  res.json({ configured: mailConfigured, from, ...(await outboxStatus()) });
}));

// Manda un correo de prueba a la propia artista y espera a saber si salió bien.
email.post("/admin/mail/test", requireArtist, ah(async (req, res) => {
  if (mailConfigured) {
    const v = await verifyTransport();
    if (!v.ok) return res.status(502).json({ error: "smtp_failed", message: `El servidor de correo no responde: ${v.error}` });
  }
  await sendDirect(req.user.email, "test", {}, req.user.lang);
  await processOutbox();
  const last = await one("select sent_at, error from email_outbox where to_email = $1 order by id desc limit 1", [req.user.email]);
  if (!last?.sent_at) return res.status(502).json({ error: "smtp_failed", message: `No se pudo enviar: ${last?.error || "error desconocido"}` });
  res.json({ ok: true, to: req.user.email, configured: mailConfigured });
}));
