-- FlowSchool Migration V2
-- Run this in Supabase SQL Editor

-- 1. Add caching columns to lessons
alter table public.lessons
  add column if not exists content text,
  add column if not exists quiz_questions jsonb,
  add column if not exists video_search_term text,
  add column if not exists generated_at timestamptz;

-- 2. Add mandatory / unlock columns to subjects
alter table public.subjects
  add column if not exists is_mandatory boolean default false,
  add column if not exists unlock_xp int default 0;

-- 3. Stickers table
create table if not exists public.level_stickers (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.users(id) on delete cascade,
  subject_id uuid references public.subjects(id) on delete cascade,
  level int not null,
  sticker_emoji text not null,
  earned_at timestamptz default now(),
  unique(user_id, subject_id, level)
);
alter table public.level_stickers enable row level security;
drop policy if exists "Users can manage own stickers" on public.level_stickers;
create policy "Users can manage own stickers" on public.level_stickers for all using (auth.uid() = user_id);

-- 4. Unlocked optional subjects
create table if not exists public.unlocked_subjects (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.users(id) on delete cascade,
  subject_id uuid references public.subjects(id) on delete cascade,
  unlocked_at timestamptz default now(),
  unique(user_id, subject_id)
);
alter table public.unlocked_subjects enable row level security;
drop policy if exists "Users can manage own unlocked subjects" on public.unlocked_subjects;
create policy "Users can manage own unlocked subjects" on public.unlocked_subjects for all using (auth.uid() = user_id);

-- 5. XP milestones (tracks which milestones user has redeemed)
create table if not exists public.xp_milestones (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.users(id) on delete cascade,
  milestone_xp int not null,
  used_at timestamptz default now(),
  unique(user_id, milestone_xp)
);
alter table public.xp_milestones enable row level security;
drop policy if exists "Users can manage own xp milestones" on public.xp_milestones;
create policy "Users can manage own xp milestones" on public.xp_milestones for all using (auth.uid() = user_id);

-- 6. Insert 3 mandatory core subjects
insert into public.subjects (name, emoji, description, color_from, color_to, sort_order, is_default, is_mandatory, unlock_xp) values
  ('Emotionale Intelligenz',    '🧠', 'Gefühle verstehen, Empathie entwickeln und besser mit Menschen umgehen', '#7c6aff', '#ff6a9e', 1, true, true, 0),
  ('Finanzielle Intelligenz',   '💰', 'Geld verstehen, sparen, investieren und finanziell klug entscheiden',    '#ffcc6a', '#ff6a9e', 2, true, true, 0),
  ('KI verstehen & beherrschen','🤖', 'Wie KI funktioniert, was sie kann und wie du sie für dich nutzt',        '#6affcc', '#7c6aff', 3, true, true, 0)
on conflict do nothing;

-- 7. Lessons for Emotionale Intelligenz
insert into public.lessons (subject_id, title, sort_order, duration_minutes)
select s.id, t.title, t.sort_order, 10
from public.subjects s,
(values
  ('Was sind Emotionen und wozu brauchen wir sie?', 1),
  ('Empathie: Die Kunst, andere zu verstehen', 2),
  ('Umgang mit Wut und Frustration', 3),
  ('Selbstvertrauen stärken', 4),
  ('Konflikte lösen — ohne Streit zu eskalieren', 5)
) as t(title, sort_order)
where s.name = 'Emotionale Intelligenz'
  and not exists (select 1 from public.lessons l where l.subject_id = s.id);

-- 8. Lessons for Finanzielle Intelligenz
insert into public.lessons (subject_id, title, sort_order, duration_minutes)
select s.id, t.title, t.sort_order, 10
from public.subjects s,
(values
  ('Was ist Geld eigentlich?', 1),
  ('Einnahmen, Ausgaben und Sparen', 2),
  ('Wie Zinsen funktionieren — für und gegen dich', 3),
  ('Investieren: Geld für dich arbeiten lassen', 4),
  ('Werbung und clevere Kaufentscheidungen', 5)
) as t(title, sort_order)
where s.name = 'Finanzielle Intelligenz'
  and not exists (select 1 from public.lessons l where l.subject_id = s.id);

-- 9. Lessons for KI verstehen & beherrschen
insert into public.lessons (subject_id, title, sort_order, duration_minutes)
select s.id, t.title, t.sort_order, 10
from public.subjects s,
(values
  ('Was ist Künstliche Intelligenz?', 1),
  ('Wie lernt eine KI? Machine Learning einfach erklärt', 2),
  ('ChatGPT & Co — wie du KI richtig nutzt', 3),
  ('KI in deinem Alltag — was steckt dahinter?', 4),
  ('Chancen und Risiken: KI verändert die Welt', 5)
) as t(title, sort_order)
where s.name = 'KI verstehen & beherrschen'
  and not exists (select 1 from public.lessons l where l.subject_id = s.id);

-- 10. Insert unlockable optional subjects (500 XP reward)
insert into public.subjects (name, emoji, description, color_from, color_to, sort_order, is_default, is_mandatory, unlock_xp) values
  ('Pferde & Reiten',        '🐴', 'Alles über Pferde, Reitkunst und das Leben mit Tieren',                   '#ffcc6a', '#6affcc', 10, true, false, 500),
  ('Landmaschinen & Technik','🚜', 'Traktoren, Erntemaschinen und wie moderne Landwirtschaft funktioniert',   '#6affcc', '#ffcc6a', 11, true, false, 500),
  ('Natur & Tierwelt',       '🦊', 'Tiere, Ökosysteme, Wildnis und wie die Natur zusammenhängt',             '#ff6a9e', '#ffcc6a', 12, true, false, 500)
on conflict do nothing;
