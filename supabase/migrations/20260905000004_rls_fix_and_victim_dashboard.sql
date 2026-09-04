-- Hotfix: break profiles ↔ cases RLS recursion + apply victim dashboard schema.
-- Safe to re-run.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── SECURITY DEFINER helpers (bypass RLS — no recursion) ─────────────────────
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_staff_for_victim(p_victim_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM cases
    WHERE victim_id = p_victim_id
      AND (
        assigned_counsellor_id = auth.uid()
        OR assigned_official_id = auth.uid()
      )
  )
  OR public.get_my_role() = 'admin';
$$;

CREATE OR REPLACE FUNCTION public.is_assigned_counsellor_or_official()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.get_my_role() IN ('counsellor', 'official', 'admin');
$$;

-- ─── Fix recursive profiles policy ────────────────────────────────────────────
DROP POLICY IF EXISTS "Counsellors and officials can read assigned profiles" ON profiles;
CREATE POLICY "Counsellors and officials can read assigned profiles"
  ON profiles FOR SELECT
  USING (
    public.is_assigned_counsellor_or_official()
    AND (
      public.is_staff_for_victim(id)
      OR id = auth.uid()
    )
  );

-- ─── Fix recursive officials cases policy (self-join cases + profiles) ────────
DROP POLICY IF EXISTS "Officials can read district cases" ON cases;
CREATE POLICY "Officials can read district cases"
  ON cases FOR SELECT
  USING (
    public.get_my_role() = 'official'
    AND (
      assigned_official_id = auth.uid()
      OR district IN (
        SELECT c.district FROM cases c
        WHERE c.assigned_official_id = auth.uid()
        LIMIT 1
      )
    )
  );

-- ─── Victim dashboard columns on profiles ─────────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS instant_call_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS consultant_meet_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS case_reference TEXT,
  ADD COLUMN IF NOT EXISTS photo_url TEXT,
  ADD COLUMN IF NOT EXISTS bio TEXT;

-- ─── Enums ────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE meet_status AS ENUM ('scheduled', 'completed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE distress_source AS ENUM ('chat', 'call', 'manual');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE distress_scores
  ADD COLUMN IF NOT EXISTS source distress_source;

-- ─── Instant calls ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS instant_calls (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  case_id UUID REFERENCES cases(id) ON DELETE SET NULL,
  twilio_call_sid TEXT,
  call_session_id UUID REFERENCES call_sessions(id) ON DELETE SET NULL,
  transcript TEXT,
  summary TEXT,
  duration_seconds INT,
  status TEXT NOT NULL DEFAULT 'completed',
  distress_score_id UUID REFERENCES distress_scores(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_instant_calls_user
  ON instant_calls (user_id, created_at DESC);

-- ─── Consultants ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS consultants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  photo_url TEXT,
  specialization TEXT NOT NULL DEFAULT 'Trauma-informed counselling',
  bio TEXT,
  availability_note TEXT DEFAULT 'Weekdays 10:00–18:00 IST',
  contact_email TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  active_case_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS consultant_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  consultant_id UUID NOT NULL REFERENCES consultants(id) ON DELETE RESTRICT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id)
);

CREATE TABLE IF NOT EXISTS consultant_meets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  consultant_id UUID NOT NULL REFERENCES consultants(id) ON DELETE RESTRICT,
  status meet_status NOT NULL DEFAULT 'scheduled',
  scheduled_at TIMESTAMPTZ NOT NULL,
  report TEXT,
  recommendations TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS consultant_updates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  consultant_id UUID REFERENCES consultants(id) ON DELETE SET NULL,
  meet_id UUID REFERENCES consultant_meets(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  case_id UUID REFERENCES cases(id) ON DELETE SET NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_problem_tags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'chat',
  confidence NUMERIC,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, tag)
);

CREATE TABLE IF NOT EXISTS exercise_recommendations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tag TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  content_url TEXT,
  duration_minutes INT DEFAULT 10,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS consultant_slots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  consultant_id UUID NOT NULL REFERENCES consultants(id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  is_booked BOOLEAN NOT NULL DEFAULT false,
  meet_id UUID REFERENCES consultant_meets(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO exercise_recommendations (tag, title, description, steps, duration_minutes)
SELECT * FROM (VALUES
  ('anxiety', 'Box breathing', 'A simple 4-count breath that calms the nervous system when worry spikes.',
   '["Sit comfortably.","Inhale 4.","Hold 4.","Exhale 4.","Hold 4. Repeat 4–6 rounds."]'::jsonb, 5),
  ('anxiety', '5-4-3-2-1 grounding', 'Name what you can sense to come back into the present.',
   '["5 things you see.","4 you can touch.","3 you hear.","2 you smell.","1 kind thought."]'::jsonb, 8),
  ('sleep', 'Sleep hygiene wind-down', 'A short evening routine for restless nights.',
   '["Dim screens 45 min before bed.","Write one worry aside.","5 min slow breathing.","Cool dark room."]'::jsonb, 15),
  ('harassment', 'Safety check-in plan', 'Clarify who you can reach and what feels safe.',
   '["One trusted person.","Nearest safe place.","Save NHAA 14566 and 112.","Share only what feels safe."]'::jsonb, 10),
  ('depression', 'Tiny activation step', 'One small action when energy is low.',
   '["Drink water.","Open a window 2 min.","One short safe message.","Note one okay thing."]'::jsonb, 10),
  ('anger', 'Cool-down release', 'Channel intensity without harm.',
   '["Plant both feet.","Exhale longer than inhale.","Name the feeling.","Move 2 minutes."]'::jsonb, 8),
  ('loneliness', 'Connection bridge', 'Gentle ways to feel less alone.',
   '["Open Samvedna chatbot.","Message one person.","Three sounds around you.","Book counsellor when ready."]'::jsonb, 10),
  ('general', 'Daily steadiness check', 'Brief wellness when tags are still forming.',
   '["Rate energy/mood/sleep 1–5.","3 slow breaths.","Water + simple food.","Note one support used."]'::jsonb, 7)
) AS v(tag, title, description, steps, duration_minutes)
WHERE NOT EXISTS (
  SELECT 1 FROM exercise_recommendations er WHERE er.tag = v.tag AND er.title = v.title
);

-- Triggers
CREATE OR REPLACE FUNCTION public.bump_instant_call_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE profiles SET instant_call_count = instant_call_count + 1 WHERE id = NEW.user_id;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_instant_calls_count ON instant_calls;
CREATE TRIGGER trg_instant_calls_count
  AFTER INSERT ON instant_calls
  FOR EACH ROW EXECUTE FUNCTION public.bump_instant_call_count();

CREATE OR REPLACE FUNCTION public.sync_consultant_meet_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE profiles SET consultant_meet_count = (
    SELECT COUNT(*)::INT FROM consultant_meets
    WHERE user_id = COALESCE(NEW.user_id, OLD.user_id)
      AND status IN ('scheduled', 'completed')
  ) WHERE id = COALESCE(NEW.user_id, OLD.user_id);
  RETURN COALESCE(NEW, OLD);
END; $$;

DROP TRIGGER IF EXISTS trg_consultant_meets_count ON consultant_meets;
CREATE TRIGGER trg_consultant_meets_count
  AFTER INSERT OR UPDATE OR DELETE ON consultant_meets
  FOR EACH ROW EXECUTE FUNCTION public.sync_consultant_meet_count();

CREATE OR REPLACE FUNCTION public.bump_consultant_case_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE consultants SET active_case_count = active_case_count + 1 WHERE id = NEW.consultant_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE consultants SET active_case_count = GREATEST(0, active_case_count - 1) WHERE id = OLD.consultant_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $$;

DROP TRIGGER IF EXISTS trg_assignment_case_count ON consultant_assignments;
CREATE TRIGGER trg_assignment_case_count
  AFTER INSERT OR DELETE ON consultant_assignments
  FOR EACH ROW EXECUTE FUNCTION public.bump_consultant_case_count();

-- RLS
ALTER TABLE instant_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE consultants ENABLE ROW LEVEL SECURITY;
ALTER TABLE consultant_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE consultant_meets ENABLE ROW LEVEL SECURITY;
ALTER TABLE consultant_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_problem_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE exercise_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE consultant_slots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Victims read own instant calls" ON instant_calls;
CREATE POLICY "Victims read own instant calls" ON instant_calls FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Victims insert own instant calls" ON instant_calls;
CREATE POLICY "Victims insert own instant calls" ON instant_calls FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Authenticated browse consultants" ON consultants;
CREATE POLICY "Authenticated browse consultants" ON consultants FOR SELECT
  USING (auth.uid() IS NOT NULL AND active = true);

DROP POLICY IF EXISTS "Victims read own assignment" ON consultant_assignments;
CREATE POLICY "Victims read own assignment" ON consultant_assignments FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Victims read own meets" ON consultant_meets;
CREATE POLICY "Victims read own meets" ON consultant_meets FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Victims insert own meets" ON consultant_meets;
CREATE POLICY "Victims insert own meets" ON consultant_meets FOR INSERT WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "Victims update own meets" ON consultant_meets;
CREATE POLICY "Victims update own meets" ON consultant_meets FOR UPDATE USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Victims read own consultant updates" ON consultant_updates;
CREATE POLICY "Victims read own consultant updates" ON consultant_updates FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Victims read own chat" ON chat_messages;
CREATE POLICY "Victims read own chat" ON chat_messages FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Victims insert own chat" ON chat_messages;
CREATE POLICY "Victims insert own chat" ON chat_messages FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Victims read own tags" ON user_problem_tags;
CREATE POLICY "Victims read own tags" ON user_problem_tags FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Victims upsert own tags" ON user_problem_tags;
CREATE POLICY "Victims upsert own tags" ON user_problem_tags FOR INSERT WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "Victims update own tags" ON user_problem_tags;
CREATE POLICY "Victims update own tags" ON user_problem_tags FOR UPDATE USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Authenticated read exercises" ON exercise_recommendations;
CREATE POLICY "Authenticated read exercises" ON exercise_recommendations FOR SELECT
  USING (auth.uid() IS NOT NULL AND active = true);

DROP POLICY IF EXISTS "Authenticated read slots" ON consultant_slots;
CREATE POLICY "Authenticated read slots" ON consultant_slots FOR SELECT
  USING (auth.uid() IS NOT NULL);
