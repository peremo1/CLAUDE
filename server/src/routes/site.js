import { Router } from "express";
import { z } from "zod";
import { publicUser, requireArtist, requireUser } from "../auth.js";
import { many, one, q } from "../db.js";
import { ah, bad, idParam, notFound, parse, zI18n } from "../http.js";
import { workImageUrls } from "../media.js";

export const site = Router();

export const SOCIALS = ["x", "bsky", "pixiv", "ig", "tiktok", "yt", "patreon", "kofi"];

site.get("/site", ah(async (req, res) => {
  const s = await one("select * from site_settings where id = 1");
  const artist = await one("select * from users where role = 'artist' order by id limit 1");
  const stats = await one(`select
      (select count(*) from follows)::int as followers,
      (select count(*) from works)::int as works,
      (select count(*) from commissions where status = 'done')::int as done`);
  const following = req.user ? !!(await one("select 1 from follows where user_id = $1", [req.user.id])) : false;
  res.json({
    open: s.open, about: s.about, featuredWorkId: s.featured_work_id,
    socials: SOCIALS.map(id => ({ id, url: "", on: false, ...(s.socials.find(x => x.id === id) || {}) })),
    artist: publicUser(artist), stats, following,
  });
}));

site.patch("/site", requireArtist, ah(async (req, res) => {
  const b = parse(z.object({
    open: z.boolean().optional(),
    about: zI18n(3000).optional(),
    socials: z.array(z.object({
      id: z.enum(SOCIALS),
      on: z.boolean(),
      url: z.string().trim().max(300).refine(v => v === "" || /^https:\/\/[^\s]+$/.test(v), "El enlace debe empezar por https://"),
    })).optional(),
    featuredWorkId: z.number().int().positive().nullable().optional(),
  }), req.body);
  if (b.socials?.some(s => s.on && !s.url)) throw bad("invalid", "Pega el enlace de cada red que actives.");
  await q(`update site_settings set open = coalesce($1, open), about = coalesce($2, about), socials = coalesce($3, socials),
    featured_work_id = case when $4 then $5 else featured_work_id end where id = 1`,
    [b.open ?? null, b.about ?? null, b.socials ? JSON.stringify(b.socials) : null, b.featuredWorkId !== undefined, b.featuredWorkId ?? null]);
  res.json({ ok: true });
}));

site.post("/follow", requireUser, ah(async (req, res) => {
  if (req.user.role === "artist") throw bad("self_follow", "No puedes seguirte a ti misma.");
  const del = await q("delete from follows where user_id = $1", [req.user.id]);
  if (!del.rowCount) await q("insert into follows (user_id) values ($1)", [req.user.id]);
  const n = await one("select count(*)::int as n from follows");
  res.json({ following: !del.rowCount, followers: n.n });
}));

// ---------- colecciones y etiquetas ----------

site.get("/collections", ah(async (_req, res) => {
  const rows = await many(`select c.*, (select count(*) from works w where w.collection_id = c.id)::int as count,
      (select w.image from works w where w.collection_id = c.id order by w.nsfw, w.created_at desc limit 1) as cover,
      (select w.nsfw from works w where w.collection_id = c.id order by w.nsfw, w.created_at desc limit 1) as cover_nsfw
    from collections c order by c.position, c.id`);
  res.json({ collections: rows.map(c => ({ id: c.id, name: c.name, count: c.count, cover: workImageUrls(c.cover), coverNsfw: !!c.cover_nsfw })) });
}));

site.post("/collections", requireArtist, ah(async (req, res) => {
  const b = parse(z.object({ name: zI18n(60) }), req.body);
  if (!b.name.es && !b.name.en) throw bad("invalid", "Escribe un nombre.");
  const name = { es: b.name.es || b.name.en, en: b.name.en || b.name.es };
  const c = await one("insert into collections (name, position) values ($1, (select coalesce(max(position), 0) + 1 from collections)) returning *", [name]);
  res.status(201).json({ collection: { id: c.id, name: c.name, count: 0 } });
}));

site.patch("/collections/:id", requireArtist, ah(async (req, res) => {
  const b = parse(z.object({ name: zI18n(60).partial() }), req.body);
  const c = await one("update collections set name = name || $2 where id = $1 returning *", [idParam(req), JSON.stringify(Object.fromEntries(Object.entries(b.name).filter(([, v]) => v)))]);
  if (!c) throw notFound();
  res.json({ collection: { id: c.id, name: c.name } });
}));

site.delete("/collections/:id", requireArtist, ah(async (req, res) => {
  const r = await q("delete from collections where id = $1", [idParam(req)]);
  if (!r.rowCount) throw notFound();
  res.json({ ok: true });
}));

site.get("/tags", ah(async (_req, res) => {
  const rows = await many(`select t.name, count(wt.work_id)::int as count from tags t left join work_tags wt on wt.tag = t.name group by t.name order by t.name`);
  res.json({ tags: rows });
}));

const zTag = z.string().trim().toLowerCase().transform(v => v.replace(/^#/, "")).pipe(z.string().min(1).max(40));

site.post("/tags", requireArtist, ah(async (req, res) => {
  const { name } = parse(z.object({ name: zTag }), req.body);
  await q("insert into tags (name) values ($1) on conflict do nothing", [name]);
  res.status(201).json({ tag: { name, count: 0 } });
}));

site.delete("/tags/:name", requireArtist, ah(async (req, res) => {
  await q("delete from tags where name = $1", [String(req.params.name).toLowerCase()]);
  res.json({ ok: true });
}));

// ---------- eventos (próxima obra) ----------

const eventOut = (e, notifySet) => ({
  id: e.id, title: e.title, startsAt: e.starts_at, visible: e.visible, teaserWorkId: e.teaser_work_id,
  teaser: workImageUrls(e.teaser_image), notify: notifySet.has(e.id),
});

site.get("/events", ah(async (req, res) => {
  const all = req.user?.role === "artist" && req.query.all === "1";
  const rows = await many(`select e.*, w.image as teaser_image from events e left join works w on w.id = e.teaser_work_id
    ${all ? "" : "where e.visible and e.starts_at > now()"} order by e.starts_at`);
  const mine = req.user ? new Set((await many("select event_id from event_notify where user_id = $1", [req.user.id])).map(r => r.event_id)) : new Set();
  res.json({ events: rows.map(e => eventOut(e, mine)) });
}));

const eventFields = z.object({
  title: zI18n(120),
  startsAt: z.string().datetime({ offset: true }),
  teaserWorkId: z.number().int().positive().nullable().optional(),
  visible: z.boolean().optional(),
});

site.post("/events", requireArtist, ah(async (req, res) => {
  const b = parse(eventFields, req.body);
  if (!b.title.es && !b.title.en) throw bad("invalid", "Escribe un nombre.");
  const e = await one("insert into events (title, starts_at, teaser_work_id, visible) values ($1, $2, $3, $4) returning id",
    [{ es: b.title.es || b.title.en, en: b.title.en || b.title.es }, b.startsAt, b.teaserWorkId ?? null, b.visible ?? true]);
  res.status(201).json({ id: e.id });
}));

site.patch("/events/:id", requireArtist, ah(async (req, res) => {
  const b = parse(eventFields.partial(), req.body);
  const title = b.title && { es: b.title.es || b.title.en, en: b.title.en || b.title.es };
  const e = await one(`update events set title = coalesce($2, title), starts_at = coalesce($3, starts_at),
    teaser_work_id = case when $4 then $5 else teaser_work_id end, visible = coalesce($6, visible) where id = $1 returning id`,
    [idParam(req), title || null, b.startsAt ?? null, b.teaserWorkId !== undefined, b.teaserWorkId ?? null, b.visible ?? null]);
  if (!e) throw notFound();
  res.json({ ok: true });
}));

site.delete("/events/:id", requireArtist, ah(async (req, res) => {
  const r = await q("delete from events where id = $1", [idParam(req)]);
  if (!r.rowCount) throw notFound();
  res.json({ ok: true });
}));

site.post("/events/:id/notify", requireUser, ah(async (req, res) => {
  const id = idParam(req);
  if (!(await one("select 1 from events where id = $1", [id]))) throw notFound();
  const del = await q("delete from event_notify where user_id = $1 and event_id = $2", [req.user.id, id]);
  if (!del.rowCount) await q("insert into event_notify (user_id, event_id) values ($1, $2)", [req.user.id, id]);
  res.json({ notify: !del.rowCount });
}));

// ---------- resumen del panel ----------

site.get("/admin/stats", requireArtist, ah(async (_req, res) => {
  const s = await one(`select
      (select count(*) from likes where created_at > now() - interval '30 days')::int as likes_month,
      (select count(*) from follows)::int as followers,
      (select count(*) from commissions where status = 'requested')::int as new_requests,
      (select count(*) from commissions where status in ('accepted', 'sketch', 'color'))::int as active,
      (select count(*) from messages m join users u on u.id = m.recipient_id where u.role = 'artist' and m.read_at is null)::int as unread`);
  res.json({ likesMonth: s.likes_month, followers: s.followers, newRequests: s.new_requests, active: s.active, unread: s.unread });
}));
