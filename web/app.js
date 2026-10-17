import { T } from "./i18n.js";

// ---------- utilidades básicas ----------
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
const detectLang = () => ((navigator.languages && navigator.languages[0]) || navigator.language || "en").toLowerCase().startsWith("es") ? "es" : "en";
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const G = window.gsap && !matchMedia("(prefers-reduced-motion: reduce)").matches ? window.gsap : null;
const FLOW = ["requested", "quoted", "accepted", "sketch", "color", "done"];
const SOCIAL_META = { x: ["X", "s-x"], bsky: ["Bluesky", "s-bsky"], pixiv: ["Pixiv", "s-pixiv"], ig: ["Instagram", "s-ig"], tiktok: ["TikTok", "s-tiktok"], yt: ["YouTube", "s-yt"], patreon: ["Patreon", "s-patreon"], kofi: ["Ko-fi", "s-kofi"] };

const S = {
  lang: store.get("zaber-lang") || detectLang(),
  me: null, site: null, works: [], cols: [], tags: [], events: [], allEvents: [], comms: [], convs: [], notes: [], unreadNotes: 0,
  filter: "all", colF: null, sort: "recent", q: "", revealed: new Set(),
  current: null, comments: [], replyTo: null, navList: null,
  route: "inicio", ptab: "resumen", proTab: "datos", commId: null, cFilter: "all", evEditing: null, thread: null, threadMsgs: [],
};
const t = k => T[S.lang][k] ?? T.es[k] ?? k;
const loc = v => typeof v === "string" ? v : (v?.[S.lang] || v?.es || v?.en || "");
const role = () => S.me?.role || "guest";
const isArtist = () => role() === "artist";
const work = id => S.works.find(w => w.id === id);
const colName = id => loc(S.cols.find(c => c.id === id)?.name) || "";
const artist = () => S.site?.artist || { name: "Zaber", handle: "zaber", role: "artist", avatar: null };

// ---------- API ----------
class ApiError extends Error {
  constructor(message, code, fields, status) { super(message); this.code = code; this.fields = fields; this.status = status; }
}
async function api(path, { method = "GET", body, form } = {}) {
  const opt = { method, headers: { "x-requested-with": "zaber" }, credentials: "same-origin" };
  if (form) opt.body = form;
  else if (body !== undefined) { opt.headers["content-type"] = "application/json"; opt.body = JSON.stringify(body); }
  let res;
  try { res = await fetch("/api" + path, opt); } catch { throw new ApiError(t("offline"), "offline"); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = t("errors")[data.error] || (S.lang === "es" ? data.message : null) || t("errGeneric");
    if (res.status === 401 && S.me) { S.me = null; applyRole(); }
    throw new ApiError(msg, data.error, data.fields, res.status);
  }
  return data;
}
// Muestra el error en un aviso y, si viene por campos, debajo de cada campo del formulario.
function showError(e, form) {
  let shown = false;
  if (form && e.fields) {
    for (const [k, v] of Object.entries(e.fields)) {
      const el = form.querySelector(`[data-err="${k.split(".")[0]}"]`);
      if (el) { el.textContent = S.lang === "es" ? v : t("errField"); shown = true; }
    }
  }
  // Si el error es de un campo que no está a la vista, el aviso dice el motivo concreto.
  const first = e.fields && Object.values(e.fields)[0];
  toast(!shown && first && S.lang === "es" ? first : e.message || t("errGeneric"));
}
function clearErrors(form) { form?.querySelectorAll("[data-err], .form-err").forEach(el => el.textContent = ""); }
async function busy(btn, fn) {
  if (btn) { btn.disabled = true; btn.classList.add("busy"); }
  try { return await fn(); } finally { if (btn) { btn.disabled = false; btn.classList.remove("busy"); } }
}

// ---------- formato ----------
const nf = n => new Intl.NumberFormat(S.lang, n >= 10000 ? { notation: "compact", maximumFractionDigits: 1 } : {}).format(n || 0);
const rtf = () => new Intl.RelativeTimeFormat(S.lang, { numeric: "auto" });
function ago(date) {
  const m = Math.round((Date.now() - new Date(date).getTime()) / 60000);
  if (m < 1) return rtf().format(0, "minute");
  if (m < 60) return rtf().format(-m, "minute");
  if (m < 1440) return rtf().format(-Math.round(m / 60), "hour");
  const d = Math.round(m / 1440);
  if (d < 7) return rtf().format(-d, "day");
  if (d < 60) return rtf().format(-Math.round(d / 7), "week");
  return new Intl.DateTimeFormat(S.lang, { day: "numeric", month: "short", year: "numeric" }).format(new Date(date));
}
const fdate = d => new Intl.DateTimeFormat(S.lang, { day: "numeric", month: "short", year: "numeric" }).format(new Date(d));
const fdatetime = d => new Intl.DateTimeFormat(S.lang, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(d));
const richText = s => esc(s).replace(/@([\p{L}\p{N}_.]+)/gu, '<span class="mention">@$1</span>');

// ---------- piezas de interfaz ----------
const hidden18 = w => w.nsfw && !S.revealed.has(w.id) && !(S.me && S.me.prefs?.blur === false);
const likes = w => w.likes;
function pic(w, size = "thumb", alt = "") {
  if (!w?.image) return "";
  if (size === "detail") return `<img src="${w.image.medium}" srcset="${w.image.medium} 1280w, ${w.image.full} 2400w" sizes="(max-width: 980px) 100vw, 60vw" alt="${esc(alt)}" decoding="async">`;
  return `<img src="${w.image[size]}" alt="${esc(alt)}" loading="lazy" decoding="async">`;
}
function avatarHTML(u, size = 34, cls = "") {
  const st = `width:${size}px;height:${size}px`;
  if (!u) return `<span class="av-img av-fallback ${cls}" style="${st};font-size:${Math.round(size * .4)}px">?</span>`;
  const src = u.avatar || (u.role === "artist" ? "/assets/zaber.jpg" : null);
  if (src) return `<img class="av-img ${cls}" src="${esc(src)}" alt="" style="${st}">`;
  const hue = [...(u.name || "?")].reduce((a, c) => a + c.charCodeAt(0), 0) % 60 - 30;
  return `<span class="av-img av-fallback ${cls}" style="${st};filter:hue-rotate(${hue}deg);font-size:${Math.round(size * .4)}px">${esc((u.name || "?")[0].toUpperCase())}</span>`;
}
function card(w) {
  const h = hidden18(w);
  return `<button class="card" data-open="${w.id}">
    <div class="thumb ${h ? "blur" : ""}"><div class="pic">${pic(w, "thumb", loc(w.title))}</div>
      ${w.nsfw ? '<span class="b18">+18</span>' : ""}
      ${h ? `<div class="veil"><span><b>+18</b>${t("reveal")}</span></div>` : ""}
      <span class="lk"><svg><use href="#heart"/></svg>${nf(likes(w))}</span>
    </div>
    <div><div class="t">${esc(loc(w.title))}</div><div class="s">${ago(w.createdAt)}</div></div>
  </button>`;
}
const fileThumb = f => `<a class="media" href="${esc(f.url)}" data-lightbox="${esc(f.url)}"><img src="${esc(f.url)}" alt="" loading="lazy"></a>`;
function confirmAsk(title, text, okLabel, onOk, { password = false } = {}) {
  $("#cfTitle").textContent = title; $("#cfText").textContent = text; $("#cfText").hidden = !text; $("#cfOk").textContent = okLabel;
  $("#cfPassWrap").hidden = !password; $("#cfPass").value = ""; $("#cfErr").textContent = "";
  $("#cfOk").onclick = () => busy($("#cfOk"), async () => {
    try { await onOk($("#cfPass").value); $("#confirmDlg").close(); }
    catch (e) { if (password && e.code === "bad_password") $("#cfErr").textContent = e.message; else { $("#confirmDlg").close(); showError(e); } }
  });
  openDlg($("#confirmDlg"));
  if (password) setTimeout(() => $("#cfPass").focus(), 50);
}

// ---------- animación ----------
function burst(el, color) {
  if (!G || !el) return;
  const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  for (let i = 0; i < 9; i++) {
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("class", "spk"); s.innerHTML = '<use href="#spark"/>';
    s.style.left = cx + "px"; s.style.top = cy + "px"; s.style.color = i % 3 ? color : "#eee3ec";
    (el.closest("dialog") || document.body).appendChild(s);
    const a = (i / 9) * Math.PI * 2 + Math.random() * .4, d = 28 + Math.random() * 26;
    G.fromTo(s, { scale: 0, rotate: 0 }, { x: Math.cos(a) * d, y: Math.sin(a) * d, scale: .5 + Math.random() * .8, rotate: 90, duration: .55, ease: "power3.out" });
    G.to(s, { opacity: 0, duration: .3, delay: .35, onComplete: () => s.remove() });
  }
}
function pop(el) { if (G && el) G.fromTo(el.querySelector("svg") || el, { scale: .6 }, { scale: 1, duration: .5, ease: "elastic.out(1.2,.4)" }); }
function toast(msg) {
  const el = $("#toast"); el.querySelector("span").textContent = msg; el.hidden = false;
  if (G) G.fromTo(el, { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: .35, ease: "back.out(2)" });
  clearTimeout(el._t); el._t = setTimeout(() => G ? G.to(el, { y: 10, opacity: 0, duration: .25, onComplete: () => el.hidden = true }) : (el.hidden = true), 3200);
}
function magnet() {
  if (!G || !matchMedia("(hover: hover)").matches) return;
  $$(".btn.primary").forEach(b => {
    if (b._mag) return; b._mag = true;
    b.addEventListener("pointermove", e => { const r = b.getBoundingClientRect(); G.to(b, { x: (e.clientX - r.left - r.width / 2) * .18, y: (e.clientY - r.top - r.height / 2) * .3, duration: .3, ease: "power2.out" }); });
    b.addEventListener("pointerleave", () => G.to(b, { x: 0, y: 0, duration: .5, ease: "elastic.out(1,.4)" }));
  });
}
// GSAP reubica un momento el elemento al leer su transform y eso saca al <dialog> del modo modal,
// así que solo se anima la opacidad del diálogo y el movimiento va en sus hijos.
function openDlg(d) { if (!d.open) d.showModal(); if (G) { G.fromTo(d, { opacity: 0 }, { opacity: 1, duration: .3 }); G.fromTo(d.children, { y: 20 }, { y: 0, duration: .45, ease: "power3.out", clearProps: "transform" }); } }
function countUp(sel) { if (!G) return; $$(sel).forEach(b => { const n = +b.dataset.count, o = { v: 0 }; G.to(o, { v: n, duration: 1.2, ease: "power2.out", onUpdate: () => b.textContent = nf(Math.round(o.v)) }); }); }
function needLogin(mode = "register") { if (!S.me) { openAuth(mode); return true; } return false; }

// ---------- menciones (@) ----------
function bindMentions(ta) {
  if (ta._m) return; ta._m = true;
  const host = ta.parentElement; host.style.position = "relative";
  const box = document.createElement("div"); box.className = "mpop"; box.hidden = true; host.appendChild(box);
  let sel = 0, list = [], timer;
  const query = () => { const m = ta.value.slice(0, ta.selectionStart).match(/@([\p{L}\p{N}_.]*)$/u); return m ? m[1] : null; };
  const insert = u => { const pos = ta.selectionStart, before = ta.value.slice(0, pos).replace(/@([\p{L}\p{N}_.]*)$/u, "@" + u.handle + " "); ta.value = before + ta.value.slice(pos); ta.focus(); ta.selectionStart = ta.selectionEnd = before.length; box.hidden = true; };
  const draw = () => { box.innerHTML = list.map((u, i) => `<button type="button" class="${i === sel ? "on" : ""}" data-h="${esc(u.handle)}">${avatarHTML(u, 28)}<span><b>${esc(u.name)}</b><small>@${esc(u.handle)}</small></span></button>`).join(""); };
  ta.addEventListener("input", () => {
    const q = query(); clearTimeout(timer);
    if (q === null || !S.me) { box.hidden = true; return; }
    timer = setTimeout(async () => {
      try { list = (await api(`/users?q=${encodeURIComponent(q)}`)).users.filter(u => u.id !== S.me.id).slice(0, 5); } catch { list = []; }
      sel = 0; box.hidden = !list.length; draw();
    }, 150);
  });
  ta.addEventListener("keydown", e => {
    if (box.hidden) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); sel = (sel + (e.key === "ArrowDown" ? 1 : list.length - 1)) % list.length; draw(); }
    if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insert(list[sel]); }
    if (e.key === "Escape") box.hidden = true;
  });
  box.addEventListener("mousedown", e => { const b = e.target.closest("[data-h]"); if (b) { e.preventDefault(); insert(list.find(u => u.handle === b.dataset.h)); } });
  ta.addEventListener("blur", () => setTimeout(() => box.hidden = true, 150));
}

// ---------- carga de datos ----------
async function loadCatalog() {
  const [w, c, tg, ev] = await Promise.all([api("/works"), api("/collections"), api("/tags"), api("/events")]);
  S.works = w.works; S.cols = c.collections; S.tags = tg.tags.map(x => x.name); S.events = ev.events;
}
async function loadSite() { S.site = await api("/site"); applyArtist(); }
async function loadPrivate() {
  if (!S.me) { S.comms = []; S.convs = []; S.notes = []; S.unreadNotes = 0; return; }
  const [c, cv, n] = await Promise.all([api("/commissions"), api("/conversations"), api("/notifications")]);
  S.comms = c.commissions; S.convs = cv.conversations; S.notes = n.notifications; S.unreadNotes = n.unread;
}
function applyArtist() {
  const a = artist();
  $$(".artist-av").forEach(img => { img.src = a.avatar || "/assets/zaber.jpg"; });
  $$(".artist-name").forEach(el => { el.textContent = a.name; });
}

// ---------- inicio ----------
function nextEvent() { return S.events.filter(e => e.visible && new Date(e.startsAt) > Date.now()).sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt))[0]; }
function renderHome() {
  const f = work(S.site?.featuredWorkId) || S.works[0];
  const feat = $("#feature");
  feat.classList.toggle("empty-feature", !f);
  $("#fArt").hidden = !f;
  if (f) {
    $("#fArt").innerHTML = pic(f, "medium", loc(f.title)); $("#fArt").dataset.open = f.id;
    $("#fArt").classList.toggle("blur", hidden18(f));
    $("#fTitle").textContent = loc(f.title);
    $("#fMeta").textContent = ago(f.createdAt) + (f.collectionId ? `, ${colName(f.collectionId)}` : "");
    $("#fDesc").textContent = loc(f.desc);
    $("#fActs").innerHTML = `<button class="btn primary" data-open="${f.id}">${t("viewWork")}</button>
      <button class="act" id="fLike" aria-pressed="${f.liked}"><svg class="i"><use href="#heart"/></svg><span>${nf(f.likes)}</span></button>
      <button class="act" id="fSave" aria-pressed="${f.saved}"><svg class="i"><use href="#save"/></svg><span>${f.saved ? t("saved") : t("save")}</span></button>`;
    $("#fLike").onclick = () => toggleLike(f.id, $("#fLike"));
    $("#fSave").onclick = () => toggleSave(f.id, $("#fSave"));
    feat.querySelector(".tag").hidden = false;
  } else {
    feat.querySelector(".tag").hidden = true;
    $("#fTitle").textContent = t("emptyHomeTitle"); $("#fMeta").textContent = "";
    $("#fDesc").textContent = isArtist() ? t("emptyHomeArtist") : t("emptyHomeFan");
    $("#fActs").innerHTML = isArtist() ? `<button class="btn primary" data-newwork><svg class="i"><use href="#upload"/></svg>${t("uploadFirst")}</button>` : "";
  }
  const ev = nextEvent();
  $("#premiere").hidden = !ev; $("#lead").classList.toggle("solo", !ev);
  if (ev) {
    $("#evTitle").textContent = loc(ev.title);
    $("#teaser").innerHTML = ev.teaser ? `<img src="${ev.teaser.thumb}" alt="">` : "";
    $("#notifyBtn span").textContent = ev.notify ? t("notifyOn") : t("notifyMe"); $("#notifyBtn").setAttribute("aria-pressed", String(!!ev.notify));
  }
  const recent = [...S.works].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 20);
  const popular = [...S.works].sort((a, b) => b.likes - a.likes).slice(0, 20);
  $("#rowRecent").hidden = !S.works.length; $("#rowPopular").hidden = S.works.length < 4;
  $("#rail-recent").innerHTML = recent.map(card).join("");
  $("#rail-popular").innerHTML = popular.map(card).join("");
  const cols = S.cols.filter(c => c.count);
  $("#rowCols").hidden = !cols.length;
  $("#cols").innerHTML = cols.map(c => `<a class="col" href="#galeria" data-col="${c.id}"><div class="pic ${c.coverNsfw && !(S.me && S.me.prefs?.blur === false) ? "blurred-cover" : ""}" ${c.coverNsfw && !(S.me && S.me.prefs?.blur === false) ? 'style="filter:blur(18px);transform:scale(1.2)"' : ""}>${c.cover ? `<img src="${c.cover.thumb}" alt="" loading="lazy">` : ""}</div><div><b>${esc(loc(c.name))}</b><small>${t("works")(c.count)}</small></div></a>`).join("");
  $("#bandLive").classList.toggle("off", !S.site.open); $("#bandLive span").textContent = S.site.open ? t("open") : t("closed");
  $("#aboutText").textContent = loc(S.site.about);
  const st = S.site.stats;
  $("#nums").innerHTML = [[st.followers, "nFollowers"], [st.works, "nWorks"], [st.done, "nDone"]].map(([n, k]) => `<div><b data-count="${n}">${nf(n)}</b><small>${t(k)}</small></div>`).join("");
  $("#year").textContent = new Date().getFullYear();
}
function tick() {
  const ev = nextEvent(); if (!ev || S.route !== "inicio") return;
  const s = Math.max(0, Math.floor((new Date(ev.startsAt) - Date.now()) / 1000));
  if (!s) { S.events = S.events.filter(e => e !== ev); renderHome(); return; }
  const parts = [[Math.floor(s / 86400), "days"], [Math.floor(s / 3600) % 24, "hours"], [Math.floor(s / 60) % 60, "min"], [s % 60, "sec"]];
  const el = $("#clock");
  if (el.children.length !== 4 || el.dataset.lang !== S.lang) { el.innerHTML = parts.map(([, k]) => `<div><b></b><small>${t(k)}</small></div>`).join(""); el.dataset.lang = S.lang; }
  parts.forEach(([v], i) => { const b = el.children[i].querySelector("b"), nv = String(v).padStart(2, "0"); if (b.textContent !== nv) { b.textContent = nv; if (G && i === 3) G.fromTo(b, { y: -6, opacity: .3 }, { y: 0, opacity: 1, duration: .3, ease: "power2.out" }); } });
}

// ---------- galería ----------
function renderGallery() {
  const mode = S.route;
  $("#galTitle").textContent = mode === "guardadas" ? t("navSaved") : mode === "megusta" ? t("navLiked") : t("navGallery");
  const cols = S.cols.filter(c => c.count);
  $("#colFilter").hidden = !cols.length;
  $("#colFilter").innerHTML = [`<button class="chip" data-colf="" aria-pressed="${!S.colF}">${t("allCols")}</button>`, ...cols.map(c => `<button class="chip" data-colf="${c.id}" aria-pressed="${S.colF === c.id}">${esc(loc(c.name))}</button>`)].join("");
  let list = S.works.filter(w => S.filter === "all" || (S.filter === "nsfw") === w.nsfw);
  if (S.colF) list = list.filter(w => w.collectionId === S.colF);
  if (mode === "guardadas") list = list.filter(w => w.saved);
  if (mode === "megusta") list = list.filter(w => w.liked);
  if (S.q) { const q = S.q.toLowerCase().replace(/^#/, ""); list = list.filter(w => (w.title.es + " " + w.title.en + " " + w.tags.join(" ")).toLowerCase().includes(q)); }
  list.sort(S.sort === "popular" ? (a, b) => b.likes - a.likes : (a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  $("#grid").innerHTML = list.map(card).join("");
  const em = $("#empty"); em.hidden = list.length > 0;
  const icon = mode === "megusta" ? "heart" : mode === "guardadas" ? "save" : "search";
  const msg = S.q ? t("noResults") : mode === "megusta" ? t("emptyLiked") : mode === "guardadas" ? t("emptySaved") : S.works.length ? t("noResults") : t("emptyGallery");
  em.innerHTML = `<svg><use href="#${icon}"/></svg><p>${msg}</p>${mode !== "galeria" || S.q ? `<a class="btn sm" href="#galeria" data-clearq>${t("navGallery")}</a>` : ""}`;
  $("#sort").value = S.sort;
}

// ---------- ficha de obra ----------
function syncLikeBtns(w) {
  for (const id of ["#dLike", "#fLike"]) { const b = $(id); if (b && (id === "#fLike" ? $("#fLike") && (work(S.site?.featuredWorkId) || S.works[0])?.id === w.id : S.current?.id === w.id)) { b.setAttribute("aria-pressed", String(w.liked)); b.querySelector("span").textContent = nf(w.likes); } }
}
function syncSaveBtns(w) {
  for (const id of ["#dSave", "#fSave"]) { const b = $(id); if (b && (id === "#fSave" ? (work(S.site?.featuredWorkId) || S.works[0])?.id === w.id : S.current?.id === w.id)) { b.setAttribute("aria-pressed", String(w.saved)); b.querySelector("span").textContent = w.saved ? t("saved") : t("save"); } }
}
async function openDetail(id, { push = true } = {}) {
  const w = work(id); if (!w) return;
  S.current = w; S.revealed.add(id);
  $("#dPic").innerHTML = pic(w, "detail", loc(w.title)); $("#dPic").style.setProperty("--ar", w.image ? `${w.image.w}/${w.image.h}` : "4/5");
  $("#dBack").innerHTML = pic(w, "thumb");
  $("#dTitle").textContent = loc(w.title);
  $("#dDate").textContent = ago(w.createdAt) + (w.collectionId ? `, ${colName(w.collectionId)}` : "") + (w.nsfw ? ", +18" : "");
  $("#dDesc").textContent = loc(w.desc);
  $("#dTags").innerHTML = w.tags.map(x => `<button class="chip" data-tagsearch="${esc(x)}">#${esc(x)}</button>`).join("");
  $("#ownerBar").hidden = !isArtist();
  syncLikeBtns(w); syncSaveBtns(w);
  $("#shareBox").hidden = true; $("#dShare").setAttribute("aria-expanded", "false");
  const url = encodeURIComponent(`${location.origin}/obra/${id}`), txt = encodeURIComponent(loc(w.title) + " — Zaber");
  $("#shX").href = `https://x.com/intent/post?text=${txt}&url=${url}`;
  $("#shBs").href = `https://bsky.app/intent/compose?text=${txt}%20${url}`;
  $("#shRd").href = `https://www.reddit.com/submit?url=${url}&title=${txt}`;
  $("#swipeHint").textContent = t("swipeHint");
  S.replyTo = null; S.comments = []; renderComments(true);
  if (!$("#detail").open) { openDlg($("#detail")); requestAnimationFrame(() => { $(".detail").scrollTop = 0; $(".detail .side").scrollTop = 0; }); }
  if (push && location.pathname !== `/obra/${id}`) history.replaceState(null, "", `/obra/${id}${location.hash}`);
  refreshCards();
  try { S.comments = (await api(`/works/${id}/comments`)).comments; } catch (e) { showError(e); }
  if (S.current?.id === id) renderComments();
}
function closeDetailUrl() { if (location.pathname.startsWith("/obra/")) history.replaceState(null, "", "/" + location.hash); }
function commentHTML(c, isReply) {
  const u = c.user, mine = S.me && c.user.id === S.me.id;
  return `<div class="cm" data-cid="${c.id}">${avatarHTML(u, isReply ? 28 : 34)}<div style="min-width:0">
    <div class="n"><b>${esc(u.name)}</b>${u.role === "artist" ? `<span class="badge">${t("artistBadge")}</span>` : ""} @${esc(u.handle)}, ${ago(c.createdAt)}</div>
    <p>${richText(c.text)}</p>
    <div class="tools">
      <button class="link-btn" data-clike="${c.id}" aria-pressed="${c.liked}" aria-label="Me gusta"><svg><use href="#heart"/></svg>${c.likes || ""}</button>
      <button class="link-btn" data-creply="${c.id}">${t("reply")}</button>
      ${mine || isArtist() ? `<button class="link-btn del" data-cdel="${c.id}">${t("delete")}</button>` : ""}
    </div></div></div>`;
}
function renderComments(loading) {
  const w = S.current, all = S.comments;
  $("#dCount").textContent = loading ? "" : all.length;
  const roots = all.filter(c => !c.parentId);
  $("#dComments").innerHTML = !w.allowComments && !all.length ? `<p class="muted">${t("commentsOff")}</p>`
    : loading ? `<div class="skeleton" style="height:60px"></div>`
    : roots.length ? roots.map(r => { const reps = all.filter(c => c.parentId === r.id); return `<div>${commentHTML(r)}${reps.length ? `<div class="replies">${reps.map(c => commentHTML(c, true)).join("")}</div>` : ""}</div>`; }).join("")
    : `<p class="muted">${t("noComments")}</p>`;
  $(".cbox").hidden = !w.allowComments && !isArtist();
  const rp = $("#replying"); rp.hidden = !S.replyTo;
  if (S.replyTo) rp.querySelector("span").textContent = t("replyingTo")(S.replyTo.name);
}
function refreshCards() { if (S.route === "inicio") renderHome(); else if (["galeria", "guardadas", "megusta"].includes(S.route)) renderGallery(); }
async function toggleLike(id, btn) {
  if (needLogin()) return;
  const w = work(id);
  try {
    const r = await api(`/works/${id}/like`, { method: "POST" });
    w.liked = r.liked; w.likes = r.likes;
    syncLikeBtns(w); pop(btn); if (r.liked) burst(btn, "#ffd10b");
    if (btn.id === "dLike") refreshCards();
  } catch (e) { showError(e); }
}
async function toggleSave(id, btn) {
  if (needLogin()) return;
  const w = work(id);
  try {
    const r = await api(`/works/${id}/save`, { method: "POST" });
    w.saved = r.saved;
    syncSaveBtns(w); pop(btn); if (r.saved) burst(btn, "#c45dea");
    if (btn.id === "dSave") refreshCards();
  } catch (e) { showError(e); }
}
function navDetail(dir) {
  const L = (S.navList || S.works.map(w => w.id)).filter(id => work(id));
  if (L.length < 2 || !S.current) return;
  const i = L.indexOf(S.current.id), next = L[(i + dir + L.length) % L.length];
  openDetail(next);
  if (G) G.fromTo("#dPic", { x: dir * 60, opacity: 0 }, { x: 0, opacity: 1, duration: .4, ease: "power3.out", clearProps: "transform" });
}
function doubleLike() {
  const h = $("#bigheart");
  if (G) G.fromTo(h, { scale: .3, opacity: 0 }, { scale: 1, opacity: 1, duration: .35, ease: "back.out(2.5)", onComplete: () => G.to(h, { scale: 1.3, opacity: 0, duration: .35, delay: .25 }) });
  if (!S.me) { setTimeout(() => needLogin(), 400); return; }
  if (!S.current.liked) toggleLike(S.current.id, $("#dLike")); else burst($("#dLike"), "#ffd10b");
}
(() => {
  const st = $("#stage"); let x0 = 0, y0 = 0, t0 = 0, lastTap = 0;
  st.addEventListener("touchstart", e => { const p = e.touches[0]; x0 = p.clientX; y0 = p.clientY; t0 = Date.now(); }, { passive: true });
  st.addEventListener("touchend", e => {
    const p = e.changedTouches[0], dx = p.clientX - x0, dy = p.clientY - y0;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3) { navDetail(dx < 0 ? 1 : -1); return; }
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && Date.now() - t0 < 300) {
      if (Date.now() - lastTap < 320) { e.preventDefault(); lastTap = 0; doubleLike(); } else lastTap = Date.now();
    }
  });
  st.addEventListener("dblclick", e => { if (!e.target.closest("button")) doubleLike(); });
  document.addEventListener("keydown", e => {
    if (!$("#detail").open || e.target.matches("input, textarea")) return;
    if (e.key === "ArrowRight") navDetail(1);
    if (e.key === "ArrowLeft") navDetail(-1);
  });
  $("#detail").addEventListener("close", closeDetailUrl);
})();

// ---------- subir / editar obra ----------
let workDraft = null;
function openWorkForm(id) {
  const w = id ? work(id) : { id: null, title: { es: "", en: "" }, desc: { es: "", en: "" }, collectionId: null, tags: [], nsfw: false, allowComments: true };
  workDraft = { id: w.id, file: null, tags: new Set(w.tags) };
  const allTags = [...new Set([...S.tags, ...w.tags])].sort();
  const sw = (idf, on, label, help = "") => `<div class="setrow"><div class="grow"><b>${label}</b>${help ? `<small>${help}</small>` : ""}</div><label class="switch"><input type="checkbox" id="${idf}" ${on ? "checked" : ""} aria-label="${label}"><span></span></label></div>`;
  $("#workForm").innerHTML = `<button class="round close" type="button" data-close aria-label="Cerrar"><svg class="i"><use href="#x"/></svg></button>
    <h2>${id ? t("editWork") : t("newWorkT")}</h2>
    <div class="field"><span class="lab">${t("image")}</span>
      <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap"><div class="media lg" id="wfPrev">${id ? pic(w, "thumb") : ""}</div><label class="drop" for="wfFile" style="flex:1;min-width:180px"><svg class="i" style="width:26px;height:26px;color:var(--violet-hi)"><use href="#upload"/></svg>${t("upDrop")}</label></div>
      <input type="file" id="wfFile" accept="image/*" hidden><span class="err" data-err="image"></span></div>
    <div class="row2"><div class="field"><label for="wfTes">${t("titleEs")}</label><input type="text" id="wfTes" maxlength="120" value="${esc(w.title.es)}"><span class="err" data-err="title"></span></div><div class="field"><label for="wfTen">${t("titleEn")}</label><input type="text" id="wfTen" maxlength="120" value="${esc(w.title.en)}"></div></div>
    <div class="row2"><div class="field"><label for="wfDes">${t("descEs")}</label><textarea id="wfDes" maxlength="2000" style="min-height:80px">${esc(w.desc.es)}</textarea></div><div class="field"><label for="wfDen">${t("descEn")}</label><textarea id="wfDen" maxlength="2000" style="min-height:80px">${esc(w.desc.en)}</textarea></div></div>
    <div class="field"><label for="wfCol">${t("collection")}</label><select id="wfCol"><option value="">${t("none")}</option>${S.cols.map(c => `<option value="${c.id}" ${c.id === w.collectionId ? "selected" : ""}>${esc(loc(c.name))}</option>`).join("")}</select></div>
    <div class="field"><span class="lab">${t("tags")}</span><div class="chipset" id="wfTags">${allTags.map(x => `<button type="button" class="chip" data-wtag="${esc(x)}" aria-pressed="${w.tags.includes(x)}">#${esc(x)}</button>`).join("")}</div>
      <label hidden for="wfNewTag">${t("newTag")}</label><input type="text" id="wfNewTag" maxlength="40" placeholder="${t("addTag")}" style="max-width:260px"></div>
    <div>${sw("wfNsfw", w.nsfw, t("markNsfw"), t("markNsfwD"))}${sw("wfCom", w.allowComments, t("allowComments"))}${sw("wfFeat", id && S.site.featuredWorkId === id, t("featureIt"))}</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn primary" id="wfGo">${id ? t("update") : t("publish")}</button>${id ? `<button type="button" class="btn danger" data-wdel="${id}"><svg class="i"><use href="#trash"/></svg>${t("delete")}</button>` : ""}</div>`;
  $("#wfFile").addEventListener("change", e => {
    const f = e.target.files[0]; if (!f) return;
    workDraft.file = f; $("#wfPrev").innerHTML = `<img src="${URL.createObjectURL(f)}" alt="">`;
  });
  $("#wfNewTag").addEventListener("keydown", e => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const v = e.target.value.trim().replace(/^#/, "").toLowerCase(); if (!v) return;
    workDraft.tags.add(v); e.target.value = "";
    if (!$(`#wfTags [data-wtag="${CSS.escape(v)}"]`)) $("#wfTags").insertAdjacentHTML("beforeend", `<button type="button" class="chip" data-wtag="${esc(v)}" aria-pressed="true">#${esc(v)}</button>`);
    else $(`#wfTags [data-wtag="${CSS.escape(v)}"]`).setAttribute("aria-pressed", "true");
  });
  openDlg($("#workDlg")); magnet();
}
$("#workForm").addEventListener("click", e => {
  const b = e.target.closest("[data-wtag]"); if (!b) return;
  const on = b.getAttribute("aria-pressed") !== "true"; b.setAttribute("aria-pressed", String(on));
  on ? workDraft.tags.add(b.dataset.wtag) : workDraft.tags.delete(b.dataset.wtag);
});
$("#workForm").addEventListener("submit", e => {
  e.preventDefault();
  const form = e.target; clearErrors(form);
  const isNew = !workDraft.id;
  if (isNew && !workDraft.file) { form.querySelector('[data-err="image"]').textContent = t("imageNeeded"); return; }
  const fd = new FormData();
  fd.set("title", JSON.stringify({ es: $("#wfTes").value.trim(), en: $("#wfTen").value.trim() }));
  fd.set("desc", JSON.stringify({ es: $("#wfDes").value.trim(), en: $("#wfDen").value.trim() }));
  fd.set("collectionId", $("#wfCol").value);
  fd.set("tags", JSON.stringify([...workDraft.tags]));
  fd.set("nsfw", String($("#wfNsfw").checked));
  fd.set("allowComments", String($("#wfCom").checked));
  fd.set("featured", String($("#wfFeat").checked));
  if (workDraft.file) fd.set("image", workDraft.file);
  const btn = $("#wfGo");
  busy(btn, async () => {
    try {
      if (workDraft.file) btn.lastChild.textContent = t("uploading");
      const r = await api(isNew ? "/works" : `/works/${workDraft.id}`, { method: isNew ? "POST" : "PATCH", form: fd });
      if (isNew) S.works.unshift(r.work); else Object.assign(work(r.work.id), r.work);
      burst(btn, "#ffd10b"); $("#workDlg").close(); toast(isNew ? t("published") : t("updated"));
      await Promise.all([loadSite(), api("/collections").then(c => { S.cols = c.collections; }), api("/tags").then(tg => { S.tags = tg.tags.map(x => x.name); })]);
      if ($("#detail").open) openDetail(r.work.id); else rerender();
    } catch (err) {
      btn.lastChild.textContent = isNew ? t("publish") : t("update");
      showError(err, form);
    }
  });
});
function deleteWork(id) {
  confirmAsk(t("delWorkQ"), t("delWorkT"), t("delete"), async () => {
    await api(`/works/${id}`, { method: "DELETE" });
    S.works = S.works.filter(w => w.id !== id);
    if ($("#workDlg").open) $("#workDlg").close();
    if ($("#detail").open) $("#detail").close();
    toast(t("deleted"));
    await loadSite(); rerender();
  });
}

// ---------- comisiones ----------
function gateHTML(title) { return `<div class="gate"><svg><use href="#lock"/></svg><h3 style="font-size:1.4rem">${title}</h3><p class="muted">${t("needAccountText")}</p><button class="btn primary" data-open-login>${t("createAccount")}</button></div>`; }
const progressPct = c => c.status === "rejected" ? 0 : Math.round(FLOW.indexOf(c.status) / (FLOW.length - 1) * 100);
function statusPill(c, asArtist) {
  if (c.approval === "pending") return `<span class="pill wait">${asArtist ? t("waitingClient") : t("waiting")}</span>`;
  if (c.status === "quoted" && !asArtist) return `<span class="pill wait">${t("st").quoted}</span>`;
  return `<span class="pill ${c.status}">${t("st")[c.status]}</span>`;
}
function commCard(c, asArtist) {
  const u = c.client || { name: t("deletedUser"), handle: "—" };
  return `<button class="ccard" data-comm="${c.id}">
    <div class="mini">${c.cover ? `<img src="${esc(c.cover.url)}" alt="" loading="lazy">` : avatarHTML(c.client, 56)}</div>
    <div style="min-width:0"><b>${t("commNo")(c.code)}</b>${asArtist ? ` <span class="muted">${esc(u.name)}</span>` : ""}<small>${t("cTypes")[c.type] || ""}, ${ago(c.updatedAt)}</small><div class="bar-p"><i style="width:${progressPct(c)}%"></i></div></div>
    ${statusPill(c, asArtist)}
  </button>`;
}
function renderCommission() {
  const box = $("#comView");
  const steps = `<div><div class="live ${S.site.open ? "" : "off"}"><i></i><span>${S.site.open ? t("open") : t("closed")}</span></div><h2 style="font-size:2.4rem">${t("comTitle")}</h2><p class="muted" style="margin-top:12px;max-width:46ch">${t("comIntro")}</p>
    <ol class="steps">${[1, 2, 3, 4].map(i => `<li><div><b>${t("s" + i)}</b><span>${t("s" + i + "d")}</span></div></li>`).join("")}</ol></div>`;
  if (isArtist()) { box.innerHTML = `<div class="two">${steps}<div class="panel"><h3>${t("ptabs").encargos}</h3><div style="display:grid;gap:10px">${S.comms.map(c => commCard(c, true)).join("") || `<p class="muted">${t("noReqs")}</p>`}</div></div></div>`; return; }
  if (!S.me) { box.innerHTML = `<div class="two">${steps}${gateHTML(t("needAccount"))}</div>`; return; }
  const form = S.site.open ? `<form class="panel" id="comForm" novalidate>
    <h3>${t("comFormTitle")}</h3>
    <div class="field"><label for="cfType">${t("cType")}</label><select id="cfType">${t("cTypes").map((o, i) => `<option value="${i}">${o}</option>`).join("")}</select></div>
    <div class="field"><label for="cfDesc">${t("cDesc")}</label><textarea id="cfDesc" maxlength="4000"></textarea><small>${t("cDescHelp")}</small><span class="err" data-err="description"></span></div>
    <div class="field"><span class="lab">${t("cRefs")}</span><label class="drop" for="cfRefs"><svg class="i" style="width:24px;height:24px;color:var(--violet-hi)"><use href="#upload"/></svg>${t("cDrop")}</label><input type="file" id="cfRefs" multiple accept="image/*" hidden><div class="thumbs" id="cfThumbs"></div></div>
    <div class="row2"><div class="field"><label for="cfUse">${t("cUse")}</label><select id="cfUse">${t("cUses").map((o, i) => `<option value="${i}">${o}</option>`).join("")}</select></div>
      <div class="field"><label for="cfBudget">${t("cBudget")}</label><input type="text" id="cfBudget" maxlength="60" placeholder="50 USD"></div></div>
    <label class="check"><input type="checkbox" id="cfNsfw"><span>${t("cNsfw")}</span></label>
    <button class="btn primary" style="justify-self:start">${t("send")}</button></form>` : `<div class="gate"><svg><use href="#lock"/></svg><h3 style="font-size:1.4rem">${t("closed")}</h3><p class="muted">${t("closedText")}</p></div>`;
  box.innerHTML = `<div style="display:grid;gap:36px"><div class="two">${steps}${form}</div>
    <div><div class="row-head"><h2>${t("yourComms")}</h2></div>${S.comms.length ? `<div style="display:grid;gap:10px">${S.comms.map(c => commCard(c)).join("")}</div>` : `<p class="muted">${t("noComms")}</p>`}</div></div>`;
  if (S.site.open) {
    let refs = [];
    const draw = () => { $("#cfThumbs").innerHTML = refs.map((f, i) => `<div class="media"><img src="${URL.createObjectURL(f)}" alt=""><button type="button" class="x" data-rmref="${i}" aria-label="Quitar"><svg><use href="#x"/></svg></button></div>`).join(""); };
    $("#cfRefs").addEventListener("change", e => { refs = [...refs, ...e.target.files].slice(0, 6); e.target.value = ""; draw(); });
    $("#cfThumbs").addEventListener("click", e => { const b = e.target.closest("[data-rmref]"); if (b) { refs.splice(+b.dataset.rmref, 1); draw(); } });
    $("#comForm").addEventListener("submit", e => {
      e.preventDefault(); const form = e.target; clearErrors(form);
      const fd = new FormData();
      fd.set("type", $("#cfType").value); fd.set("usage", $("#cfUse").value); fd.set("nsfw", String($("#cfNsfw").checked));
      fd.set("budget", $("#cfBudget").value.trim()); fd.set("description", $("#cfDesc").value.trim());
      refs.forEach(f => fd.append("files", f));
      busy(e.submitter, async () => {
        try {
          const r = await api("/commissions", { method: "POST", form: fd });
          burst(e.submitter, "#ffd10b"); toast(t("sent"));
          S.comms = (await api("/commissions")).commissions;
          location.hash = `encargo-${r.id}`;
        } catch (err) { showError(err, form); }
      });
    });
  }
  magnet();
}
async function renderCommDetail() {
  const box = $("#commDetail");
  let c;
  try { c = (await api(`/commissions/${S.commId}`)).commission; }
  catch (e) { showError(e); location.hash = isArtist() ? "panel" : "comisiones"; return; }
  if (S.route !== "encargo") return;
  const asArtist = isArtist(), u = c.client || { name: t("deletedUser"), handle: "—" }, ci = FLOW.indexOf(c.status);
  const stepper = `<div class="stepper">${FLOW.map((s, i) => `<div class="${i < ci ? "done" : i === ci ? "now" : ""}"><i></i><span>${t("stShort")[s]}</span></div>`).join("")}</div>`;
  const lastQuote = c.updates.map(x => x.status).lastIndexOf("quoted");
  const lastAsk = c.updates.map(x => x.askApproval).lastIndexOf(true);
  const tl = c.updates.map((up, i) => {
    const who = up.author || { name: up.byArtist ? artist().name : t("deletedUser"), handle: "", role: up.byArtist ? "artist" : "fan" };
    const mine = up.byArtist === asArtist;
    let extra = "";
    if (i === lastAsk && c.approval === "pending") {
      extra = asArtist ? `<div class="approve"><span class="pill wait">${t("waitingClient")}</span></div>`
        : `<div class="approve" id="approveBox"><span class="pill wait">${t("waiting")}</span><button class="btn primary sm" data-approve="yes"><svg class="i"><use href="#check"/></svg>${t("approve")}</button><button class="btn sm" data-approve="no">${t("askChanges")}</button></div>`;
    }
    if (i === lastQuote && c.status === "quoted" && c.quote) extra = `<div class="approve"><b>${t("quoteFor")(esc(c.quote.price), esc(c.quote.days))}</b>${asArtist ? `<span class="pill wait">${t("waitingClient")}</span>` : `<button class="btn primary sm" data-quote="yes"><svg class="i"><use href="#check"/></svg>${t("acceptQuote")}</button><button class="btn sm danger" data-quote="no">${t("declineQuote")}</button>`}</div>`;
    let text = up.text;
    if (!text && up.status === "quoted" && i === lastQuote && c.quote && c.status !== "quoted") text = t("quoteFor")(c.quote.price, c.quote.days);
    return `<li class="${mine ? "mine" : ""}">${avatarHTML(who, 36)}<div style="min-width:0">
      <div class="who"><b>${esc(who.name)}</b>${up.status ? `<span class="pill ${up.status}">${t("st")[up.status]}</span>` : ""}${up.approval ? `<span class="pill ${up.approval === "approved" ? "ok" : "rejected"}">${up.approval === "approved" ? t("approved") : t("changesReq")}</span>` : ""}<span>${fdatetime(up.createdAt)}</span></div>
      <div class="body">${text ? `<p>${richText(text)}</p>` : ""}${up.files.length ? `<div class="thumbs">${up.files.map(fileThumb).join("")}</div>` : ""}${extra}</div></div></li>`;
  }).join("");
  const nextOpts = ["sketch", "color", "done"].filter(s => FLOW.indexOf(s) > ci);
  let composer = "";
  if (asArtist && c.status === "requested") {
    composer = `<form class="panel" id="quoteForm" novalidate><h3>${t("sendQuote")}</h3>
      <div class="row2"><div class="field"><label for="qPrice">${t("price")}</label><input type="text" id="qPrice" maxlength="40" placeholder="90 USD"><span class="err" data-err="price"></span></div><div class="field"><label for="qDays">${t("deadline")}</label><input type="number" id="qDays" min="1" max="365" inputmode="numeric" placeholder="14"><span class="err" data-err="days"></span></div></div>
      <div class="field"><label for="qNote">${t("note")}</label><textarea id="qNote" data-mentions maxlength="2000" style="min-height:80px"></textarea></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn primary"><svg class="i"><use href="#send"/></svg>${t("sendQuote")}</button><button type="button" class="btn danger" id="rejectBtn">${t("rejectReq")}</button></div></form>`;
  } else if (!["done", "rejected"].includes(c.status) && !(asArtist && c.status === "quoted")) {
    composer = `<form class="panel" id="updForm" novalidate>${asArtist ? `<h3>${t("newUpdate")}</h3>
      ${["accepted", "sketch", "color"].includes(c.status) ? `<div class="field"><label for="uStatus">${t("changeTo")}</label><select id="uStatus"><option value="">${t("sameStatus")} (${t("st")[c.status]})</option>${nextOpts.map(s => `<option value="${s}">${t("st")[s]}</option>`).join("")}</select></div>` : ""}` : ""}
      <div class="field"><label for="uMsg">${asArtist ? t("msg") : t("replyHere")}</label><textarea id="uMsg" data-mentions maxlength="4000" style="min-height:90px"></textarea></div>
      <input type="file" id="uFiles" accept="image/*" multiple hidden><div class="thumbs" id="uThumbs"></div>
      ${asArtist && ["accepted", "sketch", "color"].includes(c.status) ? `<label class="check"><input type="checkbox" id="uAsk"><span>${t("askApproval")}</span></label>` : ""}
      <div style="display:flex;gap:10px;flex-wrap:wrap"><label class="btn sm" for="uFiles"><svg class="i"><use href="#clip"/></svg>${t("attachFiles")}</label><button class="btn primary sm"><svg class="i"><use href="#send"/></svg>${asArtist ? t("sendTo")(esc(u.name)) : t("sendMsg")}</button></div></form>`;
  }
  const dl = [[t("client"), `${esc(u.name)}${u.handle !== "—" ? " @" + esc(u.handle) : ""}`], [t("type"), t("cTypes")[c.type] || ""], [t("use"), t("cUses")[c.usage] || ""], [t("nsfwQ"), c.nsfw ? t("yes") : t("no")], [t("budget"), esc(c.budget) || "—"], [t("price"), c.quote ? esc(c.quote.price) : "—"], [t("deadline"), c.quote ? t("daysN")(esc(c.quote.days)) : "—"], [t("created"), fdate(c.createdAt)]];
  box.innerHTML = `<div style="display:grid;gap:22px">
    <a class="back" href="${asArtist ? "#panel" : "#comisiones"}" ${asArtist ? 'data-ptab="encargos"' : ""}><svg class="i"><use href="#left"/></svg>${t("backComms")}</a>
    <div class="ptitle"><div><h2>${t("commNo")(c.code)}</h2><p class="muted" style="margin-top:6px">${t("cTypes")[c.type] || ""}, ${esc(u.name)}</p></div>${statusPill(c, asArtist)}</div>
    ${c.status !== "rejected" ? stepper : ""}
    <div class="two wide"><div style="display:grid;gap:22px;min-width:0"><div class="panel"><h3>${t("history")}</h3><ol class="tl">${tl}</ol></div>${composer}</div>
      <div class="panel summary"><h3>${t("summary")}</h3><p style="color:#d4c6da;white-space:pre-line;overflow-wrap:anywhere">${esc(c.description)}</p><dl>${dl.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join("")}</dl></div></div></div>`;
  $$("#commDetail [data-mentions]").forEach(bindMentions);
  let files = [];
  const drawFiles = () => { $("#uThumbs").innerHTML = files.map((f, i) => `<div class="media"><img src="${URL.createObjectURL(f)}" alt=""><button type="button" class="x" data-rmf="${i}" aria-label="Quitar"><svg><use href="#x"/></svg></button></div>`).join(""); };
  $("#uFiles")?.addEventListener("change", e => { files = [...files, ...e.target.files].slice(0, 6); e.target.value = ""; drawFiles(); });
  $("#uThumbs")?.addEventListener("click", e => { const b = e.target.closest("[data-rmf]"); if (b) { files.splice(+b.dataset.rmf, 1); drawFiles(); } });
  $("#updForm")?.addEventListener("submit", e => {
    e.preventDefault();
    const fd = new FormData(), text = $("#uMsg").value.trim(), st = $("#uStatus")?.value || "";
    if (!st && !text && !files.length) { $("#uMsg").focus(); return; }
    fd.set("text", text); if (st) fd.set("status", st); if ($("#uAsk")?.checked) fd.set("askApproval", "true");
    files.forEach(f => fd.append("files", f));
    busy(e.submitter, async () => {
      try { await api(`/commissions/${c.id}/updates`, { method: "POST", form: fd }); burst(e.submitter, "#ffd10b"); toast(t("sentTo")(asArtist ? u.name : artist().name)); await afterCommChange(); }
      catch (err) { showError(err); }
    });
  });
  $("#quoteForm")?.addEventListener("submit", e => {
    e.preventDefault(); const form = e.target; clearErrors(form);
    busy(e.submitter, async () => {
      try { await api(`/commissions/${c.id}/quote`, { method: "POST", body: { price: $("#qPrice").value.trim(), days: Number($("#qDays").value), note: $("#qNote").value.trim() } }); burst(e.submitter, "#ffd10b"); toast(t("sentTo")(u.name)); await afterCommChange(); }
      catch (err) { showError(err, form); }
    });
  });
  $("#rejectBtn")?.addEventListener("click", () => confirmAsk(t("rejectReq"), t("rejectReqT"), t("rejectReq"), async () => { await api(`/commissions/${c.id}/reject`, { method: "POST", body: {} }); await afterCommChange(); }));
  $$("[data-quote]").forEach(b => b.addEventListener("click", () => busy(b, async () => {
    const accept = b.dataset.quote === "yes";
    try { await api(`/commissions/${c.id}/quote-response`, { method: "POST", body: { accept } }); if (accept) burst(b, "#ffd10b"); toast(accept ? t("quoteAccepted") : t("quoteDeclined")); await afterCommChange(); }
    catch (err) { showError(err); }
  })));
  $$("[data-approve]").forEach(b => b.addEventListener("click", () => {
    if (b.dataset.approve === "yes") return busy(b, async () => {
      try { await api(`/commissions/${c.id}/approval`, { method: "POST", body: { approve: true } }); burst(b, "#5fd39a"); toast(t("approvedToast")); await afterCommChange(); }
      catch (err) { showError(err); }
    });
    $("#approveBox").innerHTML = `<div class="field" style="flex:1;min-width:220px"><label for="chNote">${t("changesWhat")}</label><textarea id="chNote" maxlength="2000" style="min-height:80px"></textarea></div><button class="btn primary sm" id="chGo">${t("sendChanges")}</button>`;
    $("#chNote").focus();
    $("#chGo").addEventListener("click", () => busy($("#chGo"), async () => {
      try { await api(`/commissions/${c.id}/approval`, { method: "POST", body: { approve: false, note: $("#chNote").value.trim() } }); toast(t("changesToast")); await afterCommChange(); }
      catch (err) { showError(err); }
    }));
  }));
  magnet();
}
async function afterCommChange() {
  S.comms = (await api("/commissions")).commissions;
  await renderCommDetail(); updateBadges();
  if (G) G.from("#commDetail .tl li:last-child", { y: 16, opacity: 0, duration: .45, ease: "power3.out" });
}

// ---------- mensajes ----------
async function renderMessages() {
  const box = $("#msgSide");
  if (!S.me) { box.innerHTML = `<div style="max-width:520px">${gateHTML(t("needAccountMsg"))}</div>`; return; }
  try { S.convs = (await api("/conversations")).conversations; } catch (e) { showError(e); return; }
  if (S.route !== "mensajes") return;
  if (!S.convs.length) { box.innerHTML = `<div class="empty"><svg><use href="#chat"/></svg><p>${t("noConversations")}</p></div>`; return; }
  if (!S.thread || !S.convs.find(c => c.user.id === S.thread)) S.thread = S.convs[0].user.id;
  const conv = S.convs.find(c => c.user.id === S.thread);
  let data;
  try { data = await api(`/messages${isArtist() ? `?with=${S.thread}` : ""}`); } catch (e) { showError(e); return; }
  S.threadMsgs = data.messages; conv.unread = 0; updateBadges();
  const tu = data.user;
  box.innerHTML = `<div class="inbox ${isArtist() ? "" : "solo"}">
    <div class="threads" ${isArtist() ? "" : "hidden"}>${S.convs.map(x => `<button data-thread="${x.user.id}" aria-current="${x.user.id === S.thread}">${avatarHTML(x.user, 40)}<span style="min-width:0"><b>${esc(x.user.name)}</b>${x.unread ? ` <span class="count" style="display:inline-grid">${x.unread}</span>` : ""}<small>${esc(x.last || "")}</small></span></button>`).join("")}</div>
    <div class="thread"><div class="th-head">${avatarHTML(tu, 34)}<b>${esc(tu.name)}</b><span class="muted">@${esc(tu.handle)}</span></div>
      <div class="msgs" id="msgs">${S.threadMsgs.length ? S.threadMsgs.map(msgHTML).join("") : `<p class="muted" id="noMsgs">${t("noMessages")}</p>`}</div>
      <div class="compose-files" id="mFiles"></div>
      <form class="compose" id="compose"><input type="file" id="mFileIn" accept="image/*" multiple hidden><label class="round clip" for="mFileIn" aria-label="${t("attach")}"><svg class="i"><use href="#clip"/></svg></label><label for="msgIn" hidden>${t("typeMsg")}</label><input type="text" id="msgIn" maxlength="4000" autocomplete="off" placeholder="${t("typeMsg")}"><button class="round go" aria-label="${t("sendMsg")}"><svg class="i"><use href="#send"/></svg></button></form></div></div>`;
  scrollMsgs();
  let files = [];
  const drawFiles = () => { $("#mFiles").innerHTML = files.map((f, i) => `<div class="media"><img src="${URL.createObjectURL(f)}" alt=""><button type="button" class="x" data-rmm="${i}" aria-label="Quitar"><svg><use href="#x"/></svg></button></div>`).join(""); };
  $("#mFileIn").addEventListener("change", e => { files = [...files, ...e.target.files].slice(0, 6); e.target.value = ""; drawFiles(); });
  $("#mFiles").addEventListener("click", e => { const b = e.target.closest("[data-rmm]"); if (b) { files.splice(+b.dataset.rmm, 1); drawFiles(); } });
  $("#compose").addEventListener("submit", e => {
    e.preventDefault(); const v = $("#msgIn").value.trim(); if (!v && !files.length) return;
    const fd = new FormData(); fd.set("text", v); if (isArtist()) fd.set("to", String(S.thread)); files.forEach(f => fd.append("files", f));
    const btn = e.submitter;
    busy(btn, async () => {
      try { await api("/messages", { method: "POST", form: fd }); $("#msgIn").value = ""; files = []; drawFiles(); $("#msgIn").focus(); }
      catch (err) { showError(err); }
    });
  });
}
function msgHTML(m) {
  const mine = m.from === S.me.id;
  return `<div class="msg ${mine ? "mine" : ""}" data-mid="${m.id}">${m.text ? richText(m.text) : ""}${m.files.length ? `<div class="thumbs">${m.files.map(fileThumb).join("")}</div>` : ""}<time>${fdatetime(m.createdAt)}</time></div>`;
}
function scrollMsgs() { const m = $("#msgs"); if (m) m.lastElementChild?.scrollIntoView({ block: "end" }); }

// ---------- tiempo real ----------
let ws, wsTimer, wsTries = 0;
function connectWs() {
  if (!S.me || ws) return;
  ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
  ws.onopen = () => { wsTries = 0; };
  ws.onmessage = e => {
    let d; try { d = JSON.parse(e.data); } catch { return; }
    if (d.type === "message") onLiveMessage(d);
    if (d.type === "notification") {
      const n = { ...d.notification, read: false, createdAt: d.notification.created_at };
      S.notes.unshift(n); S.unreadNotes++; updateBadges(); if (!$("#notes").hidden) renderNotes();
      // Si estás mirando ese encargo, se actualiza solo.
      if (n.data?.commissionId) api("/commissions").then(r => { S.comms = r.commissions; updateBadges(); if (S.route === "encargo" && S.commId === n.data.commissionId) renderCommDetail(); }).catch(() => {});
    }
  };
  ws.onclose = () => { ws = null; if (S.me) { clearTimeout(wsTimer); wsTimer = setTimeout(connectWs, Math.min(30000, 1000 * 2 ** wsTries++)); } };
}
function disconnectWs() { clearTimeout(wsTimer); if (ws) { const w = ws; ws = null; w.onclose = null; w.close(); } }
function onLiveMessage({ message: m, from }) {
  const other = m.from === S.me.id ? m.to : m.from;
  const conv = S.convs.find(c => c.user.id === other);
  if (conv) { conv.last = m.text; conv.lastAt = m.createdAt; }
  if (S.route === "mensajes" && S.thread === other && $("#msgs")) {
    if (S.threadMsgs.some(x => x.id === m.id)) return;
    S.threadMsgs.push(m); $("#noMsgs")?.remove();
    $("#msgs").insertAdjacentHTML("beforeend", msgHTML(m)); scrollMsgs();
    if (G) G.from("#msgs .msg:last-child", { y: 14, scale: .9, opacity: 0, duration: .35, ease: "back.out(2)", transformOrigin: m.from === S.me.id ? "100% 100%" : "0% 100%" });
    if (m.from !== S.me.id) api(`/messages${isArtist() ? `?with=${other}` : ""}`).catch(() => {});
    return;
  }
  if (m.from !== S.me.id) {
    if (conv) conv.unread = (conv.unread || 0) + 1; else S.convs.unshift({ user: from, last: m.text, lastAt: m.createdAt, unread: 1 });
    updateBadges(); toast(t("newMsgFrom")(from.name));
    if (S.route === "mensajes") renderMessages();
  }
}

// ---------- perfil ----------
function renderProfile() {
  const box = $("#profileView");
  if (!S.me) { box.innerHTML = gateHTML(t("joinTitle")); return; }
  const me = S.me, art = isArtist();
  const tabs = Object.entries(t("pTabs")).filter(([k]) => !(art && k === "encargos"));
  if (!tabs.find(([k]) => k === S.proTab)) S.proTab = "datos";
  let body = "";
  if (S.proTab === "datos") body = `<form class="panel" id="proForm" style="max-width:760px" novalidate>
    <div class="field"><span class="lab">${t("photo")}</span><div class="avatar-edit">${avatarHTML(me, 96, "big")}
      <label class="btn sm" for="proPhoto"><svg class="i"><use href="#upload"/></svg>${t("changePhoto")}</label>${me.avatar ? `<button type="button" class="btn sm ghost" id="rmPhoto">${t("removePhoto")}</button>` : ""}<input type="file" id="proPhoto" accept="image/*" hidden></div></div>
    <div class="row2"><div class="field"><label for="proName">${t("displayName")}</label><input type="text" id="proName" maxlength="60" value="${esc(me.name)}"><span class="err" data-err="name"></span></div>
      <div class="field"><label for="proHandle">${t("username")}</label><input type="text" id="proHandle" maxlength="31" value="${esc(me.handle)}"><small>${t("usernameHelp")}</small><span class="err" data-err="handle"></span></div></div>
    <div class="field"><label for="proBio">${t("bio")}</label><textarea id="proBio" maxlength="500" style="min-height:90px">${esc(me.bio)}</textarea></div>
    <button class="btn primary" style="justify-self:start">${t("saveChanges")}</button></form>`;
  if (S.proTab === "cuenta") body = `<div style="display:grid;gap:22px;max-width:760px">
    <form class="panel" id="mailForm" novalidate><h3>${t("changeEmail")}</h3><div class="row2"><div class="field"><label for="proMail">${t("newEmail")}</label><input type="email" id="proMail" maxlength="200" value="${esc(me.email)}"><span class="err" data-err="email"></span></div>
      <div class="field"><label for="proMailPw">${t("confirmPass")}</label><input type="password" id="proMailPw" autocomplete="current-password"><span class="err" data-err="password"></span></div></div><button class="btn sm" style="justify-self:start">${t("saveChanges")}</button></form>
    <form class="panel" id="passForm" novalidate><h3>${t("changePass")}</h3>
      <div class="field"><label for="pCur">${t("curPass")}</label><input type="password" id="pCur" autocomplete="current-password"><span class="err" data-err="current"></span></div>
      <div class="row2"><div class="field"><label for="pNew">${t("newPass")}</label><input type="password" id="pNew" autocomplete="new-password"><small>${t("passHelp")}</small><span class="err" data-err="next"></span></div>
        <div class="field"><label for="pNew2">${t("newPass2")}</label><input type="password" id="pNew2" autocomplete="new-password"><span class="err" data-err="next2"></span></div></div>
      <button class="btn primary" style="justify-self:start">${t("changePass")}</button></form>
    ${art ? "" : `<div class="panel" style="border-color:rgba(255,107,139,.3)"><h3>${t("dangerZone")}</h3><p class="muted">${t("dangerText")}</p><button class="btn danger" id="delAcc" style="justify-self:start">${t("delAccount")}</button></div>`}</div>`;
  if (S.proTab === "prefs") body = `<div class="panel" style="max-width:760px;gap:0">
    ${[["blur", "prefBlur", "prefBlurD"], ["mail", "prefMail", "prefMailD"], ["mention", "prefMention", ""]].map(([k, a, b]) => `<div class="setrow"><div class="grow"><b>${t(a)}</b>${b ? `<small>${t(b)}</small>` : ""}</div><label class="switch"><input type="checkbox" data-pref="${k}" ${me.prefs[k] !== false ? "checked" : ""} aria-label="${t(a)}"><span></span></label></div>`).join("")}
    <div class="setrow"><div class="grow"><b>${t("prefLang")}</b></div><div class="seg"><button data-lang2="es" aria-pressed="${S.lang === "es"}">Español</button><button data-lang2="en" aria-pressed="${S.lang === "en"}">English</button></div></div></div>`;
  if (S.proTab === "encargos") body = S.comms.length ? `<div style="display:grid;gap:10px;max-width:860px">${S.comms.map(c => commCard(c)).join("")}</div>` : `<div class="empty"><svg><use href="#brush"/></svg><p>${t("noComms")}</p><a class="btn sm primary" href="#comisiones">${t("ctaCommission")}</a></div>`;
  box.innerHTML = `<div style="display:grid;gap:22px"><div style="display:flex;gap:14px;align-items:center">${avatarHTML(me, 56)}<div><h2 style="font-size:2rem">${esc(me.name)}</h2><p class="muted">@${esc(me.handle)}</p></div></div>
    <div class="tabbar" role="tablist">${tabs.map(([k, v]) => `<button role="tab" data-protab="${k}" aria-selected="${S.proTab === k}">${v}</button>`).join("")}</div>${body}</div>`;
  const setMe = async u => { S.me = u; refreshMe(); if (art) await loadSite(); renderProfile(); };
  $("#proPhoto")?.addEventListener("change", e => {
    const f = e.target.files[0]; if (!f) return;
    const fd = new FormData(); fd.set("avatar", f);
    api("/me/avatar", { method: "POST", form: fd }).then(r => setMe(r.user)).then(() => toast(t("savedOk"))).catch(err => showError(err));
  });
  $("#rmPhoto")?.addEventListener("click", () => api("/me/avatar", { method: "DELETE" }).then(r => setMe(r.user)).catch(err => showError(err)));
  $("#proForm")?.addEventListener("submit", e => {
    e.preventDefault(); const form = e.target; clearErrors(form);
    busy(e.submitter, async () => {
      try { const r = await api("/me", { method: "PATCH", body: { name: $("#proName").value.trim(), handle: $("#proHandle").value.trim(), bio: $("#proBio").value.trim() } }); burst(e.submitter, "#ffd10b"); toast(t("savedOk")); await setMe(r.user); }
      catch (err) { showError(err, form); }
    });
  });
  $("#mailForm")?.addEventListener("submit", e => {
    e.preventDefault(); const form = e.target; clearErrors(form);
    busy(e.submitter, async () => {
      try { const r = await api("/me/email", { method: "PATCH", body: { email: $("#proMail").value.trim(), password: $("#proMailPw").value } }); toast(t("emailChanged")); await setMe(r.user); }
      catch (err) { showError(err, form); }
    });
  });
  $("#passForm")?.addEventListener("submit", e => {
    e.preventDefault(); const form = e.target; clearErrors(form);
    const cur = $("#pCur").value, n1 = $("#pNew").value, n2 = $("#pNew2").value;
    if (n1.length < 8) { form.querySelector('[data-err="next"]').textContent = t("errLen"); return; }
    if (n1 !== n2) { form.querySelector('[data-err="next2"]').textContent = t("errMatch"); return; }
    busy(e.submitter, async () => {
      try { await api("/me/password", { method: "PATCH", body: { current: cur, next: n1 } }); form.reset(); burst(e.submitter, "#5fd39a"); toast(t("passOk")); }
      catch (err) { showError(err, form); if (G) G.fromTo(form, { x: -8 }, { x: 0, duration: .5, ease: "elastic.out(1.5,.3)" }); }
    });
  });
  $("#delAcc")?.addEventListener("click", () => confirmAsk(t("delAccountQ"), t("dangerText"), t("delAccount"), async pw => {
    await api("/me", { method: "DELETE", body: { password: pw } });
    await afterLogout(); toast(t("accountDeleted")); location.hash = "inicio";
  }, { password: true }));
  $$("[data-pref]").forEach(i => i.addEventListener("change", async () => {
    try { const r = await api("/me", { method: "PATCH", body: { prefs: { [i.dataset.pref]: i.checked } } }); S.me = r.user; toast(t("savedOk")); }
    catch (err) { i.checked = !i.checked; showError(err); }
  }));
  $$("[data-lang2]").forEach(b => b.addEventListener("click", () => setLang(b.dataset.lang2)));
  magnet();
}

// ---------- panel de Zaber ----------
async function renderPanel() {
  const box = $("#panelView"), tabs = t("ptabs");
  const fresh = S.comms.filter(c => c.status === "requested").length;
  let body = `<div class="skeleton" style="height:120px"></div>`;
  const shell = () => { box.innerHTML = `<div style="display:grid;gap:22px"><div class="ptitle"><h2>${t("panelTitle")}</h2><button class="btn primary sm" data-newwork><svg class="i"><use href="#upload"/></svg>${t("upload")}</button></div>
    <div class="tabbar" role="tablist">${Object.entries(tabs).map(([k, v]) => `<button role="tab" data-ptab="${k}" aria-selected="${S.ptab === k}">${v}${k === "encargos" && fresh ? `<span class="count">${fresh}</span>` : ""}</button>`).join("")}</div>${body}</div>`; magnet(); };
  shell();
  try {
    if (S.ptab === "resumen") {
      const s = await api("/admin/stats");
      body = `<div class="kpis">${[[s.likesMonth, "kLikes"], [s.followers, "kFollow"], [s.newRequests, "kReq"], [s.active, "kActive"]].map(([n, k]) => `<div><b data-count="${n}">${nf(n)}</b><small>${t(k)}</small></div>`).join("")}</div>
        <div class="panel"><h3>${t("latestReqs")}</h3><div style="display:grid;gap:10px">${S.comms.slice(0, 4).map(c => commCard(c, true)).join("") || `<p class="muted">${t("noReqs")}</p>`}</div></div>`;
    }
    if (S.ptab === "obras") body = `<div class="panel"><div class="ptitle"><h3>${tabs.obras} (${S.works.length})</h3></div>
      <div class="lrows">${S.works.map(w => `<div class="lrow"><div class="mini">${pic(w, "thumb")}</div><div class="grow"><b>${esc(loc(w.title))}</b> ${w.nsfw ? '<span class="pill">+18</span>' : ""} ${S.site.featuredWorkId === w.id ? `<span class="pill wait">${t("newWork")}</span>` : ""}<small class="muted" style="display:block">${esc(colName(w.collectionId)) || t("none")}${w.tags.length ? ", #" + w.tags.map(esc).join(" #") : ""}</small></div>
        <span class="muted" style="font-variant-numeric:tabular-nums">♥ ${nf(w.likes)}</span><div class="tools"><button class="round sm" data-editwork="${w.id}" aria-label="${t("edit")}"><svg class="i"><use href="#edit"/></svg></button><button class="round sm" data-wdel="${w.id}" aria-label="${t("delete")}"><svg class="i"><use href="#trash"/></svg></button></div></div>`).join("") || `<p class="muted">${t("noWorks")}</p>`}</div></div>`;
    if (S.ptab === "encargos") {
      S.comms = (await api("/commissions")).commissions;
      const list = S.comms.filter(c => S.cFilter === "all" || (S.cFilter === "wait" ? c.approval === "pending" : c.status === S.cFilter));
      body = `<div class="seg" style="align-self:start;justify-self:start">${[["all", t("allStatus")], ["requested", t("stShort").requested], ["wait", t("waitShort")], ["quoted", t("stShort").quoted], ["sketch", t("stShort").sketch], ["color", t("stShort").color], ["done", t("stShort").done]].map(([k, v]) => `<button data-cf="${k}" aria-pressed="${S.cFilter === k}">${v}</button>`).join("")}</div>
        <div style="display:grid;gap:10px">${list.map(c => commCard(c, true)).join("") || `<p class="muted">${t("noReqs")}</p>`}</div>`;
    }
    if (S.ptab === "colecciones") {
      const tg = (await api("/tags")).tags; S.tags = tg.map(x => x.name);
      body = `<div class="two even">
      <div class="panel"><h3>${t("colTitle")}</h3><p class="muted">${t("colHelp")}</p><div class="lrows">${S.cols.map(c => `<div class="lrow"><div class="grow row2"><label hidden for="cn-${c.id}">ES</label><input type="text" id="cn-${c.id}" maxlength="60" data-colname="${c.id}" data-l="es" value="${esc(c.name.es)}"><label hidden for="cne-${c.id}">EN</label><input type="text" id="cne-${c.id}" maxlength="60" data-colname="${c.id}" data-l="en" value="${esc(c.name.en)}"></div><span class="muted">${c.count}</span><button class="round sm" data-delcol="${c.id}" aria-label="${t("delete")}"><svg class="i"><use href="#trash"/></svg></button></div>`).join("")}</div>
        <form id="colAdd" style="display:flex;gap:8px"><label hidden for="newCol">${t("newCol")}</label><input type="text" id="newCol" maxlength="60" placeholder="${t("newCol")}"><button class="btn sm"><svg class="i"><use href="#plus"/></svg>${t("add")}</button></form></div>
      <div class="panel"><h3>${t("tagTitle")}</h3><p class="muted">${t("tagHelp")}</p><div class="chipset">${tg.map(x => `<span class="chip">#${esc(x.name)} <span class="muted">${x.count}</span><button class="x" data-deltag="${esc(x.name)}" aria-label="${t("delete")} ${esc(x.name)}"><svg><use href="#x"/></svg></button></span>`).join("")}</div>
        <form id="tagAdd" style="display:flex;gap:8px"><label hidden for="newTag">${t("newTag")}</label><input type="text" id="newTag" maxlength="40" placeholder="${t("newTag")}"><button class="btn sm"><svg class="i"><use href="#plus"/></svg>${t("add")}</button></form></div></div>`;
    }
    if (S.ptab === "eventos") {
      S.allEvents = (await api("/events?all=1")).events;
      const ev = S.evEditing ? S.allEvents.find(e => e.id === S.evEditing) : null, nx = nextEvent();
      const dtl = d => { const x = new Date(d); return new Date(x - x.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
      body = `<div class="two even"><div class="panel"><h3>${t("evTitle")}</h3><p class="muted">${t("evHelp")}</p>
        <div class="lrows">${S.allEvents.length ? S.allEvents.map(e => `<div class="lrow"><div class="mini">${e.teaser ? `<img src="${e.teaser.thumb}" alt="">` : ""}</div><div class="grow"><b>${esc(loc(e.title))}</b> ${nx && e.id === nx.id ? `<span class="pill wait">${t("nextDrop")}</span>` : ""}<small class="muted" style="display:block">${new Date(e.startsAt) < Date.now() ? t("evPast") : t("evIn") + " " + fdatetime(e.startsAt)}</small></div>
          <label class="switch" title="${t("evShow")}"><input type="checkbox" data-evshow="${e.id}" ${e.visible ? "checked" : ""} aria-label="${t("evShow")}"><span></span></label>
          <div class="tools"><button class="round sm" data-evedit="${e.id}" aria-label="${t("edit")}"><svg class="i"><use href="#edit"/></svg></button><button class="round sm" data-evdel="${e.id}" aria-label="${t("delete")}"><svg class="i"><use href="#trash"/></svg></button></div></div>`).join("") : `<p class="muted">${t("noEvents")}</p>`}</div></div>
        <form class="panel" id="evForm" novalidate><h3>${ev ? t("edit") + ": " + esc(loc(ev.title)) : t("newEv")}</h3>
          <div class="row2"><div class="field"><label for="evEs">${t("evName")}</label><input type="text" id="evEs" maxlength="120" value="${esc(ev?.title.es || "")}"></div><div class="field"><label for="evEn">${t("evNameEn")}</label><input type="text" id="evEn" maxlength="120" value="${esc(ev?.title.en || "")}"></div></div>
          <div class="field"><label for="evAt">${t("evWhen")}</label><input type="datetime-local" id="evAt" value="${dtl(ev?.startsAt || Date.now() + 3 * 86400000)}"></div>
          <div class="field"><label for="evTeaser">${t("evTeaser")}</label><select id="evTeaser"><option value="">${t("none")}</option>${S.works.map(w => `<option value="${w.id}" ${ev?.teaserWorkId === w.id ? "selected" : ""}>${esc(loc(w.title))}</option>`).join("")}</select><small>${t("evTeaserD")}</small></div>
          <div class="setrow"><div class="grow"><b>${t("evShow")}</b></div><label class="switch"><input type="checkbox" id="evShowNew" ${!ev || ev.visible ? "checked" : ""} aria-label="${t("evShow")}"><span></span></label></div>
          <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn primary"><svg class="i"><use href="#cal"/></svg>${t("evSave")}</button>${ev ? `<button type="button" class="btn ghost" id="evCancel">${t("cancel")}</button>` : ""}</div></form></div>`;
    }
    if (S.ptab === "sitio") body = `<div class="two even">
      <form class="panel" id="siteForm" novalidate><h3>${t("siteTitle")}</h3>
        <div class="setrow"><div class="grow"><b>${t("openToggle")}</b><small>${t("openToggleD")}</small></div><label class="switch"><input type="checkbox" id="siteOpen" ${S.site.open ? "checked" : ""} aria-label="${t("openToggle")}"><span></span></label></div>
        <div class="field"><label for="abEs">${t("aboutEs")}</label><textarea id="abEs" maxlength="3000">${esc(S.site.about.es)}</textarea></div>
        <div class="field"><label for="abEn">${t("aboutEn")}</label><textarea id="abEn" maxlength="3000">${esc(S.site.about.en)}</textarea></div>
        <button class="btn primary" style="justify-self:start">${t("saveChanges")}</button></form>
      <div class="panel"><h3>${t("socialTitle")}</h3><p class="muted">${t("socialHelp")}</p><div id="socialRows">${S.site.socials.map(s => { const [name, icon] = SOCIAL_META[s.id]; return `<div class="social-row ${s.on ? "" : "off"}"><span class="ic"><svg class="i"><use href="#${icon}"/></svg></span><b>${name}</b><label hidden for="su-${s.id}">${name} URL</label><input type="url" id="su-${s.id}" data-surl="${s.id}" maxlength="300" value="${esc(s.url)}" placeholder="https://"><label class="switch"><input type="checkbox" data-son="${s.id}" ${s.on ? "checked" : ""} aria-label="${name}"><span></span></label></div>`; }).join("")}</div></div></div>`;
  } catch (e) { showError(e); body = ""; }
  if (S.route !== "panel") return;
  shell();
  if (S.ptab === "resumen") countUp("#kpis [data-count]");
  $("#colAdd")?.addEventListener("submit", e => { e.preventDefault(); const v = $("#newCol").value.trim(); if (!v) return; api("/collections", { method: "POST", body: { name: { es: v, en: "" } } }).then(reloadCols).then(() => { renderPanel(); toast(t("savedOk")); }).catch(err => showError(err)); });
  $("#tagAdd")?.addEventListener("submit", e => { e.preventDefault(); const v = $("#newTag").value.trim(); if (!v) return; api("/tags", { method: "POST", body: { name: v } }).then(() => renderPanel()).catch(err => showError(err)); });
  $$("[data-colname]").forEach(i => i.addEventListener("change", () => { if (!i.value.trim()) return; api(`/collections/${i.dataset.colname}`, { method: "PATCH", body: { name: { [i.dataset.l]: i.value.trim() } } }).then(reloadCols).then(() => toast(t("savedOk"))).catch(err => showError(err)); }));
  $("#evForm")?.addEventListener("submit", e => {
    e.preventDefault();
    const at = new Date($("#evAt").value);
    if (isNaN(at)) return $("#evAt").focus();
    const body = { title: { es: $("#evEs").value.trim(), en: $("#evEn").value.trim() }, startsAt: at.toISOString(), teaserWorkId: $("#evTeaser").value ? Number($("#evTeaser").value) : null, visible: $("#evShowNew").checked };
    busy(e.submitter, async () => {
      try {
        await api(S.evEditing ? `/events/${S.evEditing}` : "/events", { method: S.evEditing ? "PATCH" : "POST", body });
        S.evEditing = null; burst(e.submitter, "#ffd10b"); toast(t("evSaved")); await reloadEvents(); renderPanel();
      } catch (err) { showError(err); }
    });
  });
  $("#evCancel")?.addEventListener("click", () => { S.evEditing = null; renderPanel(); });
  $$("[data-evshow]").forEach(i => i.addEventListener("change", () => api(`/events/${i.dataset.evshow}`, { method: "PATCH", body: { visible: i.checked } }).then(reloadEvents).then(() => renderPanel()).catch(err => showError(err))));
  $("#siteForm")?.addEventListener("submit", e => {
    e.preventDefault();
    busy(e.submitter, async () => {
      try { await api("/site", { method: "PATCH", body: { open: $("#siteOpen").checked, about: { es: $("#abEs").value.trim(), en: $("#abEn").value.trim() } } }); await loadSite(); burst(e.submitter, "#ffd10b"); toast(t("savedOk")); }
      catch (err) { showError(err); }
    });
  });
  const saveSocials = async () => {
    const socials = S.site.socials.map(s => ({ id: s.id, on: $(`[data-son="${s.id}"]`).checked, url: $(`[data-surl="${s.id}"]`).value.trim() }));
    try { await api("/site", { method: "PATCH", body: { socials } }); await loadSite(); renderSocials(); toast(t("savedOk")); }
    catch (err) { showError(err); }
    $$(".social-row").forEach(r => r.classList.toggle("off", !r.querySelector("[data-son]").checked));
  };
  $$("[data-son]").forEach(i => i.addEventListener("change", saveSocials));
  $$("[data-surl]").forEach(i => i.addEventListener("change", saveSocials));
}
const reloadCols = async () => { S.cols = (await api("/collections")).collections; };
const reloadEvents = async () => { S.events = (await api("/events")).events; };

// ---------- menús, notificaciones y redes ----------
function renderSocials() {
  const on = (S.site?.socials || []).filter(s => s.on && s.url);
  $("#sideSocials").innerHTML = on.length ? `<h4>${t("networks")}</h4>` + on.map(s => { const [name, icon] = SOCIAL_META[s.id]; return `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" title="${name}"><svg class="i"><use href="#${icon}"/></svg><span class="lbl">${name}</span></a>`; }).join("") : "";
}
function noteLink(n) {
  if (n.data.commissionId) return `#encargo-${n.data.commissionId}`;
  if (n.type === "message") return "#mensajes";
  return "#inicio";
}
function renderNotes() {
  const box = $("#notes");
  if (!S.me) { box.innerHTML = `<h3>${t("notesTitle")}</h3><p class="notes-empty">${t("notesGuest")}</p>`; return; }
  box.innerHTML = `<h3>${t("notesTitle")}</h3>` + (S.notes.length ? S.notes.slice(0, 20).map(n => {
    const fn = t("note")[n.type];
    return `<a class="note ${n.read ? "" : "unread"}" href="${noteLink(n)}" ${n.data.workId ? `data-open-work="${n.data.workId}"` : ""}>${avatarHTML(artist(), 36)}<div><p>${esc(fn ? fn(n.data) : n.type)}</p><small>${ago(n.createdAt)}</small></div></a>`;
  }).join("") : `<p class="notes-empty">${t("noNotes")}</p>`);
}
function refreshMe() {
  $("#meBtn").innerHTML = S.me ? avatarHTML(S.me, 40, "me") : "";
  renderMeMenu();
}
function renderMeMenu() {
  if (!S.me) { $("#meMenu").innerHTML = ""; return; }
  const me = S.me;
  $("#meMenu").innerHTML = `<div class="head">${avatarHTML(me, 40)}<div><b>${esc(me.name)}</b><small>@${esc(me.handle)}</small></div></div>
    <a href="#perfil" data-protab="datos"><svg class="i"><use href="#user"/></svg>${t("myProfile")}</a>
    ${isArtist() ? `<a href="#panel"><svg class="i"><use href="#chart"/></svg>${t("navPanel")}</a>` : `<a href="#perfil" data-protab="encargos"><svg class="i"><use href="#brush"/></svg>${t("myComms")}</a>`}
    <a href="#guardadas"><svg class="i"><use href="#save"/></svg>${t("navSaved")}</a>
    <button id="logout"><svg class="i"><use href="#logout"/></svg>${t("logOut")}</button>`;
  $("#logout").addEventListener("click", async () => { await api("/auth/logout", { method: "POST" }).catch(() => {}); await afterLogout(); toast(t("loggedOut")); location.hash = "inicio"; });
}
function updateBadges() {
  const n = !S.me ? 0 : isArtist() ? S.comms.filter(c => c.status === "requested").length : S.comms.filter(c => c.approval === "pending" || c.status === "quoted").length;
  $$("[data-comm-count]").forEach(el => { el.hidden = !n; el.textContent = n; });
  const unread = S.convs.reduce((a, c) => a + (c.unread || 0), 0);
  $$("[data-unread]").forEach(el => { el.hidden = !unread; el.textContent = unread; });
  $("#bellDot").hidden = !S.unreadNotes;
}

// ---------- entrar / registrarse ----------
let authMode = "login", resetToken = null;
function openAuth(mode = "login") {
  authMode = mode;
  const f = $("#authForm"); clearErrors(f);
  const txt = { login: ["loginTitle", "loginText", "logIn"], register: ["joinTitle", "joinText", "createAccount"], forgot: ["forgotTitle", "forgotText", "forgotSend"], reset: ["resetTitle", "resetText", "resetGo"] }[mode];
  $("#authTitle").textContent = t(txt[0]); $("#authText").textContent = t(txt[1]); $("#authGo").textContent = t(txt[2]);
  f.querySelectorAll("[data-mode]").forEach(el => { el.hidden = !el.dataset.mode.split(" ").includes(mode); });
  $("#auPass").autocomplete = mode === "login" ? "current-password" : "new-password";
  $("#auPassLbl").textContent = mode === "reset" ? t("newPass") : t("password");
  if (!$("#login").open) openDlg($("#login"));
  setTimeout(() => (mode === "register" ? $("#auName") : mode === "reset" ? $("#auPass") : $("#auEmail")).focus(), 60);
}
$("#authForm").addEventListener("click", e => { const b = e.target.closest("[data-auth]"); if (b) openAuth(b.dataset.auth); });
$("#authForm").addEventListener("submit", e => {
  e.preventDefault();
  const f = e.target; clearErrors(f);
  const email = $("#auEmail").value.trim(), password = $("#auPass").value;
  busy($("#authGo"), async () => {
    try {
      if (authMode === "login") { S.me = (await api("/auth/login", { method: "POST", body: { email, password } })).user; await afterLogin("welcome"); }
      if (authMode === "register") {
        if (!$("#auAge").checked) { $("#authErr").textContent = t("errAge"); return; }
        S.me = (await api("/auth/register", { method: "POST", body: { email, password, name: $("#auName").value.trim(), handle: $("#auHandle").value.trim(), lang: S.lang, adult: true } })).user;
        await afterLogin("welcomeNew");
      }
      if (authMode === "forgot") { await api("/auth/forgot", { method: "POST", body: { email } }); $("#authText").textContent = t("forgotSent"); }
      if (authMode === "reset") {
        await api("/auth/reset", { method: "POST", body: { token: resetToken, password } });
        S.me = (await api("/auth/me")).user; await afterLogin("resetOk");
      }
    } catch (err) {
      if (err.fields) showError(err, f); else $("#authErr").textContent = err.message;
    }
  });
});
async function afterLogin(msg) {
  $("#login").close(); $("#auPass").value = "";
  if (S.me.lang && S.me.lang !== S.lang && !store.get("zaber-lang")) S.lang = S.me.lang;
  await Promise.all([loadSite(), loadCatalog(), loadPrivate()]);
  applyLang(); applyRole(); connectWs();
  toast(t(msg));
}
async function afterLogout() {
  S.me = null; disconnectWs();
  await Promise.all([loadSite(), loadCatalog(), loadPrivate()]);
  applyRole();
}

// ---------- rutas ----------
const ROUTES = ["inicio", "galeria", "guardadas", "megusta", "comisiones", "encargo", "mensajes", "perfil", "panel"];
function moveIndicator() { const a = $(`#menu a[aria-current="page"]`), ind = $("#menu .ind"); if (!a) { ind.style.opacity = 0; return; } ind.style.opacity = 1; ind.style.transform = `translateY(${a.offsetTop}px)`; }
function route(first) {
  let r = location.hash.slice(1) || "inicio";
  const m = r.match(/^encargo-(\d+)$/); if (m) { S.commId = Number(m[1]); r = "encargo"; }
  if (r.startsWith("reset-")) { resetToken = r.slice(6); history.replaceState(null, "", location.pathname); openAuth("reset"); r = "inicio"; }
  if (!ROUTES.includes(r) || (r === "panel" && !isArtist()) || (r === "encargo" && !S.commId)) r = "inicio";
  if (["guardadas", "megusta", "perfil", "encargo"].includes(r) && !S.me) { r = "inicio"; setTimeout(() => needLogin("login"), 50); }
  const changed = S.route !== r; S.route = r;
  const viewName = ["guardadas", "megusta"].includes(r) ? "galeria" : r;
  $$("[data-view]").forEach(v => v.hidden = v.dataset.view !== viewName);
  const navR = r === "encargo" ? (isArtist() ? "panel" : "comisiones") : r;
  $$("[data-route]").forEach(a => a.dataset.route === navR ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  moveIndicator(); rerender();
  if (!first && changed) window.scrollTo({ top: 0, behavior: "instant" });
  const v = $(`[data-view="${viewName}"]`);
  if (G && !first) G.fromTo(v.children, { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: .45, stagger: .05, ease: "power3.out", clearProps: "transform,opacity" });
  magnet();
}
function rerender() {
  const r = S.route;
  if (r === "inicio") renderHome();
  if (["galeria", "guardadas", "megusta"].includes(r)) renderGallery();
  if (r === "comisiones") renderCommission();
  if (r === "encargo") renderCommDetail();
  if (r === "mensajes") renderMessages();
  if (r === "perfil") renderProfile();
  if (r === "panel") renderPanel();
  updateBadges(); tick();
}
function intro() {
  if (!G || S.route !== "inicio") return;
  const tl = G.timeline({ defaults: { ease: "power3.out" } });
  tl.from(".feature", { clipPath: "inset(0 100% 0 0 round 22px)", duration: 1 })
    .from(".feature .art", { scale: .9, rotate: -3, opacity: 0, duration: .8 }, "-=.6")
    .from(".feature .txt > *", { y: 18, opacity: 0, stagger: .07, duration: .5 }, "-=.5")
    .from("#rail-recent .card", { y: 24, opacity: 0, stagger: .05, duration: .5 }, "-=.4");
  countUp("#nums [data-count]");
}

// ---------- idioma y sesión ----------
function setLang(l) {
  S.lang = l; store.set("zaber-lang", l); applyLang();
  if (S.me && S.me.lang !== l) api("/me", { method: "PATCH", body: { lang: l } }).then(r => { S.me = r.user; }).catch(() => {});
}
function applyLang() {
  document.documentElement.lang = S.lang;
  $$("[data-t]").forEach(el => { const v = t(el.dataset.t); if (typeof v === "string") el.textContent = v; });
  $("#q").placeholder = t("searchPh"); $("#searchBtn").setAttribute("aria-label", t("search"));
  $("#lang").dataset.on = S.lang;
  $$("[data-lang]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.lang === S.lang)));
  syncFollow(); syncCollapse(); renderSocials(); renderNotes(); renderMeMenu(); route(true);
  if ($("#detail").open && S.current) openDetail(S.current.id, { push: false });
}
function applyRole() {
  $$("[data-artist]").forEach(a => a.hidden = !isArtist());
  $$("[data-fan]").forEach(a => a.hidden = role() !== "fan");
  $("#loginBtn").hidden = !!S.me;
  $("#meBtn").hidden = !S.me;
  $("#bell").hidden = !S.me;
  $(".who-card").hidden = isArtist();
  S.thread = null; refreshMe(); renderNotes(); syncFollow(); route(true);
}
function syncFollow() {
  if (!S.site) return;
  $("#followers").textContent = t("followers")(nf(S.site.stats.followers));
  $("#followBtn").textContent = S.site.following ? t("following") : t("follow");
  $("#followBtn").setAttribute("aria-pressed", String(!!S.site.following));
}
function syncCollapse() {
  const c = $("#app").classList.contains("collapsed");
  $("#collapse").setAttribute("aria-label", c ? t("showMenu") : t("hideMenu")); $("#collapse").setAttribute("aria-expanded", String(!c));
  setTimeout(moveIndicator, 360);
}

// ---------- eventos de la interfaz ----------
document.addEventListener("click", e => {
  const o = e.target.closest("[data-open]"); if (o) { const box = o.closest(".rail, .grid"); S.navList = box ? [...box.querySelectorAll("[data-open]")].map(x => +x.dataset.open) : null; openDetail(+o.dataset.open); return; }
  const ow = e.target.closest("[data-open-work]"); if (ow) { e.preventDefault(); $("#notes").hidden = true; S.navList = null; openDetail(+ow.dataset.openWork); return; }
  const nv = e.target.closest("[data-nav]"); if (nv) { navDetail(+nv.dataset.nav); return; }
  const lb = e.target.closest("[data-lightbox]"); if (lb) { e.preventDefault(); $("#lbImg").src = lb.dataset.lightbox; openDlg($("#lightbox")); return; }
  if (e.target.closest("[data-close]")) e.target.closest("dialog").close();
  if (e.target.closest("[data-open-login]")) needLogin();
  const th = e.target.closest("[data-thread]"); if (th) { S.thread = +th.dataset.thread; renderMessages(); }
  const rl = e.target.closest("[data-rail]"); if (rl) { const r = $("#rail-" + rl.dataset.rail); r.scrollBy({ left: rl.dataset.dir * r.clientWidth * .8, behavior: "smooth" }); }
  const so = e.target.closest("[data-sort]"); if (so) S.sort = so.dataset.sort;
  const cl = e.target.closest("[data-col]"); if (cl) S.colF = +cl.dataset.col;
  const cf = e.target.closest("[data-colf]"); if (cf) { S.colF = cf.dataset.colf ? +cf.dataset.colf : null; renderGallery(); }
  if (e.target.closest("[data-clearq]")) { S.q = ""; $("#q").value = ""; }
  const ts = e.target.closest("[data-tagsearch]"); if (ts) { $("#detail").close(); S.q = ts.dataset.tagsearch; $("#q").value = "#" + S.q; S.colF = null; location.hash === "#galeria" ? renderGallery() : (location.hash = "galeria"); }
  const cm = e.target.closest("[data-comm]"); if (cm) { e.preventDefault(); $("#notes").hidden = true; const h = `encargo-${cm.dataset.comm}`; location.hash === "#" + h ? route() : (location.hash = h); }
  const pt = e.target.closest("[data-ptab]"); if (pt) { S.ptab = pt.dataset.ptab; if (S.route === "panel") renderPanel(); }
  const pr = e.target.closest("[data-protab]"); if (pr) { S.proTab = pr.dataset.protab; if (S.route === "perfil") renderProfile(); }
  const cfl = e.target.closest("[data-cf]"); if (cfl) { S.cFilter = cfl.dataset.cf; renderPanel(); }
  if (e.target.closest("[data-newwork]")) openWorkForm(null);
  const ew = e.target.closest("[data-editwork]"); if (ew) openWorkForm(+ew.dataset.editwork);
  const dw = e.target.closest("[data-wdel]"); if (dw) deleteWork(+dw.dataset.wdel);
  const dc = e.target.closest("[data-delcol]"); if (dc) confirmAsk(t("delColQ"), t("delColT"), t("delete"), async () => { await api(`/collections/${dc.dataset.delcol}`, { method: "DELETE" }); await reloadCols(); S.works.forEach(w => { if (w.collectionId === +dc.dataset.delcol) w.collectionId = null; }); renderPanel(); toast(t("deleted")); });
  const dt = e.target.closest("[data-deltag]"); if (dt) api(`/tags/${encodeURIComponent(dt.dataset.deltag)}`, { method: "DELETE" }).then(() => { S.works.forEach(w => w.tags = w.tags.filter(x => x !== dt.dataset.deltag)); renderPanel(); }).catch(err => showError(err));
  const ee = e.target.closest("[data-evedit]"); if (ee) { S.evEditing = +ee.dataset.evedit; renderPanel(); }
  const ed = e.target.closest("[data-evdel]"); if (ed) confirmAsk(t("delEvQ"), "", t("delete"), async () => { await api(`/events/${ed.dataset.evdel}`, { method: "DELETE" }); await reloadEvents(); renderPanel(); toast(t("deleted")); });
  // comentarios
  const lk = e.target.closest("[data-clike]"); if (lk && !needLogin()) {
    const c = S.comments.find(x => x.id === +lk.dataset.clike);
    api(`/comments/${c.id}/like`, { method: "POST" }).then(r => { c.liked = r.liked; c.likes = r.likes; renderComments(); if (r.liked) { const b = $(`[data-clike="${c.id}"]`); pop(b); burst(b, "#ffd10b"); } }).catch(err => showError(err));
  }
  const rp = e.target.closest("[data-creply]"); if (rp && !needLogin()) {
    const c = S.comments.find(x => x.id === +rp.dataset.creply);
    S.replyTo = { id: c.parentId || c.id, name: c.user.name }; renderComments();
    const ta = $("#cText"), h = "@" + c.user.handle + " "; if (!ta.value.includes(h)) ta.value = h + ta.value; ta.focus();
  }
  const cd = e.target.closest("[data-cdel]"); if (cd) {
    const id = +cd.dataset.cdel;
    api(`/comments/${id}`, { method: "DELETE" }).then(() => { const n = S.comments.length; S.comments = S.comments.filter(c => c.id !== id && c.parentId !== id); S.current.comments -= n - S.comments.length; renderComments(); toast(t("deleted")); }).catch(err => showError(err));
  }
  if (!e.target.closest("#notes, #bell")) { $("#notes").hidden = true; $("#bell").setAttribute("aria-expanded", "false"); }
  if (!e.target.closest("#meMenu, #meBtn") || e.target.closest("#meMenu a")) { $("#meMenu").hidden = true; $("#meBtn").setAttribute("aria-expanded", "false"); }
  if (!e.target.closest(".search")) $("#suggest").hidden = true;
});
$("#fArt").addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(+$("#fArt").dataset.open); } });
$$("dialog").forEach(d => d.addEventListener("click", e => { if (e.target === d) d.close(); }));
$("#dLike").addEventListener("click", () => toggleLike(S.current.id, $("#dLike")));
$("#dSave").addEventListener("click", () => toggleSave(S.current.id, $("#dSave")));
$("#dEdit").addEventListener("click", () => openWorkForm(S.current.id));
$("#dDel").addEventListener("click", () => deleteWork(S.current.id));
$("#dShare").addEventListener("click", () => { const b = $("#shareBox"); b.hidden = !b.hidden; $("#dShare").setAttribute("aria-expanded", String(!b.hidden)); if (!b.hidden && G) G.from("#shareBox > *", { y: 10, opacity: 0, stagger: .05, duration: .3, ease: "back.out(2)" }); });
$("#shCopy").addEventListener("click", () => { const link = `${location.origin}/obra/${S.current.id}`; navigator.clipboard?.writeText(link).then(() => toast(t("copied")), () => toast(link)); });
$("#cancelReply").addEventListener("click", () => { S.replyTo = null; $("#cText").value = ""; renderComments(); });
bindMentions($("#cText"));
$("#cForm").addEventListener("submit", e => {
  e.preventDefault(); if (needLogin()) return;
  const v = $("#cText").value.trim(); if (!v) return;
  const btn = e.submitter || $("#cForm button");
  busy(btn, async () => {
    try {
      const r = await api(`/works/${S.current.id}/comments`, { method: "POST", body: { text: v, parentId: S.replyTo?.id ?? null } });
      S.comments.push(r.comment); S.current.comments++;
      $("#cText").value = ""; S.replyTo = null; renderComments(); toast(t("posted"));
      if (G) G.from(`[data-cid="${r.comment.id}"]`, { y: 12, opacity: 0, duration: .35 });
    } catch (err) { showError(err); }
  });
});
$("#followBtn").addEventListener("click", async () => {
  if (needLogin()) return;
  try {
    const r = await api("/follow", { method: "POST" });
    S.site.following = r.following; S.site.stats.followers = r.followers; syncFollow();
    if (r.following) burst($("#followBtn"), "#ffd10b"); pop($("#followBtn"));
  } catch (err) { showError(err); }
});
$("#notifyBtn").addEventListener("click", async () => {
  if (needLogin()) return;
  const ev = nextEvent(); if (!ev) return;
  try {
    ev.notify = (await api(`/events/${ev.id}/notify`, { method: "POST" })).notify;
    $("#notifyBtn span").textContent = ev.notify ? t("notifyOn") : t("notifyMe"); $("#notifyBtn").setAttribute("aria-pressed", String(ev.notify));
    if (ev.notify) { burst($("#notifyBtn"), "#ffd10b"); if (G) G.fromTo("#notifyBtn svg", { rotate: -25 }, { rotate: 0, duration: .8, ease: "elastic.out(1.4,.25)" }); }
  } catch (err) { showError(err); }
});
$("#bell").addEventListener("click", () => {
  const n = $("#notes"); n.hidden = !n.hidden; $("#bell").setAttribute("aria-expanded", String(!n.hidden)); $("#meMenu").hidden = true;
  renderNotes();
  if (!n.hidden && S.unreadNotes) { S.unreadNotes = 0; updateBadges(); api("/notifications/read", { method: "POST" }).then(() => S.notes.forEach(x => x.read = true)).catch(() => {}); }
  if (G) { G.fromTo("#bell svg", { rotate: -20 }, { rotate: 0, duration: .7, ease: "elastic.out(1.4,.25)" }); if (!n.hidden) G.fromTo(n, { y: -8, opacity: 0 }, { y: 0, opacity: 1, duration: .25 }); }
});
$("#meBtn").addEventListener("click", () => { const m = $("#meMenu"); m.hidden = !m.hidden; $("#meBtn").setAttribute("aria-expanded", String(!m.hidden)); $("#notes").hidden = true; if (!m.hidden && G) G.fromTo(m, { y: -8, opacity: 0 }, { y: 0, opacity: 1, duration: .25 }); });
$("#collapse").addEventListener("click", () => { $("#app").classList.toggle("collapsed"); store.set("zaber-side", $("#app").classList.contains("collapsed") ? "1" : "0"); syncCollapse(); });
$("#filters").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; S.filter = b.dataset.f; $$("#filters button").forEach(x => x.setAttribute("aria-pressed", String(x === b))); renderGallery(); });
$("#sort").addEventListener("change", e => { S.sort = e.target.value; renderGallery(); });
$("#q").addEventListener("input", e => {
  S.q = e.target.value.trim(); const sg = $("#suggest");
  if (!S.q) { sg.hidden = true; if (S.route === "galeria") renderGallery(); return; }
  const q = S.q.toLowerCase().replace(/^#/, "");
  const hits = S.works.filter(w => (w.title.es + " " + w.title.en + " " + w.tags.join(" ")).toLowerCase().includes(q)).slice(0, 5);
  sg.innerHTML = hits.length ? hits.map(w => `<button data-sug="${w.id}"><span class="th pic" style="${hidden18(w) ? "filter:blur(6px)" : ""}">${pic(w, "thumb")}</span><span><b>${esc(loc(w.title))}</b><small>${ago(w.createdAt)}${w.nsfw ? ", +18" : ""}${w.tags.length ? ", #" + w.tags.map(esc).join(" #") : ""}</small></span></button>`).join("") : `<p class="muted" style="padding:10px">${t("noResults")}</p>`;
  sg.hidden = false;
});
$("#searchBtn").addEventListener("click", () => { $("header.top").classList.add("searching"); $("#q").focus(); if (G) G.fromTo("header.top .search", { opacity: 0, y: -6 }, { opacity: 1, y: 0, duration: .25 }); });
$("#searchClose").addEventListener("click", () => { $("header.top").classList.remove("searching"); $("#q").value = ""; S.q = ""; $("#suggest").hidden = true; if (S.route === "galeria") renderGallery(); });
$("#suggest").addEventListener("click", e => { const b = e.target.closest("[data-sug]"); if (b) { $("#suggest").hidden = true; $("header.top").classList.remove("searching"); S.navList = null; openDetail(+b.dataset.sug); } });
$("#q").addEventListener("keydown", e => { if (e.key === "Enter") { $("#suggest").hidden = true; $("header.top").classList.remove("searching"); $("#q").blur(); location.hash === "#galeria" ? renderGallery() : (location.hash = "galeria"); } if (e.key === "Escape") { $("#q").value = ""; S.q = ""; $("#suggest").hidden = true; } });
$$("[data-lang]").forEach(b => b.addEventListener("click", () => setLang(b.dataset.lang)));
$("#loginBtn").addEventListener("click", () => openAuth("login"));
window.addEventListener("hashchange", () => route());
window.addEventListener("resize", moveIndicator);
setInterval(tick, 1000);

// ---------- arranque ----------
async function boot() {
  if (store.get("zaber-side") === "1") $("#app").classList.add("collapsed");
  const gate = store.get("zaber-18") !== "yes";
  $("#age").hidden = !gate;
  $("#ageYes").addEventListener("click", () => { store.set("zaber-18", "yes"); if (G) G.to("#age", { opacity: 0, duration: .45, onComplete: () => { $("#age").hidden = true; intro(); } }); else $("#age").hidden = true; });
  $("#ageNo").addEventListener("click", () => { $("#ageBye").hidden = false; });
  try {
    const [me] = await Promise.all([api("/auth/me"), loadSite()]);
    S.me = me.user;
    if (S.me?.lang && !store.get("zaber-lang")) S.lang = S.me.lang;
    await Promise.all([loadCatalog(), loadPrivate()]);
  } catch (e) { showError(e); }
  applyLang(); applyRole(); connectWs();
  const m = location.pathname.match(/^\/obra\/(\d+)/);
  if (m && work(+m[1])) openDetail(+m[1], { push: false });
  if (!gate) intro();
}
boot();
