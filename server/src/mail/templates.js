import { config } from "../config.js";

// Plantillas de correo en español e inglés. Siempre neutras: sin imágenes de obras ni texto explícito,
// para que no haya sorpresas en la bandeja de entrada y el proveedor de correo no tenga motivos de queja.

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const url = path => `${config.publicUrl}${path}`;

const CATEGORY_NAME = {
  es: { comms: "encargos", messages: "mensajes", social: "respuestas y menciones", news: "obras nuevas y eventos" },
  en: { comms: "commissions", messages: "messages", social: "replies and mentions", news: "new works and events" },
};

const STATUS_LINE = {
  es: {
    sketch: "Zaber ha subido el boceto de tu encargo.",
    color: "Tu encargo ha pasado a la fase de color y detalles.",
    done: "¡Tu encargo está terminado! Ya puedes verlo y descargarlo.",
    rejected: "Zaber no puede aceptar este encargo. Entra para ver el motivo.",
  },
  en: {
    sketch: "Zaber has uploaded the sketch for your commission.",
    color: "Your commission has moved to the color and details stage.",
    done: "Your commission is finished! You can now see and download it.",
    rejected: "Zaber can't take this commission. Open it to see why.",
  },
};

// Cada tipo devuelve asunto, título, párrafos y botón. `d` son los datos del aviso.
const TYPES = {
  reset_code: {
    es: d => ({ subject: "Código para cambiar tu contraseña", title: "Tu código", code: d.code,
      lines: ["Escribe este código en la web para elegir una contraseña nueva. Caduca en 15 minutos.", "Si no lo has pedido tú, ignora este correo: tu contraseña no cambia."] }),
    en: d => ({ subject: "Code to change your password", title: "Your code", code: d.code,
      lines: ["Enter this code on the site to choose a new password. It expires in 15 minutes.", "If you didn't ask for it, ignore this email: your password stays the same."] }),
  },
  test: {
    es: () => ({ subject: "Correo de prueba de tu web", title: "El correo funciona", lines: ["Si lees esto, la web ya puede enviar correos: códigos de contraseña, encargos y avisos."], button: ["Abrir la web", url("/")] }),
    en: () => ({ subject: "Test email from your site", title: "Email works", lines: ["If you're reading this, the site can send emails: password codes, commissions and notifications."], button: ["Open the site", url("/")] }),
  },
  comm_new: {
    es: d => ({ subject: `Nuevo pedido de comisión ${d.code}`, title: "Tienes un pedido nuevo", lines: [`${d.name || "@" + d.by} ha pedido un encargo. Revísalo y envía un presupuesto o recházalo.`], button: ["Ver pedido", url(`/#encargo-${d.commissionId}`)] }),
    en: d => ({ subject: `New commission request ${d.code}`, title: "You have a new request", lines: [`${d.name || "@" + d.by} requested a commission. Review it and send a quote or decline it.`], button: ["View request", url(`/#encargo-${d.commissionId}`)] }),
  },
  comm_quote: {
    es: d => ({ subject: `Presupuesto para tu encargo ${d.code}`, title: "Ya tienes presupuesto", lines: [`Zaber te propone ${d.price}, con entrega en ${d.days} días.`, "Entra para aceptarlo o rechazarlo."], button: ["Ver presupuesto", url(`/#encargo-${d.commissionId}`)] }),
    en: d => ({ subject: `Quote for your commission ${d.code}`, title: "Your quote is ready", lines: [`Zaber proposes ${d.price}, delivered in ${d.days} days.`, "Open it to accept or decline."], button: ["View quote", url(`/#encargo-${d.commissionId}`)] }),
  },
  comm_update: {
    es: d => ({ subject: d.ask ? `Zaber necesita tu aprobación (${d.code})` : `Novedades en tu encargo ${d.code}`, title: d.ask ? "Revisa el boceto" : "Hay novedades",
      lines: [STATUS_LINE.es[d.status] || "Zaber ha actualizado tu encargo.", ...(d.ask ? ["Necesita que lo apruebes o pidas cambios antes de seguir."] : [])], button: ["Ver encargo", url(`/#encargo-${d.commissionId}`)] }),
    en: d => ({ subject: d.ask ? `Zaber needs your approval (${d.code})` : `News on your commission ${d.code}`, title: d.ask ? "Review the sketch" : "There's news",
      lines: [STATUS_LINE.en[d.status] || "Zaber has updated your commission.", ...(d.ask ? ["She needs you to approve it or ask for changes before moving on."] : [])], button: ["View commission", url(`/#encargo-${d.commissionId}`)] }),
  },
  comm_message: {
    es: d => ({ subject: `Mensaje nuevo en el encargo ${d.code}`, title: "Mensaje nuevo", lines: [`${d.name || "@" + d.by} ha escrito en el seguimiento del encargo ${d.code}.`], button: ["Leer", url(`/#encargo-${d.commissionId}`)] }),
    en: d => ({ subject: `New message on commission ${d.code}`, title: "New message", lines: [`${d.name || "@" + d.by} wrote on the tracker for commission ${d.code}.`], button: ["Read", url(`/#encargo-${d.commissionId}`)] }),
  },
  comm_response: {
    es: d => ({ subject: d.accepted ? `Presupuesto aceptado (${d.code})` : `Presupuesto rechazado (${d.code})`, title: d.accepted ? "¡Presupuesto aceptado!" : "Presupuesto rechazado",
      lines: [d.accepted ? `${d.name || "@" + d.by} ha aceptado tu presupuesto. Ya puedes empezar.` : `${d.name || "@" + d.by} ha rechazado tu presupuesto.`], button: ["Ver encargo", url(`/#encargo-${d.commissionId}`)] }),
    en: d => ({ subject: d.accepted ? `Quote accepted (${d.code})` : `Quote declined (${d.code})`, title: d.accepted ? "Quote accepted!" : "Quote declined",
      lines: [d.accepted ? `${d.name || "@" + d.by} accepted your quote. You can start.` : `${d.name || "@" + d.by} declined your quote.`], button: ["View commission", url(`/#encargo-${d.commissionId}`)] }),
  },
  comm_approval: {
    es: d => ({ subject: d.approved ? `Boceto aprobado (${d.code})` : `Piden cambios en el boceto (${d.code})`, title: d.approved ? "Boceto aprobado" : "Piden cambios",
      lines: [d.approved ? `${d.name || "@" + d.by} ha aprobado el boceto. Puedes seguir con el encargo.` : `${d.name || "@" + d.by} ha pedido cambios en el boceto. Entra para ver qué quiere cambiar.`], button: ["Ver encargo", url(`/#encargo-${d.commissionId}`)] }),
    en: d => ({ subject: d.approved ? `Sketch approved (${d.code})` : `Changes requested on the sketch (${d.code})`, title: d.approved ? "Sketch approved" : "Changes requested",
      lines: [d.approved ? `${d.name || "@" + d.by} approved the sketch. You can carry on.` : `${d.name || "@" + d.by} asked for changes on the sketch. Open it to see what they want.`], button: ["View commission", url(`/#encargo-${d.commissionId}`)] }),
  },
  message: {
    es: d => ({ subject: `${d.name || "@" + d.by} te ha escrito`, title: "Tienes un mensaje nuevo", lines: [`${d.name || "@" + d.by} te ha enviado un mensaje privado.`], button: ["Leer mensaje", url("/#mensajes")] }),
    en: d => ({ subject: `${d.name || "@" + d.by} wrote to you`, title: "You have a new message", lines: [`${d.name || "@" + d.by} sent you a private message.`], button: ["Read message", url("/#mensajes")] }),
  },
  comment_reply: {
    es: d => ({ subject: `@${d.by} ha respondido a tu comentario`, title: "Nueva respuesta", lines: [`@${d.by} ha respondido a tu comentario.`], button: ["Ver conversación", url(`/obra/${d.workId}`)] }),
    en: d => ({ subject: `@${d.by} replied to your comment`, title: "New reply", lines: [`@${d.by} replied to your comment.`], button: ["View thread", url(`/obra/${d.workId}`)] }),
  },
  mention: {
    es: d => ({ subject: `@${d.by} te ha mencionado`, title: "Te han mencionado", lines: [`@${d.by} te ha mencionado.`], button: ["Ver", url(d.commissionId ? `/#encargo-${d.commissionId}` : d.workId ? `/obra/${d.workId}` : "/#mensajes")] }),
    en: d => ({ subject: `@${d.by} mentioned you`, title: "You were mentioned", lines: [`@${d.by} mentioned you.`], button: ["View", url(d.commissionId ? `/#encargo-${d.commissionId}` : d.workId ? `/obra/${d.workId}` : "/#mensajes")] }),
  },
  new_work: {
    es: d => ({ subject: "Zaber ha publicado una obra nueva", title: "Obra nueva", lines: ["Zaber acaba de subir una obra nueva a su galería."], button: ["Ver obra", url(`/obra/${d.workId}`)] }),
    en: d => ({ subject: "Zaber posted a new work", title: "New work", lines: ["Zaber just uploaded a new work to her gallery."], button: ["View work", url(`/obra/${d.workId}`)] }),
  },
  event_start: {
    es: d => ({ subject: `Ya está aquí: ${d.title?.es || d.title?.en || "evento de Zaber"}`, title: "¡Ya empezó!", lines: [`Pediste que te avisáramos de «${d.title?.es || d.title?.en}». Ya está disponible.`], button: ["Ir a la web", url("/")] }),
    en: d => ({ subject: `It's here: ${d.title?.en || d.title?.es || "Zaber event"}`, title: "It's live!", lines: [`You asked us to tell you about “${d.title?.en || d.title?.es}”. It's available now.`], button: ["Go to the site", url("/")] }),
  },
};

export const EMAIL_TYPES = Object.keys(TYPES);

export function render(type, data, lang = "es", { unsubUrl, category } = {}) {
  const L = lang === "en" ? "en" : "es";
  const m = TYPES[type][L](data || {});
  const footerEs = unsubUrl
    ? `Recibes este correo porque tienes activados los avisos de ${CATEGORY_NAME.es[category]}. <a href="${esc(unsubUrl)}" style="color:#7a5a86">Dejar de recibirlos</a> o <a href="${esc(url("/#perfil"))}" style="color:#7a5a86">cambiar tus preferencias</a>.`
    : "Este es un correo automático, no hace falta responder.";
  const footerEn = unsubUrl
    ? `You get this email because you turned on ${CATEGORY_NAME.en[category]} notifications. <a href="${esc(unsubUrl)}" style="color:#7a5a86">Stop receiving them</a> or <a href="${esc(url("/#perfil"))}" style="color:#7a5a86">change your preferences</a>.`
    : "This is an automatic email, no need to reply.";
  const footer = L === "en" ? footerEn : footerEs;

  const html = `<!doctype html>
<html lang="${L}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(m.subject)}</title></head>
<body style="margin:0;padding:0;background:#f3eef6;font-family:Arial,Helvetica,sans-serif;color:#24132e">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3eef6;padding:32px 12px"><tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden">
    <tr><td style="background:#5b0f78;padding:18px 28px;font-size:22px;font-weight:bold;color:#ffffff;letter-spacing:.5px">Zaber <span style="color:#ffd10b">&#10022;</span></td></tr>
    <tr><td style="padding:28px">
      <h1 style="margin:0 0 14px;font-size:22px;line-height:1.25;color:#24132e">${esc(m.title)}</h1>
      ${m.lines.map(l => `<p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:#3d2a47">${esc(l)}</p>`).join("")}
      ${m.code ? `<p style="margin:20px 0;font-size:34px;font-weight:bold;letter-spacing:10px;color:#5b0f78;font-family:'Courier New',monospace">${esc(m.code)}</p>` : ""}
      ${m.button ? `<p style="margin:22px 0 4px"><a href="${esc(m.button[1])}" style="display:inline-block;background:#ffd10b;color:#1c1206;font-weight:bold;font-size:15px;text-decoration:none;padding:12px 22px;border-radius:999px">${esc(m.button[0])}</a></p>` : ""}
    </td></tr>
    <tr><td style="padding:18px 28px;border-top:1px solid #eee5f1;font-size:12px;line-height:1.5;color:#7a5a86">${footer}</td></tr>
  </table>
</td></tr></table>
</body></html>`;

  const text = [m.title, "", ...m.lines, ...(m.code ? ["", m.code] : []), ...(m.button ? ["", `${m.button[0]}: ${m.button[1]}`] : []), "", "—",
    unsubUrl ? (L === "en" ? `Stop these emails: ${unsubUrl}` : `Dejar de recibir estos correos: ${unsubUrl}`) : (L === "en" ? "Automatic email." : "Correo automático.")].join("\n");
  return { subject: m.subject, html, text };
}
