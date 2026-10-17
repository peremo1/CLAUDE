import crypto from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { config } from "./config.js";
import { one, q } from "./db.js";
import { HttpError, forbidden } from "./http.js";

export const COOKIE = "zs";
const sha256 = s => crypto.createHash("sha256").update(s).digest("hex");
export const randomToken = () => crypto.randomBytes(32).toString("base64url");

export const hashPassword = pw => hash(pw, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
export const checkPassword = (h, pw) => verify(h, pw).catch(() => false);

export async function startSession(res, userId) {
  const token = randomToken();
  const days = config.sessionDays;
  await q("insert into sessions (id, user_id, expires_at) values ($1, $2, now() + make_interval(days => $3))", [sha256(token), userId, days]);
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: config.isProd, maxAge: days * 86400000, path: "/" });
}

export async function endSession(req, res) {
  const token = req.cookies?.[COOKIE];
  if (token) await q("delete from sessions where id = $1", [sha256(token)]);
  res.clearCookie(COOKIE, { path: "/" });
}

export async function userFromToken(token) {
  if (!token) return null;
  return one(`select u.* from sessions s join users u on u.id = s.user_id where s.id = $1 and s.expires_at > now()`, [sha256(token)]);
}

export async function loadUser(req, _res, next) {
  try {
    req.user = await userFromToken(req.cookies?.[COOKIE]);
    next();
  } catch (e) { next(e); }
}

export function requireUser(req, _res, next) {
  if (!req.user) return next(new HttpError(401, "login_required", "Necesitas iniciar sesión."));
  next();
}

export function requireArtist(req, _res, next) {
  if (!req.user) return next(new HttpError(401, "login_required", "Necesitas iniciar sesión."));
  if (req.user.role !== "artist") return next(forbidden());
  next();
}

// Las peticiones que cambian datos deben llevar esta cabecera. Un sitio ajeno no puede añadirla
// sin permiso CORS (que no damos), así que bloquea ataques CSRF junto con la cookie SameSite=Lax.
export function csrfGuard(req, _res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.get("x-requested-with") !== "zaber") return next(forbidden("csrf", "Petición no permitida."));
  next();
}

export const resetTokenHash = sha256;

export const avatarUrl = u => (u?.avatar ? `/media/avatars/${u.avatar}` : null);
export const publicUser = u => u && ({ id: u.id, name: u.name, handle: u.handle, bio: u.bio, role: u.role, avatar: avatarUrl(u) });
export const selfUser = u => u && ({ ...publicUser(u), email: u.email, lang: u.lang, prefs: u.prefs });
