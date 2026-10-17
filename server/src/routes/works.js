import { Router } from "express";
import { z } from "zod";
import { publicUser, requireArtist, requireUser } from "../auth.js";
import { many, one, q, tx } from "../db.js";
import { ah, bad, forbidden, idParam, notFound, parse, zBool, zI18n, zIntish, zJson } from "../http.js";
import { refreshOg, removeWorkImage, saveWorkImage, upload, workImageUrls } from "../media.js";
import { notify, notifyMentions } from "../notify.js";

export const works = Router();

const WORK_SELECT = `
  select w.*,
    (select count(*) from likes l where l.work_id = w.id)::int as likes,
    (select count(*) from comments c where c.work_id = w.id)::int as comment_count,
    coalesce((select array_agg(t.tag order by t.tag) from work_tags t where t.work_id = w.id), '{}') as tags,
    exists(select 1 from likes l where l.work_id = w.id and l.user_id = $1) as liked,
    exists(select 1 from saves s where s.work_id = w.id and s.user_id = $1) as saved
  from works w`;

export const workOut = w => ({
  id: w.id,
  title: w.title,
  desc: w.description,
  nsfw: w.nsfw,
  allowComments: w.allow_comments,
  collectionId: w.collection_id,
  tags: w.tags,
  likes: w.likes,
  liked: w.liked,
  saved: w.saved,
  comments: w.comment_count,
  image: workImageUrls(w.image),
  createdAt: w.created_at,
});

export async function getWork(id, userId = 0) {
  return one(`${WORK_SELECT} where w.id = $2`, [userId, id]);
}

works.get("/works", ah(async (req, res) => {
  const rows = await many(`${WORK_SELECT} order by w.created_at desc limit 1000`, [req.user?.id || 0]);
  res.json({ works: rows.map(workOut) });
}));

works.get("/works/:id", ah(async (req, res) => {
  const w = await getWork(idParam(req), req.user?.id || 0);
  if (!w) throw notFound();
  res.json({ work: workOut(w) });
}));

const workFields = z.object({
  title: zJson(zI18n(120)),
  desc: zJson(zI18n(2000)).optional(),
  nsfw: zBool.optional(),
  allowComments: zBool.optional(),
  collectionId: zIntish.nullable().optional(),
  tags: zJson(z.array(z.string().trim().toLowerCase().min(1).max(40)).max(20)).optional(),
  featured: zBool.optional(),
});

async function setTags(client, workId, tags) {
  await client.query("delete from work_tags where work_id = $1", [workId]);
  for (const tag of tags) {
    await client.query("insert into tags (name) values ($1) on conflict do nothing", [tag]);
    await client.query("insert into work_tags (work_id, tag) values ($1, $2) on conflict do nothing", [workId, tag]);
  }
}

function checkTitle(title) {
  if (!title.es && !title.en) throw bad("invalid", "Escribe un título.", { title: "Escribe un título." });
  return { es: title.es || title.en, en: title.en || title.es };
}

works.post("/works", requireArtist, upload.single("image"), ah(async (req, res) => {
  const b = parse(workFields, req.body);
  if (!req.file) throw bad("no_file", "Elige una imagen.", { image: "Elige una imagen." });
  const image = await saveWorkImage(req.file.buffer, { nsfw: !!b.nsfw });
  const id = await tx(async c => {
    const desc = b.desc || { es: "", en: "" };
    const { rows: [w] } = await c.query(`insert into works (title, description, nsfw, allow_comments, collection_id, image)
      values ($1, $2, $3, $4, $5, $6) returning id`,
      [checkTitle(b.title), { es: desc.es || desc.en, en: desc.en || desc.es }, !!b.nsfw, b.allowComments ?? true, b.collectionId ?? null, image]);
    await setTags(c, w.id, b.tags || []);
    if (b.featured) await c.query("update site_settings set featured_work_id = $1", [w.id]);
    return w.id;
  }).catch(async e => { await removeWorkImage(image); throw e; });
  // Aviso a quienes siguen a Zaber.
  const followers = await many("select user_id from follows");
  for (const f of followers) await notify(f.user_id, "new_work", { workId: id });
  res.status(201).json({ work: workOut(await getWork(id, req.user.id)) });
}));

works.patch("/works/:id", requireArtist, upload.single("image"), ah(async (req, res) => {
  const id = idParam(req);
  const old = await one("select * from works where id = $1", [id]);
  if (!old) throw notFound();
  const b = parse(workFields.partial(), req.body);
  const image = req.file ? await saveWorkImage(req.file.buffer, { nsfw: b.nsfw ?? old.nsfw }) : null;
  await tx(async c => {
    const desc = b.desc && { es: b.desc.es || b.desc.en, en: b.desc.en || b.desc.es };
    await c.query(`update works set title = coalesce($2, title), description = coalesce($3, description), nsfw = coalesce($4, nsfw),
      allow_comments = coalesce($5, allow_comments), collection_id = case when $6 then $7 else collection_id end,
      image = coalesce($8, image), updated_at = now() where id = $1`,
      [id, b.title ? checkTitle(b.title) : null, desc || null, b.nsfw ?? null, b.allowComments ?? null, b.collectionId !== undefined, b.collectionId ?? null, image]);
    if (b.tags) await setTags(c, id, b.tags);
    if (b.featured === true) await c.query("update site_settings set featured_work_id = $1", [id]);
    if (b.featured === false) await c.query("update site_settings set featured_work_id = null where featured_work_id = $1", [id]);
  });
  if (image) await removeWorkImage(old.image);
  else if (b.nsfw !== undefined && b.nsfw !== old.nsfw) await refreshOg(old.image, b.nsfw);
  res.json({ work: workOut(await getWork(id, req.user.id)) });
}));

works.delete("/works/:id", requireArtist, ah(async (req, res) => {
  const w = await one("delete from works where id = $1 returning image", [idParam(req)]);
  if (!w) throw notFound();
  await removeWorkImage(w.image);
  res.json({ ok: true });
}));

// Me gusta y guardar funcionan como interruptores.
for (const [path, table] of [["like", "likes"], ["save", "saves"]]) {
  works.post(`/works/:id/${path}`, requireUser, ah(async (req, res) => {
    const id = idParam(req);
    if (!(await one("select 1 from works where id = $1", [id]))) throw notFound();
    const del = await q(`delete from ${table} where user_id = $1 and work_id = $2`, [req.user.id, id]);
    if (!del.rowCount) await q(`insert into ${table} (user_id, work_id) values ($1, $2)`, [req.user.id, id]);
    const w = await getWork(id, req.user.id);
    res.json({ liked: w.liked, saved: w.saved, likes: w.likes });
  }));
}

// ---------- comentarios ----------

works.get("/works/:id/comments", ah(async (req, res) => {
  const rows = await many(`select c.*, u.name, u.handle, u.role, u.avatar, u.bio,
      (select count(*) from comment_likes l where l.comment_id = c.id)::int as likes,
      exists(select 1 from comment_likes l where l.comment_id = c.id and l.user_id = $2) as liked
    from comments c join users u on u.id = c.user_id where c.work_id = $1 order by c.created_at`, [idParam(req), req.user?.id || 0]);
  res.json({ comments: rows.map(commentOut) });
}));

const commentOut = c => ({
  id: c.id, parentId: c.parent_id, text: c.body, createdAt: c.created_at, likes: c.likes, liked: c.liked,
  user: publicUser({ id: c.user_id, name: c.name, handle: c.handle, role: c.role, avatar: c.avatar, bio: c.bio }),
});

works.post("/works/:id/comments", requireUser, ah(async (req, res) => {
  const workId = idParam(req);
  const b = parse(z.object({ text: z.string().trim().min(1).max(2000), parentId: z.number().int().positive().nullable().optional() }), req.body);
  const w = await one("select allow_comments from works where id = $1", [workId]);
  if (!w) throw notFound();
  if (!w.allow_comments && req.user.role !== "artist") throw forbidden("comments_off", "Los comentarios están desactivados en esta obra.");
  let parent = null;
  if (b.parentId) {
    parent = await one("select id, parent_id, user_id from comments where id = $1 and work_id = $2", [b.parentId, workId]);
    if (!parent) throw bad("bad_parent", "El comentario al que respondes ya no existe.");
  }
  // Las respuestas siempre cuelgan del comentario raíz: un solo nivel de hilo.
  const rootId = parent ? (parent.parent_id || parent.id) : null;
  const c = await one("insert into comments (work_id, user_id, parent_id, body) values ($1, $2, $3, $4) returning id", [workId, req.user.id, rootId, b.text]);
  if (parent && parent.user_id !== req.user.id) await notify(parent.user_id, "comment_reply", { workId, commentId: c.id, by: req.user.handle });
  await notifyMentions(b.text, req.user.id, { workId, commentId: c.id, by: req.user.handle });
  const row = await one(`select c.*, u.name, u.handle, u.role, u.avatar, u.bio, 0 as likes, false as liked
    from comments c join users u on u.id = c.user_id where c.id = $1`, [c.id]);
  res.status(201).json({ comment: commentOut(row) });
}));

works.delete("/comments/:id", requireUser, ah(async (req, res) => {
  const c = await one("select user_id from comments where id = $1", [idParam(req)]);
  if (!c) throw notFound();
  if (c.user_id !== req.user.id && req.user.role !== "artist") throw forbidden();
  await q("delete from comments where id = $1", [idParam(req)]);
  res.json({ ok: true });
}));

works.post("/comments/:id/like", requireUser, ah(async (req, res) => {
  const id = idParam(req);
  if (!(await one("select 1 from comments where id = $1", [id]))) throw notFound();
  const del = await q("delete from comment_likes where user_id = $1 and comment_id = $2", [req.user.id, id]);
  if (!del.rowCount) await q("insert into comment_likes (user_id, comment_id) values ($1, $2)", [req.user.id, id]);
  const r = await one("select count(*)::int as n from comment_likes where comment_id = $1", [id]);
  res.json({ liked: !del.rowCount, likes: r.n });
}));
