import { Router } from "express";
import { requireUser } from "../auth.js";
import { config } from "../config.js";
import { one } from "../db.js";
import { ah, notFound } from "../http.js";
import { privatePath } from "../media.js";

export const files = Router();

// Adjuntos privados: solo los ven las personas de esa conversación o de ese encargo (y la artista).
files.get("/files/:id", requireUser, ah(async (req, res) => {
  if (!/^[0-9a-f-]{36}$/.test(req.params.id)) throw notFound();
  const f = await one("select * from files where id = $1", [req.params.id]);
  if (!f) throw notFound();
  const me = req.user;
  let allowed = me.role === "artist" || f.owner_id === me.id;
  if (!allowed && f.kind === "message") {
    allowed = !!(await one("select 1 from messages where id = $1 and (sender_id = $2 or recipient_id = $2)", [f.ref_id, me.id]));
  }
  if (!allowed && f.kind === "commission") {
    allowed = !!(await one(`select 1 from commission_updates cu join commissions c on c.id = cu.commission_id
      where cu.id = $1 and c.client_id = $2`, [f.ref_id, me.id]));
  }
  if (!allowed) throw notFound();
  res.set("Cache-Control", "private, max-age=86400");
  res.type("image/webp");
  // Con Nginx delante, Node solo da permiso y Nginx entrega el archivo desde una ruta interna.
  if (config.behindNginx) {
    res.set("X-Accel-Redirect", `/_private/${f.path}`);
    return res.end();
  }
  res.sendFile(privatePath(f.path));
}));
