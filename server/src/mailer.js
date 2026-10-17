import fs from "node:fs/promises";
import path from "node:path";
import nodemailer from "nodemailer";
import { config } from "./config.js";

const transport = config.smtp ? nodemailer.createTransport({ ...config.smtp, pool: true, maxConnections: 2 }) : null;
export const mailConfigured = !!transport;

// Entrega un correo. Sin servidor de correo configurado, lo guarda como archivo en data/outbox
// para poder abrirlo en el navegador y ver cómo queda (útil para probar sin contratar nada).
export async function deliver({ to, subject, html, text, headers = {} }) {
  if (transport) {
    await transport.sendMail({ from: config.mailFrom, to, subject, html, text, headers });
    return;
  }
  await fs.mkdir(config.outboxDir, { recursive: true });
  const name = `${new Date().toISOString().replace(/[:.]/g, "-")}-${to.replace(/[^a-z0-9]+/gi, "_")}`;
  await fs.writeFile(path.join(config.outboxDir, `${name}.html`), `<!-- Para: ${to} | Asunto: ${subject} -->\n${html}`);
  await fs.writeFile(path.join(config.outboxDir, `${name}.txt`), `Para: ${to}\nAsunto: ${subject}\n\n${text}`);
  console.log(`[correo guardado sin enviar: falta SMTP] ${to}: ${subject}`);
}

export async function verifyTransport() {
  if (!transport) return { ok: false, error: "no_smtp" };
  try { await transport.verify(); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
}
