-- Sistema de correo: códigos de recuperación, cola de envío y preferencias por categoría.

-- La recuperación pasa de enlace a código de 6 dígitos. Solo vale el último código pedido.
drop table if exists password_resets;
create table password_codes (
  user_id     bigint primary key references users on delete cascade,
  code_hash   text not null,
  attempts    int not null default 0,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

-- Cola de correos: se envían en segundo plano y se reintentan si el proveedor falla.
create table email_outbox (
  id          bigserial primary key,
  to_email    text not null,
  subject     text not null,
  html        text not null,
  text        text not null,
  headers     jsonb not null default '{}',
  attempts    int not null default 0,
  next_at     timestamptz not null default now(),
  sent_at     timestamptz,
  error       text,
  created_at  timestamptz not null default now()
);
create index email_outbox_pending_idx on email_outbox (next_at) where sent_at is null;

-- Evita mandar un correo por cada mensaje del chat: como mucho uno cada cierto tiempo por conversación.
create table email_throttle (
  user_id  bigint not null references users on delete cascade,
  key      text not null,
  last_at  timestamptz not null default now(),
  primary key (user_id, key)
);

-- Recordatorio de eventos: se marca cuando ya se avisó a quien pulsó "Avisarme".
alter table events add column notified_at timestamptz;

-- Preferencias de correo por categoría. "mail" (todo o nada) se sustituye por cuatro interruptores.
alter table users alter column prefs set default
  '{"blur": true, "mention": true, "mail_comms": true, "mail_messages": true, "mail_social": false, "mail_news": false}';
update users set prefs = (prefs - 'mail') || jsonb_build_object(
  'mail_comms', coalesce((prefs->>'mail')::boolean, true),
  'mail_messages', coalesce((prefs->>'mail')::boolean, true),
  'mail_social', false,
  'mail_news', false);
