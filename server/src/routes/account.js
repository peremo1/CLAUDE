import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import crypto from "node:crypto";
import { checkPassword, endSession, hashPassword, publicUser, requireUser, selfUser, startSession } from "../auth.js";
import { config } from "../config.js";
import { many, one, q } from "../db.js";
import { ah, bad, HttpError, parse } from "../http.js";
import { removeAvatar, saveAvatar, upload } from "../media.js";
import { sendDirect } from "../notify.js";

export const account = Router();

// Frena intentos de adivinar contraseñas: 20 intentos cada 15 minutos por IP (AUTH_RATE_LIMIT).
const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: config.authRateLimit, standardHeaders: "draft-7", legacyHeaders: false,
  message: { error: "rate_limited", message: "Demasiados intentos. Espera unos minutos." } });

const zEmail = z.string().trim().toLowerCase().email().max(200);
const zPassword = z.string().min(8, "Mínimo 8 caracteres.").max(200);
const zHandle = z.string().trim().transform(v => v.replace(/^@/, "")).pipe(z.string().regex(/^[\p{L}\p{N}_.]{2,30}$/u, "Usa de 2 a 30 letras, números, punto o guion bajo."));
const zName = z.string().trim().min(1).max(60);

async function taken(field, value, exceptId = 0) {
  return !!(await one(`select 1 from users where lower(${field}) = lower($1) and id <> $2`, [value, exceptId]));
}

account.post("/auth/register", authLimit, ah(async (req, res) => {
  const b = parse(z.object({ email: zEmail, password: zPassword, name: zName, handle: zHandle, lang: z.enum(["es", "en"]).optional(),
    adult: z.literal(true, { error: "Tienes que confirmar que eres mayor de edad." }) }), req.body);
  if (await taken("email", b.email)) throw bad("email_taken", "Ya hay una cuenta con ese correo.");
  if (await taken("handle", b.handle)) throw bad("handle_taken", "Ese usuario ya está en uso.");
  const user = await one("insert into users (email, password_hash, name, handle, lang) values ($1, $2, $3, $4, $5) returning *",
    [b.email, await hashPassword(b.password), b.name, b.handle, b.lang || "es"]);
  await startSession(res, user.id);
  res.status(201).json({ user: selfUser(user) });
}));

account.post("/auth/login", authLimit, ah(async (req, res) => {
  const b = parse(z.object({ email: zEmail, password: z.string().min(1).max(200) }), req.body);
  const user = await one("select * from users where lower(email) = $1", [b.email]);
  if (!user || !(await checkPassword(user.password_hash, b.password))) throw new HttpError(401, "bad_credentials", "Correo o contraseña incorrectos.");
  await startSession(res, user.id);
  res.json({ user: selfUser(user) });
}));

account.post("/auth/logout", ah(async (req, res) => {
  await endSession(req, res);
  res.json({ ok: true });
}));

account.get("/auth/me", (req, res) => res.json({ user: selfUser(req.user) }));

// Contraseña olvidada: se envía un código de 6 dígitos al correo. Caduca en 15 minutos,
// admite 5 intentos y solo vale el último pedido. Siempre responde lo mismo para no revelar qué correos tienen cuenta.
const codeHash = (userId, code) => crypto.createHash("sha256").update(`${config.appSecret}:${userId}:${code}`).digest("hex");
const CODE_TTL_MIN = 15, CODE_ATTEMPTS = 5;

account.post("/auth/forgot", authLimit, ah(async (req, res) => {
  const { email } = parse(z.object({ email: zEmail }), req.body);
  const user = await one("select id, email, lang from users where lower(email) = $1", [email]);
  // Como mucho un código por minuto y cuenta, para que nadie pueda llenar de correos a otra persona.
  const recent = user && await one("select 1 from password_codes where user_id = $1 and created_at > now() - interval '1 minute'", [user.id]);
  if (user && !recent) {
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    await q(`insert into password_codes (user_id, code_hash, expires_at) values ($1, $2, now() + make_interval(mins => $3))
      on conflict (user_id) do update set code_hash = excluded.code_hash, attempts = 0, expires_at = excluded.expires_at, created_at = now()`,
      [user.id, codeHash(user.id, code), CODE_TTL_MIN]);
    await sendDirect(user.email, "reset_code", { code }, user.lang);
  }
  res.json({ ok: true });
}));

account.post("/auth/reset", authLimit, ah(async (req, res) => {
  const b = parse(z.object({ email: zEmail, code: z.string().trim().regex(/^\d{6}$/, "El código tiene 6 números."), password: zPassword }), req.body);
  const user = await one("select id from users where lower(email) = $1", [b.email]);
  const row = user && await one("select * from password_codes where user_id = $1", [user.id]);
  const badCode = () => bad("bad_code", "El código no es correcto o ha caducado. Pide otro.", { code: "El código no es correcto o ha caducado." });
  if (!row || row.attempts >= CODE_ATTEMPTS || new Date(row.expires_at) < new Date()) throw badCode();
  const okCode = crypto.timingSafeEqual(Buffer.from(row.code_hash, "hex"), Buffer.from(codeHash(user.id, b.code), "hex"));
  if (!okCode) {
    await q("update password_codes set attempts = attempts + 1 where user_id = $1", [user.id]);
    throw badCode();
  }
  await q("delete from password_codes where user_id = $1", [user.id]);
  await q("update users set password_hash = $1 where id = $2", [await hashPassword(b.password), user.id]);
  await q("delete from sessions where user_id = $1", [user.id]);
  await startSession(res, user.id);
  res.json({ ok: true });
}));

// ---------- mi cuenta ----------

account.patch("/me", requireUser, ah(async (req, res) => {
  const b = parse(z.object({
    name: zName.optional(),
    handle: zHandle.optional(),
    bio: z.string().trim().max(500).optional(),
    lang: z.enum(["es", "en"]).optional(),
    prefs: z.object({ blur: z.boolean(), mention: z.boolean(), mail_comms: z.boolean(), mail_messages: z.boolean(), mail_social: z.boolean(), mail_news: z.boolean() }).partial().optional(),
  }), req.body);
  if (b.handle && await taken("handle", b.handle, req.user.id)) throw bad("handle_taken", "Ese usuario ya está en uso.");
  const prefs = b.prefs ? { ...req.user.prefs, ...b.prefs } : req.user.prefs;
  const u = await one(`update users set name = coalesce($2, name), handle = coalesce($3, handle), bio = coalesce($4, bio), lang = coalesce($5, lang), prefs = $6
    where id = $1 returning *`, [req.user.id, b.name, b.handle, b.bio, b.lang, prefs]);
  res.json({ user: selfUser(u) });
}));

account.post("/me/avatar", requireUser, upload.single("avatar"), ah(async (req, res) => {
  if (!req.file) throw bad("no_file", "Elige una imagen.");
  const name = await saveAvatar(req.file.buffer);
  await removeAvatar(req.user.avatar);
  const u = await one("update users set avatar = $2 where id = $1 returning *", [req.user.id, name]);
  res.json({ user: selfUser(u) });
}));

account.delete("/me/avatar", requireUser, ah(async (req, res) => {
  await removeAvatar(req.user.avatar);
  const u = await one("update users set avatar = null where id = $1 returning *", [req.user.id]);
  res.json({ user: selfUser(u) });
}));

account.patch("/me/email", requireUser, ah(async (req, res) => {
  const b = parse(z.object({ email: zEmail, password: z.string().min(1) }), req.body);
  if (!(await checkPassword(req.user.password_hash, b.password))) throw bad("bad_password", "La contraseña no es correcta.", { password: "La contraseña no es correcta." });
  if (await taken("email", b.email, req.user.id)) throw bad("email_taken", "Ya hay una cuenta con ese correo.");
  const u = await one("update users set email = $2 where id = $1 returning *", [req.user.id, b.email]);
  res.json({ user: selfUser(u) });
}));

account.patch("/me/password", requireUser, ah(async (req, res) => {
  const b = parse(z.object({ current: z.string().min(1, "Escribe tu contraseña actual."), next: zPassword }), req.body);
  if (!(await checkPassword(req.user.password_hash, b.current))) throw bad("bad_password", "La contraseña actual no es correcta.", { current: "La contraseña actual no es correcta." });
  await q("update users set password_hash = $2 where id = $1", [req.user.id, await hashPassword(b.next)]);
  // Cierra las demás sesiones abiertas y deja solo esta.
  await q("delete from sessions where user_id = $1", [req.user.id]);
  await startSession(res, req.user.id);
  res.json({ ok: true });
}));

account.delete("/me", requireUser, ah(async (req, res) => {
  const b = parse(z.object({ password: z.string().min(1) }), req.body);
  if (req.user.role === "artist") throw bad("artist_account", "La cuenta de la artista no se puede borrar desde aquí.");
  if (!(await checkPassword(req.user.password_hash, b.password))) throw bad("bad_password", "La contraseña no es correcta.", { password: "La contraseña no es correcta." });
  await removeAvatar(req.user.avatar);
  await q("delete from users where id = $1", [req.user.id]);
  res.clearCookie("zs", { path: "/" });
  res.json({ ok: true });
}));

// Para el autocompletado de @menciones.
account.get("/users", requireUser, ah(async (req, res) => {
  const qs = String(req.query.q || "").replace(/^@/, "").trim().toLowerCase().slice(0, 30);
  const rows = await many(`select * from users where lower(handle) like $1 or lower(name) like $1
    order by (role = 'artist') desc, lower(handle) limit 8`, [qs.replace(/[%_\\]/g, "\\$&") + "%"]);
  res.json({ users: rows.map(publicUser) });
}));
