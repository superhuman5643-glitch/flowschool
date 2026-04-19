-- FlowSchool: Child learning profile (Gehirn)
-- Run in Supabase SQL Editor

create table if not exists public.child_profiles (
  id             uuid default uuid_generate_v4() primary key,
  user_id        uuid references public.users(id) on delete cascade unique,
  interests      text[]  default '{}',        -- ['Minecraft', 'Fußball', 'YouTube']
  weak_topics    text[]  default '{}',         -- ['Brüche', 'Schwerkraft']
  strong_topics  text[]  default '{}',         -- ['Programmieren', 'Biologie']
  preferred_examples text[] default '{}',      -- ['Gaming', 'Sport', 'Alltag']
  learning_notes text    default '',           -- Freie Notizen die Claude akkumuliert
  vocab_level    int     default 1,            -- 1=einfach 2=mittel 3=fortgeschritten
  lessons_completed int  default 0,
  avg_quiz_attempts float default 1.0,
  updated_at     timestamptz default now()
);

alter table public.child_profiles enable row level security;

create policy "Users can read own profile"
  on public.child_profiles for select using (auth.uid() = user_id);

create policy "Users can update own profile"
  on public.child_profiles for all using (auth.uid() = user_id);

create policy "Parents can read all profiles"
  on public.child_profiles for select using (
    exists (select 1 from public.users where id = auth.uid() and role = 'parent')
  );

-- Service role can always write (for API updates)
create policy "Service role full access"
  on public.child_profiles for all using (auth.role() = 'service_role');
