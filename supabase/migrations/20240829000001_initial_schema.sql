-- Samvedna: initial schema
-- Run via Supabase SQL Editor or `supabase db push`

-- ─── Extensions ─────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Enums ────────────────────────────────────────────────────────────────────
CREATE TYPE user_role AS ENUM ('victim', 'counsellor', 'official', 'admin');
CREATE TYPE case_status AS ENUM ('investigation', 'trial', 'rehabilitation', 'closed');
CREATE TYPE checkin_channel AS ENUM ('chat', 'ivrs', 'sms', 'app');
CREATE TYPE risk_level AS ENUM ('low', 'moderate', 'high', 'critical');
CREATE TYPE alert_status AS ENUM ('open', 'acknowledged', 'resolved');
CREATE TYPE support_type AS ENUM (
  'counselling', 'medical', 'legal', 'financial', 'protection', 'rehabilitation'
);
CREATE TYPE support_status AS ENUM ('suggested', 'in_progress', 'completed');

-- ─── Profiles (extends auth.users) ──────────────────────────────────────────
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role user_role NOT NULL DEFAULT 'victim',
  full_name TEXT NOT NULL,
  preferred_language TEXT NOT NULL DEFAULT 'en',
  phone_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Cases ────────────────────────────────────────────────────────────────────
CREATE TABLE cases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  victim_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  case_number TEXT NOT NULL UNIQUE,
  case_type TEXT NOT NULL,
  status case_status NOT NULL DEFAULT 'investigation',
  assigned_counsellor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  assigned_official_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  district TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cases_victim ON cases(victim_id);
CREATE INDEX idx_cases_counsellor ON cases(assigned_counsellor_id);
CREATE INDEX idx_cases_official ON cases(assigned_official_id);
CREATE INDEX idx_cases_district_state ON cases(district, state);

-- ─── Check-ins ────────────────────────────────────────────────────────────────
CREATE TABLE checkins (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  victim_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  channel checkin_channel NOT NULL DEFAULT 'chat',
  raw_transcript TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_checkins_case ON checkins(case_id);
CREATE INDEX idx_checkins_victim ON checkins(victim_id);
CREATE INDEX idx_checkins_created ON checkins(created_at DESC);

-- ─── Distress scores ─────────────────────────────────────────────────────────
CREATE TABLE distress_scores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  checkin_id UUID NOT NULL UNIQUE REFERENCES checkins(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
  risk_level risk_level NOT NULL,
  reasoning TEXT NOT NULL,
  signals_detected JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_distress_scores_case ON distress_scores(case_id);
CREATE INDEX idx_distress_scores_risk ON distress_scores(risk_level);
CREATE INDEX idx_distress_scores_created ON distress_scores(created_at DESC);

-- ─── Alerts ───────────────────────────────────────────────────────────────────
CREATE TABLE alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  distress_score_id UUID NOT NULL REFERENCES distress_scores(id) ON DELETE CASCADE,
  severity risk_level NOT NULL,
  status alert_status NOT NULL DEFAULT 'open',
  assigned_to UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX idx_alerts_case ON alerts(case_id);
CREATE INDEX idx_alerts_status ON alerts(status);
CREATE INDEX idx_alerts_assigned ON alerts(assigned_to);

-- ─── Support recommendations ──────────────────────────────────────────────────
CREATE TABLE support_recommendations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  alert_id UUID REFERENCES alerts(id) ON DELETE SET NULL,
  type support_type NOT NULL,
  description TEXT NOT NULL,
  status support_status NOT NULL DEFAULT 'suggested',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_support_recommendations_case ON support_recommendations(case_id);

-- ─── Case timeline events ─────────────────────────────────────────────────────
CREATE TABLE case_timeline_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  description TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_timeline_events_case ON case_timeline_events(case_id);

-- ─── Intervention notes ───────────────────────────────────────────────────────
CREATE TABLE intervention_notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  counsellor_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_intervention_notes_case ON intervention_notes(case_id);

-- ─── Onboarding tokens (victim invite links) ──────────────────────────────────
CREATE TABLE onboarding_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token TEXT NOT NULL UNIQUE,
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_onboarding_tokens_token ON onboarding_tokens(token);

-- ─── Auto-create profile on signup ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, role, full_name, preferred_language, phone_number)
  VALUES (
    NEW.id,
    COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'victim'),
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'preferred_language', 'en'),
    NEW.raw_user_meta_data->>'phone_number'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ─── Helper: get current user's role ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$;

-- ─── Row Level Security ───────────────────────────────────────────────────────
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE distress_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_timeline_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE intervention_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_tokens ENABLE ROW LEVEL SECURITY;

-- ─── Profiles policies ────────────────────────────────────────────────────────
CREATE POLICY "Users can read own profile"
  ON profiles FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY "Counsellors and officials can read assigned profiles"
  ON profiles FOR SELECT
  USING (
    public.get_my_role() IN ('counsellor', 'official', 'admin')
    AND (
      id IN (
        SELECT victim_id FROM cases
        WHERE assigned_counsellor_id = auth.uid()
           OR assigned_official_id = auth.uid()
      )
      OR id IN (
        SELECT assigned_counsellor_id FROM cases WHERE assigned_official_id = auth.uid()
      )
    )
  );

-- ─── Cases policies ───────────────────────────────────────────────────────────
CREATE POLICY "Victims can read own cases"
  ON cases FOR SELECT
  USING (victim_id = auth.uid());

CREATE POLICY "Counsellors can read assigned cases"
  ON cases FOR SELECT
  USING (
    public.get_my_role() = 'counsellor'
    AND assigned_counsellor_id = auth.uid()
  );

CREATE POLICY "Officials can read district cases"
  ON cases FOR SELECT
  USING (
    public.get_my_role() = 'official'
    AND (
      assigned_official_id = auth.uid()
      OR district IN (
        SELECT c.district FROM cases c
        JOIN profiles p ON p.id = auth.uid()
        WHERE c.assigned_official_id = auth.uid()
        LIMIT 1
      )
    )
  );

-- ─── Checkins policies ────────────────────────────────────────────────────────
CREATE POLICY "Victims can read own checkins"
  ON checkins FOR SELECT
  USING (victim_id = auth.uid());

CREATE POLICY "Victims can insert own checkins"
  ON checkins FOR INSERT
  WITH CHECK (
    victim_id = auth.uid()
    AND case_id IN (SELECT id FROM cases WHERE victim_id = auth.uid())
  );

CREATE POLICY "Counsellors can read checkins for assigned cases"
  ON checkins FOR SELECT
  USING (
    public.get_my_role() IN ('counsellor', 'official')
    AND case_id IN (
      SELECT id FROM cases
      WHERE assigned_counsellor_id = auth.uid()
         OR assigned_official_id = auth.uid()
    )
  );

-- ─── Distress scores policies ─────────────────────────────────────────────────
CREATE POLICY "Victims can read own distress scores"
  ON distress_scores FOR SELECT
  USING (
    case_id IN (SELECT id FROM cases WHERE victim_id = auth.uid())
  );

CREATE POLICY "Counsellors and officials can read distress scores"
  ON distress_scores FOR SELECT
  USING (
    public.get_my_role() IN ('counsellor', 'official')
    AND case_id IN (
      SELECT id FROM cases
      WHERE assigned_counsellor_id = auth.uid()
         OR assigned_official_id = auth.uid()
    )
  );

-- ─── Alerts policies ──────────────────────────────────────────────────────────
CREATE POLICY "Counsellors can read assigned alerts"
  ON alerts FOR SELECT
  USING (
    assigned_to = auth.uid()
    OR case_id IN (
      SELECT id FROM cases
      WHERE assigned_counsellor_id = auth.uid()
         OR assigned_official_id = auth.uid()
    )
  );

CREATE POLICY "Counsellors and officials can update alerts"
  ON alerts FOR UPDATE
  USING (
    public.get_my_role() IN ('counsellor', 'official')
    AND (
      assigned_to = auth.uid()
      OR case_id IN (
        SELECT id FROM cases WHERE assigned_official_id = auth.uid()
      )
    )
  );

-- ─── Support recommendations policies ─────────────────────────────────────────
CREATE POLICY "Staff can read support recommendations"
  ON support_recommendations FOR SELECT
  USING (
    public.get_my_role() IN ('counsellor', 'official')
    AND case_id IN (
      SELECT id FROM cases
      WHERE assigned_counsellor_id = auth.uid()
         OR assigned_official_id = auth.uid()
    )
  );

CREATE POLICY "Counsellors can insert support recommendations"
  ON support_recommendations FOR INSERT
  WITH CHECK (
    public.get_my_role() = 'counsellor'
    AND case_id IN (
      SELECT id FROM cases WHERE assigned_counsellor_id = auth.uid()
    )
  );

CREATE POLICY "Counsellors can update support recommendations"
  ON support_recommendations FOR UPDATE
  USING (
    public.get_my_role() = 'counsellor'
    AND case_id IN (
      SELECT id FROM cases WHERE assigned_counsellor_id = auth.uid()
    )
  );

-- ─── Timeline events policies ─────────────────────────────────────────────────
CREATE POLICY "Staff can read timeline events"
  ON case_timeline_events FOR SELECT
  USING (
    public.get_my_role() IN ('counsellor', 'official')
    AND case_id IN (
      SELECT id FROM cases
      WHERE assigned_counsellor_id = auth.uid()
         OR assigned_official_id = auth.uid()
    )
  );

CREATE POLICY "Staff can insert timeline events"
  ON case_timeline_events FOR INSERT
  WITH CHECK (
    public.get_my_role() IN ('counsellor', 'official')
    AND created_by = auth.uid()
  );

-- ─── Intervention notes policies ──────────────────────────────────────────────
CREATE POLICY "Counsellors can read intervention notes"
  ON intervention_notes FOR SELECT
  USING (
    public.get_my_role() IN ('counsellor', 'official')
    AND case_id IN (
      SELECT id FROM cases
      WHERE assigned_counsellor_id = auth.uid()
         OR assigned_official_id = auth.uid()
    )
  );

CREATE POLICY "Counsellors can insert intervention notes"
  ON intervention_notes FOR INSERT
  WITH CHECK (
    public.get_my_role() = 'counsellor'
    AND counsellor_id = auth.uid()
    AND case_id IN (
      SELECT id FROM cases WHERE assigned_counsellor_id = auth.uid()
    )
  );

-- ─── Onboarding tokens policies ───────────────────────────────────────────────
CREATE POLICY "Staff can manage onboarding tokens"
  ON onboarding_tokens FOR ALL
  USING (
    public.get_my_role() IN ('counsellor', 'official', 'admin')
    AND created_by = auth.uid()
  );

COMMENT ON TABLE profiles IS 'User profiles extending Supabase auth.users with role and preferences';
COMMENT ON TABLE distress_scores IS 'LLM-generated distress screening scores — triage signal, not clinical diagnosis';
COMMENT ON TABLE onboarding_tokens IS 'Temporary links for victim onboarding by counsellors/officials';
