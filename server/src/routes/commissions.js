import { Router } from "express";
import { z } from "zod";
import { publicUser, requireUser } from "../auth.js";
import { many, one, q, tx } from "../db.js";
import { ah, bad, forbidden, idParam, notFound, parse, zBool, zIntish } from "../http.js";
import { fileUrl, savePrivateImage, upload } from "../media.js";
import { artistId, notify, notifyMentions } from "../notify.js";
import { push } from "../realtime.js";

export const commissions = Router();

export const FLOW = ["requested", "quoted", "accepted", "sketch", "color", "done"];
const WORKING = ["accepted", "sketch", "color"];
const code = id => `C-${1000 + id}`;

async function loadFor(req) {
  const c = await one("select * from commissions where id = $1", [idParam(req)]);
  if (!c) throw notFound();
  const isArtist = req.user.role === "artist";
  if (!isArtist && c.client_id !== req.user.id) throw notFound();
  return { c, isArtist };
}

async function saveFiles(files, ownerId, kind, refId, client) {
  const out = [];
  for (const f of files || []) {
    const img = await savePrivateImage(f.buffer);
    await client.query("insert into files (id, owner_id, kind, ref_id, path, w, h) values ($1, $2, $3, $4, $5, $6, $7)",
      [img.id, ownerId, kind, refId, img.path, img.w, img.h]);
    out.push(img);
  }
  return out;
}

async function addUpdate(client, c, user, fields, files) {
  const { rows: [u] } = await client.query(`insert into commission_updates (commission_id, author_id, by_artist, body, status, ask_approval, approval)
    values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [c.id, user.id, user.role === "artist", fields.body || "", fields.status || null, !!fields.askApproval, fields.approval || null]);
  await saveFiles(files, user.id, "commission", u.id, client);
  return u.id;
}

const summary = (c, client, cover) => ({
  id: c.id, code: code(c.id), type: c.type, usage: c.usage, nsfw: c.nsfw, budget: c.budget, description: c.description,
  status: c.status, approval: c.approval, quote: c.quote_price ? { price: c.quote_price, days: c.quote_days } : null,
  createdAt: c.created_at, updatedAt: c.updated_at, client: client ? publicUser(client) : null, cover: cover ? fileUrl(cover) : null,
});

commissions.get("/commissions", requireUser, ah(async (req, res) => {
  const isArtist = req.user.role === "artist";
  const rows = await many(`select c.*, u.id as u_id, u.name, u.handle, u.role, u.avatar, u.bio,
      (select row_to_json(f) from files f join commission_updates cu on f.kind = 'commission' and f.ref_id = cu.id
        where cu.commission_id = c.id order by f.created_at desc limit 1) as cover
    from commissions c left join users u on u.id = c.client_id
    ${isArtist ? "" : "where c.client_id = $1"} order by c.updated_at desc`, isArtist ? [] : [req.user.id]);
  res.json({ commissions: rows.map(r => summary(r, r.u_id && { id: r.u_id, name: r.name, handle: r.handle, role: r.role, avatar: r.avatar, bio: r.bio }, r.cover)) });
}));

commissions.get("/commissions/:id", requireUser, ah(async (req, res) => {
  const { c } = await loadFor(req);
  const client = c.client_id ? await one("select * from users where id = $1", [c.client_id]) : null;
  const ups = await many(`select cu.*, u.name, u.handle, u.role, u.avatar, u.bio from commission_updates cu
    left join users u on u.id = cu.author_id where cu.commission_id = $1 order by cu.created_at, cu.id`, [c.id]);
  const files = ups.length ? await many("select * from files where kind = 'commission' and ref_id = any($1) order by created_at", [ups.map(u => u.id)]) : [];
  res.json({
    commission: {
      ...summary(c, client),
      updates: ups.map(u => ({
        id: u.id, byArtist: u.by_artist, text: u.body, status: u.status, askApproval: u.ask_approval, approval: u.approval, createdAt: u.created_at,
        author: u.author_id ? publicUser({ id: u.author_id, name: u.name, handle: u.handle, role: u.role, avatar: u.avatar, bio: u.bio }) : null,
        files: files.filter(f => f.ref_id === u.id).map(fileUrl),
      })),
    },
  });
}));

commissions.post("/commissions", requireUser, upload.array("files", 6), ah(async (req, res) => {
  if (req.user.role === "artist") throw bad("artist", "La artista no puede pedirse encargos a sí misma.");
  const site = await one("select open from site_settings where id = 1");
  if (!site.open) throw forbidden("closed", "Las comisiones están cerradas ahora mismo.");
  const b = parse(z.object({
    type: zIntish.pipe(z.number().min(0).max(9)),
    usage: zIntish.pipe(z.number().min(0).max(1)).optional(),
    nsfw: zBool.optional(),
    budget: z.string().trim().max(60).optional(),
    description: z.string().trim().min(10, "Cuenta un poco más (mínimo 10 caracteres).").max(4000),
  }), req.body);
  const id = await tx(async client => {
    const { rows: [c] } = await client.query(`insert into commissions (client_id, type, usage, nsfw, budget, description)
      values ($1, $2, $3, $4, $5, $6) returning *`, [req.user.id, b.type, b.usage ?? 0, !!b.nsfw, b.budget || "", b.description]);
    await addUpdate(client, c, req.user, { status: "requested", body: "" }, req.files);
    return c.id;
  });
  await notify(await artistId(), "comm_new", { commissionId: id, code: code(id), by: req.user.handle, name: req.user.name });
  res.status(201).json({ id, code: code(id) });
}));

commissions.post("/commissions/:id/quote", requireUser, ah(async (req, res) => {
  const { c, isArtist } = await loadFor(req);
  if (!isArtist) throw forbidden();
  if (!["requested", "quoted"].includes(c.status)) throw bad("bad_status", "Este encargo ya no admite presupuesto.");
  const b = parse(z.object({ price: z.string().trim().min(1).max(40), days: z.number().int().min(1).max(365), note: z.string().trim().max(2000).optional() }), req.body);
  await tx(async client => {
    await client.query("update commissions set status = 'quoted', quote_price = $2, quote_days = $3, updated_at = now() where id = $1", [c.id, b.price, b.days]);
    await addUpdate(client, c, req.user, { status: "quoted", body: b.note || "" });
  });
  await notify(c.client_id, "comm_quote", { commissionId: c.id, code: code(c.id), price: b.price, days: b.days });
  res.json({ ok: true });
}));

commissions.post("/commissions/:id/reject", requireUser, ah(async (req, res) => {
  const { c, isArtist } = await loadFor(req);
  if (!isArtist) throw forbidden();
  if (!["requested", "quoted"].includes(c.status)) throw bad("bad_status", "Este encargo ya está en marcha.");
  const b = parse(z.object({ reason: z.string().trim().max(2000).optional() }), req.body);
  await tx(async client => {
    await client.query("update commissions set status = 'rejected', approval = null, updated_at = now() where id = $1", [c.id]);
    await addUpdate(client, c, req.user, { status: "rejected", body: b.reason || "" });
  });
  await notify(c.client_id, "comm_update", { commissionId: c.id, code: code(c.id), status: "rejected" });
  res.json({ ok: true });
}));

commissions.post("/commissions/:id/quote-response", requireUser, ah(async (req, res) => {
  const { c, isArtist } = await loadFor(req);
  if (isArtist) throw forbidden();
  if (c.status !== "quoted") throw bad("bad_status", "No hay ningún presupuesto pendiente.");
  const { accept } = parse(z.object({ accept: z.boolean() }), req.body);
  const status = accept ? "accepted" : "rejected";
  await tx(async client => {
    await client.query("update commissions set status = $2, updated_at = now() where id = $1", [c.id, status]);
    await addUpdate(client, c, req.user, { status });
  });
  await notify(await artistId(), "comm_response", { commissionId: c.id, code: code(c.id), accepted: accept, by: req.user.handle, name: req.user.name });
  res.json({ ok: true });
}));

commissions.post("/commissions/:id/approval", requireUser, ah(async (req, res) => {
  const { c, isArtist } = await loadFor(req);
  if (isArtist) throw forbidden();
  if (c.approval !== "pending") throw bad("bad_status", "No hay nada pendiente de aprobar.");
  const b = parse(z.object({ approve: z.boolean(), note: z.string().trim().max(2000).optional() }), req.body);
  const approval = b.approve ? "approved" : "changes";
  await tx(async client => {
    await client.query("update commissions set approval = $2, updated_at = now() where id = $1", [c.id, approval]);
    await addUpdate(client, c, req.user, { approval, body: b.note || "" });
  });
  await notify(await artistId(), "comm_approval", { commissionId: c.id, code: code(c.id), approved: b.approve, by: req.user.handle, name: req.user.name });
  res.json({ ok: true });
}));

// Mensaje en el seguimiento. La artista puede además cambiar el estado y pedir aprobación.
commissions.post("/commissions/:id/updates", requireUser, upload.array("files", 6), ah(async (req, res) => {
  const { c, isArtist } = await loadFor(req);
  if (["done", "rejected"].includes(c.status)) throw bad("closed", "Este encargo está cerrado.");
  const b = parse(z.object({
    text: z.string().trim().max(4000).optional(),
    status: z.enum(["sketch", "color", "done"]).optional(),
    askApproval: zBool.optional(),
  }), req.body);
  if (!isArtist && (b.status || b.askApproval)) throw forbidden();
  if (b.status) {
    if (!WORKING.includes(c.status)) throw bad("bad_status", "Primero el cliente tiene que aceptar el presupuesto.");
    if (FLOW.indexOf(b.status) <= FLOW.indexOf(c.status)) throw bad("bad_status", "El estado solo puede avanzar.");
  }
  if (!b.text && !b.status && !req.files?.length) throw bad("empty", "Escribe algo o adjunta un archivo.");
  await tx(async client => {
    await client.query(`update commissions set status = coalesce($2, status),
      approval = case when $3 then 'pending' else approval end, updated_at = now() where id = $1`, [c.id, b.status ?? null, !!b.askApproval]);
    await addUpdate(client, c, req.user, { body: b.text, status: b.status, askApproval: b.askApproval }, req.files);
  });
  const to = isArtist ? c.client_id : await artistId();
  // Cambio de estado o petición de aprobación = "novedades"; solo texto o archivos = "mensaje nuevo".
  if (isArtist && (b.status || b.askApproval)) await notify(to, "comm_update", { commissionId: c.id, code: code(c.id), status: b.status || c.status, ask: !!b.askApproval });
  else await notify(to, "comm_message", { commissionId: c.id, code: code(c.id), by: req.user.handle, name: req.user.name });
  if (b.text) await notifyMentions(b.text, req.user.id, { commissionId: c.id, by: req.user.handle });
  res.status(201).json({ ok: true });
}));

// ---------- mensajes privados ----------
// Solo hay conversaciones entre la artista y cada persona registrada.

const msgOut = (m, files) => ({ id: m.id, from: m.sender_id, to: m.recipient_id, text: m.body, createdAt: m.created_at, readAt: m.read_at, files: files.filter(f => f.ref_id === m.id).map(fileUrl) });

commissions.get("/conversations", requireUser, ah(async (req, res) => {
  const me = req.user.id;
  const rows = await many(`select distinct on (other) other, m.body, m.created_at, m.sender_id,
      (select count(*) from messages x where x.sender_id = other and x.recipient_id = $1 and x.read_at is null)::int as unread
    from (select *, case when sender_id = $1 then recipient_id else sender_id end as other from messages where sender_id = $1 or recipient_id = $1) m
    order by other, m.created_at desc`, [me]);
  const users = rows.length ? await many("select * from users where id = any($1)", [rows.map(r => r.other)]) : [];
  const list = rows.map(r => ({ user: publicUser(users.find(u => u.id === r.other)), last: r.body, lastAt: r.created_at, mine: r.sender_id === me, unread: r.unread }))
    .filter(r => r.user).sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));
  // Una persona registrada siempre ve su conversación con Zaber, aunque aún esté vacía.
  if (req.user.role !== "artist" && !list.length) {
    const a = await one("select * from users where role = 'artist' order by id limit 1");
    if (a) list.push({ user: publicUser(a), last: "", lastAt: null, mine: false, unread: 0 });
  }
  res.json({ conversations: list });
}));

async function counterpart(req, withId) {
  if (req.user.role === "artist") {
    const u = await one("select * from users where id = $1 and role = 'fan'", [withId]);
    if (!u) throw notFound();
    return u;
  }
  const a = await one("select * from users where role = 'artist' order by id limit 1");
  if (!a) throw notFound();
  return a;
}

commissions.get("/messages", requireUser, ah(async (req, res) => {
  const other = await counterpart(req, Number(req.query.with));
  const rows = await many(`select * from messages where (sender_id = $1 and recipient_id = $2) or (sender_id = $2 and recipient_id = $1)
    order by created_at desc, id desc limit 200`, [req.user.id, other.id]);
  rows.reverse();
  const files = rows.length ? await many("select * from files where kind = 'message' and ref_id = any($1)", [rows.map(m => m.id)]) : [];
  await q("update messages set read_at = now() where sender_id = $1 and recipient_id = $2 and read_at is null", [other.id, req.user.id]);
  res.json({ user: publicUser(other), messages: rows.map(m => msgOut(m, files)) });
}));

commissions.post("/messages", requireUser, upload.array("files", 6), ah(async (req, res) => {
  const b = parse(z.object({ to: zIntish.optional(), text: z.string().trim().max(4000).optional() }), req.body);
  if (!b.text && !req.files?.length) throw bad("empty", "Escribe algo o adjunta un archivo.");
  const other = await counterpart(req, b.to);
  const { m, files } = await tx(async client => {
    const { rows: [m] } = await client.query("insert into messages (sender_id, recipient_id, body) values ($1, $2, $3) returning *", [req.user.id, other.id, b.text || ""]);
    const saved = await saveFiles(req.files, req.user.id, "message", m.id, client);
    return { m, files: saved.map(f => ({ ...f, ref_id: m.id })) };
  });
  const out = msgOut(m, files);
  push(other.id, { type: "message", message: out, from: publicUser(req.user) });
  push(req.user.id, { type: "message", message: out, from: publicUser(req.user) });
  await notify(other.id, "message", { by: req.user.handle, name: req.user.name, userId: req.user.id });
  if (b.text) await notifyMentions(b.text, req.user.id, { by: req.user.handle });
  res.status(201).json({ message: out });
}));

// ---------- avisos ----------

commissions.get("/notifications", requireUser, ah(async (req, res) => {
  const rows = await many("select * from notifications where user_id = $1 order by created_at desc limit 50", [req.user.id]);
  const unread = await one("select count(*)::int as n from notifications where user_id = $1 and read_at is null", [req.user.id]);
  res.json({ notifications: rows.map(n => ({ id: n.id, type: n.type, data: n.data, read: !!n.read_at, createdAt: n.created_at })), unread: unread.n });
}));

commissions.post("/notifications/read", requireUser, ah(async (req, res) => {
  await q("update notifications set read_at = now() where user_id = $1 and read_at is null", [req.user.id]);
  res.json({ ok: true });
}));
