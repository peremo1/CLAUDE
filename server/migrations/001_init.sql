-- Esquema inicial. Los textos que Zaber escribe en dos idiomas se guardan como {"es": "...", "en": "..."}.

create table users (
  id            bigserial primary key,
  email         text not null,
  password_hash text not null,
  name          text not null,
  handle        text not null,
  bio           text not null default '',
  role          text not null default 'fan' check (role in ('fan', 'artist')),
  avatar        text,
  lang          text not null default 'es' check (lang in ('es', 'en')),
  prefs         jsonb not null default '{"blur": true, "mail": true, "mention": true}',
  created_at    timestamptz not null default now()
);
create unique index users_email_key on users (lower(email));
create unique index users_handle_key on users (lower(handle));

create table sessions (
  id          text primary key,           -- sha256 del token de la cookie
  user_id     bigint not null references users on delete cascade,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
create index sessions_user_idx on sessions (user_id);

create table password_resets (
  token_hash  text primary key,
  user_id     bigint not null references users on delete cascade,
  expires_at  timestamptz not null,
  used_at     timestamptz
);

create table collections (
  id          bigserial primary key,
  name        jsonb not null,
  position    int not null default 0,
  created_at  timestamptz not null default now()
);

create table tags (
  name        text primary key
);

create table works (
  id              bigserial primary key,
  title           jsonb not null,
  description     jsonb not null default '{"es": "", "en": ""}',
  nsfw            boolean not null default false,
  allow_comments  boolean not null default true,
  collection_id   bigint references collections on delete set null,
  image           jsonb not null,          -- {"dir": "...", "w": 0, "h": 0}
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index works_created_idx on works (created_at desc);

create table work_tags (
  work_id  bigint not null references works on delete cascade,
  tag      text not null references tags on delete cascade on update cascade,
  primary key (work_id, tag)
);

create table site_settings (
  id                int primary key default 1 check (id = 1),
  open              boolean not null default true,
  about             jsonb not null default '{"es": "", "en": ""}',
  socials           jsonb not null default '[]',
  featured_work_id  bigint references works on delete set null
);
insert into site_settings (id) values (1);

create table follows (
  user_id     bigint primary key references users on delete cascade,
  created_at  timestamptz not null default now()
);

create table likes (
  user_id     bigint not null references users on delete cascade,
  work_id     bigint not null references works on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, work_id)
);
create index likes_work_idx on likes (work_id);

create table saves (
  user_id     bigint not null references users on delete cascade,
  work_id     bigint not null references works on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, work_id)
);

create table comments (
  id          bigserial primary key,
  work_id     bigint not null references works on delete cascade,
  user_id     bigint not null references users on delete cascade,
  parent_id   bigint references comments on delete cascade,  -- siempre apunta al comentario raíz
  body        text not null,
  created_at  timestamptz not null default now()
);
create index comments_work_idx on comments (work_id, created_at);

create table comment_likes (
  user_id     bigint not null references users on delete cascade,
  comment_id  bigint not null references comments on delete cascade,
  primary key (user_id, comment_id)
);

create table events (
  id              bigserial primary key,
  title           jsonb not null,
  starts_at       timestamptz not null,
  teaser_work_id  bigint references works on delete set null,
  visible         boolean not null default true,
  created_at      timestamptz not null default now()
);

create table event_notify (
  user_id   bigint not null references users on delete cascade,
  event_id  bigint not null references events on delete cascade,
  primary key (user_id, event_id)
);

create table commissions (
  id           bigserial primary key,
  client_id    bigint references users on delete set null,   -- si el cliente borra su cuenta, el encargo se conserva
  type         smallint not null,
  usage        smallint not null default 0,
  nsfw         boolean not null default false,
  budget       text not null default '',
  description  text not null,
  status       text not null default 'requested'
               check (status in ('requested', 'quoted', 'accepted', 'sketch', 'color', 'done', 'rejected')),
  quote_price  text,
  quote_days   int,
  approval     text check (approval in ('pending', 'approved', 'changes')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index commissions_client_idx on commissions (client_id);

create table commission_updates (
  id             bigserial primary key,
  commission_id  bigint not null references commissions on delete cascade,
  author_id      bigint references users on delete set null,
  by_artist      boolean not null,
  body           text not null default '',
  status         text,
  ask_approval   boolean not null default false,
  approval       text check (approval in ('approved', 'changes')),
  created_at     timestamptz not null default now()
);
create index commission_updates_idx on commission_updates (commission_id, created_at);

create table messages (
  id            bigserial primary key,
  sender_id     bigint not null references users on delete cascade,
  recipient_id  bigint not null references users on delete cascade,
  body          text not null default '',
  read_at       timestamptz,
  created_at    timestamptz not null default now()
);
create index messages_pair_idx on messages (least(sender_id, recipient_id), greatest(sender_id, recipient_id), created_at);

-- Archivos privados: adjuntos del chat y de los encargos. Solo se sirven tras comprobar permisos.
create table files (
  id          uuid primary key,
  owner_id    bigint not null references users on delete cascade,
  kind        text not null check (kind in ('message', 'commission')),
  ref_id      bigint not null,
  path        text not null,
  w           int,
  h           int,
  created_at  timestamptz not null default now()
);
create index files_ref_idx on files (kind, ref_id);

create table notifications (
  id          bigserial primary key,
  user_id     bigint not null references users on delete cascade,
  type        text not null,
  data        jsonb not null default '{}',
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index notifications_user_idx on notifications (user_id, created_at desc);
