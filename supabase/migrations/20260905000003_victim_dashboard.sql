-- Victim Dashboard module: instant calls, consultants, chat history, exercises.
-- Additive only. Does not replace existing distress_scores / call_sessions / cases.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Enums ────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE meet_status AS ENUM ('scheduled', 'completed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE distress_source AS ENUM ('chat', 'call', 'manual');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Extend distress_scores with source for chat | call | manual attribution
ALTER TABLE distress_scores
  ADD COLUMN IF NOT EXISTS source distress_source;

COMMENT ON COLUMN distress_scores.source IS
  'Origin of the score: chat (check-in/chatbot), call (instant/AI voice), or manual.';

-- Cached counters on profiles (avoid full scans for dashboard cards)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS instant_call_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS consultant_meet_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS case_reference TEXT,
  ADD COLUMN IF NOT EXISTS photo_url TEXT,
  ADD COLUMN IF NOT EXISTS bio TEXT;

-- ─── Instant calls (Twilio / in-browser conversational AI) ────────────────────
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
CREATE INDEX IF NOT EXISTS idx_instant_calls_twilio
  ON instant_calls (twilio_call_sid) WHERE twilio_call_sid IS NOT NULL;

-- ─── Consultants directory ────────────────────────────────────────────────────
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

CREATE INDEX IF NOT EXISTS idx_consultants_active
  ON consultants (active, active_case_count);

-- ─── Consultant assignments (auto-allot on first distress score) ──────────────
CREATE TABLE IF NOT EXISTS consultant_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  consultant_id UUID NOT NULL REFERENCES consultants(id) ON DELETE RESTRICT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_consultant_assignments_consultant
  ON consultant_assignments (consultant_id);

-- ─── Consultant meets / bookings ──────────────────────────────────────────────
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

CREATE INDEX IF NOT EXISTS idx_consultant_meets_user
  ON consultant_meets (user_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS idx_consultant_meets_consultant
  ON consultant_meets (consultant_id, scheduled_at);

-- ─── Consultant relationship updates feed ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS consultant_updates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  consultant_id UUID REFERENCES consultants(id) ON DELETE SET NULL,
  meet_id UUID REFERENCES consultant_meets(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consultant_updates_user
  ON consultant_updates (user_id, created_at DESC);

-- ─── Chat messages (RLS-scoped; not shared analytics) ─────────────────────────
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  case_id UUID REFERENCES cases(id) ON DELETE SET NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_user
  ON chat_messages (user_id, created_at DESC);

-- ─── Problem tags extracted from chat (feeds exercises) ───────────────────────
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

CREATE INDEX IF NOT EXISTS idx_user_problem_tags_user
  ON user_problem_tags (user_id);

-- ─── Exercise recommendations (tag → content mapping) ─────────────────────────
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

CREATE INDEX IF NOT EXISTS idx_exercise_recommendations_tag
  ON exercise_recommendations (tag) WHERE active;

-- Seed curated exercises (idempotent via unique title+tag)
INSERT INTO exercise_recommendations (tag, title, description, steps, duration_minutes)
SELECT * FROM (VALUES
  (
    'anxiety',
    'Box breathing',
    'A simple 4-count breath that calms the nervous system when worry spikes.',
    '["Sit comfortably with both feet on the floor.","Inhale through the nose for 4 counts.","Hold gently for 4 counts.","Exhale through the mouth for 4 counts.","Hold empty for 4 counts. Repeat 4–6 rounds."]'::jsonb,
    5
  ),
  (
    'anxiety',
    '5-4-3-2-1 grounding',
    'Name what you can sense to come back into the present moment.',
    '["Name 5 things you can see.","Name 4 things you can touch.","Name 3 things you can hear.","Name 2 things you can smell.","Name 1 thing you can taste or one kind thought."]'::jsonb,
    8
  ),
  (
    'sleep',
    'Sleep hygiene wind-down',
    'A short evening routine for restless nights.',
    '["Dim screens 45 minutes before bed.","Write one worry on paper and set it aside.","Do 5 minutes of slow breathing.","Keep the room cool and dark.","Wake at a consistent time tomorrow."]'::jsonb,
    15
  ),
  (
    'harassment',
    'Safety check-in plan',
    'Clarify who you can reach and what feels safe right now.',
    '["Identify one trusted person you can message.","Note the nearest safe place if you need to leave.","Save NHAA 14566 and emergency 112 in your phone.","Share only what feels safe — no pressure to recount everything.","Ask your allotted counsellor about protection measures."]'::jsonb,
    10
  ),
  (
    'depression',
    'Tiny activation step',
    'One small, doable action when energy is low.',
    '["Drink a glass of water.","Open a window or step outside for 2 minutes.","Send one short message to someone safe.","Note one thing that went okay today.","Rest without guilt — rest is part of recovery."]'::jsonb,
    10
  ),
  (
    'anger',
    'Cool-down release',
    'Channel intensity without harm when anger rises.',
    '["Pause and plant both feet firmly.","Exhale longer than you inhale (e.g. 4 in, 6 out).","Name the feeling aloud: \"I am angry and that is allowed.\"","Move your body for 2 minutes (walk, stretch).","Choose one safe next step, not a permanent decision."]'::jsonb,
    8
  ),
  (
    'loneliness',
    'Connection bridge',
    'Gentle ways to feel less alone without forcing social energy.',
    '["Open the Samvedna chatbot for a short check-in.","Message one person a simple \"thinking of you\".","Sit with tea and notice three sounds around you.","Book a session with your allotted counsellor when ready.","Remember: asking for company is strength, not burden."]'::jsonb,
    10
  ),
  (
    'general',
    'Daily steadiness check',
    'A brief wellness plan when tags are still forming.',
    '["Rate energy, mood, and sleep from 1–5 privately.","Do 3 rounds of slow breathing.","Drink water and eat something simple.","Note one support you used today.","Reach out if today feels heavier than usual."]'::jsonb,
    7
  )
) AS v(tag, title, description, steps, duration_minutes)
WHERE NOT EXISTS (
  SELECT 1 FROM exercise_recommendations er
  WHERE er.tag = v.tag AND er.title = v.title
);

-- ─── Available booking slots (simple weekly template) ─────────────────────────
CREATE TABLE IF NOT EXISTS consultant_slots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  consultant_id UUID NOT NULL REFERENCES consultants(id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  is_booked BOOLEAN NOT NULL DEFAULT false,
  meet_id UUID REFERENCES consultant_meets(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consultant_slots_open
  ON consultant_slots (consultant_id, starts_at)
  WHERE NOT is_booked;

-- ─── Counter maintenance triggers ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bump_instant_call_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE profiles
  SET instant_call_count = instant_call_count + 1
  WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_instant_calls_count ON instant_calls;
CREATE TRIGGER trg_instant_calls_count
  AFTER INSERT ON instant_calls
  FOR EACH ROW EXECUTE FUNCTION public.bump_instant_call_count();

CREATE OR REPLACE FUNCTION public.sync_consultant_meet_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE profiles
  SET consultant_meet_count = (
    SELECT COUNT(*)::INT FROM consultant_meets
    WHERE user_id = COALESCE(NEW.user_id, OLD.user_id)
      AND status IN ('scheduled', 'completed')
  )
  WHERE id = COALESCE(NEW.user_id, OLD.user_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_consultant_meets_count ON consultant_meets;
CREATE TRIGGER trg_consultant_meets_count
  AFTER INSERT OR UPDATE OR DELETE ON consultant_meets
  FOR EACH ROW EXECUTE FUNCTION public.sync_consultant_meet_count();

CREATE OR REPLACE FUNCTION public.bump_consultant_case_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE consultants SET active_case_count = active_case_count + 1 WHERE id = NEW.consultant_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE consultants SET active_case_count = GREATEST(0, active_case_count - 1) WHERE id = OLD.consultant_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_assignment_case_count ON consultant_assignments;
CREATE TRIGGER trg_assignment_case_count
  AFTER INSERT OR DELETE ON consultant_assignments
  FOR EACH ROW EXECUTE FUNCTION public.bump_consultant_case_count();

-- ─── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE instant_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE consultants ENABLE ROW LEVEL SECURITY;
ALTER TABLE consultant_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE consultant_meets ENABLE ROW LEVEL SECURITY;
ALTER TABLE consultant_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_problem_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE exercise_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE consultant_slots ENABLE ROW LEVEL SECURITY;

-- Instant calls: owner only
DROP POLICY IF EXISTS "Victims read own instant calls" ON instant_calls;
CREATE POLICY "Victims read own instant calls"
  ON instant_calls FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Victims insert own instant calls" ON instant_calls;
CREATE POLICY "Victims insert own instant calls"
  ON instant_calls FOR INSERT WITH CHECK (user_id = auth.uid());

-- Consultants: any authenticated user may browse active directory
DROP POLICY IF EXISTS "Authenticated browse consultants" ON consultants;
CREATE POLICY "Authenticated browse consultants"
  ON consultants FOR SELECT
  USING (auth.uid() IS NOT NULL AND active = true);

-- Assignments: own row
DROP POLICY IF EXISTS "Victims read own assignment" ON consultant_assignments;
CREATE POLICY "Victims read own assignment"
  ON consultant_assignments FOR SELECT USING (user_id = auth.uid());

-- Meets: own rows
DROP POLICY IF EXISTS "Victims read own meets" ON consultant_meets;
CREATE POLICY "Victims read own meets"
  ON consultant_meets FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Victims insert own meets" ON consultant_meets;
CREATE POLICY "Victims insert own meets"
  ON consultant_meets FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Victims update own meets" ON consultant_meets;
CREATE POLICY "Victims update own meets"
  ON consultant_meets FOR UPDATE USING (user_id = auth.uid());

-- Updates feed
DROP POLICY IF EXISTS "Victims read own consultant updates" ON consultant_updates;
CREATE POLICY "Victims read own consultant updates"
  ON consultant_updates FOR SELECT USING (user_id = auth.uid());

-- Chat: owner only (+ assigned counsellor via profile link on cases)
DROP POLICY IF EXISTS "Victims read own chat" ON chat_messages;
CREATE POLICY "Victims read own chat"
  ON chat_messages FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Victims insert own chat" ON chat_messages;
CREATE POLICY "Victims insert own chat"
  ON chat_messages FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Assigned counsellor read chat" ON chat_messages;
CREATE POLICY "Assigned counsellor read chat"
  ON chat_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM consultant_assignments ca
      JOIN consultants c ON c.id = ca.consultant_id
      WHERE ca.user_id = chat_messages.user_id
        AND c.profile_id = auth.uid()
    )
  );

-- Tags
DROP POLICY IF EXISTS "Victims read own tags" ON user_problem_tags;
CREATE POLICY "Victims read own tags"
  ON user_problem_tags FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Victims upsert own tags" ON user_problem_tags;
CREATE POLICY "Victims upsert own tags"
  ON user_problem_tags FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Victims update own tags" ON user_problem_tags;
CREATE POLICY "Victims update own tags"
  ON user_problem_tags FOR UPDATE USING (user_id = auth.uid());

-- Exercises: readable by any authenticated user
DROP POLICY IF EXISTS "Authenticated read exercises" ON exercise_recommendations;
CREATE POLICY "Authenticated read exercises"
  ON exercise_recommendations FOR SELECT
  USING (auth.uid() IS NOT NULL AND active = true);

-- Slots: browse open slots
DROP POLICY IF EXISTS "Authenticated read slots" ON consultant_slots;
CREATE POLICY "Authenticated read slots"
  ON consultant_slots FOR SELECT
  USING (auth.uid() IS NOT NULL);
