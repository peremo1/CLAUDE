import nodemailer from "nodemailer";
import { config } from "./config.js";

const transport = config.smtp ? nodemailer.createTransport(config.smtp) : null;

// Sin servidor de correo configurado, los correos se escriben en el registro del servidor.
// Así se puede probar todo (por ejemplo, recuperar la contraseña) sin contratar nada.
export async function sendMail({ to, subject, text }) {
  if (!transport) {
    console.log(`\n[correo no enviado: falta SMTP]\nPara: ${to}\nAsunto: ${subject}\n${text}\n`);
    return;
  }
  try {
    await transport.sendMail({ from: config.smtp.from, to, subject, text });
  } catch (e) {
    console.error("No se pudo enviar el correo:", e.message);
  }
}
