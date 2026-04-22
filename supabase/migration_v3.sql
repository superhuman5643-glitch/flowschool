-- FlowSchool Migration V3
-- Run this in Supabase SQL Editor

-- Add motion detection scores to sessions table
-- Stores array of movement % per break, e.g. [72, 85, 40]
alter table public.sessions
  add column if not exists break_motion jsonb default '[]'::jsonb;
