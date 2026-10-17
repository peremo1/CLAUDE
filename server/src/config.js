import crypto from "node:crypto";
import path from "node:path";

const env = process.env;
const isProd = env.NODE_ENV === "production";

export const config = {
  isProd,
  port: Number(env.PORT || 3000),
  databaseUrl: env.DATABASE_URL || "postgres://zaber@localhost:5432/zaber",
  // Dirección pública de la web, sin barra final. Se usa en enlaces de correos y vistas previas para redes.
  publicUrl: (env.PUBLIC_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ""),
  mediaDir: path.resolve(env.MEDIA_DIR || "./data/media"),
  webDir: path.resolve(env.WEB_DIR || new URL("../../web", import.meta.url).pathname),
  // Detrás de Nginx los archivos privados se entregan con X-Accel-Redirect en vez de leerlos desde Node.
  behindNginx: env.BEHIND_NGINX === "1",
  sessionDays: Number(env.SESSION_DAYS || 30),
  maxUploadMb: Number(env.MAX_UPLOAD_MB || 25),
  // Intentos de acceso (entrar, registrarse, códigos) por IP cada 15 minutos.
  authRateLimit: Number(env.AUTH_RATE_LIMIT || 20),
  // Clave para firmar los enlaces de baja de correos. Si no se define, se deriva de la conexión a la
  // base de datos (que incluye su contraseña), así que es secreta y estable sin configurar nada más.
  appSecret: env.APP_SECRET || crypto.createHash("sha256").update(`zaber:${env.DATABASE_URL || "dev"}`).digest("hex"),
  // Sin SMTP, los correos se guardan aquí como archivos .html para poder verlos.
  outboxDir: path.resolve(env.MAIL_OUTBOX_DIR || "./data/outbox"),
  mailFrom: env.MAIL_FROM || "Zaber <no-reply@localhost>",
  smtp: env.SMTP_HOST ? {
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT || 587),
    secure: env.SMTP_SECURE === "1",
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  } : null,
};
