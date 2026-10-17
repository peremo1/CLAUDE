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
  smtp: env.SMTP_HOST ? {
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT || 587),
    secure: env.SMTP_SECURE === "1",
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    from: env.MAIL_FROM || "Zaber <no-reply@localhost>",
  } : null,
};
