import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { config } from "./config.js";
import { csrfGuard, loadUser } from "./auth.js";
import { errorHandler, HttpError } from "./http.js";
import { account } from "./routes/account.js";
import { works, getWork } from "./routes/works.js";
import { site } from "./routes/site.js";
import { commissions } from "./routes/commissions.js";
import { files } from "./routes/files.js";
import { workImageUrls } from "./media.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  if (config.behindNginx) app.set("trust proxy", 1);

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "script-src": ["'self'"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "img-src": ["'self'", "data:", "blob:"],
        "connect-src": ["'self'"],
        "font-src": ["'self'"],
        "upgrade-insecure-requests": config.isProd ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: config.isProd,
  }));

  app.use(express.json({ limit: "200kb" }));
  app.use(cookieParser());

  const api = express.Router();
  api.use(rateLimit({ windowMs: 60 * 1000, limit: 300, standardHeaders: "draft-7", legacyHeaders: false,
    message: { error: "rate_limited", message: "Demasiadas peticiones. Espera un momento." } }));
  api.use(loadUser, csrfGuard);
  api.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  api.get("/health", (_req, res) => res.json({ ok: true }));
  api.use(account, works, site, commissions, files);
  api.use((_req, _res, next) => next(new HttpError(404, "not_found", "Esa ruta de la API no existe.")));
  app.use("/api", api, errorHandler);

  // En producción Nginx sirve /media y la web directamente; esto es para desarrollo.
  app.use("/media", express.static(path.join(config.mediaDir, "public"), { maxAge: "30d", immutable: true, index: false }));

  // Enlace compartible de una obra: misma web, pero con la vista previa correcta para X, Bluesky, etc.
  app.get("/obra/:id", loadUser, async (req, res, next) => {
    try {
      const html = await fs.readFile(path.join(config.webDir, "index.html"), "utf8");
      const w = Number(req.params.id) > 0 ? await getWork(Number(req.params.id)) : null;
      if (!w) return res.status(404).type("html").send(html);
      const lang = req.acceptsLanguages("es", "en") || "es";
      const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
      const title = `${w.title[lang] || w.title.es} · Zaber`;
      const desc = (w.description[lang] || w.description.es || "").slice(0, 200);
      const img = `${config.publicUrl}${workImageUrls(w.image).og}`;
      const url = `${config.publicUrl}/obra/${w.id}`;
      const meta = `<meta property="og:type" content="article"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${img}"><meta property="og:url" content="${url}"><meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}"><meta name="twitter:image" content="${img}">${w.nsfw ? '<meta name="rating" content="adult">' : ""}`;
      res.type("html").send(html.replace("</head>", `${meta}\n</head>`).replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`));
    } catch (e) { next(e); }
  });

  app.use(express.static(config.webDir, { index: "index.html", maxAge: config.isProd ? "1h" : 0 }));
  return app;
}
