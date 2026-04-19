-- FlowSchool Supabase Schema
-- Run this in your Supabase SQL Editor

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Users table (extends Supabase auth.users)
create table public.users (
  id uuid references auth.users(id) on delete cascade primary key,
  email text not null,
  role text not null check (role in ('lenny', 'parent')),
  created_at timestamptz default now()
);
alter table public.users enable row level security;
create policy "Users can read own data" on public.users for select using (auth.uid() = id);

-- Subjects table
create table public.subjects (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  emoji text not null,
  description text,
  color_from text default '#7c6aff',
  color_to text default '#ff6a9e',
  sort_order int default 0,
  created_by uuid references public.users(id),
  is_default boolean default false,
  created_at timestamptz default now()
);
alter table public.subjects enable row level security;
create policy "Anyone authenticated can read subjects" on public.subjects for select using (auth.role() = 'authenticated');
create policy "Lenny can insert custom subjects" on public.subjects for insert with check (auth.uid() = created_by);

-- Lessons table
create table public.lessons (
  id uuid default uuid_generate_v4() primary key,
  subject_id uuid references public.subjects(id) on delete cascade,
  title text not null,
  sort_order int default 0,
  duration_minutes int default 10,
  created_at timestamptz default now()
);
alter table public.lessons enable row level security;
create policy "Anyone authenticated can read lessons" on public.lessons for select using (auth.role() = 'authenticated');

-- Progress table
create table public.progress (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.users(id) on delete cascade,
  lesson_id uuid references public.lessons(id) on delete cascade,
  completed boolean default false,
  score int default 0,
  time_spent_seconds int default 0,
  completed_at timestamptz,
  created_at timestamptz default now(),
  unique(user_id, lesson_id)
);
alter table public.progress enable row level security;
create policy "Users can manage own progress" on public.progress for all using (auth.uid() = user_id);
create policy "Parents can read all progress" on public.progress for select using (
  exists (select 1 from public.users where id = auth.uid() and role = 'parent')
);

-- Chat messages table
create table public.chat_messages (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.users(id) on delete cascade,
  lesson_id uuid references public.lessons(id) on delete cascade,
  question text not null,
  answer text not null,
  created_at timestamptz default now()
);
alter table public.chat_messages enable row level security;
create policy "Users can manage own chat messages" on public.chat_messages for all using (auth.uid() = user_id);
create policy "Parents can read all chat messages" on public.chat_messages for select using (
  exists (select 1 from public.users where id = auth.uid() and role = 'parent')
);

-- Sessions table
create table public.sessions (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.users(id) on delete cascade,
  start_time timestamptz default now(),
  end_time timestamptz,
  breaks_taken int default 0,
  active_minutes int default 0
);
alter table public.sessions enable row level security;
create policy "Users can manage own sessions" on public.sessions for all using (auth.uid() = user_id);
create policy "Parents can read all sessions" on public.sessions for select using (
  exists (select 1 from public.users where id = auth.uid() and role = 'parent')
);

-- XP / Stats view
create view public.user_stats as
  select
    u.id as user_id,
    count(distinct p.lesson_id) filter (where p.completed) as lessons_completed,
    coalesce(sum(p.time_spent_seconds) / 3600.0, 0)::numeric(10,1) as hours_learned,
    count(distinct date(s.start_time)) as days_active,
    count(distinct p.lesson_id) filter (where p.completed) * 100 as xp_points
  from public.users u
  left join public.progress p on p.user_id = u.id
  left join public.sessions s on s.user_id = u.id
  where u.id = auth.uid()
  group by u.id;

-- ─── Seed: Default subjects ───────────────────────────────────────────────────
insert into public.subjects (name, emoji, description, color_from, color_to, sort_order, is_default) values
  ('Physik & Weltraum', '🚀', 'Schwerkraft, Planeten, Licht und die Geheimnisse des Universums', '#7c6aff', '#6affcc', 1, true),
  ('Programmieren',     '💻', 'Python, Web, Games und wie Computer denken', '#ff6a9e', '#7c6aff', 2, true),
  ('Biologie',          '🧬', 'Zellen, Tiere, Pflanzen und wie das Leben funktioniert', '#6affcc', '#ffcc6a', 3, true),
  ('Geografie',         '🌍', 'Länder, Kontinente, Klima und die Welt entdecken', '#ffcc6a', '#ff6a9e', 4, true),
  ('Musik',             '🎵', 'Noten, Rhythmus, Instrumente und Musikgeschichte', '#ff6a9e', '#ffcc6a', 5, true),
  ('Mathe',             '📐', 'Zahlen, Geometrie, Gleichungen und logisches Denken', '#7c6aff', '#ff6a9e', 6, true),
  ('Design',            '🎨', 'Farben, Typografie, Grafik und kreatives Gestalten', '#6affcc', '#7c6aff', 7, true),
  ('Sprachen',          '🗣️', 'Englisch, Spanisch, Französisch und mehr', '#ffcc6a', '#6affcc', 8, true);

-- ─── Seed: Starter lessons per subject ───────────────────────────────────────
-- Physik & Weltraum
insert into public.lessons (subject_id, title, sort_order, duration_minutes)
select id, title, sort_order, 10 from public.subjects, (values
  ('Wie funktioniert Schwerkraft?', 1),
  ('Unser Sonnensystem', 2),
  ('Was ist Licht?', 3),
  ('Schwarze Löcher erklärt', 4),
  ('Raketen und Raumfahrt', 5)
) as t(title, sort_order)
where subjects.name = 'Physik & Weltraum';

-- Programmieren
insert into public.lessons (subject_id, title, sort_order, duration_minutes)
select id, title, sort_order, 10 from public.subjects, (values
  ('Was ist eine Variable?', 1),
  ('If-Abfragen und Entscheidungen', 2),
  ('Schleifen: Dinge wiederholen', 3),
  ('Funktionen bauen', 4),
  ('Dein erstes Spiel mit Python', 5)
) as t(title, sort_order)
where subjects.name = 'Programmieren';

-- Biologie
insert into public.lessons (subject_id, title, sort_order, duration_minutes)
select id, title, sort_order, 10 from public.subjects, (values
  ('Die Zelle — Baustein des Lebens', 1),
  ('Fotosynthese erklärt', 2),
  ('Das menschliche Skelett', 3),
  ('Wie das Herz funktioniert', 4),
  ('Evolution und natürliche Auslese', 5)
) as t(title, sort_order)
where subjects.name = 'Biologie';

-- Geografie
insert into public.lessons (subject_id, title, sort_order, duration_minutes)
select id, title, sort_order, 10 from public.subjects, (values
  ('Die 7 Kontinente', 1),
  ('Wie entstehen Vulkane?', 2),
  ('Klimazonen der Erde', 3),
  ('Flüsse und Seen der Welt', 4),
  ('Bevölkerung und Städte', 5)
) as t(title, sort_order)
where subjects.name = 'Geografie';

-- Musik
insert into public.lessons (subject_id, title, sort_order, duration_minutes)
select id, title, sort_order, 10 from public.subjects, (values
  ('Noten lesen lernen', 1),
  ('Rhythmus und Takt', 2),
  ('Die bekanntesten Instrumente', 3),
  ('Was ist ein Akkord?', 4),
  ('Musikgeschichte: Von Bach zu Beyoncé', 5)
) as t(title, sort_order)
where subjects.name = 'Musik';

-- Mathe
insert into public.lessons (subject_id, title, sort_order, duration_minutes)
select id, title, sort_order, 10 from public.subjects, (values
  ('Primzahlen und ihre Geheimnisse', 1),
  ('Brüche verständlich erklärt', 2),
  ('Geometrie: Flächen und Winkel', 3),
  ('Gleichungen lösen', 4),
  ('Statistik und Wahrscheinlichkeit', 5)
) as t(title, sort_order)
where subjects.name = 'Mathe';

-- Design
insert into public.lessons (subject_id, title, sort_order, duration_minutes)
select id, title, sort_order, 10 from public.subjects, (values
  ('Die Farbenlehre', 1),
  ('Typografie: Schriften wählen', 2),
  ('Komposition und Bildaufbau', 3),
  ('Logos und Corporate Design', 4),
  ('Grundlagen der UX', 5)
) as t(title, sort_order)
where subjects.name = 'Design';

-- Sprachen
insert into public.lessons (subject_id, title, sort_order, duration_minutes)
select id, title, sort_order, 10 from public.subjects, (values
  ('Englisch: Alltagsgespräche', 1),
  ('Englisch: Zeitformen', 2),
  ('Spanisch: Die ersten 100 Wörter', 3),
  ('Warum gibt es so viele Sprachen?', 4),
  ('Körpersprache weltweit', 5)
) as t(title, sort_order)
where subjects.name = 'Sprachen';
