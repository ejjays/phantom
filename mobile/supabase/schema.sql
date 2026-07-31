-- nexstream updates feature schema
--
-- setup:
--   1. create a free project at https://supabase.com (no credit card)
--   2. open the SQL editor, paste this whole file, run it
--   3. project settings -> api: copy the project url + anon key
--   4. put them in mobile/.env as:
--        EXPO_PUBLIC_SUPABASE_URL=...
--        EXPO_PUBLIC_SUPABASE_ANON_KEY=...
--   5. add new changelog rows from table editor -> updates
--
-- identity: google sign-in or anonymous guest (auto-generated username like
-- anonymous30584). reactions/comments/likes reference profiles(id); guests get
-- a profile row on first sign-in, so every write has a valid user_id.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (char_length(username) between 3 and 20),
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles
  add column if not exists is_creator boolean not null default false;

create table if not exists public.updates (
  id uuid primary key default gen_random_uuid(),
  version text,
  title text not null,
  body text not null,
  category text not null default 'feature'
    check (category in ('feature', 'optimization', 'fix')),
  published_at timestamptz not null default now()
);

alter table public.updates add column if not exists image_url text;

create table if not exists public.reactions (
  id uuid primary key default gen_random_uuid(),
  update_id uuid not null references public.updates (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  unique (update_id, user_id, emoji)
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  update_id uuid not null references public.updates (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

alter table public.comments add column if not exists parent_id uuid
  references public.comments (id) on delete cascade;

alter table public.comments add column if not exists gif_url text;

alter table public.comments add column if not exists image_url text;

-- body originally required 1..500 chars; relax so a comment may be media-only
-- (empty body) as long as a gif_url or image_url is attached. drop old inline
-- checks by name-agnostic sweep, then re-add the combined rule.
do $$
declare con text;
begin
  for con in
    select conname from pg_constraint
    where conrelid = 'public.comments'::regclass and contype = 'c'
  loop
    execute format('alter table public.comments drop constraint %I', con);
  end loop;
end $$;

alter table public.comments
  add constraint comments_body_or_media
  check (
    char_length(body) <= 500
    and (char_length(body) >= 1 or gif_url is not null or image_url is not null)
  );

create index if not exists reactions_update_idx on public.reactions (update_id);
create index if not exists comments_update_idx on public.comments (update_id);
create index if not exists comments_parent_idx on public.comments (parent_id);

alter table public.profiles enable row level security;
alter table public.updates enable row level security;
alter table public.reactions enable row level security;
alter table public.comments enable row level security;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select using (true);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists updates_read on public.updates;
create policy updates_read on public.updates
  for select using (true);

drop policy if exists reactions_read on public.reactions;
create policy reactions_read on public.reactions
  for select using (true);

drop policy if exists reactions_insert_own on public.reactions;
create policy reactions_insert_own on public.reactions
  for insert with check (auth.uid() = user_id);

drop policy if exists reactions_delete_own on public.reactions;
create policy reactions_delete_own on public.reactions
  for delete using (auth.uid() = user_id);

drop policy if exists comments_read on public.comments;
create policy comments_read on public.comments
  for select using (true);

drop policy if exists comments_insert_own on public.comments;
create policy comments_insert_own on public.comments
  for insert with check (auth.uid() = user_id);

drop policy if exists comments_delete_own on public.comments;
create policy comments_delete_own on public.comments
  for delete using (auth.uid() = user_id);

drop policy if exists comments_update_own on public.comments;
create policy comments_update_own on public.comments
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.comment_likes (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.comments (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (comment_id, user_id)
);

create index if not exists comment_likes_comment_idx
  on public.comment_likes (comment_id);

alter table public.comment_likes enable row level security;

drop policy if exists comment_likes_read on public.comment_likes;
create policy comment_likes_read on public.comment_likes
  for select using (true);

drop policy if exists comment_likes_insert_own on public.comment_likes;
create policy comment_likes_insert_own on public.comment_likes
  for insert with check (auth.uid() = user_id);

drop policy if exists comment_likes_delete_own on public.comment_likes;
create policy comment_likes_delete_own on public.comment_likes
  for delete using (auth.uid() = user_id);

-- realtime: stream feed + comment changes to clients live (no refresh).
-- idempotent loop — skips tables already in the publication.
do $$
declare
  tbl text;
begin
  foreach tbl in array array['updates', 'reactions', 'comments', 'comment_likes']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public' and tablename = tbl
    ) then
      execute format(
        'alter publication supabase_realtime add table public.%I',
        tbl
      );
    end if;
  end loop;
end $$;

insert into public.updates (version, title, body, category)
values (
  '1.0.0',
  'Welcome to Updates',
  'This is where new features, optimizations and fixes show up. React and leave a comment!',
  'feature'
)
on conflict do nothing;

-- push notifications: token registry + inbox + social mute
-- device_tokens: user → FCM token (service role reads; clients own-row only).

create table if not exists public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  token text not null unique,
  platform text not null default 'android',
  updated_at timestamptz not null default now()
);

create index if not exists device_tokens_user_idx
  on public.device_tokens (user_id);

alter table public.device_tokens enable row level security;

drop policy if exists device_tokens_read_own on public.device_tokens;
create policy device_tokens_read_own on public.device_tokens
  for select using (auth.uid() = user_id);

drop policy if exists device_tokens_insert_own on public.device_tokens;
create policy device_tokens_insert_own on public.device_tokens
  for insert with check (auth.uid() = user_id);

drop policy if exists device_tokens_update_own on public.device_tokens;
create policy device_tokens_update_own on public.device_tokens
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists device_tokens_delete_own on public.device_tokens;
create policy device_tokens_delete_own on public.device_tokens
  for delete using (auth.uid() = user_id);

-- inbox: one row per personal event. service-role-only insert (no client policy).

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  type text not null check (type in ('reply', 'mention', 'like', 'comment')),
  actor_id uuid references public.profiles (id) on delete set null,
  actor_name text,
  actor_avatar text,
  update_id uuid references public.updates (id) on delete cascade,
  comment_id uuid references public.comments (id) on delete cascade,
  preview text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_recipient_idx
  on public.notifications (recipient_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists notifications_read_own on public.notifications;
create policy notifications_read_own on public.notifications
  for select using (auth.uid() = recipient_id);

drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
  for update using (auth.uid() = recipient_id)
  with check (auth.uid() = recipient_id);

drop policy if exists notifications_delete_own on public.notifications;
create policy notifications_delete_own on public.notifications
  for delete using (auth.uid() = recipient_id);

-- social push opt-out (default on). send-push checks before writing inbox/push.
alter table public.profiles
  add column if not exists notif_social boolean not null default true;

-- realtime for live badge updates. device_tokens skipped (no subscriber).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'notifications'
  ) then
    execute 'alter publication supabase_realtime add table public.notifications';
  end if;
end $$;
